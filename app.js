/* ============================================================
   Finisher — app logic
   Modules: Store (persistence) · Age (time math + timers) ·
   Images (paste capture + compression) · UI (rendering)
   ============================================================ */

'use strict';

/* ----------------------------- Store ----------------------------- */

const Store = (() => {
  const KEY = 'matrixTodo.v1';

  const defaults = () => ({
    tasks: [],            // active AND archived tasks (archived = completedAt set)
    settings: {
      context: 'work',    // 'work' | 'home'
      oldThresholdDays: 3 // age (days) at which a task crosses into "old"
    }
  });

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      return { ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } };
    } catch {
      return defaults();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      alert('Could not save — browser storage is full. Try removing some attached images or clearing the archive.');
      return false;
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  return {
    get tasks() { return state.tasks; },
    get settings() { return state.settings; },

    addTask({ text, urgency, images }) {
      const task = {
        id: uid(),
        text,
        context: state.settings.context,
        urgency,               // 'high' | 'low'
        createdAt: Date.now(),
        completedAt: null,
        images: images || []
      };
      state.tasks.push(task);
      if (!save()) { state.tasks.pop(); return null; }
      return task;
    },

    updateTask(id, patch) {
      const t = state.tasks.find(t => t.id === id);
      if (t) { Object.assign(t, patch); save(); }
      return t;
    },

    deleteTask(id) {
      state.tasks = state.tasks.filter(t => t.id !== id);
      save();
    },

    clearArchive(context) {
      state.tasks = state.tasks.filter(t => !(t.completedAt && t.context === context));
      save();
    },

    setSetting(key, value) {
      state.settings[key] = value;
      save();
    }
  };
})();

/* ------------------------------ Age ------------------------------ */
/* A task's quadrant is DERIVED from its createdAt, never stored, so
   tasks "move" across the age axis simply by re-rendering.
   Timers:
     1. a setTimeout aimed at the next local midnight — the only moment
        calendar ages actually change — which re-renders and re-arms;
     2. a 60s interval safety net that re-renders only when a task's
        quadrant or age label has changed (covers threshold edits made
        in another tab, clock changes, missed timeouts);
     3. a visibilitychange hook, because mobile browsers freeze timers
        while the tab is backgrounded.                                  */

const Age = (() => {
  const DAY_MS = 86_400_000;

  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

  const ageDays = task => Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(task.createdAt)) / DAY_MS));

  const isOld = task => ageDays(task) >= Store.settings.oldThresholdDays;

  const label = task => {
    const d = ageDays(task);
    return d === 0 ? 'Today' : d === 1 ? '1 day old' : `${d} days old`;
  };

  // Device-local timestamp, yy/mm/dd hh:mm (24h)
  const stamp = ts => {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getFullYear() % 100)}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function scheduleMidnightTick(onTick) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0); // next local midnight
    setTimeout(() => { onTick(); scheduleMidnightTick(onTick); }, next - now + 1000);
  }

  function start(onTick) {
    scheduleMidnightTick(onTick);
    // Safety net: fingerprint quadrant placement + labels; re-render on drift.
    let fp = fingerprint();
    setInterval(() => {
      const now = fingerprint();
      if (now !== fp) { fp = now; onTick(); }
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        const now = fingerprint();
        if (now !== fp) { fp = now; onTick(); }
      }
    });
    // Let render() refresh the fingerprint after any manual re-render too.
    return () => { fp = fingerprint(); };
  }

  const fingerprint = () =>
    Store.tasks.map(t => `${t.id}:${isOld(t) ? 'o' : 'n'}:${ageDays(t)}`).join('|');

  return { ageDays, isOld, label, stamp, start };
})();

/* ----------------------------- Images ---------------------------- */
/* Clipboard images are compressed onto a canvas (max 1024px, JPEG .8)
   before being stored as data URLs, to respect the ~5 MB localStorage
   budget. */

const Images = (() => {
  const MAX_DIM = 1024;

  function fromClipboard(event) {
    const items = [...(event.clipboardData?.items || [])];
    const files = items.filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
    if (!files.length) return null;
    event.preventDefault();
    return Promise.all(files.map(compress));
  }

  function compress(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten transparency for JPEG
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
      img.src = url;
    });
  }

  return { fromClipboard };
})();

/* ------------------------------- UI ------------------------------ */

