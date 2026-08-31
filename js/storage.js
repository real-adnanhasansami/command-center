/* storage.js — local persistence layer (localStorage) + optional Firebase cloud sync.
   Local storage always works, offline, with no account. Signing in with Google adds
   real-time sync across devices for everything EXCEPT the Vision Board — those images
   are too large for Firestore's free-tier 1MB-per-document limit, so Vision Board stays
   device-local for now (see README). */

const STORAGE_KEY = 'cc_state_v2';
const LEGACY_KEY = 'cc_state_v1';

const defaultState = () => ({
  version: 2,
  meta: {
    theme: 'dark', lastWrapUp: null, notifAsked: false, tabOrder: null,
    journalTitle: 'Journal', noticeTitle: 'Updates & Notices',
    sectionLocks: {} // { sectionKey: true } — locked sections are skipped by "Erase All"
  },
  activities: { daily: [], weekly: [], monthly: [] },
  upcoming: [],
  todo: { todo: [], inprogress: [], done: [] },
  weeklyPlan: [],
  monthlyPlan: [],
  routine: { text: '' },
  notes: [],
  habits: [],
  journal: { entries: [] },
  notices: [],
  gamify: { levels: [], blockedUntil: null },
  history: [],
  visionBoard: [], // { id, src(dataURL), caption, x, y, w, createdAt } — local-only, never synced to the cloud
  challenges: [],  // { id, title, note, startAt, endAt, dueTime, days:{date:'done'|'missed'}, streak, longestStreak, createdAt }
  events: [],        // { id, eventName, organizer, host, date, time, mode, priority, perks, cost, meetId, meetPass, createdAt }
  eventsHistory: [], // same shape + { status: 'Completed'|'Canceled' }
  activeTimer: null // { id, list, startedAt, durationSec }
});

// Fills in defaults for any field missing from a saved/incoming blob (old saves, or a
// core payload from the cloud that predates a newer field) without ever dropping data
// the caller already has. Shared by local load() and cloud sync.
function normalizeState(parsed) {
  const base = defaultState();
  if (!parsed) return base;
  return {
    ...base,
    ...parsed,
    meta: { ...base.meta, ...(parsed.meta || {}), sectionLocks: { ...base.meta.sectionLocks, ...((parsed.meta || {}).sectionLocks || {}) } },
    activities: { ...base.activities, ...(parsed.activities || {}) },
    todo: { ...base.todo, ...(parsed.todo || {}) },
    routine: { ...base.routine, ...(parsed.routine || {}) },
    journal: { ...base.journal, ...(parsed.journal || {}) },
    gamify: { ...base.gamify, ...(parsed.gamify || {}) }
  };
}

function migrateFromV1(old) {
  const base = defaultState();
  if (!old) return base;
  try {
    if (old.tasks) {
      base.activities.daily = old.tasks.daily || [];
      base.activities.weekly = old.tasks.weekly || [];
      base.activities.monthly = old.tasks.monthly || [];
      base.upcoming = old.tasks.upcoming || [];
    }
    if (old.kanban) {
      base.todo.todo = old.kanban.todo || [];
      base.todo.inprogress = old.kanban.inprogress || [];
      base.todo.done = old.kanban.done || [];
    }
    base.notes = old.notes || [];
    base.habits = (old.habits || []).map(h => ({ ...h, freq: h.freq || 'daily' }));
    base.journal = old.journal || { entries: [] };
    if (old.meta) base.meta.theme = old.meta.theme || 'dark';
  } catch (e) { console.warn('Migration from v1 partially failed', e); }
  return base;
}

// ================= CLOUD SYNC (Firebase, optional) =================
// A random id for this browser tab/session — lets us recognize and ignore the
// real-time echo of our OWN writes coming back from Firestore, so we don't
// re-render/stomp on something the user is actively typing.
const CLIENT_ID = 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
let fbApp = null, fbAuth = null, fbDb = null, coreUnsub = null;

