/* app.js — Command Center application logic. Vanilla JS, no build step. */
(() => {
  'use strict';

  let state = Store.load();

  // ---------- self-healing data repair ----------
  // Older saves (from earlier versions that generated ids as raw numbers/timestamps
  // instead of strings) can end up with an `id` that's a Number while every lookup
  // compares against `row.dataset.id`, which the browser always gives back as a
  // String — so `1769970513003 === "1769970513003"` is false, and every button on
  // that one item silently does nothing, while newly-added items (always string ids)
  // work fine. This normalizes every id to a string, and backfills/deduplicates any
  // id that's missing or collides with another item's id, fixing both causes at once
  // without losing any data.
  (function repairIds() {
    const seen = new Set();
    let changed = false;
    const arrays = [
      state.events, state.eventsHistory,
      state.activities.daily, state.activities.weekly, state.activities.monthly,
      state.upcoming, state.todo.todo, state.todo.inprogress, state.todo.done,
      state.weeklyPlan, state.monthlyPlan, state.notes, state.habits,
      (state.gamify && state.gamify.levels) || [], state.visionBoard, state.challenges,
      state.focus.dailyMusts, state.focus.top3, state.focus.important, state.focus.optional,
      state.research.log
    ];
    arrays.forEach(arr => {
      if (!Array.isArray(arr)) return;
      arr.forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (item.id === undefined || item.id === null || item.id === '') { item.id = uid(); changed = true; }
        else if (typeof item.id !== 'string') { item.id = String(item.id); changed = true; }
        if (seen.has(item.id)) { item.id = uid(); changed = true; }
        seen.add(item.id);
      });
    });
    if (changed) Store.saveNow(state);
  })();

  document.documentElement.setAttribute('data-theme', state.meta.theme || 'dark');

  const PRIORITY_LABEL = { mandatory: '🔴 Mandatory', important: '🟡 Important', optional: '🟢 Optional' };
  let dragSrc = null;
  let calViewDate = new Date();
  let selectedCalDate = null;
  let journalDate = todayKey();

  // ---------- persistence ----------
  let suppressAutoSave = false;
  function persist(silent) { Store.save(state, () => { if (!silent) toast('Saved'); }); }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---------- helpers ----------
  function formatMinutes(total) {
    total = Math.round(total || 0);
    const h = Math.floor(total / 60), m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function formatSeconds(total) {
    total = Math.max(0, Math.round(total || 0));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function getListArray(listKey) { return listKey === 'upcoming' ? state.upcoming : state.activities[listKey]; }
  function findTask(listKey, id) { return getListArray(listKey).find(t => t.id === id); }

  // ================= HISTORY =================
  const SECTION_LABELS = {
    daily: 'Activities · Daily', weekly: 'Activities · Weekly', monthly: 'Activities · Monthly',
    upcoming: 'Upcoming', weeklyPlan: 'Weekly Plan', monthlyPlan: 'Monthly Plan', todo: 'To-Do Board', levels: 'Levels',
    challenges: 'Challenges', events: 'Events',
    dailyMusts: 'Focus · Daily Musts', top3: 'Focus · Top 3 Mandatory', important: 'Focus · Important', optional: 'Focus · Optional'
  };
  // Keyed by sectionKey+itemId so repeatedly ticking/unticking the same item never creates
  // duplicate History rows — it's an upsert, not a blind push.
  function addHistory(sectionKey, itemId, text) {
    state.history = state.history || [];
    const key = `${sectionKey}:${itemId}`;
    const existing = state.history.find(h => h.key === key);
    if (existing) { existing.text = text; existing.completedAt = Date.now(); }
    else state.history.push({ id: uid(), key, sectionKey, sectionLabel: SECTION_LABELS[sectionKey] || sectionKey, text, completedAt: Date.now() });
    if (typeof renderHistory === 'function') renderHistory();
  }
  function removeHistory(sectionKey, itemId) {
    if (!state.history) return;
    const key = `${sectionKey}:${itemId}`;
    state.history = state.history.filter(h => h.key !== key);
    if (typeof renderHistory === 'function') renderHistory();
  }

  // ================= NAVIGATION =================
  function switchView(view) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  }
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchView(btn.dataset.view);
  });

  // ================= LIVE CLOCK =================
  setInterval(() => { document.getElementById('liveClock').textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);
  document.getElementById('liveClock').textContent = new Date().toLocaleTimeString([], { hour12: false });

  // ================= THEME =================
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = state.meta.theme === 'dark' ? 'light' : 'dark';
    state.meta.theme = next;
    document.documentElement.setAttribute('data-theme', next);
    document.getElementById('themeToggle').textContent = next === 'dark' ? '🌙' : '☀️';
    persist(true);
  });
  document.getElementById('themeToggle').textContent = state.meta.theme === 'dark' ? '🌙' : '☀️';

  // ================= DRAG-REORDER NAV TABS =================
  function applyTabOrder() {
    if (!state.meta.tabOrder) return;
    const tabsEl = document.getElementById('tabs');
    state.meta.tabOrder.forEach(view => {
      const el = tabsEl.querySelector(`.tab[data-view="${view}"]`);
      if (el) tabsEl.appendChild(el);
    });
  }
  function saveTabOrder() {
    state.meta.tabOrder = [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.view);
    persist(true);
  }
  function wireTabDragging() {
    let tabDragSrc = null;
    document.querySelectorAll('.tab').forEach(tab => {
      tab.setAttribute('draggable', 'true');
      tab.addEventListener('dragstart', () => { tabDragSrc = tab.dataset.view; tab.classList.add('dragging'); });
      tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
      tab.addEventListener('dragover', (e) => e.preventDefault());
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!tabDragSrc || tabDragSrc === tab.dataset.view) return;
        const tabsEl = document.getElementById('tabs');
        const srcEl = tabsEl.querySelector(`.tab[data-view="${tabDragSrc}"]`);
        const rect = tab.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;
        tabsEl.insertBefore(srcEl, before ? tab : tab.nextSibling);
        saveTabOrder();
        tabDragSrc = null;
      });
    });
  }
  applyTabOrder();
  wireTabDragging();

  // ================= EXPORT / IMPORT / POWER RESET =================
  function exportBackup(filenameTag) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `command-center-${filenameTag || 'backup'}-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  document.getElementById('exportBtn').addEventListener('click', () => {
    exportBackup('backup');
    toast('Backup exported.');
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!confirm('Import this backup and replace ALL current data on this device?')) { e.target.value = ''; return; }
        suppressAutoSave = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        toast('Imported — reloading…');
        setTimeout(() => location.reload(), 500);
      } catch (err) {
        alert('That file is not a valid Command Center backup (invalid JSON).');
      }
    };
    reader.readAsText(file);
  });
  // Sections that can be individually locked out of "Erase All" — see the 🔒 Erase Locks
  // panel on the History tab.
  const LOCK_SECTIONS = [
    { key: 'activities', label: 'Activities (Daily/Weekly/Monthly)' },
    { key: 'todo', label: 'To-Do Board' },
    { key: 'weeklyPlan', label: 'Weekly Plan' },
    { key: 'monthlyPlan', label: 'Monthly Plan' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'routine', label: 'Routine' },
    { key: 'notes', label: 'Sticky Notes' },
    { key: 'habits', label: 'Habits' },
    { key: 'journal', label: 'Journal' },
    { key: 'notices', label: 'Notices' },
    { key: 'gamify', label: 'Levels' },
    { key: 'history', label: 'History' },
    { key: 'visionBoard', label: 'Vision Board' },
    { key: 'challenges', label: 'Challenges' },
    { key: 'events', label: 'Events' },
    { key: 'eventsHistory', label: 'Events · Past Records' },
    { key: 'focus', label: 'Focus Tasks (Daily Musts/Top 3/Important/Optional)' },
    { key: 'entertainment', label: 'Entertainment Zone balance' },
    { key: 'research', label: 'Research log' }
  ];
  function renderLockGrid() {
    const grid = document.getElementById('lockGrid');
    if (!grid) return;
    const locks = state.meta.sectionLocks || (state.meta.sectionLocks = {});
    grid.innerHTML = LOCK_SECTIONS.map(s => `
      <label class="lock-row">
        <input type="checkbox" class="lock-check" data-key="${s.key}" ${locks[s.key] ? 'checked' : ''} />
        <span>${esc(s.label)}</span>
      </label>`).join('');
    grid.querySelectorAll('.lock-check').forEach(cb => {
      cb.addEventListener('change', () => {
        locks[cb.dataset.key] = cb.checked;
        persist(true);
      });
    });
  }
  document.getElementById('powerResetBtn').addEventListener('click', () => {
    const locks = state.meta.sectionLocks || {};
    const lockedLabels = LOCK_SECTIONS.filter(s => locks[s.key]).map(s => s.label);
    const lockNote = lockedLabels.length ? `\n\nLocked (kept safe): ${lockedLabels.join(', ')}` : '\n\nNothing is locked — everything will be erased. Lock sections first from the History tab if you want to keep some.';
    if (!confirm(`⚠️ Erase All — this wipes tasks, plans, notes, journal, habits, levels, etc. This cannot be undone.${lockNote}\n\nContinue?`)) return;
    if (!confirm('A safety backup will download automatically before erasing. Continue?')) return;
    exportBackup('autobackup-before-erase');
    const preserved = {};
    LOCK_SECTIONS.forEach(s => { if (locks[s.key]) preserved[s.key] = JSON.parse(JSON.stringify(state[s.key])); });
    suppressAutoSave = true;
    setTimeout(() => {
      const fresh = defaultState();
      fresh.meta.theme = state.meta.theme;
      fresh.meta.tabOrder = state.meta.tabOrder;
      fresh.meta.journalTitle = state.meta.journalTitle;
      fresh.meta.noticeTitle = state.meta.noticeTitle;
      fresh.meta.sectionLocks = locks;
      Object.keys(preserved).forEach(k => { fresh[k] = preserved[k]; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      localStorage.removeItem(LEGACY_KEY);
      location.reload();
    }, 400); // give the download a moment to actually start
  });

  // ================= NOTIFICATIONS + SOUND =================
  function ensureNotifPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission();
  }
  function notify(title, body) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: 'icons/icon-192.png' });
      }
    } catch (e) { /* not fatal */ }
  }
  function playDing() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [880, 1108, 1320].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        o.connect(g); g.connect(ctx.destination);
        const t0 = ctx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0.001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
        o.start(t0); o.stop(t0 + 0.32);
      });
      setTimeout(() => ctx.close(), 800);
    } catch (e) { /* audio not available */ }
  }

  // ================= QUICK ADD =================
  const qaOverlay = document.getElementById('quickAddOverlay');
  function openQuickAdd() {
    qaOverlay.classList.add('open');
    document.getElementById('qaText').value = '';
    setTimeout(() => document.getElementById('qaText').focus(), 30);
  }
  function closeQuickAdd() { qaOverlay.classList.remove('open'); }
  qaOverlay.addEventListener('click', (e) => { if (e.target === qaOverlay) closeQuickAdd(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (e.altKey && e.key.toLowerCase() === 'n')) { e.preventDefault(); openQuickAdd(); }
    else if (e.key === 'Escape') closeQuickAdd();
  });
  document.getElementById('quickAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = document.getElementById('qaText').value.trim();
    if (!text) return;
    const listKey = document.getElementById('qaList').value;
    const priority = document.getElementById('qaPriority').value;
    getListArray(listKey).push({ id: uid(), text, priority, minutes: 0, done: false, actualSeconds: 0, createdAt: Date.now() });
    closeQuickAdd();
    persist(); renderAll();
  });

  // ================= TASK ROWS (Activities + Upcoming share this) =================
  function timerRemaining(t, listKey) {
    const at = state.activeTimer;
    const running = at && at.id === t.id && at.list === listKey;
    return running ? Math.max(0, at.durationSec - (Date.now() - at.startedAt) / 1000) : (t.actualSeconds || 0);
  }
  function taskRowHTML(t, listKey) {
    const at = state.activeTimer;
    const running = at && at.id === t.id && at.list === listKey;
    const remaining = timerRemaining(t, listKey);
    const urgent = running && remaining < 60;
    return `
    <li class="task-row ${t.done ? 'done' : ''}" draggable="true" data-id="${t.id}" data-list="${listKey}">
      <span class="priority-flag ${t.priority}" title="${PRIORITY_LABEL[t.priority]}"></span>
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''} />
      <input type="text" class="task-text" value="${esc(t.text)}" />
      <input type="number" class="task-minutes-input mono" min="0" value="${t.minutes || 0}" title="Countdown duration (minutes)" />
      <div class="timer-box">
        <span class="timer-display mono ${urgent ? 'urgent' : ''}" data-timer-for="${t.id}">${formatSeconds(remaining)}</span>
        <button class="timer-btn ${running ? 'running' : ''}" title="${running ? 'Stop' : 'Start'} countdown">${running ? '⏸' : '▶'}</button>
      </div>
      <div class="row-actions">
        <button class="row-btn danger del-btn" title="Delete">✕</button>
      </div>
    </li>`;
  }
  function renderGenericList(arr, ulId, summaryId, listKey) {
    const ul = document.getElementById(ulId);
    ul.innerHTML = arr.length ? arr.map(t => taskRowHTML(t, listKey)).join('') : `<li class="empty-state">Nothing here yet — add your first item above.</li>`;
    const totalMinutes = arr.reduce((s, t) => s + (t.minutes || 0), 0);
    const doneCount = arr.filter(t => t.done).length;
    const pct = arr.length ? Math.round((doneCount / arr.length) * 100) : 0;
    document.getElementById(summaryId).innerHTML = `<b>${pct}%</b> / ${formatMinutes(totalMinutes)} planned`;
    wireTaskRows(ul, listKey);
  }
  function wireTaskRows(ul, listKey) {
    ul.querySelectorAll('.task-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.task-check').addEventListener('change', (e) => {
        const t = findTask(listKey, id);
        t.done = e.target.checked;
        if (e.target.checked) addHistory(listKey, t.id, t.text); else removeHistory(listKey, t.id);
        persist(); renderAll();
      });
      const textInput = row.querySelector('.task-text');
      textInput.addEventListener('blur', () => {
        const t = findTask(listKey, id);
        if (t && textInput.value.trim() && textInput.value.trim() !== t.text) { t.text = textInput.value.trim(); persist(true); }
      });
      textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') textInput.blur(); });
      textInput.addEventListener('mousedown', (e) => e.stopPropagation());

      const minInput = row.querySelector('.task-minutes-input');
      minInput.addEventListener('mousedown', (e) => e.stopPropagation());
      minInput.addEventListener('change', () => {
        const t = findTask(listKey, id);
        if (t) { t.minutes = Math.max(0, Number(minInput.value) || 0); persist(true); }
      });

      row.querySelector('.del-btn').addEventListener('click', () => {
        if (listKey === 'upcoming') state.upcoming = state.upcoming.filter(t => t.id !== id);
        else state.activities[listKey] = state.activities[listKey].filter(t => t.id !== id);
        if (state.activeTimer && state.activeTimer.id === id && state.activeTimer.list === listKey) state.activeTimer = null;
        persist(); renderAll();
      });
      row.querySelector('.timer-btn').addEventListener('click', () => toggleTimer(id, listKey));
      row.querySelectorAll('button').forEach(btn => { btn.setAttribute('draggable', 'false'); btn.addEventListener('mousedown', (e) => e.stopPropagation()); });

      row.addEventListener('dragstart', () => { dragSrc = { id, list: listKey }; row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); row.classList.remove('drag-over');
        if (!dragSrc || dragSrc.list !== listKey) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        moveWithinList(listKey, dragSrc.id, id, before);
        dragSrc = null;
      });
    });
  }
  function moveWithinList(listKey, srcId, targetId, before) {
    const arr = getListArray(listKey);
    const idx = arr.findIndex(t => t.id === srcId);
    if (idx === -1) return;
    const [item] = arr.splice(idx, 1);
    let insertAt = arr.length;
    if (targetId) {
      const ti = arr.findIndex(t => t.id === targetId);
      insertAt = before ? ti : ti + 1;
      if (ti === -1) insertAt = arr.length;
    }
    arr.splice(insertAt, 0, item);
    persist(); renderAll();
  }

  // ---------- countdown timer ----------
  function stopActiveTimer() {
    const at = state.activeTimer;
    if (!at) return;
    const t = findTask(at.list, at.id);
    if (t) t.actualSeconds += (Date.now() - at.startedAt) / 1000;
    state.activeTimer = null;
  }
  function toggleTimer(id, listKey) {
    const at = state.activeTimer;
    if (at && at.id === id && at.list === listKey) {
      stopActiveTimer();
    } else {
      const t = findTask(listKey, id);
      if (!t.minutes || t.minutes <= 0) { toast('Set a countdown duration (minutes) first'); return; }
      stopActiveTimer();
      ensureNotifPermission();
      state.activeTimer = { id, list: listKey, startedAt: Date.now(), durationSec: t.minutes * 60 };
    }
    persist(); renderAll();
  }
  setInterval(() => {
    const at = state.activeTimer;
    if (!at) return;
    const t = findTask(at.list, at.id);
    if (!t) { state.activeTimer = null; return; }
    const remaining = at.durationSec - (Date.now() - at.startedAt) / 1000;
    if (remaining <= 0) {
      t.actualSeconds += at.durationSec;
      state.activeTimer = null;
      playDing();
      notify('⏰ Countdown finished', `"${t.text}" is done.`);
      toast(`⏰ "${t.text}" countdown finished!`);
      persist(true); renderAll();
      return;
    }
    const el = document.querySelector(`.timer-display[data-timer-for="${at.id}"]`);
    if (el) { el.textContent = formatSeconds(remaining); el.classList.toggle('urgent', remaining < 60); }
    if (Date.now() % 15000 < 1000) persist(true);
    renderDashboardStats();
  }, 1000);

  // ================= ACTIVITIES =================
  function renderActivityList() {
    const sub = document.getElementById('activitySubList').value;
    renderGenericList(state.activities[sub], 'activityList', 'activityTimeSummary', sub);
  }
  document.getElementById('activitySubList').addEventListener('change', renderActivityList);
  document.getElementById('activityAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sub = document.getElementById('activitySubList').value;
    const form = e.target;
    const text = form.querySelector('.new-task-text').value.trim();
    if (!text) return;
    const priority = form.querySelector('.new-task-priority').value;
    const minutes = Number(form.querySelector('.new-task-minutes').value) || 0;
    state.activities[sub].push({ id: uid(), text, priority, minutes, done: false, actualSeconds: 0, createdAt: Date.now() });
    form.reset();
    persist(); renderAll();
  });

  // ================= UPCOMING =================
  function renderUpcomingList() { renderGenericList(state.upcoming, 'upcomingList', 'upcomingTimeSummary', 'upcoming'); }
  document.getElementById('upcomingAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const text = form.querySelector('.new-task-text').value.trim();
    if (!text) return;
    const priority = form.querySelector('.new-task-priority').value;
    const minutes = Number(form.querySelector('.new-task-minutes').value) || 0;
    state.upcoming.push({ id: uid(), text, priority, minutes, done: false, actualSeconds: 0, createdAt: Date.now() });
    form.reset();
    persist(); renderAll();
  });

  // ================= TO-DO BOARD =================
  const STATUS_ID = { todo: 'todoTodo', inprogress: 'todoInprogress', done: 'todoDone' };
  const COUNT_ID = { todo: 'countTodo', inprogress: 'countInprogress', done: 'countDone' };
  function renderTodo() {
    ['todo', 'inprogress', 'done'].forEach(status => {
      const ul = document.getElementById(STATUS_ID[status]);
      const cards = state.todo[status];
      ul.innerHTML = cards.length ? cards.map(c => {
        const dl = deadlineInfo(c.deadline);
        return `
        <li class="kanban-card" draggable="true" data-id="${c.id}" data-status="${status}">
          <div class="kc-top">
            ${status !== 'done' ? `<button class="todo-check-btn" title="Mark complete">✓</button>` : `<span class="todo-check-btn" style="border-color:var(--optional);color:var(--optional);">✓</span>`}
            <span class="kc-text">${esc(c.text)}</span>
            <button class="row-btn danger del-kc" title="Delete">✕</button>
          </div>
          ${dl ? `<span class="deadline-badge ${dl.cls}">${dl.label}</span>` : ''}
        </li>`;
      }).join('') : '';
      document.getElementById(COUNT_ID[status]).textContent = cards.length;

      ul.querySelectorAll('.kanban-card').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.del-kc').addEventListener('click', () => {
          state.todo[status] = state.todo[status].filter(c => c.id !== id);
          persist(); renderTodo(); renderDashboardStats(); renderCalendar();
        });
        const checkBtn = card.querySelector('.todo-check-btn');
        if (status !== 'done' && checkBtn) {
          checkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = state.todo[status].findIndex(c => c.id === id);
            if (idx === -1) return;
            const [item] = state.todo[status].splice(idx, 1);
            state.todo.done.push(item);
            addHistory('todo', item.id, item.text);
            persist(); renderTodo(); renderDashboardStats(); renderCalendar();
          });
        }
        card.addEventListener('dragstart', () => { dragSrc = { id, list: status, kind: 'kanban' }; card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => e.preventDefault());
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          if (!dragSrc || dragSrc.kind !== 'kanban') return;
          const rect = card.getBoundingClientRect();
          const before = (e.clientY - rect.top) < rect.height / 2;
          moveKanban(dragSrc, status, id, before);
          dragSrc = null;
        });
      });
      ul.addEventListener('dragover', (e) => e.preventDefault());
      ul.addEventListener('drop', (e) => {
        if (e.target !== ul) return;
        if (!dragSrc || dragSrc.kind !== 'kanban') return;
        moveKanban(dragSrc, status, null, false);
        dragSrc = null;
      });
    });
  }
  function moveKanban(src, targetStatus, targetId, before) {
    const srcArr = state.todo[src.list];
    const idx = srcArr.findIndex(c => c.id === src.id);
    if (idx === -1) return;
    const [item] = srcArr.splice(idx, 1);
    if (targetStatus === 'done' && src.list !== 'done') addHistory('todo', item.id, item.text);
    else if (src.list === 'done' && targetStatus !== 'done') removeHistory('todo', item.id);
    const destArr = state.todo[targetStatus];
    let insertAt = destArr.length;
    if (targetId) {
      const ti = destArr.findIndex(c => c.id === targetId);
      insertAt = before ? ti : ti + 1;
      if (ti === -1) insertAt = destArr.length;
    }
    destArr.splice(insertAt, 0, item);
    persist(); renderTodo(); renderDashboardStats(); renderCalendar();
  }
  document.getElementById('todoAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const textInput = document.getElementById('todoText');
    const deadlineInput = document.getElementById('todoDeadline');
    const text = textInput.value.trim();
    if (!text) return;
    state.todo.todo.push({ id: uid(), text, deadline: deadlineInput.value || null, createdAt: Date.now() });
    textInput.value = ''; deadlineInput.value = '';
    persist(); renderTodo(); renderDashboardStats(); renderCalendar();
  });

  // ================= WEEKLY / MONTHLY PLAN =================
  function planRowHTML(p) {
    const dl = deadlineInfo(p.deadline);
    const when = [p.date, p.time].filter(Boolean).join('  ');
    return `<li class="plan-row ${p.done ? 'done' : ''}" data-id="${p.id}">
      <input type="checkbox" class="plan-check" ${p.done ? 'checked' : ''} />
      <span class="plan-text">${esc(p.text)}</span>
      <div class="plan-meta">
        ${when ? `<span class="plan-when mono">${esc(when)}</span>` : ''}
        ${dl ? `<span class="deadline-badge ${dl.cls}">${dl.label}</span>` : ''}
        <button class="row-btn danger del-plan" title="Delete">✕</button>
      </div>
    </li>`;
  }
  function renderPlanList(listName, ulId) {
    const arr = state[listName];
    const ul = document.getElementById(ulId);
    const sorted = [...arr].sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
    ul.innerHTML = sorted.length ? sorted.map(planRowHTML).join('') : `<li class="empty-state">Nothing planned yet.</li>`;
    ul.querySelectorAll('.plan-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.plan-check').addEventListener('change', (e) => {
        const p = state[listName].find(x => x.id === id);
        p.done = e.target.checked;
        if (e.target.checked) addHistory(listName, p.id, p.text); else removeHistory(listName, p.id);
        persist(); renderAll();
      });
      row.querySelector('.del-plan').addEventListener('click', () => {
        state[listName] = state[listName].filter(x => x.id !== id);
        persist(); renderAll();
      });
    });
  }
  function wirePlanForm(formId, listName) {
    document.getElementById(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const text = form.querySelector('.plan-text').value.trim();
      if (!text) return;
      const date = form.querySelector('.plan-date').value || null;
      const time = form.querySelector('.plan-time').value || null;
      const deadline = form.querySelector('.plan-deadline').value || null;
      state[listName].push({ id: uid(), text, date, time, deadline, done: false, createdAt: Date.now() });
      form.reset();
      persist(); renderAll();
    });
  }
  wirePlanForm('weeklyPlanForm', 'weeklyPlan');
  wirePlanForm('monthlyPlanForm', 'monthlyPlan');

  // ================= CALENDAR =================
  function collectCalIndex() {
    const index = {};
    const add = (dateStr, type) => { if (!dateStr) return; (index[dateStr] = index[dateStr] || []).push(type); };
    [...state.todo.todo, ...state.todo.inprogress, ...state.todo.done].forEach(c => add(c.deadline, 'todo'));
    state.weeklyPlan.forEach(p => { add(p.date, 'weekly'); if (p.deadline && p.deadline !== p.date) add(p.deadline, 'weekly'); });
    state.monthlyPlan.forEach(p => { add(p.date, 'monthly'); if (p.deadline && p.deadline !== p.date) add(p.deadline, 'monthly'); });
    state.gamify.levels.forEach(l => { if (l.mode === 'datetime' && l.deadlineAt) add(todayKey(new Date(l.deadlineAt)), 'level'); });
    return index;
  }
  function renderCalendar() {
    const y = calViewDate.getFullYear(), m = calViewDate.getMonth();
    document.getElementById('calLabel').textContent = calViewDate.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const index = collectCalIndex();
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
    const startOffset = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = todayKey();
    for (let i = 0; i < startOffset; i++) html += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evts = index[dateStr] || [];
      const dots = evts.slice(0, 6).map(t => `<span class="dot dot-${t}"></span>`).join('');
      html += `<div class="cal-cell ${dateStr === todayStr ? 'today' : ''} ${dateStr === selectedCalDate ? 'selected' : ''}" data-date="${dateStr}">
        <span class="cal-daynum">${d}</span><div class="cal-dots">${dots}</div>
      </div>`;
    }
    document.getElementById('calGrid').innerHTML = html;
    document.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => { selectedCalDate = cell.dataset.date; renderCalendar(); showCalDay(selectedCalDate); });
    });
  }
  function showCalDay(dateStr) {
    const items = [];
    [...state.todo.todo, ...state.todo.inprogress, ...state.todo.done].forEach(c => { if (c.deadline === dateStr) items.push({ text: c.text, src: 'To-Do deadline' }); });
    state.weeklyPlan.forEach(p => {
      if (p.date === dateStr) items.push({ text: p.text, src: 'Weekly plan' });
      if (p.deadline === dateStr && p.deadline !== p.date) items.push({ text: p.text, src: 'Weekly deadline' });
    });
    state.monthlyPlan.forEach(p => {
      if (p.date === dateStr) items.push({ text: p.text, src: 'Monthly plan' });
      if (p.deadline === dateStr && p.deadline !== p.date) items.push({ text: p.text, src: 'Monthly deadline' });
    });
    state.gamify.levels.forEach(l => {
      if (l.mode === 'datetime' && l.deadlineAt && todayKey(new Date(l.deadlineAt)) === dateStr) items.push({ text: l.text, src: 'Level deadline' });
    });
    document.getElementById('calDayTitle').textContent = dateStr;
    document.getElementById('calDayList').innerHTML = items.length
      ? items.map(i => `<li class="plan-row"><span class="plan-text">${esc(i.text)}</span><span class="hint">${i.src}</span></li>`).join('')
      : `<li class="empty-state">Nothing on this day.</li>`;
    document.getElementById('calDayPanel').style.display = 'block';
  }
  document.getElementById('calPrev').addEventListener('click', () => { calViewDate.setMonth(calViewDate.getMonth() - 1); renderCalendar(); });
  document.getElementById('calNext').addEventListener('click', () => { calViewDate.setMonth(calViewDate.getMonth() + 1); renderCalendar(); });

  // ================= ROUTINE =================
  const routineEl = document.getElementById('routineText');
  let routineSaveHandle = null;
  routineEl.addEventListener('input', () => {
    state.routine.text = routineEl.value;
    clearTimeout(routineSaveHandle);
    routineSaveHandle = setTimeout(() => persist(true), 500);
  });

  // ================= STICKY NOTES =================
  function renderNotes() {
    const canvas = document.getElementById('notesCanvas');
    canvas.innerHTML = state.notes.map(n => `
      <div class="sticky-note color-${n.color}" data-id="${n.id}" style="left:${n.x}px; top:${n.y}px;">
        <div class="note-top"><button class="note-del" title="Delete">✕</button></div>
        <textarea placeholder="Jot something down…">${esc(n.text)}</textarea>
      </div>`).join('');
    canvas.querySelectorAll('.sticky-note').forEach(el => {
      const id = el.dataset.id;
      const note = state.notes.find(n => n.id === id);
      el.querySelector('.note-del').addEventListener('click', () => { state.notes = state.notes.filter(n => n.id !== id); persist(); renderNotes(); });
      const ta = el.querySelector('textarea');
      ta.addEventListener('mousedown', (e) => e.stopPropagation());
      ta.addEventListener('input', () => { note.text = ta.value; persist(true); });
      let dragging = false, offX = 0, offY = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.target === ta || e.target.closest('.note-del')) return;
        dragging = true; el.setPointerCapture(e.pointerId);
        offX = e.clientX - el.offsetLeft; offY = e.clientY - el.offsetTop;
      });
      el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        let nx = Math.max(0, Math.min(e.clientX - offX, rect.width - el.offsetWidth));
        let ny = Math.max(0, Math.min(e.clientY - offY, rect.height - el.offsetHeight));
        el.style.left = nx + 'px'; el.style.top = ny + 'px'; note.x = nx; note.y = ny;
      });
      ['pointerup', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { if (dragging) { dragging = false; persist(true); } }));
    });
  }
  document.getElementById('noteAddSwatches').addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch');
    if (!btn) return;
    const canvas = document.getElementById('notesCanvas');
    state.notes.push({ id: uid(), color: btn.dataset.color, text: '', x: 20 + Math.random() * Math.max(40, canvas.clientWidth - 240), y: 20 + Math.random() * 120 });
    persist(); renderNotes();
  });

  // ================= VISION BOARD =================
  function renderVisionBoard() {
    const canvas = document.getElementById('visionCanvas');
    const empty = document.getElementById('visionEmptyState');
    if (empty) empty.style.display = state.visionBoard.length ? 'none' : 'flex';
    canvas.querySelectorAll('.vision-item').forEach(el => el.remove());
    state.visionBoard.forEach(v => {
      const el = document.createElement('div');
      el.className = 'vision-item';
      el.dataset.id = v.id;
      el.style.left = v.x + 'px'; el.style.top = v.y + 'px'; el.style.width = (v.w || 220) + 'px';
      el.innerHTML = `
        <div class="vi-top"><button class="vi-del" title="Delete">✕</button></div>
        <img src="${v.src}" alt="" draggable="false" />
        <input type="text" class="vi-caption" placeholder="Caption…" value="${esc(v.caption || '')}" />
        <div class="vi-resize" title="Drag to resize"></div>`;
      canvas.appendChild(el);

      el.querySelector('.vi-del').addEventListener('click', () => {
        state.visionBoard = state.visionBoard.filter(x => x.id !== v.id);
        persist(); renderVisionBoard();
      });
      const capInput = el.querySelector('.vi-caption');
      capInput.addEventListener('mousedown', (e) => e.stopPropagation());
      capInput.addEventListener('pointerdown', (e) => e.stopPropagation());
      capInput.addEventListener('input', () => { v.caption = capInput.value; persist(true); });

      // drag to move
      let dragging = false, offX = 0, offY = 0;
      el.addEventListener('pointerdown', (e) => {
        if (e.target === capInput || e.target.closest('.vi-del') || e.target.closest('.vi-resize')) return;
        dragging = true; el.setPointerCapture(e.pointerId);
        offX = e.clientX - el.offsetLeft; offY = e.clientY - el.offsetTop;
      });
      el.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        let nx = Math.max(0, Math.min(e.clientX - offX, rect.width - el.offsetWidth));
        let ny = Math.max(0, Math.min(e.clientY - offY, rect.height - el.offsetHeight));
        el.style.left = nx + 'px'; el.style.top = ny + 'px'; v.x = nx; v.y = ny;
      });
      ['pointerup', 'pointercancel'].forEach(ev => el.addEventListener(ev, () => { if (dragging) { dragging = false; persist(true); } }));

      // drag to resize (bottom-right handle)
      const handle = el.querySelector('.vi-resize');
      let resizing = false, startX = 0, startW = 0;
      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); resizing = true; handle.setPointerCapture(e.pointerId);
        startX = e.clientX; startW = el.offsetWidth;
      });
      handle.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const nw = Math.max(120, Math.min(700, startW + (e.clientX - startX)));
        el.style.width = nw + 'px'; v.w = nw;
      });
      ['pointerup', 'pointercancel'].forEach(ev => handle.addEventListener(ev, () => { if (resizing) { resizing = false; persist(true); } }));
    });
  }
  function fileToCompressedDataURL(file, maxDim = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale); height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  document.getElementById('visionFileInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const canvas = document.getElementById('visionCanvas');
    for (const file of files) {
      try {
        const src = await fileToCompressedDataURL(file);
        state.visionBoard.push({
          id: uid(), src, caption: '',
          x: 20 + Math.random() * Math.max(40, canvas.clientWidth - 260),
          y: 20 + Math.random() * 160, w: 220, createdAt: Date.now()
        });
      } catch (err) { console.warn('Could not load image', file.name, err); }
    }
    e.target.value = '';
    persist(); renderVisionBoard();
    toast(`Added ${files.length} image${files.length > 1 ? 's' : ''} to Vision Board.`);
  });

  // ================= HABITS =================
  function habitKeyFor(h) { return h.freq === 'monthly' ? monthKey() : h.freq === 'weekly' ? isoWeekKey() : todayKey(); }
  function stepBack(d, freq) {
    const nd = new Date(d);
    if (freq === 'monthly') nd.setMonth(nd.getMonth() - 1);
    else if (freq === 'weekly') nd.setDate(nd.getDate() - 7);
    else nd.setDate(nd.getDate() - 1);
    return nd;
  }
  function keyForFreq(d, freq) { return freq === 'monthly' ? monthKey(d) : freq === 'weekly' ? isoWeekKey(d) : todayKey(d); }
  function computeStreak(h) {
    let count = 0, d = new Date(), key = keyForFreq(d, h.freq);
    if (!h.history[key]) { d = stepBack(d, h.freq); key = keyForFreq(d, h.freq); }
    while (h.history[key]) { count++; d = stepBack(d, h.freq); key = keyForFreq(d, h.freq); }
    return count;
  }
  function habitRowHTML(h, compact) {
    const key = habitKeyFor(h);
    const checked = !!h.history[key];
    const streak = computeStreak(h);
    const unit = h.freq === 'monthly' ? 'mo' : h.freq === 'weekly' ? 'wk' : 'd';
    return `
    <li class="habit-row" data-id="${h.id}">
      <button class="habit-check ${checked ? 'checked' : ''}" title="Mark this ${h.freq === 'daily' ? 'day' : h.freq === 'weekly' ? 'week' : 'month'}">${checked ? '✓' : ''}</button>
      <span class="habit-name">${esc(h.name)}</span>
      <span class="habit-freq">${h.freq}</span>
      <span class="habit-streak">${streak > 0 ? `${streak}${unit} streak 🔥` : 'no streak yet'}</span>
      ${compact ? '' : '<button class="row-btn danger del-habit" title="Delete">✕</button>'}
    </li>`;
  }
  function renderHabits() {
    const list = document.getElementById('habitsList');
    list.innerHTML = state.habits.length ? state.habits.map(h => habitRowHTML(h, false)).join('') : `<li class="empty-state">No habits yet — add one to start a streak.</li>`;
    list.querySelectorAll('.habit-row').forEach(row => {
      const id = row.dataset.id;
      const h = state.habits.find(x => x.id === id);
      row.querySelector('.habit-check').addEventListener('click', () => {
        const key = habitKeyFor(h);
        if (h.history[key]) delete h.history[key]; else h.history[key] = true;
        persist(); renderHabits(); renderDashboardStats();
      });
      const delBtn = row.querySelector('.del-habit');
      if (delBtn) delBtn.addEventListener('click', () => { state.habits = state.habits.filter(x => x.id !== id); persist(); renderHabits(); renderDashboardStats(); });
    });
    const dash = document.getElementById('dashHabitList');
    dash.innerHTML = state.habits.length ? state.habits.slice(0, 6).map(h => habitRowHTML(h, true)).join('') : `<li class="empty-state">No habits yet.</li>`;
    dash.querySelectorAll('.habit-check').forEach((btn, i) => {
      const h = state.habits[i];
      btn.addEventListener('click', () => {
        const key = habitKeyFor(h);
        if (h.history[key]) delete h.history[key]; else h.history[key] = true;
        persist(); renderHabits(); renderDashboardStats();
      });
    });
  }
  document.getElementById('habitAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('habitName');
    const name = nameInput.value.trim();
    if (!name) return;
    const freq = document.getElementById('habitFreq').value;
    state.habits.push({ id: uid(), name, freq, history: {} });
    nameInput.value = '';
    persist(); renderHabits(); renderDashboardStats();
  });

  // ================= JOURNAL =================
  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return div.textContent || '';
  }
  function getEntry(date) { return state.journal.entries.find(e => e.date === date); }
  function renderJournal() {
    document.getElementById('journalDateLabel').textContent = journalDate;
    const jt = document.getElementById('journalText');
    const entry = getEntry(journalDate);
    if (document.activeElement !== jt) jt.innerHTML = entry ? entry.text : '';
    const list = document.getElementById('journalEntries');
    const sorted = [...state.journal.entries].sort((a, b) => b.date.localeCompare(a.date));
    list.innerHTML = sorted.length ? sorted.map(e => `
      <li class="entry-item" data-date="${e.date}">
        <div class="entry-info">
          <div class="entry-date">${e.date}</div>
          <div class="entry-preview">${esc(stripHtml(e.text).slice(0, 80) || '(empty)')}</div>
        </div>
        <button class="row-btn danger del-entry" title="Delete entry">✕</button>
      </li>`).join('') : `<li class="empty-state">No entries yet.</li>`;
    list.querySelectorAll('.entry-info').forEach(el => el.addEventListener('click', () => { journalDate = el.closest('.entry-item').dataset.date; renderJournal(); }));
    list.querySelectorAll('.del-entry').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const date = btn.closest('.entry-item').dataset.date;
      state.journal.entries = state.journal.entries.filter(en => en.date !== date);
      if (journalDate === date) journalDate = todayKey();
      persist(); renderJournal();
    }));
  }
  let journalSaveHandle = null;
  const journalEditor = document.getElementById('journalText');
  journalEditor.addEventListener('input', () => {
    clearTimeout(journalSaveHandle);
    journalSaveHandle = setTimeout(() => {
      let entry = getEntry(journalDate);
      if (!entry) { entry = { id: uid(), date: journalDate, text: '' }; state.journal.entries.push(entry); }
      entry.text = journalEditor.innerHTML;
      persist(true);
      renderJournal();
    }, 500);
  });
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection inside the editor
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      journalEditor.dispatchEvent(new Event('input'));
    });
  });
  document.getElementById('editJournalTitleBtn').addEventListener('click', () => {
    const next = prompt('Rename this section:', state.meta.journalTitle || 'Journal');
    if (next && next.trim()) {
      state.meta.journalTitle = next.trim();
      document.getElementById('journalTitleText').textContent = next.trim();
      const tab = document.querySelector('.tab[data-view="journal"]');
      if (tab) tab.textContent = next.trim();
      persist(true);
    }
  });

  // ================= DASHBOARD =================
  function collectDeadlines() {
    const items = [];
    [...state.todo.todo, ...state.todo.inprogress, ...state.todo.done].forEach(c => { if (c.deadline) items.push({ text: c.text, date: c.deadline, src: 'To-Do' }); });
    state.weeklyPlan.forEach(p => { if (p.deadline) items.push({ text: p.text, date: p.deadline, src: 'Weekly' }); });
    state.monthlyPlan.forEach(p => { if (p.deadline) items.push({ text: p.text, date: p.deadline, src: 'Monthly' }); });
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items;
  }
  function renderDashboardStats() {
    const daily = state.activities.daily;
    const doneCount = daily.filter(t => t.done).length;
    const pct = daily.length ? Math.round((doneCount / daily.length) * 100) : 0;
    document.getElementById('statCompletion').textContent = `${pct}%`;
    document.getElementById('statCompletionBar').style.width = `${pct}%`;

    const totalPlanned = daily.reduce((s, t) => s + (t.minutes || 0), 0);
    let totalActualSec = daily.reduce((s, t) => s + (t.actualSeconds || 0), 0);
    if (state.activeTimer && state.activeTimer.list === 'daily') {
      const t = findTask('daily', state.activeTimer.id);
      if (t) totalActualSec += Math.min(state.activeTimer.durationSec, (Date.now() - state.activeTimer.startedAt) / 1000);
    }
    const totalActualMin = totalActualSec / 60;
    document.getElementById('statTimePair').textContent = `${formatMinutes(totalPlanned)} / ${formatMinutes(totalActualMin)}`;
    const maxBar = Math.max(totalPlanned, totalActualMin, 1);
    document.getElementById('statPlannedBar').style.width = `${Math.min(100, (totalPlanned / maxBar) * 100)}%`;
    document.getElementById('statActualBar').style.width = `${Math.min(100, (totalActualMin / maxBar) * 100)}%`;

    document.getElementById('statHabits').textContent = state.habits.length;
    const streakLeader = state.habits.map(h => computeStreak(h)).sort((a, b) => b - a)[0];
    document.getElementById('statHabitsSub').textContent = state.habits.length ? `best streak: ${streakLeader || 0}` : 'no habits yet';

    document.getElementById('statTodo').textContent = state.todo.inprogress.length;
    document.getElementById('statTodoSub').textContent = `${state.todo.todo.length} to-do · ${state.todo.done.length} done`;

    const dashList = document.getElementById('dashDailyList');
    const sorted = [...daily];
    dashList.innerHTML = sorted.length ? sorted.slice(0, 8).map(t => `
      <li class="task-row ${t.done ? 'done' : ''}">
        <span class="priority-flag ${t.priority}"></span>
        <span class="task-text" style="border:none;">${esc(t.text)}</span>
        <span class="task-minutes">${t.minutes || 0}m</span>
      </li>`).join('') : `<li class="empty-state">No daily activities yet.</li>`;

    const deadlines = collectDeadlines().slice(0, 6);
    document.getElementById('dashDeadlines').innerHTML = deadlines.length ? deadlines.map(d => {
      const info = deadlineInfo(d.date);
      return `<li class="deadline-item"><span class="deadline-badge ${info.cls}">${info.label}</span><span class="di-text">${esc(d.text)}</span><span class="di-src">${d.src}</span></li>`;
    }).join('') : `<li class="empty-state">No deadlines set.</li>`;

    const wp = [...state.weeklyPlan].filter(p => !p.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).slice(0, 5);
    document.getElementById('dashWeeklyPlan').innerHTML = wp.length ? wp.map(p => `
      <li class="plan-row"><span class="plan-text">${esc(p.text)}</span><span class="plan-when mono">${esc([p.date, p.time].filter(Boolean).join(' '))}</span></li>`).join('') : `<li class="empty-state">Nothing planned yet.</li>`;
  }

  // ================= WRAP UP DAY =================
  // Sanitizes the rich-text journal HTML (from the contenteditable editor) for safe reuse
  // in the print report — strips scripts/handlers but keeps bold/underline/list formatting
  // and real line breaks (the old version flattened everything to one line via textContent).
  function sanitizeRichHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '')
      .replace(/ on\w+='[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }
  document.getElementById('wrapUpBtn').addEventListener('click', () => {
    const dateStr = todayKey();
    const daily = state.activities.daily;
    const completed = daily.filter(t => t.done);
    const unfinished = daily.filter(t => !t.done);
    const totalPlanned = daily.reduce((s, t) => s + (t.minutes || 0), 0);
    const totalActual = daily.reduce((s, t) => s + (t.actualSeconds || 0), 0);
    const pct = daily.length ? Math.round((completed.length / daily.length) * 100) : 0;
    const entry = getEntry(dateStr);
    const generatedStr = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    const completedRows = completed.length ? completed.map(t => `
        <div class="wu-row">
          <span class="wu-box wu-box-done">&#10003;</span>
          <span class="wu-text">${esc(t.text)}</span>
          <span class="wu-meta">planned ${esc((t.minutes || 0) + 'm')} &middot; actual ${esc(formatSeconds(t.actualSeconds || 0))}</span>
        </div>`).join('') : `<div class="wu-empty">Nothing completed today.</div>`;

    const unfinishedRows = unfinished.length ? unfinished.map(t => `
        <div class="wu-row">
          <span class="wu-box"></span>
          <span class="wu-text">${esc(t.text)}</span>
          <span class="wu-meta">planned ${esc((t.minutes || 0) + 'm')}</span>
        </div>`).join('') : `<div class="wu-empty">Nothing carried over.</div>`;

    const journalHtml = entry && entry.text && stripHtml(entry.text).trim()
      ? `<div class="wu-journal-rich">${sanitizeRichHtml(entry.text)}</div>`
      : '<div class="wu-empty">No journal entry for today.</div>';

    const notesHtml = state.notes.length
      ? `<div class="wu-notes">${state.notes.map(n => `<div class="wu-note wu-note-${esc(n.color || 'yellow')}">${esc(n.text || '(empty)')}</div>`).join('')}</div>`
      : `<div class="wu-empty">No sticky notes.</div>`;

    const reportHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>command-center-wrapup-${esc(dateStr)}</title>
<style>
  @page { size: A4; margin: 15mm 16mm; }
  *{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html,body{ margin:0; padding:0; }
  body{
    font-family: 'Segoe UI', 'Nirmala UI', 'Noto Sans Bengali', 'Vrinda', Calibri, Arial, sans-serif;
    color:#1c2530; font-size:13px; line-height:1.5; background:#fff;
  }
  .wu-page{ max-width:800px; margin:0 auto; padding:26px 6px 10px; }
  .wu-toolbar{
    position:sticky; top:0; display:flex; justify-content:flex-end; gap:8px; padding:10px 6px;
    background:#fff; border-bottom:1px solid #e4e8ef; margin-bottom:14px;
  }
  .wu-btn{
    font-family:inherit; font-size:12.5px; font-weight:700; border-radius:7px; padding:8px 16px;
    cursor:pointer; border:1px solid #2f4270;
  }
  .wu-btn-primary{ background:#2f4270; color:#fff; }
  .wu-btn-ghost{ background:#fff; color:#2f4270; }
  .wu-header{
    background:linear-gradient(135deg,#1f2a44,#2f4270); color:#fff; padding:22px 26px; border-radius:12px;
    margin-bottom:18px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;
  }
  .wu-header-left h1{ margin:0 0 4px; font-size:19px; letter-spacing:.3px; }
  .wu-header-left .wu-sub{ font-size:12px; opacity:.85; }
  .wu-ring{
    width:64px; height:64px; border-radius:50%; flex:none;
    background: conic-gradient(#38c98e ${pct * 3.6}deg, rgba(255,255,255,.18) 0deg);
    display:flex; align-items:center; justify-content:center;
  }
  .wu-ring-inner{
    width:50px; height:50px; border-radius:50%; background:#1f2a44; color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700;
  }
  .wu-stats{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; }
  .wu-stat{ flex:1 1 150px; min-width:150px; border:1px solid #dfe3ea; border-radius:9px; padding:11px 13px; background:#f7f9fc; }
  .wu-stat .wu-label{ font-size:9.5px; text-transform:uppercase; letter-spacing:.6px; color:#6b7385; margin-bottom:5px; }
  .wu-stat .wu-value{ font-size:16px; font-weight:700; color:#1f2a44; word-break:break-word; }
  .wu-bar-track{ height:6px; border-radius:4px; background:#e4e8ef; margin-top:7px; overflow:hidden; }
  .wu-bar-fill{ height:100%; background:#2f8f5b; }
  .wu-section{ margin-bottom:20px; break-inside:avoid; }
  .wu-section h2{
    font-size:11.5px; text-transform:uppercase; letter-spacing:.7px; color:#2f4270;
    border-bottom:2px solid #2f4270; padding-bottom:6px; margin:0 0 9px; display:flex; align-items:center; gap:8px;
  }
  .wu-section h2 .cnt{
    font-size:10px; background:#eef1f7; color:#5b6478; border-radius:9px; padding:1px 8px; font-weight:600;
  }
  .wu-row{
    display:flex; align-items:flex-start; gap:10px; padding:7px 4px; border-bottom:1px solid #eef0f4;
    font-size:12.5px; break-inside:avoid;
  }
  .wu-box{
    flex:0 0 auto; width:14px; height:14px; margin-top:1px; border:1.5px solid #9aa3b2; border-radius:4px;
    display:inline-flex; align-items:center; justify-content:center; font-size:10px; color:#fff;
  }
  .wu-box-done{ background:#2f8f5b; border-color:#2f8f5b; }
  .wu-text{ flex:1 1 auto; word-break:break-word; }
  .wu-meta{ flex:0 0 auto; color:#6b7385; font-size:10.5px; white-space:nowrap; }
  .wu-empty{ color:#9aa3b2; font-size:12px; font-style:italic; padding:6px 4px; }
  .wu-journal-rich{
    font-size:12.5px; line-height:1.7; background:#f7f9fc; border:1px solid #dfe3ea; border-radius:9px;
    padding:12px 14px; word-break:break-word;
  }
  .wu-journal-rich ul{ margin:6px 0; padding-left:20px; }
  .wu-journal-rich div{ min-height:1em; }
  .wu-notes{ display:flex; flex-wrap:wrap; gap:8px; }
  .wu-note{ border:1px solid #eadf9d; border-radius:7px; padding:9px 11px; font-size:11.5px; max-width:220px; word-break:break-word; background:#fff6cf; }
  .wu-note-pink{ background:#fbe1ec; border-color:#f2b8d2; }
  .wu-note-blue{ background:#dcf1fb; border-color:#a9dcf7; }
  .wu-note-green{ background:#dff6e8; border-color:#b7ecc9; }
  .wu-footer{ text-align:center; font-size:9.5px; color:#9aa3b2; border-top:1px solid #eef0f4; padding-top:12px; margin-top:26px; }
  @media print { .wu-toolbar{ display:none; } .wu-page{ padding-top:0; } }
</style></head>
<body>
  <div class="wu-toolbar no-print">
    <button class="wu-btn wu-btn-primary" onclick="window.print()">🖨 Save as PDF</button>
    <button class="wu-btn wu-btn-ghost" onclick="window.close()">Close</button>
  </div>
  <div class="wu-page">
    <div class="wu-header">
      <div class="wu-header-left">
        <h1>COMMAND CENTER &middot; DAILY WRAP-UP</h1>
        <div class="wu-sub">${esc(dateStr)}</div>
      </div>
      <div class="wu-ring"><div class="wu-ring-inner">${pct}%</div></div>
    </div>
    <div class="wu-stats">
      <div class="wu-stat"><div class="wu-label">Completion</div><div class="wu-value">${pct}% <span style="font-weight:400;font-size:10.5px;color:#6b7385;">(${completed.length}/${daily.length})</span></div>
        <div class="wu-bar-track"><div class="wu-bar-fill" style="width:${pct}%"></div></div></div>
      <div class="wu-stat"><div class="wu-label">Planned Time</div><div class="wu-value">${esc(formatMinutes(totalPlanned))}</div></div>
      <div class="wu-stat"><div class="wu-label">Actual Time</div><div class="wu-value">${esc(formatSeconds(totalActual))}</div></div>
      <div class="wu-stat"><div class="wu-label">Generated</div><div class="wu-value" style="font-size:12px;">${esc(generatedStr)}</div></div>
    </div>
    <div class="wu-section"><h2>Completed <span class="cnt">${completed.length}</span></h2>${completedRows}</div>
    <div class="wu-section"><h2>Carried Over <span class="cnt">${unfinished.length}</span></h2>${unfinishedRows}</div>
    <div class="wu-section"><h2>Journal</h2>${journalHtml}</div>
    <div class="wu-section"><h2>Sticky Notes <span class="cnt">${state.notes.length}</span></h2>${notesHtml}</div>
    <div class="wu-footer">Generated by Command Center &middot; ${esc(generatedStr)}</div>
  </div>
  <script>
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });
  <\/script>
</body></html>`;

    // Blob + real navigation (instead of document.write into a blank popup) — far more
    // reliable across browsers/PWA contexts, and the print trigger lives inside the
    // opened page itself so timing doesn't depend on the parent window at all.
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWin = window.open(url, '_blank');
    if (!printWin) {
      toast('Pop-up blocked — allow pop-ups, then try Wrap Up Day again.');
    } else {
      toast('Day wrapped up — choose "Save as PDF" in the print dialog.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    state.activities.daily = daily.filter(t => !t.done).map(t => ({ ...t, actualSeconds: 0 }));
    if (state.activeTimer && state.activeTimer.list === 'daily') state.activeTimer = null;
    state.meta.lastWrapUp = dateStr;
    persist(); renderAll();
  });

  // ================= EVENTS (Digital Event Manager) =================
  let editEventId = null;
  const eventNotifiedMap = {};

  function formatEventDate(dateString) {
    if (!dateString) return '';
    const [y, m, d] = dateString.split('-');
    return `${d}-${m}-${y}`;
  }
  function eventCountdownText(ev) {
    const eventDate = new Date(`${ev.date}T${ev.time}`);
    const diffMs = eventDate - Date.now();
    if (diffMs <= 0) return { text: 'Started', started: true };
    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return { text: `${days}d ${hours}h ${mins}m`, started: false };
  }
  function resetEventForm() {
    document.getElementById('eventForm').reset();
    document.getElementById('evCost').value = 'Free';
    editEventId = null;
    document.getElementById('evAddBtn').style.display = '';
    document.getElementById('evUpdateBtn').style.display = 'none';
  }
  function readEventForm() {
    return {
      eventName: document.getElementById('evName').value.trim(),
      organizer: document.getElementById('evOrganizer').value.trim(),
      host: document.getElementById('evHost').value.trim(),
      date: document.getElementById('evDate').value,
      time: document.getElementById('evTime').value,
      mode: document.getElementById('evMode').value,
      priority: document.getElementById('evPriority').value,
      perks: document.getElementById('evPerks').value,
      cost: document.getElementById('evCost').value.trim() || 'Free',
      meetId: document.getElementById('evMeetId').value.trim(),
      meetPass: document.getElementById('evMeetPass').value.trim()
    };
  }
  document.getElementById('eventForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = readEventForm();
    if (!data.eventName || !data.date || !data.time) { toast('⚠️ Event name, date and time are required.'); return; }
    if (editEventId) {
      const ev = state.events.find(x => x.id === editEventId);
      if (ev) Object.assign(ev, data);
      resetEventForm();
      toast('Event updated.');
    } else {
      state.events.push({ id: uid(), ...data, createdAt: Date.now() });
      resetEventForm();
      toast('Event added to schedule.');
    }
    persist(); renderEvents();
  });
  function editEvent(id) {
    const ev = state.events.find(x => x.id === id);
    if (!ev) return;
    document.getElementById('evName').value = ev.eventName;
    document.getElementById('evOrganizer').value = ev.organizer || '';
    document.getElementById('evHost').value = ev.host || '';
    document.getElementById('evDate').value = ev.date;
    document.getElementById('evTime').value = ev.time;
    document.getElementById('evMode').value = ev.mode;
    document.getElementById('evPriority').value = ev.priority;
    document.getElementById('evPerks').value = ev.perks || 'No';
    document.getElementById('evCost').value = ev.cost || 'Free';
    document.getElementById('evMeetId').value = ev.meetId || '';
    document.getElementById('evMeetPass').value = ev.meetPass || '';
    editEventId = id;
    document.getElementById('evAddBtn').style.display = 'none';
    document.getElementById('evUpdateBtn').style.display = '';
    document.getElementById('eventForm').scrollIntoView({ behavior: 'smooth' });
  }
  function markEvent(id, action) {
    const idx = state.events.findIndex(x => x.id === id);
    if (idx === -1) return;
    const ev = state.events[idx];
    ev.status = action === 'complete' ? 'Completed' : 'Canceled';
    state.eventsHistory.push(ev);
    state.events.splice(idx, 1);
    addHistory('events', ev.id, `${ev.eventName} — ${ev.status}`);
    if (editEventId === id) resetEventForm();
    persist(); renderEvents();
  }
  let eventDragStartIndex = null;
  function wireEventDragRows() {
    document.querySelectorAll('#eventsTableBody tr.draggable-row').forEach(row => {
      row.addEventListener('dragstart', function () { eventDragStartIndex = +this.dataset.index; this.classList.add('dragging'); });
      row.addEventListener('dragover', (e) => e.preventDefault());
      row.addEventListener('dragenter', (e) => e.preventDefault());
      row.addEventListener('dragend', function () { this.classList.remove('dragging'); });
      row.addEventListener('drop', function () {
        const endIndex = +this.dataset.index;
        if (eventDragStartIndex === null || eventDragStartIndex === endIndex) return;
        const [item] = state.events.splice(eventDragStartIndex, 1);
        state.events.splice(endIndex, 0, item);
        eventDragStartIndex = null;
        persist(); renderEvents();
      });
    });
  }
  function renderEvents() {
    const body = document.getElementById('eventsTableBody');
    if (!state.events.length) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:34px; color:var(--text-faint);">No upcoming events.</td></tr>`;
    } else {
      body.innerHTML = state.events.map((ev, index) => {
        const cd = eventCountdownText(ev);
        return `
        <tr class="draggable-row" draggable="true" data-index="${index}" data-id="${ev.id}">
          <td>
            <span class="event-main-text">${esc(ev.eventName)}</span>
            <span class="event-sub-text">Org: ${esc(ev.organizer || '-')}</span>
            <span class="event-sub-text">Host: ${esc(ev.host || '-')}</span>
          </td>
          <td>
            <span class="event-main-text">${esc(formatEventDate(ev.date))}</span>
            <span class="event-sub-text mono" style="color:var(--accent); font-weight:700;">${esc(ev.time)}</span>
          </td>
          <td>
            ${esc(ev.mode)}
            <span class="event-perk-text">🎁 ${esc(ev.perks || 'No')}</span>
          </td>
          <td>${esc(ev.cost)}</td>
          <td>
            <span class="event-main-text" style="font-size:12px;">ID: ${esc(ev.meetId || '-')}</span>
            <span class="event-sub-text">Pass: ${esc(ev.meetPass || '-')}</span>
          </td>
          <td><span class="event-priority-badge ${ev.priority}">${PRIORITY_LABEL[ev.priority] || ev.priority}</span></td>
          <td class="event-countdown ${cd.started ? 'started' : ''}">${cd.text}</td>
          <td>
            <button class="event-action-btn event-btn-check" title="Complete">✔</button>
            <button class="event-action-btn event-btn-cross" title="Cancel">✘</button>
            <button class="event-action-btn event-btn-edit" title="Edit">✎</button>
          </td>
        </tr>`;
      }).join('');
      body.querySelectorAll('tr[data-id]').forEach(row => {
        const id = row.dataset.id;
        row.querySelector('.event-btn-check').addEventListener('click', () => markEvent(id, 'complete'));
        row.querySelector('.event-btn-cross').addEventListener('click', () => markEvent(id, 'cancel'));
        row.querySelector('.event-btn-edit').addEventListener('click', () => editEvent(id));
        // The row itself is draggable="true" (for reordering). On touch/installed-PWA
        // contexts a draggable ancestor can swallow the tap on a button before a click
        // ever fires — stopping the drag gesture from starting on the action buttons
        // themselves keeps taps reliable, the same guard already used on editable inputs
        // elsewhere in this file (see wireTaskRows' mousedown stopPropagation).
        row.querySelectorAll('button').forEach(btn => {
          btn.setAttribute('draggable', 'false');
          btn.addEventListener('mousedown', (e) => e.stopPropagation());
          btn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        });
      });
      wireEventDragRows();
    }

    const histBody = document.getElementById('eventsHistoryTableBody');
    const sortedHist = [...state.eventsHistory].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    histBody.innerHTML = sortedHist.length ? sortedHist.map(ev => `
      <tr>
        <td><span class="event-main-text">${esc(ev.eventName)}</span></td>
        <td><span class="event-sub-text">Org: ${esc(ev.organizer || '-')}</span><span class="event-sub-text">Host: ${esc(ev.host || '-')}</span></td>
        <td>${esc(formatEventDate(ev.date))}</td>
        <td><span class="event-status-${esc(ev.status)}">${esc(ev.status)}</span></td>
      </tr>`).join('') : `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-faint);">No past events yet.</td></tr>`;
  }
  function tickEventCountdowns() {
    document.querySelectorAll('#eventsTableBody tr[data-id]').forEach(row => {
      const ev = state.events.find(x => x.id === row.dataset.id);
      if (!ev) return;
      const cd = eventCountdownText(ev);
      const cell = row.querySelector('.event-countdown');
      if (cell) { cell.textContent = cd.text; cell.classList.toggle('started', cd.started); }
    });
  }
  function checkEventReminders() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    state.events.forEach(ev => {
      const eventDate = new Date(`${ev.date}T${ev.time}`);
      const diffMins = Math.floor((eventDate - Date.now()) / 60000);
      const key = ev.id + '-' + diffMins;
      if (eventNotifiedMap[key]) return;
      if (diffMins >= 1438 && diffMins <= 1442) { notify('📅 Reminder: Tomorrow', `${ev.eventName} at ${ev.time}`); eventNotifiedMap[key] = true; }
      else if (diffMins >= 58 && diffMins <= 62) { notify('⏰ 1 Hour Left', `Get ready for ${ev.eventName}`); eventNotifiedMap[key] = true; }
      else if (diffMins >= 4 && diffMins <= 6) { notify('🚨 5 Minutes Left!', `${ev.eventName} — ID: ${ev.meetId || '-'} | Pass: ${ev.meetPass || '-'}`); eventNotifiedMap[key] = true; }
    });
  }
  setInterval(() => {
    if (document.getElementById('view-events').classList.contains('active')) tickEventCountdowns();
    checkEventReminders();
  }, 30000);
  document.getElementById('eventAlertsBtn').addEventListener('click', () => {
    if (!('Notification' in window)) { alert('This browser does not support notifications.'); return; }
    Notification.requestPermission().then(p => {
      if (p === 'granted') { notify('Command Center', 'Event reminders are active 🔔'); toast('Event alerts enabled.'); }
      else toast("Permission denied — you won't get event alerts.");
    });
  });
  document.getElementById('eventsHistoryToggle').addEventListener('click', () => {
    const section = document.getElementById('eventsHistorySection');
    const btn = document.getElementById('eventsHistoryToggle');
    const show = section.style.display === 'none';
    section.style.display = show ? 'block' : 'none';
    btn.textContent = show ? 'Hide Past Events' : 'Show Past Events';
  });
  document.getElementById('eventsHistoryClear').addEventListener('click', () => {
    if (!state.eventsHistory.length) return;
    if (!confirm('Delete ALL past events? This cannot be undone.')) return;
    state.eventsHistory.forEach(ev => removeHistory('events', ev.id));
    state.eventsHistory = [];
    persist(); renderEvents();
  });
  document.getElementById('eventsPdfBtn').addEventListener('click', () => {
    const generatedStr = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const rows = state.events.length ? state.events.map(ev => {
      const cd = eventCountdownText(ev);
      return `
        <tr>
          <td><strong>${esc(ev.eventName)}</strong><br><span class="ev-sub">Org: ${esc(ev.organizer || '-')} &middot; Host: ${esc(ev.host || '-')}</span></td>
          <td>${esc(formatEventDate(ev.date))}<br>${esc(ev.time)}</td>
          <td>${esc(ev.mode)}<br><span class="ev-sub">${esc(ev.perks || 'No')}</span></td>
          <td>${esc(ev.cost)}</td>
          <td>${esc(ev.meetId || '-')}</td>
          <td>${esc(PRIORITY_LABEL[ev.priority] || ev.priority)}</td>
          <td>${esc(cd.text)}</td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center; padding:20px; color:#9aa3b2;">No upcoming events.</td></tr>`;

    const reportHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>command-center-events-${esc(todayKey())}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 14mm; }
  *{ box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body{ font-family:'Segoe UI', Calibri, Arial, sans-serif; color:#1c2530; font-size:12px; margin:0; }
  .ev-page{ max-width:1000px; margin:0 auto; padding:20px 4px; }
  .ev-toolbar{ display:flex; justify-content:flex-end; gap:8px; padding:8px 4px; border-bottom:1px solid #e4e8ef; margin-bottom:14px; }
  .ev-btn{ font-size:12px; font-weight:700; border-radius:7px; padding:8px 16px; cursor:pointer; border:1px solid #2f4270; }
  .ev-btn-primary{ background:#2f4270; color:#fff; }
  .ev-btn-ghost{ background:#fff; color:#2f4270; }
  .ev-header{ background:linear-gradient(135deg,#1f2a44,#2f4270); color:#fff; padding:18px 22px; border-radius:12px; margin-bottom:16px; }
  .ev-header h1{ margin:0 0 4px; font-size:18px; }
  .ev-header .ev-sub2{ font-size:11.5px; opacity:.85; }
  table{ width:100%; border-collapse:collapse; }
  th{ background:#f3f4f8; color:#2f4270; text-align:left; padding:9px 10px; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; border-bottom:2px solid #2f4270; }
  td{ padding:9px 10px; border-bottom:1px solid #eaecf1; vertical-align:top; font-size:11.5px; }
  .ev-sub{ color:#6b7385; font-size:10px; }
  .ev-footer{ text-align:center; font-size:9.5px; color:#9aa3b2; padding-top:14px; margin-top:16px; border-top:1px solid #eef0f4; }
  @media print { .ev-toolbar{ display:none; } }
</style></head>
<body>
  <div class="ev-toolbar no-print">
    <button class="ev-btn ev-btn-primary" onclick="window.print()">🖨 Save as PDF</button>
    <button class="ev-btn ev-btn-ghost" onclick="window.close()">Close</button>
  </div>
  <div class="ev-page">
    <div class="ev-header"><h1>COMMAND CENTER &middot; EVENT SCHEDULE</h1><div class="ev-sub2">Generated ${esc(generatedStr)}</div></div>
    <table>
      <thead><tr><th>Event</th><th>Date &amp; Time</th><th>Mode &amp; Perks</th><th>Cost</th><th>Meeting</th><th>Priority</th><th>Countdown</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="ev-footer">Generated by Command Center &middot; ${esc(generatedStr)}</div>
  </div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });<\/script>
</body></html>`;

    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWin = window.open(url, '_blank');
    if (!printWin) toast('Pop-up blocked — allow pop-ups, then try again.');
    else toast('Choose "Save as PDF" in the print dialog.');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  // Events-only backup — separate from the global ⬇/⬆, for sharing/backing up just
  // your event schedule without exposing the rest of your data. Operates on the live
  // `state` object (not raw localStorage), so it always matches what's on screen and
  // goes through the normal persist()/renderEvents() pipeline like everything else.
  document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
    if (!state.events.length && !state.eventsHistory.length) { toast('No events to export yet.'); return; }
    const payload = { kind: 'command-center-events-backup', exportedAt: Date.now(), events: state.events, eventsHistory: state.eventsHistory };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `command-center-events-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Events exported.');
  });
  document.getElementById('importJsonBtn')?.addEventListener('click', () => document.getElementById('importJsonInput').click());
  document.getElementById('importJsonInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incomingEvents = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.events) ? parsed.events : null);
        const incomingHistory = Array.isArray(parsed.eventsHistory) ? parsed.eventsHistory : [];
        if (!incomingEvents) { alert('That file doesn\'t look like an Events backup.'); e.target.value = ''; return; }
        if (!confirm(`Import ${incomingEvents.length} event(s)${incomingHistory.length ? ` and ${incomingHistory.length} past record(s)` : ''}? This adds to (not replaces) your current events.`)) { e.target.value = ''; return; }
        const existingIds = new Set([...state.events, ...state.eventsHistory].map(ev => ev.id));
        incomingEvents.forEach(ev => { if (!existingIds.has(ev.id)) state.events.push(ev); });
        incomingHistory.forEach(ev => { if (!existingIds.has(ev.id)) state.eventsHistory.push(ev); });
        persist(); renderEvents();
        toast('Events imported.');
      } catch (err) {
        alert('Invalid JSON file.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // ================= LEVELS (GAMIFY) =================
  function levelDeadlineMs(lvl, activatedAt) {
    if (lvl.mode === 'datetime' && lvl.deadlineAt) return lvl.deadlineAt - (activatedAt || Date.now());
    return (lvl.hours || 24) * 3600 * 1000;
  }
  function computeLevelStatus(index) {
    if (state.gamify.blockedUntil && Date.now() < state.gamify.blockedUntil) return 'blocked';
    const levels = state.gamify.levels;
    const firstIncomplete = levels.findIndex(l => !l.done);
    if (firstIncomplete === -1) return 'done';
    if (index < firstIncomplete) return 'done';
    if (index > firstIncomplete) return 'locked';
    const lvl = levels[index];
    if (!lvl.activatedAt) return 'active';
    const deadlineMs = levelDeadlineMs(lvl, lvl.activatedAt);
    const elapsed = Date.now() - lvl.activatedAt;
    if (elapsed < deadlineMs) return 'active';
    if (elapsed < deadlineMs * 1.5) return 'warning';
    return 'expired';
  }
  function ensureLevelActivation() {
    if (state.gamify.blockedUntil && Date.now() < state.gamify.blockedUntil) return;
    const levels = state.gamify.levels;
    const firstIncomplete = levels.findIndex(l => !l.done);
    if (firstIncomplete !== -1 && !levels[firstIncomplete].activatedAt) {
      levels[firstIncomplete].activatedAt = Date.now();
      persist(true);
    }
  }
  function checkLevelDeadlines() {
    if (state.gamify.blockedUntil) {
      if (Date.now() >= state.gamify.blockedUntil) {
        state.gamify.blockedUntil = null;
        const firstIncomplete = state.gamify.levels.findIndex(l => !l.done);
        if (firstIncomplete !== -1) state.gamify.levels[firstIncomplete].activatedAt = Date.now();
        persist(true);
        toast('🔓 24-hour block lifted — levels unlocked again.');
        renderGamify();
      }
      return;
    }
    ensureLevelActivation();
    const firstIncomplete = state.gamify.levels.findIndex(l => !l.done);
    if (firstIncomplete !== -1 && computeLevelStatus(firstIncomplete) === 'expired') {
      state.gamify.blockedUntil = Date.now() + 24 * 3600 * 1000;
      persist(true);
      notify('⛔ Level deadline missed', 'Grace period expired — all levels are locked for 24 hours.');
      toast('⛔ Deadline + grace period missed — Levels locked for 24 hours.');
      renderGamify();
    }
  }
  function renderGamify() {
    const levels = state.gamify.levels;
    const blocked = state.gamify.blockedUntil && Date.now() < state.gamify.blockedUntil;
    const banner = document.getElementById('gamifyBlockBanner');
    if (blocked) {
      banner.style.display = 'block';
      banner.textContent = `⛔ Locked for missing a deadline + grace period. Unlocks in ${formatSeconds((state.gamify.blockedUntil - Date.now()) / 1000)}.`;
    } else banner.style.display = 'none';

    const ol = document.getElementById('levelList');
    ol.innerHTML = levels.length ? levels.map((lvl, i) => {
      const status = blocked ? 'blocked' : computeLevelStatus(i);
      let timeLabel = '';
      const deadlineMs = levelDeadlineMs(lvl, lvl.activatedAt || Date.now());
      const elapsed = lvl.activatedAt ? Date.now() - lvl.activatedAt : 0;
      if (status === 'active') timeLabel = `⏳ ${formatSeconds((deadlineMs - elapsed) / 1000)} left`;
      else if (status === 'warning' || status === 'expired') timeLabel = `⚠ Grace: ${formatSeconds(Math.max(0, deadlineMs * 1.5 - elapsed) / 1000)} left`;
      else if (status === 'locked') timeLabel = '🔒 Locked';
      else if (status === 'done') timeLabel = '✓ Completed';
      else if (status === 'blocked') timeLabel = '⛔ Blocked';
      const dueNote = lvl.mode === 'datetime' && lvl.deadlineAt ? ` <span class="hint">(due ${new Date(lvl.deadlineAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})</span>` : '';
      const checkable = (status === 'active' || status === 'warning') && !blocked;
      return `<li class="level-row ${status}" data-id="${lvl.id}">
        <span class="level-num">${i + 1}</span>
        <input type="checkbox" class="level-check" ${lvl.done ? 'checked' : ''} ${checkable ? '' : 'disabled'} />
        <span class="level-text">${esc(lvl.text)}${dueNote}</span>
        <span class="level-time mono">${timeLabel}</span>
        <button class="row-btn danger del-level" title="Delete">✕</button>
      </li>`;
    }).join('') : `<li class="empty-state">No levels yet — add your first one above.</li>`;

    ol.querySelectorAll('.level-row').forEach(row => {
      const id = row.dataset.id;
      const cb = row.querySelector('.level-check');
      if (!cb.disabled) {
        cb.addEventListener('change', () => {
          const lvl = state.gamify.levels.find(l => l.id === id);
          lvl.done = cb.checked;
          if (!lvl.done) { lvl.activatedAt = null; removeHistory('levels', lvl.id); }
          else addHistory('levels', lvl.id, lvl.text);
          persist(); renderGamify(); renderDashboardStats();
        });
      }
      row.querySelector('.del-level').addEventListener('click', () => {
        state.gamify.levels = state.gamify.levels.filter(l => l.id !== id);
        persist(); renderGamify();
      });
    });
  }
  document.getElementById('levelAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const textInput = document.getElementById('levelText');
    const hoursInput = document.getElementById('levelHours');
    const dateInput = document.getElementById('levelDate');
    const timeInput = document.getElementById('levelTime');
    const text = textInput.value.trim();
    if (!text) return;
    const hoursVal = Number(hoursInput.value);
    let mode, hours = null, deadlineAt = null;
    if (hoursVal > 0) {
      mode = 'duration'; hours = hoursVal;
    } else if (dateInput.value && timeInput.value) {
      mode = 'datetime';
      deadlineAt = new Date(`${dateInput.value}T${timeInput.value}`).getTime();
    } else {
      toast('Set either a deadline in hours, or a specific date & time.');
      return;
    }
    state.gamify.levels.push({ id: uid(), text, mode, hours, deadlineAt, done: false, activatedAt: null, createdAt: Date.now() });
    textInput.value = ''; hoursInput.value = ''; dateInput.value = ''; timeInput.value = '';
    persist(); renderGamify();
  });
  function tickGamifyDisplay() {
    const levels = state.gamify.levels;
    const blocked = state.gamify.blockedUntil && Date.now() < state.gamify.blockedUntil;
    const banner = document.getElementById('gamifyBlockBanner');
    if (blocked) {
      banner.style.display = 'block';
      banner.textContent = `⛔ Locked for missing a deadline + grace period. Unlocks in ${formatSeconds((state.gamify.blockedUntil - Date.now()) / 1000)}.`;
    } else banner.style.display = 'none';
    document.querySelectorAll('#levelList .level-row').forEach(row => {
      const id = row.dataset.id;
      const i = levels.findIndex(l => l.id === id);
      if (i === -1) return;
      const status = blocked ? 'blocked' : computeLevelStatus(i);
      const lvl = levels[i];
      const deadlineMs = levelDeadlineMs(lvl, lvl.activatedAt || Date.now());
      const elapsed = lvl.activatedAt ? Date.now() - lvl.activatedAt : 0;
      let timeLabel = '';
      if (status === 'active') timeLabel = `⏳ ${formatSeconds((deadlineMs - elapsed) / 1000)} left`;
      else if (status === 'warning' || status === 'expired') timeLabel = `⚠ Grace: ${formatSeconds(Math.max(0, deadlineMs * 1.5 - elapsed) / 1000)} left`;
      else if (status === 'locked') timeLabel = '🔒 Locked';
      else if (status === 'done') timeLabel = '✓ Completed';
      else if (status === 'blocked') timeLabel = '⛔ Blocked';
      const timeEl = row.querySelector('.level-time');
      if (timeEl) timeEl.textContent = timeLabel;
    });
  }
  setInterval(() => {
    const before = state.gamify.blockedUntil;
    checkLevelDeadlines();
    // checkLevelDeadlines already re-renders fully on a real state transition (block start/lift);
    // otherwise just patch the countdown text so checkboxes/listeners stay intact.
    if (before === state.gamify.blockedUntil && document.getElementById('view-gamify').classList.contains('active')) tickGamifyDisplay();
  }, 1000);

  // ================= CHALLENGE MODE =================
  function chDayStart(d = new Date()) { const nd = new Date(d); nd.setHours(0, 0, 0, 0); return nd; }
  function chAddDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
  function chDueCutoffToday(ch) {
    if (!ch.dueTime) return null;
    const [hh, mm] = ch.dueTime.split(':').map(Number);
    const c = new Date(); c.setHours(hh, mm, 0, 0);
    return c;
  }
  // Fills in 'missed' for any past day with no entry, and auto-misses today once its
  // daily deadline time has passed without a tick. Keeps the day-map + streak accurate
  // without needing a background timer to run every second.
  function reconcileChallenge(ch) {
    const today = chDayStart();
    const start = chDayStart(new Date(ch.startAt));
    const hardEnd = ch.endAt ? chDayStart(new Date(ch.endAt)) : today;
    let cursor = new Date(start);
    while (cursor < today && cursor <= hardEnd) {
      const k = todayKey(cursor);
      if (!ch.days[k]) ch.days[k] = 'missed';
      cursor = chAddDays(cursor, 1);
    }
    const todayK = todayKey(today);
    if (!ch.days[todayK] && today >= start && (!ch.endAt || today <= hardEnd)) {
      const cutoff = chDueCutoffToday(ch);
      if (cutoff && Date.now() > cutoff.getTime()) ch.days[todayK] = 'missed';
    }
    ch.streak = chComputeStreak(ch);
    ch.longestStreak = Math.max(ch.longestStreak || 0, ch.streak);
  }
  function chComputeStreak(ch) {
    let streak = 0;
    let cursor = chDayStart();
    let k = todayKey(cursor);
    if (ch.days[k] === 'missed') return 0;
    if (ch.days[k] === 'done') { streak++; cursor = chAddDays(cursor, -1); }
    while (ch.days[todayKey(cursor)] === 'done') { streak++; cursor = chAddDays(cursor, -1); }
    return streak;
  }
  function chStatusForDate(ch, dateKey) {
    if (ch.days[dateKey]) return ch.days[dateKey];
    const today = todayKey();
    if (dateKey === today) return 'pending';
    return dateKey < today ? 'missed' : 'future';
  }
  function chTotalDays(ch) {
    if (!ch.endAt) return null;
    return Math.max(1, Math.round((chDayStart(new Date(ch.endAt)) - chDayStart(new Date(ch.startAt))) / 86400000) + 1);
  }
  function chDoneCount(ch) { return Object.values(ch.days).filter(v => v === 'done').length; }
  function chFormatCountdown(ms) {
    if (ms <= 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400), h = Math.floor((totalSec % 86400) / 3600), m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${totalSec % 60}s`;
  }
  function renderChallenges() {
    const container = document.getElementById('challengeList');
    if (!state.challenges.length) { container.innerHTML = `<p class="empty-state">No challenges yet — start one above.</p>`; return; }
    const now = Date.now();
    container.innerHTML = state.challenges.map(ch => {
      reconcileChallenge(ch);
      const total = chTotalDays(ch);
      const done = chDoneCount(ch);
      const todayK = todayKey();
      const todayStatus = chStatusForDate(ch, todayK);
      const started = now >= ch.startAt;
      const ended = ch.endAt && now > ch.endAt;
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : null;

      let countdownLabel = '';
      if (!started) countdownLabel = `Starts in ${chFormatCountdown(ch.startAt - now)}`;
      else if (ended) countdownLabel = `Ended — ${done}/${total || '?'} days completed`;
      else if (ch.dueTime && todayStatus === 'pending') {
        const cutoff = chDueCutoffToday(ch);
        countdownLabel = cutoff ? `Today's deadline in ${chFormatCountdown(cutoff - now)}` : '';
      } else if (ch.endAt) countdownLabel = `${chFormatCountdown(ch.endAt - now)} left`;

      // day strip — show the whole range if it's short, else the most recent 30 days
      const start = chDayStart(new Date(ch.startAt));
      const last = ended ? chDayStart(new Date(ch.endAt)) : chDayStart();
      let dayKeys = [];
      let cursor = new Date(start);
      while (cursor <= last) { dayKeys.push(todayKey(cursor)); cursor = chAddDays(cursor, 1); }
      if (dayKeys.length > 30) dayKeys = dayKeys.slice(-30);
      const dayCells = dayKeys.map(k => {
        const st = chStatusForDate(ch, k);
        const cls = st === 'done' ? 'done' : st === 'missed' ? 'missed' : (k === todayK ? 'today-pending' : '');
        return `<span class="chc-day ${cls}" title="${k}: ${st}"></span>`;
      }).join('');

      const canMark = started && !ended && todayStatus !== 'done' && todayStatus !== 'missed';
      const markLabel = todayStatus === 'done' ? '✓ Done Today' : 'Mark Today Done';

      return `<div class="challenge-card ${ended ? 'chc-ended' : ''}" data-id="${ch.id}">
        <div class="chc-top">
          <div>
            <div class="chc-title">${esc(ch.title)}</div>
            <div class="chc-badges">
              <span class="chc-badge">${ch.dueTime ? `⏰ Daily by ${esc(ch.dueTime)}` : (ch.endAt ? `📅 ${total} day challenge` : '📅 Ongoing')}</span>
              <span class="chc-badge streak">🔥 ${ch.streak || 0} day streak</span>
              <span class="chc-badge longest">🏆 best ${ch.longestStreak || 0}</span>
            </div>
          </div>
          <button class="row-btn danger del-challenge" title="Delete">✕</button>
        </div>
        ${total ? `<div class="chc-progress-track"><div class="chc-progress-fill" style="width:${pct}%"></div></div>` : ''}
        <div class="chc-meta-row">
          <span>${done} day${done === 1 ? '' : 's'} completed${total ? ` of ${total}` : ''}</span>
          <span class="chc-countdown">${esc(countdownLabel)}</span>
        </div>
        <div class="chc-days">${dayCells}</div>
        <div class="chc-actions">
          <button class="btn chc-mark-btn" ${canMark ? '' : 'disabled'}>${markLabel}</button>
          ${todayStatus === 'missed' ? '<span class="hint" style="color:var(--mandatory);">Missed today\'s window</span>' : ''}
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.del-challenge').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.closest('.challenge-card').dataset.id;
      if (!confirm('Delete this challenge? This cannot be undone.')) return;
      state.challenges = state.challenges.filter(c => c.id !== id);
      persist(); renderChallenges();
    }));
    container.querySelectorAll('.chc-mark-btn').forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => {
        const id = btn.closest('.challenge-card').dataset.id;
        const ch = state.challenges.find(c => c.id === id);
        if (!ch) return;
        const cutoff = chDueCutoffToday(ch);
        if (cutoff && Date.now() > cutoff.getTime()) {
          ch.days[todayKey()] = 'missed';
          toast('Too late — today\'s deadline already passed.');
        } else {
          ch.days[todayKey()] = 'done';
          ch.streak = chComputeStreak(ch);
          ch.longestStreak = Math.max(ch.longestStreak || 0, ch.streak);
          addHistory('challenges', `${ch.id}:${todayKey()}`, `${ch.title} — Day ${chDoneCount(ch)}`);
          toast(`🔥 ${ch.streak} day streak!`);
        }
        persist(); renderChallenges();
      });
    });
  }
  const chDurationSelect = document.querySelector('#challengeAddForm .ch-duration');
  chDurationSelect.addEventListener('change', () => {
    const custom = chDurationSelect.value === 'custom';
    document.querySelectorAll('#challengeAddForm .ch-custom-field').forEach(f => f.style.display = custom ? 'flex' : 'none');
  });
  document.getElementById('challengeAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const title = form.querySelector('.ch-title').value.trim();
    if (!title) return;
    const durationVal = form.querySelector('.ch-duration').value;
    const dueTime = form.querySelector('.ch-duetime').value || null;
    let startAt = Date.now(), endAt = null;
    if (durationVal === 'custom') {
      const startVal = form.querySelector('.ch-start').value;
      const endVal = form.querySelector('.ch-end').value;
      if (!startVal || !endVal) { toast('Set both a custom start and end date.'); return; }
      startAt = new Date(startVal).getTime();
      endAt = new Date(endVal).getTime();
      if (endAt <= startAt) { toast('End must be after start.'); return; }
    } else if (durationVal === 'ongoing') {
      endAt = null;
    } else {
      const days = Number(durationVal);
      endAt = Date.now() + days * 86400000;
    }
    state.challenges.push({
      id: uid(), title, startAt, endAt, dueTime,
      days: {}, streak: 0, longestStreak: 0, createdAt: Date.now()
    });
    form.reset();
    document.querySelectorAll('#challengeAddForm .ch-custom-field').forEach(f => f.style.display = 'none');
    persist(); renderChallenges();
    toast('Challenge started — good luck! 🔥');
  });
  setInterval(() => { if (document.getElementById('view-challenges').classList.contains('active')) renderChallenges(); }, 30000);

  // ================= UPDATES / NOTICES =================
  const CHANGELOG = [
    { version: 'v9', date: '2026-09-13', items: [
      'Fixed Events: complete/cancel/edit buttons could get swallowed by the row\'s drag-to-reorder handling on touch — taps are reliable now',
      'Added Focus Zone tab — Entertainment Zone gate (Instagram/Facebook/LinkedIn tiles), a Fajr-to-Fajr Prayer checklist that locks Entertainment + Research when a prayer window is missed, and a low-friction Research box',
      'Entertainment Zone access is earned by completing today\'s Top 3 Mandatory tasks (0→locked, 1→5min, 2→10min, 3→60min budget minus what\'s already used today), capped at 2 hours/day, with an unmissable overlay + growing lockout if you overstay',
      'Added a 4-category Focus Task dashboard — Daily Musts (with a streak), Top 3 Mandatory, Important (deadline-sorted, overdue pinned to the top), and Optional/Interests — with a category-aware quick-add, an optional "why" note per task, and a Weekly Review summary',
      'Incomplete Top 3 tasks carry over to the next day instead of disappearing'
    ] },
    { version: 'v8', date: '2026-08-30', items: [
      'Added Events — a full event manager (organizer/host/date/time/mode/priority/perks/cost/meeting details), with drag-to-reorder, live countdowns, and edit-in-place',
      'Event reminders (🔔 button, Events tab) — notifications 1 day, 1 hour, and 5 minutes before each event',
      'Past Events (Completed/Canceled) tracked separately, and also logged into the main History tab',
      'Export a landscape Event Schedule PDF from the Events tab',
      'Events sync via Cloud Sync and are included in JSON backup/restore and Erase Locks, same as every other section'
    ] },
    { version: 'v7', date: '2026-08-11', items: [
      'Added ☁️ Cloud Sync — sign in with Google (👤 button, top bar) to sync everything in real time across your laptop, phone, and desktop',
      'First sign-in on a device asks how to combine local vs. cloud data if both already have something, so nothing is silently overwritten',
      'Vision Board stays device-local by design (images are too large to sync via Firestore\'s free tier) — everything else syncs',
      'Works fully offline either way — signed out, it behaves exactly as before (local-only, no account needed)'
    ] },
    { version: 'v6', date: '2026-08-10', items: [
      'Added Vision Board — upload, drag, resize and caption images on a free canvas',
      'Added Challenge Mode — set 10/20/30/365-day or custom-length streak challenges, or a daily deadline-time challenge (e.g. "before 7 AM")',
      'Wrap Up Day PDF completely redesigned — fixed a layout squeeze, added a completion ring, kept journal formatting (bold/underline/lists/line breaks) instead of flattening it, and made the print step far more reliable across browsers',
      'History no longer creates duplicate entries when repeatedly ticking/unticking the same item',
      'History: delete individual entries, or Clear All History in one click (auto-backup first)',
      'Erase All (⏻) now respects per-section "🔒 Erase Locks" so you can protect specific sections (set on the History tab)',
      'Notices can now be edited after posting, not just deleted',
      'Notice text box is much bigger and easier to write in',
      'Changelog can now be collapsed to just the latest version',
      'App updates pulled from GitHub now reliably reach every installed device — your data is untouched either way, since it lives separately in the browser'
    ] },
    { version: 'v5', date: '2026-08-05', items: [
      'Wrap Up Day now exports a well-organized, designed PDF (via print dialog → Save as PDF) instead of a .txt file',
    ] },
    { version: 'v4', date: '2026-08-04', items: [
      'Removed Pinning — drag-and-drop already handles reordering; Wrap Up Day now clears all completed daily items',
      'Levels can now use a specific deadline date & time instead of an hours countdown',
      'Wrap Up Day .txt export redesigned — aligned, boxed, professional layout',
      'Added History — every completed item across all sections, grouped and browsable',
      'Calendar now shows Level deadlines too',
      'Power Reset now auto-downloads a safety backup before wiping data',
      'Updates & Notices section title is fixed (no longer needs renaming)'
    ] },
    { version: 'v3', date: '2026-07-29', items: [
      'Added Levels — sequential task unlocking with deadlines, grace periods, and a 24h lockout for missed deadlines',
      'Added Updates & Notices board (personal notices + this changelog)',
      'Rich text Journal — Bold / Underline / Italic / bullet list, plus entry delete',
      'JSON export / import for moving your data between devices',
      'Drag-and-drop reordering of the top navigation tabs',
      'Redesigned checkboxes app-wide + one-click complete on To-Do cards',
      'Editable section titles for Journal and Updates & Notices',
      'Power Reset button for wiping all local data'
    ] },
    { version: 'v2', date: '2026-07-28', items: [
      'Restructured into Activities / To-Do / Weekly Plan / Monthly Plan / Calendar / Routine',
      'Deadline badges (overdue / urgent / soon / normal)',
      'Custom countdown timer per task with sound + browser notification',
      'Habits now support Daily / Weekly / Monthly frequency',
      'Fixed light mode contrast issues'
    ] },
    { version: 'v1', date: '2026-07-28', items: [
      'Initial release — Daily/Weekly/Monthly/Upcoming tasks, Kanban, Sticky Notes, Habits, Journal, Wrap Up Day export, offline PWA'
    ] }
  ];
  let editingNoticeId = null;
  function renderNotices() {
    const list = document.getElementById('noticeList');
    const sorted = [...state.notices].sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = sorted.length ? sorted.map(n => {
      if (editingNoticeId === n.id) {
        return `
      <li class="notice-item editing" data-id="${n.id}">
        <input type="text" class="notice-edit-title" value="${esc(n.title)}" />
        <textarea class="notice-edit-text">${esc(n.text || '')}</textarea>
        <div class="notice-edit-actions">
          <button class="btn btn-accent btn-sm save-notice">Save</button>
          <button class="btn btn-ghost btn-sm cancel-notice">Cancel</button>
        </div>
      </li>`;
      }
      return `
      <li class="notice-item" data-id="${n.id}">
        <div class="notice-item-top">
          <span class="notice-item-title">${esc(n.title)}</span>
          <div class="entry-actions">
            <span class="notice-item-date mono">${new Date(n.createdAt).toLocaleDateString()}</span>
            <button class="row-btn edit-notice" title="Edit">✎</button>
            <button class="row-btn danger del-notice" title="Delete">✕</button>
          </div>
        </div>
        ${n.text ? `<div class="notice-item-body">${esc(n.text)}</div>` : ''}
      </li>`;
    }).join('') : `<li class="empty-state">No notices yet — add one above.</li>`;

    list.querySelectorAll('.del-notice').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.closest('.notice-item').dataset.id;
      state.notices = state.notices.filter(n => n.id !== id);
      persist(); renderNotices();
    }));
    list.querySelectorAll('.edit-notice').forEach(btn => btn.addEventListener('click', () => {
      editingNoticeId = btn.closest('.notice-item').dataset.id;
      renderNotices();
      const li = list.querySelector('.notice-item.editing .notice-edit-title');
      if (li) li.focus();
    }));
    list.querySelectorAll('.cancel-notice').forEach(btn => btn.addEventListener('click', () => { editingNoticeId = null; renderNotices(); }));
    list.querySelectorAll('.save-notice').forEach(btn => btn.addEventListener('click', () => {
      const li = btn.closest('.notice-item');
      const id = li.dataset.id;
      const title = li.querySelector('.notice-edit-title').value.trim();
      if (!title) { toast('Title can\'t be empty.'); return; }
      const text = li.querySelector('.notice-edit-text').value.trim();
      const n = state.notices.find(x => x.id === id);
      if (n) { n.title = title; n.text = text; }
      editingNoticeId = null;
      persist(); renderNotices();
    }));

    const cl = document.getElementById('changelogList');
    const shown = changelogExpanded ? CHANGELOG : CHANGELOG.slice(0, 1);
    cl.innerHTML = shown.map(v => `
      <li class="changelog-entry">
        <div class="cl-head"><span class="cl-version">${esc(v.version)}</span><span class="cl-date mono">${esc(v.date)}</span></div>
        <ul>${v.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      </li>`).join('');
    const toggleBtn = document.getElementById('changelogToggle');
    if (toggleBtn) toggleBtn.textContent = changelogExpanded ? '▾ Hide older updates' : `▸ Show all updates (${CHANGELOG.length})`;
  }
  document.getElementById('noticeAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const title = form.querySelector('.notice-title-input').value.trim();
    if (!title) return;
    const text = form.querySelector('.notice-text-input').value.trim();
    state.notices.push({ id: uid(), title, text, createdAt: Date.now() });
    form.reset();
    persist(); renderNotices();
  });
  let changelogExpanded = false;
  document.getElementById('changelogToggle').addEventListener('click', () => { changelogExpanded = !changelogExpanded; renderNotices(); });

  // ================= HISTORY (render) =================
  const expandedHistorySections = new Set();
  function renderHistory() {
    const groups = {};
    (state.history || []).forEach(h => { (groups[h.sectionKey] = groups[h.sectionKey] || []).push(h); });
    const container = document.getElementById('historyGroups');
    const keys = Object.keys(groups);
    if (!keys.length) { container.innerHTML = `<p class="empty-state">No completed items yet.</p>`; renderLockGrid(); return; }
    container.innerHTML = keys.map(key => {
      const items = groups[key].slice().sort((a, b) => b.completedAt - a.completedAt);
      const label = items[0].sectionLabel;
      const expanded = expandedHistorySections.has(key);
      return `<div class="history-group">
        <button class="history-group-head" data-key="${key}">
          <span>${esc(label)}</span><span class="count">${items.length}</span>
          <span class="chev">${expanded ? '▾' : '▸'}</span>
        </button>
        <ul class="history-item-list" style="display:${expanded ? 'flex' : 'none'};">
          ${items.map(it => `<li class="history-item" data-id="${it.id}"><span class="hi-text">${esc(it.text)}</span><span class="hi-date mono">${new Date(it.completedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span><button class="row-btn danger del-history-item" title="Delete this entry">✕</button></li>`).join('')}
        </ul>
      </div>`;
    }).join('');
    container.querySelectorAll('.history-group-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (expandedHistorySections.has(key)) expandedHistorySections.delete(key); else expandedHistorySections.add(key);
        renderHistory();
      });
    });
    container.querySelectorAll('.del-history-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.history-item').dataset.id;
        state.history = state.history.filter(h => h.id !== id);
        persist(); renderHistory();
      });
    });
    renderLockGrid();
  }
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (!state.history || !state.history.length) { toast('History is already empty.'); return; }
    if (!confirm('Clear ALL history entries? A backup downloads first; this cannot be undone.')) return;
    exportBackup('autobackup-before-history-clear');
    setTimeout(() => {
      state.history = [];
      persist(); renderHistory();
      toast('History cleared.');
    }, 300);
  });

  // ================= FOCUS & ACCESS CONTROL =================
  // Everything here is enforced at the UI/JS level only — a website can't force-close
  // another tab or lock the OS screen. The countdown, the overlay, and the disabled tiles
  // are the actual enforcement mechanism; nothing here stops opening Instagram in an
  // unrelated tab. That limitation is understood and accepted.

  const PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

  // ---------- Fajr-day rollover ----------
  // Daily Musts / Top 3 / Entertainment's daily cap all reset at Fajr rather than midnight.
  function currentFajrDayKey() {
    return fajrDayKey(state.prayer.timings && state.prayer.timings.Fajr, new Date());
  }
  function rolloverIfNeeded() {
    const dk = currentFajrDayKey();
    if (state.focus.dailyMustsDayKey !== dk) {
      if (state.focus.dailyMustsDayKey) {
        const total = state.focus.dailyMusts.length;
        const completed = state.focus.dailyMusts.filter(t => t.done).length;
        state.focus.dailyMustsHistory.push({ dayKey: state.focus.dailyMustsDayKey, total, completed });
        state.focus.dailyMustsHistory = state.focus.dailyMustsHistory.slice(-30);
        if (total > 0) state.focus.dailyMustsStreak = (completed === total) ? (state.focus.dailyMustsStreak || 0) + 1 : 0;
      }
      state.focus.dailyMusts.forEach(t => { t.done = false; });
      state.focus.dailyMustsDayKey = dk;
    }
    if (state.focus.top3DayKey !== dk) {
      // Incomplete Top 3 tasks carry over instead of vanishing; completed ones are cleared
      // to make room for the new day's three.
      const carried = state.focus.top3.filter(t => !t.done).map(t => ({ ...t, carried: true }));
      state.focus.top3 = carried.slice(0, 3);
      state.focus.top3DayKey = dk;
    }
    if (state.entertainment.dayKey !== dk) {
      if (state.entertainment.dayKey) {
        state.entertainment.usageHistory.push({ dayKey: state.entertainment.dayKey, minutes: Math.round(state.entertainment.usedTodayMin) });
        state.entertainment.usageHistory = state.entertainment.usageHistory.slice(-30);
      }
      state.entertainment.usedTodayMin = 0;
      state.entertainment.dayKey = dk;
      // lockedUntil / negBalanceMin intentionally survive the day boundary — a punitive
      // overage lockout shouldn't reset early just because a new fajr-day started.
    }
    if (state.prayer.dayKey !== dk) {
      state.prayer.checked = {};
      state.prayer.dayKey = dk;
    }
  }

  // ---------- Prayer times (Aladhan API) ----------
  function fetchPrayerTimes() {
    const statusEl = document.getElementById('prayerFetchStatus');
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0'), mm = String(now.getMonth() + 1).padStart(2, '0'), yyyy = now.getFullYear();
    const url = `https://api.aladhan.com/v1/timingsByCity/${dd}-${mm}-${yyyy}?city=Chattogram&country=Bangladesh&method=1`;
    fetch(url).then(r => r.json()).then(data => {
      const t = data && data.data && data.data.timings;
      if (!t) throw new Error('Unexpected response shape');
      state.prayer.timings = { Fajr: t.Fajr.slice(0, 5), Dhuhr: t.Dhuhr.slice(0, 5), Asr: t.Asr.slice(0, 5), Maghrib: t.Maghrib.slice(0, 5), Isha: t.Isha.slice(0, 5) };
      state.prayer.fetchedAt = Date.now();
      rolloverIfNeeded();
      persist(true);
      renderPrayer(); renderEntertainment();
    }).catch(err => {
      console.warn('Prayer time fetch failed', err);
      if (statusEl) statusEl.textContent = state.prayer.timings ? 'fetch failed — using cached times' : 'fetch failed — no cached times yet';
    });
  }
  function maybeRefetchPrayer() {
    if (!state.prayer.fetchedAt || todayKey(new Date(state.prayer.fetchedAt)) !== todayKey()) fetchPrayerTimes();
  }
  // Returns { prayer, unlockAt } if a prayer window has passed unticked, else null.
  function prayerLockActive() {
    const t = state.prayer.timings;
    if (!t) return null;
    const now = new Date();
    const mk = (hm) => { const [h, m] = hm.split(':').map(Number); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0); };
    const order = PRAYER_NAMES.map(name => ({ name, dt: mk(t[name]) }));
    const fajrTomorrow = new Date(mk(t.Fajr).getTime() + 24 * 3600 * 1000);
    for (let i = 0; i < order.length; i++) {
      const windowEnd = order[i + 1] ? order[i + 1].dt : fajrTomorrow;
      if (now >= windowEnd && !state.prayer.checked[order[i].name]) return { prayer: order[i].name, unlockAt: windowEnd };
    }
    return null;
  }
  function renderPrayer() {
    const t = state.prayer.timings;
    const statusEl = document.getElementById('prayerFetchStatus');
    if (statusEl) statusEl.textContent = t ? `updated ${new Date(state.prayer.fetchedAt).toLocaleTimeString([], { hour12: false })}` : 'loading…';
    const row = document.getElementById('prayerRow');
    if (!row) return;
    if (!t) { row.innerHTML = `<p class="hint">Fetching today's prayer times…</p>`; return; }
    const lock = prayerLockActive();
    row.innerHTML = PRAYER_NAMES.map(name => `
      <label class="prayer-item ${lock && lock.prayer === name ? 'missed' : ''}">
        <input type="checkbox" class="prayer-check" data-name="${name}" ${state.prayer.checked[name] ? 'checked' : ''} />
        <span class="pi-name">${name}</span>
        <span class="pi-time mono">${esc(t[name])}</span>
      </label>`).join('');
    row.querySelectorAll('.prayer-check').forEach(cb => {
      cb.addEventListener('change', () => {
        state.prayer.checked[cb.dataset.name] = cb.checked;
        persist(true); renderPrayer(); renderEntertainment();
      });
    });
    const banner = document.getElementById('prayerLockBanner');
    if (banner) {
      if (lock) {
        banner.style.display = '';
        banner.textContent = `🔒 ${lock.prayer} wasn't ticked in time — Entertainment Zone + Research are locked until ${lock.unlockAt.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}.`;
      } else banner.style.display = 'none';
    }
  }

  // ---------- Entertainment Zone gate ----------
  function top3DoneCount() { return state.focus.top3.filter(t => t.done).length; }
  function entEntitlementMin() {
    const n = Math.min(3, top3DoneCount());
    return n === 0 ? 0 : n === 1 ? 5 : n === 2 ? 10 : 60;
  }
  function entRemainingMin() { return Math.max(0, entEntitlementMin() - state.entertainment.usedTodayMin); }
  function entDailyCapLeftMin() { return Math.max(0, 120 - state.entertainment.usedTodayMin); }
  function entCanOpen() {
    rolloverIfNeeded();
    const pLock = prayerLockActive();
    if (pLock) return { ok: false, reason: `${pLock.prayer} wasn't ticked in time.` };
    if (state.entertainment.lockedUntil && Date.now() < state.entertainment.lockedUntil) {
      return { ok: false, reason: `Locked from overage — try again at ${new Date(state.entertainment.lockedUntil).toLocaleTimeString([], { hour12: false })}.` };
    }
    if (entDailyCapLeftMin() <= 0) return { ok: false, reason: 'Daily 2-hour cap reached — resets at the next Fajr.' };
    if (entRemainingMin() <= 0) return { ok: false, reason: 'No access yet — complete a Top 3 Mandatory task to unlock time.' };
    return { ok: true };
  }
  function openEntertainment(platform, url) {
    if (state.entertainment.session) { toast('A session is already running.'); return; }
    const check = entCanOpen();
    if (!check.ok) { toast('🔒 ' + check.reason); renderEntertainment(); return; }
    const allowedMin = Math.min(entRemainingMin(), entDailyCapLeftMin());
    state.entertainment.session = { platform, startedAt: Date.now(), allowedSec: allowedMin * 60 };
    persist(true);
    window.open(url, '_blank');
    renderEntertainment();
  }
  function endEntertainmentSession() {
    const s = state.entertainment.session;
    if (!s) return;
    const elapsedSec = (Date.now() - s.startedAt) / 1000;
    const overageSec = Math.max(0, elapsedSec - s.allowedSec);
    const cappedOverageSec = Math.min(overageSec, 30 * 60); // negative balance capped at -30 min
    const usedSec = Math.min(elapsedSec, s.allowedSec) + cappedOverageSec;
    state.entertainment.usedTodayMin += usedSec / 60;
    if (overageSec > 0) {
      state.entertainment.negBalanceMin = cappedOverageSec / 60;
      state.entertainment.lockedUntil = Date.now() + (60 + state.entertainment.negBalanceMin) * 60000;
      state.entertainment.negBalanceMin = 0; // folded into the lockout just set
    }
    state.entertainment.session = null;
    hideEntOverlay();
    persist();
    renderEntertainment();
  }
  let entOverlayShown = false;
  function showEntOverlay() { entOverlayShown = true; document.getElementById('entOverlay').style.display = 'flex'; playDing(); notify('⛔ Time\'s up', 'Close the tab — you\'re into overage time.'); }
  function hideEntOverlay() { entOverlayShown = false; const el = document.getElementById('entOverlay'); if (el) el.style.display = 'none'; }
  function wireEntCloseBtn() {
    const b = document.getElementById('entCloseBtn');
    if (b && !b._wired) { b._wired = true; b.addEventListener('click', endEntertainmentSession); }
  }
  function tickEntertainment() {
    const s = state.entertainment.session;
    const statusEl = document.getElementById('entStatus');
    if (!s) { if (entOverlayShown) hideEntOverlay(); return; }
    const elapsedSec = (Date.now() - s.startedAt) / 1000;
    const remaining = s.allowedSec - elapsedSec;
    if (remaining > 0) {
      if (statusEl) statusEl.innerHTML = `<div>Using <b>${esc(s.platform)}</b></div><div class="ent-countdown">${formatSeconds(remaining)} left</div><button type="button" class="btn btn-ghost ent-close-session" id="entCloseBtn">I'm done — close session</button>`;
      wireEntCloseBtn();
    } else {
      const overageSec = -remaining;
      if (statusEl) statusEl.innerHTML = `<div class="ent-locked">⛔ Overage: ${formatSeconds(overageSec)}</div><button type="button" class="btn btn-ghost ent-close-session" id="entCloseBtn">I've closed ${esc(s.platform)} — end session</button>`;
      wireEntCloseBtn();
      if (!entOverlayShown) showEntOverlay();
      const overlayText = document.getElementById('entOverlayOverage');
      if (overlayText) overlayText.textContent = `Overage: ${formatSeconds(overageSec)}`;
    }
  }
  function renderEntertainment() {
    const usageEl = document.getElementById('entDailyUsage');
    if (usageEl) usageEl.textContent = `${Math.round(state.entertainment.usedTodayMin)} / 120 min today`;
    const s = state.entertainment.session;
    const check = entCanOpen();
    document.querySelectorAll('.ent-tile').forEach(btn => { btn.disabled = !!s || !check.ok; });
    if (s) { tickEntertainment(); return; }
    const statusEl = document.getElementById('entStatus');
    if (!statusEl) return;
    if (!check.ok) statusEl.innerHTML = `<span class="ent-locked">🔒 ${esc(check.reason)}</span>`;
    else {
      const rem = Math.min(entRemainingMin(), entDailyCapLeftMin());
      statusEl.innerHTML = `<span>Ready — up to <b>${formatMinutes(rem)}</b> available right now.</span>`;
    }
  }
  document.querySelectorAll('.ent-tile').forEach(btn => {
    btn.addEventListener('click', () => openEntertainment(btn.dataset.platform, btn.dataset.url));
  });
  const entOverlayCloseBtn = document.getElementById('entOverlayCloseBtn');
  if (entOverlayCloseBtn) entOverlayCloseBtn.addEventListener('click', endEntertainmentSession);
  setInterval(tickEntertainment, 1000);

  // ---------- Research box ----------
  document.getElementById('researchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    rolloverIfNeeded();
    const pLock = prayerLockActive();
    if (pLock) { toast(`🔒 Locked — ${pLock.prayer} wasn't ticked in time.`); return; }
    const q = document.getElementById('researchQuery').value.trim();
    const reason = document.getElementById('researchReason').value.trim();
    if (!q || !reason) return;
    state.research.log.unshift({ id: uid(), query: q, reason, at: Date.now() });
    persist(); renderResearch();
    window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, '_blank');
    e.target.reset();
  });
  function renderResearch() {
    const ul = document.getElementById('researchLog');
    if (!ul) return;
    ul.innerHTML = state.research.log.length ? state.research.log.map(r => `
      <li class="research-row">
        <span class="rr-query">🔎 ${esc(r.query)}</span>
        <span class="rr-reason">${esc(r.reason)}</span>
        <span class="rr-time">${esc(new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>
      </li>`).join('') : `<li class="empty-state">No searches logged yet.</li>`;
  }

  // ---------- 4-category Focus Task dashboard ----------
  document.getElementById('focusQaCategory').addEventListener('change', () => {
    document.getElementById('focusQaDeadline').style.display = document.getElementById('focusQaCategory').value === 'important' ? '' : 'none';
  });
  document.getElementById('focusQuickAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    rolloverIfNeeded();
    const text = document.getElementById('focusQaText').value.trim();
    const cat = document.getElementById('focusQaCategory').value;
    const why = document.getElementById('focusQaWhy').value.trim();
    if (!text) return;
    if (cat === 'top3') {
      if (state.focus.top3.length >= 3) { toast('⚠️ Top 3 is full for today — finish or remove one first.'); return; }
      state.focus.top3.push({ id: uid(), text, done: false, why, createdAt: Date.now() });
    } else if (cat === 'important') {
      const deadline = document.getElementById('focusQaDeadline').value;
      if (!deadline) { toast('⚠️ Important tasks need a deadline.'); return; }
      state.focus.important.push({ id: uid(), text, deadline, done: false, why, createdAt: Date.now() });
    } else if (cat === 'dailyMusts') {
      state.focus.dailyMusts.push({ id: uid(), text, done: false, why, createdAt: Date.now() });
    } else {
      state.focus.optional.push({ id: uid(), text, done: false, why, createdAt: Date.now() });
    }
    e.target.reset();
    document.getElementById('focusQaDeadline').style.display = 'none';
    persist(); renderFocusTasks(); renderEntertainment();
    toast('Added.');
  });
  function focusRowHTML(t, opts) {
    opts = opts || {};
    const whyHtml = t.why ? `<div class="focus-row-why">"${esc(t.why)}"</div>` : '';
    const carriedBadge = t.carried ? '<span class="focus-badge-carried">carried over</span>' : '';
    let deadlineHtml = '';
    if (opts.deadline && t.deadline) {
      const d = new Date(t.deadline);
      const overdue = !t.done && d.getTime() < Date.now();
      deadlineHtml = `<div class="focus-row-deadline ${overdue ? 'overdue' : ''}">${esc(d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}${overdue ? '<span class="focus-badge-overdue">Overdue</span>' : ''}</div>`;
    }
    return `
    <li class="task-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" class="focus-check" ${t.done ? 'checked' : ''} />
      <div class="focus-row-main">
        <div class="focus-row-text">${esc(t.text)}${carriedBadge}</div>
        ${deadlineHtml}${whyHtml}
      </div>
      <button type="button" class="focus-row-del" title="Delete">✕</button>
    </li>`;
  }
  function wireFocusList(ulId, arr, opts) {
    const ul = document.getElementById(ulId);
    ul.querySelectorAll('li[data-id]').forEach(li => {
      const id = li.dataset.id;
      const item = arr.find(t => t.id === id);
      if (!item) return;
      const cb = li.querySelector('.focus-check');
      if (cb) cb.addEventListener('change', () => {
        item.done = cb.checked;
        if (opts.historyKey) { if (item.done) addHistory(opts.historyKey, item.id, item.text); else removeHistory(opts.historyKey, item.id); }
        persist(); renderFocusTasks(); renderEntertainment();
      });
      li.querySelector('.focus-row-del').addEventListener('click', () => {
        if (opts.historyKey) removeHistory(opts.historyKey, id);
        opts.removeFn(id);
        persist(); renderFocusTasks(); renderEntertainment();
      });
    });
  }
  function renderFocusTasks() {
    rolloverIfNeeded();
    const streakLabel = document.getElementById('dailyMustsStreakLabel');
    if (streakLabel) streakLabel.textContent = `${state.focus.dailyMustsStreak || 0} day streak`;
    const dmUl = document.getElementById('dailyMustsList');
    if (dmUl) {
      dmUl.innerHTML = state.focus.dailyMusts.length ? state.focus.dailyMusts.map(t => focusRowHTML(t)).join('') : `<li class="empty-state">No Daily Musts yet — add prayers, Quran, etc.</li>`;
      wireFocusList('dailyMustsList', state.focus.dailyMusts, { historyKey: 'dailyMusts', removeFn: (id) => { state.focus.dailyMusts = state.focus.dailyMusts.filter(t => t.id !== id); } });
    }
    const top3Label = document.getElementById('top3CountLabel');
    if (top3Label) top3Label.textContent = `${top3DoneCount()} / 3`;
    const t3Ul = document.getElementById('top3List');
    if (t3Ul) {
      t3Ul.innerHTML = state.focus.top3.length ? state.focus.top3.map(t => focusRowHTML(t)).join('') : `<li class="empty-state">Write today's 3 mandatory tasks first thing.</li>`;
      wireFocusList('top3List', state.focus.top3, { historyKey: 'top3', removeFn: (id) => { state.focus.top3 = state.focus.top3.filter(t => t.id !== id); } });
    }
    const important = [...state.focus.important].sort((a, b) => {
      const aOverdue = !a.done && new Date(a.deadline).getTime() < Date.now();
      const bOverdue = !b.done && new Date(b.deadline).getTime() < Date.now();
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
    const impUl = document.getElementById('importantList');
    if (impUl) {
      impUl.innerHTML = important.length ? important.map(t => focusRowHTML(t, { deadline: true })).join('') : `<li class="empty-state">No deadline-based tasks yet.</li>`;
      wireFocusList('importantList', state.focus.important, { historyKey: 'important', removeFn: (id) => { state.focus.important = state.focus.important.filter(t => t.id !== id); } });
    }
    const optUl = document.getElementById('optionalList');
    if (optUl) {
      optUl.innerHTML = state.focus.optional.length ? state.focus.optional.map(t => focusRowHTML(t)).join('') : `<li class="empty-state">Nothing here — pick something up when you have spare time.</li>`;
      wireFocusList('optionalList', state.focus.optional, { historyKey: 'optional', removeFn: (id) => { state.focus.optional = state.focus.optional.filter(t => t.id !== id); } });
    }
  }
  function renderWeeklyReview() {
    const body = document.getElementById('weeklyReviewBody');
    if (!body) return;
    const last7 = state.focus.dailyMustsHistory.slice(-7);
    const totalDM = last7.reduce((s, d) => s + d.total, 0);
    const compDM = last7.reduce((s, d) => s + d.completed, 0);
    const dmRate = totalDM ? Math.round((compDM / totalDM) * 100) : 0;
    const missedImportant = state.focus.important.filter(t => !t.done && new Date(t.deadline).getTime() < Date.now()).length;
    const entPastDays = state.entertainment.usageHistory.slice(-7).reduce((s, d) => s + d.minutes, 0);
    const entTotal = entPastDays + Math.round(state.entertainment.usedTodayMin);
    body.innerHTML = `
      <div class="wr-stat"><b>${dmRate}%</b>Daily Musts completion rate (last ${last7.length} logged day${last7.length === 1 ? '' : 's'})</div>
      <div class="wr-stat"><b>${missedImportant}</b>Important deadlines currently overdue</div>
      <div class="wr-stat"><b>${formatMinutes(entTotal)}</b>Entertainment Zone time (last 7 days + today)</div>
    `;
  }
  document.getElementById('weeklyReviewToggle').addEventListener('click', () => {
    const body = document.getElementById('weeklyReviewBody');
    const btn = document.getElementById('weeklyReviewToggle');
    const show = body.style.display === 'none';
    body.style.display = show ? '' : 'none';
    btn.textContent = show ? 'Hide' : 'Show';
    if (show) renderWeeklyReview();
  });

  // ---------- deadline reminders (reuses the same notify() pattern as Events) ----------
  const focusNotifiedMap = {};
  function checkFocusDeadlineReminders() {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    state.focus.important.forEach(t => {
      if (t.done) return;
      const diffMins = Math.floor((new Date(t.deadline) - Date.now()) / 60000);
      const key = t.id + '-' + diffMins;
      if (focusNotifiedMap[key]) return;
      if (diffMins >= 1438 && diffMins <= 1442) { notify('📅 Deadline tomorrow', t.text); focusNotifiedMap[key] = true; }
      else if (diffMins >= 58 && diffMins <= 62) { notify('⏰ Deadline in 1 hour', t.text); focusNotifiedMap[key] = true; }
      else if (diffMins >= 4 && diffMins <= 6) { notify('🚨 Deadline in 5 minutes', t.text); focusNotifiedMap[key] = true; }
    });
  }

  // ---------- init + periodic refresh ----------
  rolloverIfNeeded();
  fetchPrayerTimes();
  setInterval(() => {
    rolloverIfNeeded();
    maybeRefetchPrayer();
    renderPrayer();
    renderEntertainment();
    checkFocusDeadlineReminders();
  }, 30000);

  // ================= RENDER ALL =================
  function renderAll() {
    renderActivityList();
    renderUpcomingList();
    renderTodo();
    renderPlanList('weeklyPlan', 'weeklyPlanList');
    renderPlanList('monthlyPlan', 'monthlyPlanList');
    renderCalendar();
    if (selectedCalDate) showCalDay(selectedCalDate);
    renderNotes();
    renderVisionBoard();
    renderHabits();
    renderJournal();
    renderGamify();
    renderChallenges();
    renderEvents();
    renderNotices();
    renderHistory();
    renderDashboardStats();
    renderFocusTasks();
    renderPrayer();
    renderEntertainment();
    renderResearch();
    if (document.getElementById('weeklyReviewBody').style.display !== 'none') renderWeeklyReview();
  }

  if (document.activeElement !== routineEl) routineEl.value = state.routine.text || '';
  document.getElementById('journalTitleText').textContent = state.meta.journalTitle || 'Journal';
  if (state.meta.journalTitle) { const t = document.querySelector('.tab[data-view="journal"]'); if (t) t.textContent = state.meta.journalTitle; }
  renderAll();

  // ================= SERVICE WORKER =================
  // Your data lives in localStorage, completely separate from the cached app files below —
  // pulling a new version from GitHub never touches it. This just makes sure that when a
  // new version IS pushed, this device actually fetches the new files instead of serving
  // a stale cached copy forever.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('✨ Updated to the latest version — reload to apply.');
            }
          });
        });
      }).catch(() => {});
    });
  }
  window.addEventListener('beforeunload', () => { if (!suppressAutoSave) Store.saveNow(state); });

  // ================= CLOUD SYNC =================
  // Sign in with Google to sync everything (except Vision Board images — see README)
  // across devices in real time. Fully optional; the app works exactly as before
  // without ever signing in.
  const authBtn = document.getElementById('authBtn');
  const LOCAL_HAS_DATA_KEYS = ['weeklyPlan', 'monthlyPlan', 'upcoming', 'notes', 'habits', 'notices', 'history', 'challenges'];
  function localHasMeaningfulData(s) {
    if (LOCAL_HAS_DATA_KEYS.some(k => (s[k] || []).length > 0)) return true;
    if ((s.activities.daily.length + s.activities.weekly.length + s.activities.monthly.length) > 0) return true;
    if ((s.todo.todo.length + s.todo.inprogress.length + s.todo.done.length) > 0) return true;
    if ((s.journal.entries || []).length > 0) return true;
    if ((s.gamify.levels || []).length > 0) return true;
    if ((s.routine.text || '').trim()) return true;
    return false;
  }
  function applyRemoteState(remoteCore) {
    const myVisionBoard = state.visionBoard; // Vision Board is device-local — never overwritten by the cloud
    state = Store.normalizeState(remoteCore);
    state.visionBoard = myVisionBoard;
    Store.saveNow(state); // cache locally only — do NOT push back to the cloud (would just echo our own update)
    renderAll();
    toast('🔄 Synced from another device.');
  }
  function updateAuthUI(user) {
    if (user) {
      authBtn.title = `Signed in as ${user.email} — syncing across devices. Click to sign out.`;
      authBtn.classList.add('has-avatar');
      authBtn.style.backgroundImage = user.photoURL ? `url("${user.photoURL}")` : '';
      authBtn.textContent = user.photoURL ? '' : '☁';
    } else {
      authBtn.title = 'Sign in with Google to sync across devices';
      authBtn.classList.remove('has-avatar');
      authBtn.style.backgroundImage = '';
      authBtn.textContent = '👤';
    }
  }
  function closeSyncModal() { document.getElementById('syncModal').style.display = 'none'; }
  function showSyncModal(title, body, actions) {
    document.getElementById('syncModalTitle').textContent = title;
    document.getElementById('syncModalBody').textContent = body;
    const wrap = document.getElementById('syncModalActions');
    wrap.innerHTML = '';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.cls || 'btn-ghost');
      btn.textContent = a.label;
      btn.addEventListener('click', () => { closeSyncModal(); a.onClick(); });
      wrap.appendChild(btn);
    });
    document.getElementById('syncModal').style.display = 'flex';
  }
  function beginSync(uid) {
    localStorage.setItem('cc_cloud_linked_' + uid, '1');
    Store.cloud.startSync(uid, applyRemoteState);
    toast('☁️ Cloud sync is on for this device.');
  }
  function handleSignedIn(user) {
    updateAuthUI(user);
    const alreadyLinked = localStorage.getItem('cc_cloud_linked_' + user.uid) === '1';
    if (alreadyLinked) { beginSync(user.uid); return; }
    Store.cloud.hasData(user.uid).then(hasCloud => {
      const hasLocal = localHasMeaningfulData(state);
      if (!hasCloud && !hasLocal) { beginSync(user.uid); return; }
      if (hasCloud && !hasLocal) {
        // Nothing to lose on this device — just adopt the cloud data quietly.
        Store.cloud.pullOnce(user.uid).then(remote => { if (remote) applyRemoteState(remote); beginSync(user.uid); });
        return;
      }
      if (!hasCloud && hasLocal) {
        showSyncModal(
          'Sync this device?',
          'This account has no cloud data yet. Upload what\'s already on this device so your other devices can see it too.',
          [
            { label: '☁️ Upload this device\'s data', cls: 'btn-accent', onClick: () => { Store.cloud.pushCore(user.uid, state); beginSync(user.uid); } },
            { label: 'Not now', cls: 'btn-ghost', onClick: () => {} }
          ]
        );
        return;
      }
      // Both have data — real conflict (e.g. signing in on a 2nd device that already has its own stuff).
      showSyncModal(
        'This account already has synced data',
        'This device also has its own data. Choose which one to keep — the other will be replaced (use ⬇ Export first if you want a backup of either).',
        [
          { label: '⬇ Use the cloud\'s data here', cls: 'btn-accent', onClick: () => { Store.cloud.pullOnce(user.uid).then(remote => { if (remote) applyRemoteState(remote); beginSync(user.uid); }); } },
            { label: '⬆ Overwrite cloud with this device', cls: 'btn-ghost danger-ghost', onClick: () => { Store.cloud.pushCore(user.uid, state); beginSync(user.uid); } },
          { label: 'Not now', cls: 'btn-ghost', onClick: () => {} }
        ]
      );
    });
  }
  authBtn.addEventListener('click', () => {
    const user = Store.cloud.getUser();
    if (user) {
      if (confirm(`Signed in as ${user.email}. Sign out?\n\n(This device keeps its data — syncing just stops until you sign in again.)`)) {
        Store.cloud.signOut();
      }
      return;
    }
    if (!Store.cloud.available) { toast('Cloud sync isn\'t set up yet.'); return; }
    Store.cloud.signIn().catch(err => {
      if (err && err.code === 'auth/popup-closed-by-user') return;
      console.error(err);
      toast('Sign-in failed — try again.');
    });
  });
  if (Store.cloud.available) {
    Store.cloud.onAuthChange(user => {
      if (user) handleSignedIn(user);
      else { updateAuthUI(null); Store.cloud.stopSync(); }
    });
  } else {
    updateAuthUI(null);
  }
})();