const UI = (() => {
  const $ = sel => document.querySelector(sel);

  const els = {
    ctxWork: $('#ctx-work'),
    ctxHome: $('#ctx-home'),
    ctxSwitch: $('.context-switch'),
    threshold: $('#old-threshold'),
    newText: $('#new-task-text'),
    urgLow: $('#urg-low'),
    urgHigh: $('#urg-high'),
    addBtn: $('#add-task'),
    draftImages: $('#draft-images'),
    quads: {
      'high-new': $('#quad-high-new .quad-body'),
      'high-old': $('#quad-high-old .quad-body'),
      'low-new': $('#quad-low-new .quad-body'),
      'low-old': $('#quad-low-old .quad-body')
    },
    archiveToggle: $('#archive-toggle'),
    archiveCount: $('#archive-count'),
    archiveDrawer: $('#archive-drawer'),
    archiveBody: $('#archive-body'),
    archiveCtxLabel: $('.archive-ctx-label'),
    clearArchive: $('#clear-archive'),
    closeArchive: $('#close-archive'),
    scrim: $('#drawer-scrim'),
    modal: $('#edit-modal'),
    editText: $('#edit-text'),
    editUrgLow: $('#edit-urg-low'),
    editUrgHigh: $('#edit-urg-high'),
    editAge: $('#edit-age'),
    editImages: $('#edit-images'),
    editDelete: $('#edit-delete'),
    editCancel: $('#edit-cancel'),
    editSave: $('#edit-save'),
    lightbox: $('#lightbox'),
    lightboxImg: $('#lightbox-img')
  };

  let draftUrgency = 'low';
  let draftImages = [];
  let refreshAgeFingerprint = () => {};
  let editing = null; // { id, urgency, images } while the modal is open

  // View state (session-only): quadrants showing their full list, and
  // individual tasks expanded to reveal full text + attached images.
  const QUAD_CAP = 8;
  const expandedQuads = new Set(); // quadrant keys, e.g. 'high-old'
  const expandedTasks = new Set(); // task ids

  /* ---- rendering ---- */

  function render() {
    const ctx = Store.settings.context;
    const active = Store.tasks.filter(t => t.context === ctx && !t.completedAt);
    const archived = Store.tasks.filter(t => t.context === ctx && t.completedAt);

    // Oldest first inside each quadrant — the longest-waiting task tops the pile.
    active.sort((a, b) => a.createdAt - b.createdAt);

    const groups = { 'high-new': [], 'high-old': [], 'low-new': [], 'low-old': [] };
    for (const task of active) {
      groups[`${task.urgency}-${Age.isOld(task) ? 'old' : 'new'}`].push(task);
    }
    for (const [key, tasks] of Object.entries(groups)) renderQuad(key, tasks);

    els.archiveCount.textContent = archived.length;
    renderArchive(archived);
    refreshAgeFingerprint();
  }

  function renderQuad(key, tasks) {
    const body = els.quads[key];
    body.textContent = '';

    const section = body.closest('.quad');
    const count = section.querySelector('.quad-count');
    count.hidden = !tasks.length;
    count.textContent = tasks.length;
    section.querySelector('header').classList.toggle('clickable', tasks.length > QUAD_CAP);

    if (!tasks.length) {
      expandedQuads.delete(key);
      const empty = document.createElement('div');
      empty.className = 'quad-empty';
      empty.textContent = 'Nothing here ✨';
      body.appendChild(empty);
      return;
    }

    const open = expandedQuads.has(key);
    const visible = open ? tasks : tasks.slice(0, QUAD_CAP);
    for (const task of visible) body.appendChild(taskCard(task, key === 'high-old'));

    if (tasks.length > QUAD_CAP) {
      const bar = document.createElement('button');
      bar.className = 'more-bar';
      bar.textContent = open
        ? '▴ Show fewer'
        : `▾ Show all ${tasks.length} (+${tasks.length - QUAD_CAP} more)`;
      bar.addEventListener('click', () => toggleQuad(key));
      body.appendChild(bar);
    }
  }

  function toggleQuad(key) {
    expandedQuads.has(key) ? expandedQuads.delete(key) : expandedQuads.add(key);
    render();
  }

  function taskCard(task, pulse) {
    // Cards render compact (clamped text, image count chip); tapping the
    // card expands it to show the full text and attached images.
    const expandable = task.images.length > 0 || task.text.length > 80;
    const isOpen = expandable && expandedTasks.has(task.id);

    const card = document.createElement('div');
    card.className = 'task-card' + (pulse ? ' pulse' : '') + (task.completedAt ? ' done' : '')
      + (expandable ? ' expandable' : '') + (isOpen ? ' open' : '');

    if (expandable) {
      card.addEventListener('click', e => {
        if (e.target.closest('button')) return; // check/edit/delete/thumbs handle themselves
        expandedTasks.has(task.id) ? expandedTasks.delete(task.id) : expandedTasks.add(task.id);
        render();
      });
    }

    const check = document.createElement('button');
    check.className = 'task-check';
    check.title = task.completedAt ? 'Reinstate task' : 'Mark complete';
    check.setAttribute('aria-label', check.title);
    check.textContent = '✓';
    check.addEventListener('click', () => {
      Store.updateTask(task.id, { completedAt: task.completedAt ? null : Date.now() });
      render();
    });

    const main = document.createElement('div');
    main.className = 'task-main';

    const text = document.createElement('div');
    text.className = 'task-text';
    text.textContent = task.text;

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const age = document.createElement('span');
    age.className = 'age-chip';
    age.textContent = task.completedAt
      ? `done ${Age.stamp(task.completedAt)}`
      : Age.label(task);
    meta.appendChild(age);

    const created = document.createElement('span');
    created.className = 'stamp';
    created.title = 'Created';
    created.textContent = Age.stamp(task.createdAt);
    meta.appendChild(created);

    if (task.images.length && !isOpen) {
      const chip = document.createElement('span');
      chip.className = 'img-chip';
      chip.textContent = `📷 ${task.images.length}`;
      meta.appendChild(chip);
    }

    if (expandable) {
      const caret = document.createElement('span');
      caret.className = 'expand-chip';
      caret.textContent = isOpen ? '▴ less' : '▾ more';
      meta.appendChild(caret);
    }

    main.append(text, meta);

    if (task.images.length && isOpen) {
      const thumbs = document.createElement('div');
      thumbs.className = 'task-thumbs';
      task.images.forEach(src => thumbs.appendChild(thumbButton(src)));
      main.appendChild(thumbs);
    }

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (!task.completedAt) {
      const edit = document.createElement('button');
      edit.className = 'icon-btn';
      edit.title = 'Edit task';
      edit.textContent = '✏️';
      edit.addEventListener('click', () => openModal(task));
      actions.appendChild(edit);
    }

    const del = document.createElement('button');
    del.className = 'icon-btn delete';
    del.title = 'Delete task';
    del.textContent = '🗑';
    del.addEventListener('click', () => {
      if (confirm('Delete this task permanently?')) {
        Store.deleteTask(task.id);
        render();
      }
    });
    actions.appendChild(del);

    card.append(check, main, actions);
    return card;
  }

  function thumbButton(src, onRemove) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.title = 'View image';
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'Task attachment';
    btn.appendChild(img);
    btn.addEventListener('click', e => { e.preventDefault(); openLightbox(src); });
    if (!onRemove) return btn;
    wrap.appendChild(btn);
    const rm = document.createElement('button');
    rm.className = 'thumb-remove';
    rm.title = 'Remove image';
    rm.textContent = '✕';
    rm.addEventListener('click', onRemove);
    wrap.appendChild(rm);
    return wrap;
  }

  function renderArchive(archived) {
    els.archiveBody.textContent = '';
    els.archiveCtxLabel.textContent = `· ${Store.settings.context}`;
    if (!archived.length) {
      const empty = document.createElement('div');
      empty.className = 'quad-empty';
      empty.textContent = 'No completed tasks yet.';
      els.archiveBody.appendChild(empty);
      return;
    }
    archived.sort((a, b) => b.completedAt - a.completedAt);
    for (const task of archived) els.archiveBody.appendChild(taskCard(task, false));
  }

  /* ---- composer ---- */

  function setDraftUrgency(level) {
    draftUrgency = level;
    els.urgLow.classList.toggle('selected', level === 'low');
    els.urgHigh.classList.toggle('selected', level === 'high');
    els.urgLow.setAttribute('aria-checked', level === 'low');
    els.urgHigh.setAttribute('aria-checked', level === 'high');
  }

  function renderDraftImages() {
    els.draftImages.textContent = '';
    els.draftImages.hidden = !draftImages.length;
    draftImages.forEach((src, i) => {
      els.draftImages.appendChild(thumbButton(src, () => {
        draftImages.splice(i, 1);
        renderDraftImages();
      }));
    });
  }

  function addFromComposer() {
    const text = els.newText.value.trim();
    if (!text && !draftImages.length) return;
    const created = Store.addTask({
      text: text || '📷 (image task)',
      urgency: draftUrgency,
      images: draftImages
    });
    if (created) {
      els.newText.value = '';
      draftImages = [];
      renderDraftImages();
      setDraftUrgency('low');
      render();
    }
  }

  /* ---- context switch ---- */

  function setContext(ctx) {
    Store.setSetting('context', ctx);
    els.ctxSwitch.classList.toggle('home', ctx === 'home');
    els.ctxWork.setAttribute('aria-selected', ctx === 'work');
    els.ctxHome.setAttribute('aria-selected', ctx === 'home');
    render();
  }

  /* ---- edit modal ---- */

  function openModal(task) {
    editing = { id: task.id, urgency: task.urgency, images: [...task.images] };
    els.editText.value = task.text;
    els.editAge.textContent = Age.label(task);
    setEditUrgency(task.urgency);
    renderEditImages();
    els.modal.showModal();
  }

  function setEditUrgency(level) {
    if (editing) editing.urgency = level;
    els.editUrgLow.classList.toggle('selected', level === 'low');
    els.editUrgHigh.classList.toggle('selected', level === 'high');
  }

  function renderEditImages() {
    els.editImages.textContent = '';
    editing.images.forEach((src, i) => {
      els.editImages.appendChild(thumbButton(src, () => {
        editing.images.splice(i, 1);
        renderEditImages();
      }));
    });
  }

  /* ---- lightbox ---- */

  function openLightbox(src) {
    els.lightboxImg.src = src;
    els.lightbox.hidden = false;
  }

  /* ---- archive drawer ---- */

  function toggleArchive(open) {
    els.archiveDrawer.hidden = !open;
    els.scrim.hidden = !open;
  }

  /* ---- wiring ---- */

  function init() {
    // Restore settings
    els.threshold.value = String(Store.settings.oldThresholdDays);
    setContext(Store.settings.context);

    els.ctxWork.addEventListener('click', () => setContext('work'));
    els.ctxHome.addEventListener('click', () => setContext('home'));

    // Tapping a quadrant header expands/collapses its list (when over the cap)
    for (const [key, body] of Object.entries(els.quads)) {
      const header = body.closest('.quad').querySelector('header');
      header.addEventListener('click', () => {
        if (header.classList.contains('clickable')) toggleQuad(key);
      });
    }

    els.threshold.addEventListener('change', () => {
      Store.setSetting('oldThresholdDays', Number(els.threshold.value));
      render();
    });

    els.urgLow.addEventListener('click', () => setDraftUrgency('low'));
    els.urgHigh.addEventListener('click', () => setDraftUrgency('high'));
    els.addBtn.addEventListener('click', addFromComposer);
    els.newText.addEventListener('keydown', e => { if (e.key === 'Enter') addFromComposer(); });

    // Paste an image while the composer is focused → attach to draft
    els.newText.addEventListener('paste', async e => {
      const imgs = Images.fromClipboard(e);
      if (imgs) { draftImages.push(...await imgs); renderDraftImages(); }
    });

    // Paste an image while the edit modal is open → attach to that task
    els.modal.addEventListener('paste', async e => {
      if (!editing) return;
      const imgs = Images.fromClipboard(e);
      if (imgs) { editing.images.push(...await imgs); renderEditImages(); }
    });

    els.editUrgLow.addEventListener('click', () => setEditUrgency('low'));
    els.editUrgHigh.addEventListener('click', () => setEditUrgency('high'));
    els.editCancel.addEventListener('click', () => { editing = null; els.modal.close(); });
    els.editSave.addEventListener('click', () => {
      if (!editing) return;
      const text = els.editText.value.trim();
      Store.updateTask(editing.id, {
        text: text || '📷 (image task)',
        urgency: editing.urgency,
        images: editing.images
      });
      editing = null;
      els.modal.close();
      render();
    });
    els.editDelete.addEventListener('click', () => {
      if (editing && confirm('Delete this task permanently?')) {
        Store.deleteTask(editing.id);
        editing = null;
        els.modal.close();
        render();
      }
    });
    els.modal.addEventListener('close', () => { editing = null; });

    els.archiveToggle.addEventListener('click', () => toggleArchive(true));
    els.closeArchive.addEventListener('click', () => toggleArchive(false));
    els.scrim.addEventListener('click', () => toggleArchive(false));
    els.clearArchive.addEventListener('click', () => {
      if (confirm(`Clear all archived ${Store.settings.context} tasks? This cannot be undone.`)) {
        Store.clearArchive(Store.settings.context);
        render();
      }
    });

    els.lightbox.addEventListener('click', () => { els.lightbox.hidden = true; });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !els.lightbox.hidden) els.lightbox.hidden = true;
    });

    // Start the age engine (midnight tick + drift watchdog + wake-up hook)
    refreshAgeFingerprint = Age.start(render);
    render();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', UI.init);
