/* storage.js — local persistence layer (localStorage) with debounced writes. */
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
  visionBoard: [], // { id, src(dataURL), caption, x, y, w, createdAt }
  challenges: [],  // { id, title, note, startAt, endAt, dueTime, days:{date:'done'|'missed'}, streak, longestStreak, createdAt }
  activeTimer: null // { id, list, startedAt, durationSec }
});

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

const Store = {
  _saveHandle: null,

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = defaultState();
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

  saveNow(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  },

  save(state, onSaved) {
    clearTimeout(this._saveHandle);
    this._saveHandle = setTimeout(() => {
      this.saveNow(state);
      if (onSaved) onSaved();
    }, 300);
  }
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