function cloudReady() {
  if (fbApp) return true;
  if (typeof firebase === 'undefined' || typeof FIREBASE_CONFIG === 'undefined') return false;
  try {
    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    return true;
  } catch (e) { console.error('Firebase init failed', e); return false; }
}

function coreDocRef(uid) { return fbDb.collection('users').doc(uid); }

const Cloud = {
  get available() { return cloudReady(); },

  onAuthChange(cb) {
    if (!cloudReady()) { cb(null); return; }
    fbAuth.onAuthStateChanged(cb);
  },

  signIn() {
    if (!cloudReady()) return Promise.reject(new Error('Cloud sync isn\'t available right now.'));
    return fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  },

  signOut() {
    this.stopSync();
    return fbAuth ? fbAuth.signOut() : Promise.resolve();
  },

  getUser() { return fbAuth ? fbAuth.currentUser : null; },

  // Does this account already have anything saved in the cloud?
  hasData(uid) {
    return coreDocRef(uid).get().then(snap => !!(snap.exists && snap.data() && snap.data().state));
  },

  // One-time full read (used for the "use cloud data on this device" choice).
  pullOnce(uid) {
    return coreDocRef(uid).get().then(snap => (snap.exists && snap.data() ? snap.data().state : null));
  },

  // Writes everything except Vision Board (see file header) up to the cloud.
  pushCore(uid, state) {
    if (!uid || !fbDb) return Promise.resolve();
    const { visionBoard, ...rest } = state;
    return coreDocRef(uid).set({
      state: { ...rest, visionBoard: [] },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      clientWriteId: CLIENT_ID
    }).catch(e => console.error('Cloud save failed', e));
  },

  // Starts listening for changes made on OTHER devices/tabs. onRemoteState(coreState)
  // fires only for genuine remote changes — our own writes are filtered out.
  startSync(uid, onRemoteState) {
    this.stopSync();
    coreUnsub = coreDocRef(uid).onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();
      if (!data || data.clientWriteId === CLIENT_ID || !data.state) return;
      onRemoteState(data.state);
    }, err => console.error('Cloud sync listener error', err));
  },

  stopSync() {
    if (coreUnsub) { coreUnsub(); coreUnsub = null; }
  }
};

const Store = {
  _saveHandle: null,

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const migrated = migrateFromV1(JSON.parse(legacyRaw));
        this.saveNow(migrated);
        return migrated;
      }
      return defaultState();
    } catch (e) {
      console.error('Failed to load state, starting fresh.', e);
      return defaultState();
    }
  },

  // Local-only write, no cloud push — used for caching an incoming remote update, and
  // for anything that shouldn't echo straight back up to the cloud.
  saveNow(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  },

  // Debounced local save — also pushes to the cloud (debounced together) if signed in.
  save(state, onSaved) {
    clearTimeout(this._saveHandle);
    this._saveHandle = setTimeout(() => {
      this.saveNow(state);
      const user = Cloud.getUser();
      if (user) Cloud.pushCore(user.uid, state);
      if (onSaved) onSaved();
    }, 300);
  },

  cloud: Cloud,
  normalizeState
};

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function todayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
}

// Deadline urgency classification, shared across To-Do / Weekly Plan / Monthly Plan.
function deadlineInfo(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const diffDays = Math.round((d - today) / 86400000);
  let label, cls;
  if (diffDays < 0) { label = `Overdue ${Math.abs(diffDays)}d`; cls = 'overdue'; }
  else if (diffDays === 0) { label = 'Due today'; cls = 'urgent'; }
  else if (diffDays === 1) { label = '1 day left'; cls = 'urgent'; }
  else if (diffDays <= 3) { label = `${diffDays} days left`; cls = 'soon'; }
  else { label = `${diffDays} days left`; cls = 'normal'; }
  return { label, cls, diffDays, dateStr };
}