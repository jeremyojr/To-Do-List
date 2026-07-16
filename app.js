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
      if (!raw) return migrate(defaults());
      const parsed = JSON.parse(raw);
      return migrate({ ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } });
    } catch {
      return migrate(defaults());
    }
  }

  // Additive schema upgrades; the storage key stays matrixTodo.v1.
  // - updatedAt powers newest-edit-wins sync merges.
  // - Deleted tasks become tombstones ({id, deleted, updatedAt}) so a
  //   delete on one device isn't resurrected by another; purge them
  //   after 30 days to keep the file small.
  function migrate(s) {
    const cutoff = Date.now() - 30 * 86_400_000;
    s.tasks = s.tasks.filter(t => !(t.deleted && t.updatedAt < cutoff));
    for (const t of s.tasks) if (!t.updatedAt) t.updatedAt = t.completedAt || t.createdAt;
    return s;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      document.dispatchEvent(new CustomEvent('finisher:saved'));
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
      const now = Date.now();
      const task = {
        id: uid(),
        text,
        context: state.settings.context,
        urgency,               // 'high' | 'low'
        createdAt: now,
        completedAt: null,
        updatedAt: now,
        images: images || []
      };
      state.tasks.push(task);
      if (!save()) { state.tasks.pop(); return null; }
      return task;
    },

    updateTask(id, patch) {
      const t = state.tasks.find(t => t.id === id);
      if (t) { Object.assign(t, patch, { updatedAt: Date.now() }); save(); }
      return t;
    },

    deleteTask(id) {
      state.tasks = state.tasks.map(t =>
        t.id === id ? { id, deleted: true, updatedAt: Date.now() } : t);
      save();
    },

    clearArchive(context) {
      state.tasks = state.tasks.map(t =>
        (t.completedAt && t.context === context && !t.deleted)
          ? { id: t.id, deleted: true, updatedAt: Date.now() } : t);
      save();
    },

    // Install a merged task list coming back from sync.
    replaceTasks(tasks) {
      state.tasks = tasks;
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
    Store.tasks.filter(t => !t.deleted).map(t => `${t.id}:${isOld(t) ? 'o' : 'n'}:${ageDays(t)}`).join('|');

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

/* ------------------------------ Sync ------------------------------ */
/* Optional cross-device sync via Google Drive. The task list is kept
   as one JSON file in the app's hidden appDataFolder in the USER'S OWN
   Drive — this app can only see its own file, never the rest of Drive.
   Merging is per task, newest updatedAt wins; deletions propagate via
   tombstones. Local storage stays the source for rendering, so the app
   is fully usable offline and reconciles when a connection returns.

   Auth uses the OAuth redirect flow (no popups, no external script):
   connect navigates to Google and straight back with a ~1h token that
   is remembered on the device. When it expires, the app renews it with
   a sub-second prompt=none redirect bounce — on load or when the tab
   becomes visible — so after the one-time connect, sync stays on.
   The composer draft is stashed in sessionStorage across the bounce.

   Requires a Google OAuth Client ID (free) whose authorized JavaScript
   origin AND authorized redirect URI match the URL this app is served
   from. Set it below or paste it once in the in-app Sync dialog. */

const Sync = (() => {
  // OAuth Client ID (public by design — only works from the authorized origin)
  const DEFAULT_CLIENT_ID = '520934448997-8rhk87lrpda9rvvfo643pljqv27111bf.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME = 'finisher-data.json';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

  let accessToken = null;
  let fileId = null;
  let state = 'off';        // off | signedout | syncing | synced | error
  let lastSyncAt = null;
  let pushTimer = null;
  let applyingRemote = false;
  let onRemoteApplied = () => {};
  let onState = () => {};
  let onBeforeRedirect = () => {};

  const clientId = () => Store.settings.driveClientId || DEFAULT_CLIENT_ID;
  const enabled = () => !!Store.settings.driveSyncOn;
  const tokenValid = () => !!accessToken && Date.now() < (Store.settings.driveTokenExp || 0);

  function setState(s) { state = s; onState(state, lastSyncAt); }

  /* ---- auth: redirect flow ---- */

  // Must exactly match an Authorized redirect URI on the OAuth client.
  const redirectUri = () =>
    location.origin + location.pathname.replace(/index\.html$/, '');

  function authUrl(silent) {
    const p = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state: silent ? 'finisher-silent' : 'finisher-interactive'
    });
    if (silent) p.set('prompt', 'none');
    return `${AUTH}?${p}`;
  }

  function goAuth(silent) {
    onBeforeRedirect(); // stash the composer draft across the bounce
    location.assign(authUrl(silent));
  }

  // Handle the return leg: token (or error) arrives in the URL fragment.
  function consumeAuthResponse() {
    if (!/access_token=|error=/.test(location.hash)) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    if (!(h.get('state') || '').startsWith('finisher-')) return null; // not ours
    history.replaceState(null, '', location.pathname + location.search);
    return {
      token: h.get('access_token'),
      expiresIn: Number(h.get('expires_in')) || 3600,
      error: h.get('error')
    };
  }

  function adoptToken(token, expiresIn) {
    accessToken = token;
    Store.setSetting('driveToken', token);
    Store.setSetting('driveTokenExp', Date.now() + (expiresIn - 60) * 1000);
  }

  function dropToken() {
    accessToken = null;
    Store.setSetting('driveToken', null);
    Store.setSetting('driveTokenExp', 0);
  }

  // Renew the token without user interaction via a prompt=none bounce.
  // Only after one successful redirect auth on this device (proves the
  // redirect URI is registered), and rate-limited so a misbehaving
  // response can never cause a redirect loop.
  function maybeSilentReauth() {
    if (!enabled() || !clientId() || !Store.settings.driveRedirectOk) {
      setState(enabled() ? 'signedout' : 'off');
      return;
    }
    const last = Number(sessionStorage.getItem('finisher.lastSilentAuth') || 0);
    if (Date.now() - last < 60_000) { setState('signedout'); return; }
    sessionStorage.setItem('finisher.lastSilentAuth', String(Date.now()));
    setState('syncing');
    goAuth(true);
  }

  /* ---- Drive API ---- */

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${accessToken}`, ...(opts.headers || {}) }
    });
    if (res.status === 401) { dropToken(); throw new Error('auth-expired'); }
    if (!res.ok) throw new Error(`Drive API ${res.status}`);
    return res;
  }

  async function findFile() {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const res = await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
    const { files } = await res.json();
    fileId = files?.[0]?.id || null;
    return fileId;
  }

  async function createFile() {
    const res = await api(`${API}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })
    });
    fileId = (await res.json()).id;
    return fileId;
  }

  const download = async id =>
    (await api(`${API}/files/${id}?alt=media`)).json();

  const upload = (id, data) =>
    api(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

  /* ---- merge + sync ---- */

  // Per-task merge: for each id keep whichever side edited it last.
  function merge(remoteTasks, localTasks) {
    const byId = new Map();
    for (const t of remoteTasks) byId.set(t.id, t);
    for (const t of localTasks) {
      const r = byId.get(t.id);
      if (!r || (t.updatedAt || 0) >= (r.updatedAt || 0)) byId.set(t.id, t);
    }
    return [...byId.values()];
  }

  const signature = tasks =>
    JSON.stringify([...tasks].sort((a, b) => a.id < b.id ? -1 : 1));

  async function syncNow() {
    if (!tokenValid()) { maybeSilentReauth(); return; }
    setState('syncing');
    try {
      const id = await findFile() || await createFile();
      let remoteTasks = [];
      try {
        const remote = await download(id);
        if (Array.isArray(remote?.tasks)) remoteTasks = remote.tasks;
      } catch (err) {
        if (err.message === 'auth-expired') throw err;
        /* empty or unreadable file: treat as first sync */
      }

      const merged = merge(remoteTasks, Store.tasks);

      if (signature(merged) !== signature(Store.tasks)) {
        applyingRemote = true;
        Store.replaceTasks(merged);
        applyingRemote = false;
        onRemoteApplied();
      }
      if (signature(merged) !== signature(remoteTasks)) {
        await upload(id, { version: 1, savedAt: Date.now(), tasks: merged });
      }
      lastSyncAt = Date.now();
      setState('synced');
    } catch (err) {
      console.warn('Sync failed:', err);
      // Expired token: quietly renew on the next natural moment (now if
      // the tab is visible); other errors keep local-only and retry.
      setState(err.message === 'auth-expired' ? 'signedout' : 'error');
      if (err.message === 'auth-expired' && !document.hidden) maybeSilentReauth();
    }
  }

  // Local edits push after a short quiet period (each sync re-pulls first,
  // so racing edits from another device still merge safely).
  function notifyLocalChange() {
    if (applyingRemote || !enabled() || !tokenValid()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 2500);
  }

  // Interactive connect (from the Sync dialog): full redirect to Google.
  function connect() {
    goAuth(false);
  }

  function disable() {
    Store.setSetting('driveSyncOn', false);
    Store.setSetting('driveRedirectOk', false);
    dropToken();
    fileId = null;
    setState('off');
  }

  function init(remoteAppliedCb, stateCb, beforeRedirectCb) {
    onRemoteApplied = remoteAppliedCb;
    onState = stateCb;
    onBeforeRedirect = beforeRedirectCb || (() => {});

    document.addEventListener('finisher:saved', notifyLocalChange);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !enabled()) return;
      if (tokenValid()) syncNow();
      else maybeSilentReauth();
    });
    setInterval(() => { if (enabled() && tokenValid()) syncNow(); }, 120_000);

    // Returning from Google?
    const resp = consumeAuthResponse();
    if (resp) {
      if (resp.token) {
        adoptToken(resp.token, resp.expiresIn);
        Store.setSetting('driveSyncOn', true);
        Store.setSetting('driveRedirectOk', true);
        syncNow();
      } else {
        // Silent renewal needs a real sign-in (Google session gone).
        setState(enabled() ? 'signedout' : 'off');
      }
      return;
    }

    // Normal load: resume with the remembered token, renew it silently,
    // or stay off until the user connects.
    if (enabled() && clientId()) {
      accessToken = Store.settings.driveToken || null;
      if (tokenValid()) syncNow();
      else maybeSilentReauth();
    } else {
      setState(enabled() ? 'signedout' : 'off');
    }
  }

  return {
    init, connect, disable, syncNow,
    get state() { return state; },
    get lastSyncAt() { return lastSyncAt; },
    get configured() { return !!clientId(); },
    get enabled() { return enabled(); }
  };
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
    lightboxImg: $('#lightbox-img'),
    syncBtn: $('#sync-btn'),
    syncModal: $('#sync-modal'),
    syncStatus: $('#sync-status'),
    syncSetup: $('#sync-setup'),
    syncClientId: $('#sync-client-id'),
    syncConnect: $('#sync-connect'),
    syncOff: $('#sync-off'),
    syncClose: $('#sync-close')
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
    const live = Store.tasks.filter(t => !t.deleted && t.context === ctx);
    const active = live.filter(t => !t.completedAt);
    const archived = live.filter(t => t.completedAt);

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

  // Render plain text into `container`, turning URLs into clickable links.
  // Built with DOM nodes (never innerHTML) so task text can't inject markup.
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

  function renderTextWithLinks(container, text) {
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
      let url = m[0].replace(/[).,;:!?\]]+$/, ''); // trailing punctuation isn't part of the URL
      if (!url) continue;
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      const a = document.createElement('a');
      a.href = url.toLowerCase().startsWith('www.') ? 'https://' + url : url;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      container.appendChild(a);
      last = m.index + url.length;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
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
        if (e.target.closest('button, a')) return; // buttons and links handle themselves
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
    renderTextWithLinks(text, task.text);

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

  /* ---- sync ---- */

  function syncStateChanged(state, lastSyncAt) {
    const labels = {
      off: '☁ Sync',
      signedout: '☁ Sign in',
      syncing: '⟳ Syncing…',
      synced: '☁ Synced',
      error: '⚠ Sync'
    };
    els.syncBtn.textContent = labels[state] || '☁ Sync';

    const at = lastSyncAt ? ` Last synced ${Age.stamp(lastSyncAt)}.` : '';
    const messages = {
      off: 'Sync is off. Your tasks stay on this device only.',
      signedout: 'Sync needs a quick sign-in on this device. Tap Connect — after that it reconnects by itself.',
      syncing: 'Syncing with Google Drive…',
      synced: `Up to date with Google Drive. Everything you enter saves and syncs automatically.${at}`,
      error: `Couldn’t reach Google Drive — will keep retrying. Your tasks are safe on this device.${at}`
    };
    els.syncStatus.textContent = messages[state] || '';
    els.syncOff.hidden = state === 'off';
    els.syncConnect.textContent =
      state === 'synced' || state === 'syncing' ? 'Sync now' : 'Connect Google Drive';
  }

  function openSyncModal() {
    els.syncSetup.hidden = Sync.configured; // paste field only appears if no Client ID is built in
    els.syncClientId.value = Store.settings.driveClientId || '';
    els.syncModal.showModal();
  }

  function syncConnectClicked() {
    const pasted = els.syncClientId.value.trim();
    if (pasted) Store.setSetting('driveClientId', pasted);
    if (!Sync.configured) {
      els.syncStatus.textContent = 'Paste your Google OAuth Client ID first (see README for the one-time setup).';
      return;
    }
    if (Sync.state === 'synced' || Sync.state === 'syncing') {
      Sync.syncNow(); // already connected — just sync now
      return;
    }
    Sync.connect(); // navigates to Google and straight back
  }

  // The auth redirect briefly leaves the page; keep any half-typed task.
  function stashDraft() {
    if (els.newText.value.trim() || draftImages.length) {
      sessionStorage.setItem('finisher.draft', JSON.stringify({
        text: els.newText.value, urgency: draftUrgency, images: draftImages
      }));
    }
  }

  function restoreDraft() {
    const raw = sessionStorage.getItem('finisher.draft');
    if (!raw) return;
    sessionStorage.removeItem('finisher.draft');
    try {
      const d = JSON.parse(raw);
      els.newText.value = d.text || '';
      draftImages = Array.isArray(d.images) ? d.images : [];
      setDraftUrgency(d.urgency === 'high' ? 'high' : 'low');
      renderDraftImages();
    } catch { /* corrupt stash: ignore */ }
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

    els.syncBtn.addEventListener('click', openSyncModal);
    els.syncConnect.addEventListener('click', syncConnectClicked);
    els.syncOff.addEventListener('click', () => { Sync.disable(); });
    els.syncClose.addEventListener('click', () => els.syncModal.close());

    // Start the age engine (midnight tick + drift watchdog + wake-up hook)
    refreshAgeFingerprint = Age.start(render);
    restoreDraft(); // bring back anything typed before an auth redirect
    render();

    // Start sync (no-op until connected in the ☁ dialog)
    Sync.init(render, syncStateChanged, stashDraft);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', UI.init);
