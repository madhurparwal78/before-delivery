// The shared client bundle: pages rendered by hand, domain decisions compiled from src/domain.
// Domain modules are bundled at build time from dist/ (see build.mjs).

const params = new URLSearchParams(location.search);
const path = location.pathname;
const app = document.getElementById('app');

/* ---------- announcements (Feedback states) ---------- */

const SAVED_TEXT = 'All changes saved.';
const SAVING_TEXT = 'Saving…';
const NOT_SAVED_TEXT = 'Not saved. Check your connection.';
const OFFLINE_PROBLEM = 'Mullion could not be reached. Your last change was not saved.';
const LIVE_PAUSED = 'Live updates are paused. Your changes are still saved.';

/* ---------- API ---------- */

async function api(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, init); } catch { return { status: 0, body: null, raw: null }; }
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch {}
  return { status: res.status, body: parsed, raw };
}

/* ---------- small DOM helpers ---------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function focusTrap(dialog, onEscape) {
  dialog.tabIndex = -1;
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onEscape(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
}

function dialogHost(build, opener, onClose) {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true' });
  backdrop.append(dialog);
  const close = () => { backdrop.remove(); if (opener && opener.isConnected) opener.focus(); if (onClose) onClose(); };
  build(dialog, close);
  document.body.append(backdrop);
  focusTrap(dialog, close);
  // Escape closes the dialog from anywhere on the page while it is open.
  const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(backdrop)) {
      document.removeEventListener('keydown', onKey, true);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { backdrop, dialog, close };
}

/* ---------- routing ---------- */

const routes = [
  { match: /^\/signup$/, render: signupPage },
  { match: /^\/signin$/, render: signinPage },
  { match: /^\/$/, render: libraryPage },
  { match: /^\/layouts\/([^/]+)$/, render: editorPage },
  { match: /^\/view\/([^/]+)$/, render: viewPage },
  { match: /^\/join\/([^/]+)$/, render: joinPage },
];

async function route() {
  for (const entry of routes) {
    const match = entry.match.exec(path);
    if (match) { await entry.render(...match.slice(1)); return; }
  }
  await notAvailablePage('Your layouts');
}

/* ---------- auth pages ---------- */

async function signupPage() {
  const next = safeNext();
  document.title = 'Create your account — Mullion';
  app.textContent = '';
  const problem = el('div', { role: 'alert', 'aria-label': 'Form problem', class: 'alert problem' });
  const card = el('div', { class: 'card auth-card' },
    el('h1', { text: 'Create your account' }),
    el('form', {},
      field('Username', 'username', 'text'),
      field('Password', 'password', 'password'),
      problem,
      el('button', { class: 'primary', type: 'submit', text: 'Create account' }),
      el('a', { href: `/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`, text: 'Sign in' }),
    ),
  );
  card.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = card.querySelector('#username').value;
    const password = card.querySelector('#password').value;
    const res = await api('POST', '/api/signup', { username, password });
    if (res.status === 201) { location.href = next || '/'; return; }
    problem.textContent = res.body?.message ?? 'Mullion could not be reached.';
  });
  app.append(card);
  card.querySelector('#username').focus();
}

async function signinPage() {
  const next = safeNext();
  document.title = 'Sign in — Mullion';
  app.textContent = '';
  const problem = el('div', { role: 'alert', 'aria-label': 'Form problem', class: 'alert problem' });
  const card = el('div', { class: 'card auth-card' },
    el('h1', { text: 'Sign in' }),
    el('form', {},
      field('Username', 'username', 'text'),
      field('Password', 'password', 'password'),
      problem,
      el('button', { class: 'primary', type: 'submit', text: 'Sign in' }),
      el('a', { href: `/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`, text: 'Create an account' }),
    ),
  );
  card.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = card.querySelector('#username').value;
    const password = card.querySelector('#password').value;
    const res = await api('POST', '/api/session', { username, password });
    if (res.status === 200) { location.href = next || '/'; return; }
    problem.textContent = res.body?.message ?? 'Mullion could not be reached.';
  });
  app.append(card);
  card.querySelector('#username').focus();
}

function field(label, id, type) {
  const input = el('input', { id, type, 'aria-label': label, autocomplete: 'off' });
  return el('label', { for: id }, label, input);
}

function safeNext() {
  const value = params.get('next') ?? '';
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value;
  return '';
}

/* ---------- library ---------- */

async function libraryPage() {
  const me = await api('GET', '/api/me');
  if (me.status === 401) { location.href = `/signin?next=${encodeURIComponent(path)}`; return; }
  document.title = 'Your layouts — Mullion';
  app.textContent = '';
  const topbar = el('div', { class: 'topbar' },
    el('span', { class: 'wordmark', text: 'Mullion' }),
    el('span', { class: 'grow' }),
    el('button', { text: 'Sign out', onclick: async () => { await api('DELETE', '/api/session'); location.href = '/signin'; } }),
  );
  const list = el('ul', { class: 'layout-list' });
  const head = el('div', { class: 'head' },
    el('h1', { text: 'Your layouts' }),
    el('button', { class: 'primary', text: 'New layout', onclick: (event) => newLayoutDialog(event.currentTarget) }),
  );
  const container = el('div', { class: 'library' }, topbar, head, list);
  app.append(container);

  const res = await api('GET', '/api/layouts');
  if (res.body?.layouts?.length === 0) {
    list.replaceWith(el('p', { text: 'No layouts yet.' }));
  } else if (res.body?.layouts) {
    for (const layout of res.body.layouts) {
      list.append(el('li', {},
        el('a', { href: `/layouts/${layout.id}` },
          el('strong', { text: layout.name }),
          el('div', { class: 'cols', text: layout.columns.join(' ') }),
        ),
      ));
    }
  }
}

function newLayoutDialog(opener) {
  dialogHost((dialog, close) => {
    dialog.setAttribute('aria-label', 'New layout');
    const problem = el('div', { role: 'alert', 'aria-label': 'Dialog problem', class: 'alert problem' });
    const radios = el('div', { role: 'radiogroup', 'aria-label': 'Starter template', class: 'radios' });
    const templates = [['blank', 'Blank'], ['holy-grail', 'Holy Grail'], ['dashboard-shell', 'Dashboard Shell'], ['magazine-spread', 'Magazine Spread']];
    templates.forEach(([value, label], index) => {
      const input = el('input', { type: 'radio', name: 'template', id: `tpl-${value}`, value });
      if (index === 0) input.checked = true;
      radios.append(el('label', { for: `tpl-${value}` }, input, label));
    });
    const nameInput = el('input', { type: 'text', id: 'layout-name', 'aria-label': 'Layout name' });
    dialog.append(
      el('h2', { text: 'New layout' }),
      el('form', {},
        el('label', { class: 'field', for: 'layout-name' }, 'Layout name', nameInput),
        radios,
        problem,
        el('div', { class: 'actions' },
          el('button', { type: 'submit', class: 'primary', text: 'Create layout' }),
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      ),
    );
    dialog.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const template = dialog.querySelector('input[name="template"]:checked')?.value ?? 'blank';
      const res = await api('POST', '/api/layouts', { name: nameInput.value, template });
      if (res.status === 201) { close(); location.href = `/layouts/${res.body.id}`; return; }
      problem.textContent = res.body?.message ?? 'Mullion could not be reached.';
    });
    nameInput.focus();
  }, opener);
}

/* ---------- not available ---------- */

async function notAvailablePage(linkText) {
  document.title = 'This layout is not available. — Mullion';
  app.textContent = '';
  app.append(el('div', { class: 'library' },
    el('h1', { text: 'This layout is not available.' }),
    el('p', {}, el('a', { href: linkText === 'Sign in' ? '/signin' : '/', text: linkText })),
  ));
}

/* ---------- join ---------- */

async function joinPage() {
  // The server sends a signed-out visitor to /signin with next back to this page.
  await notAvailablePage('Sign in');
}

/* ---------- view page ---------- */

async function viewPage(token) {
  const res = await api('GET', `/api/view/${token}`);
  if (res.status !== 200) { await notAvailablePage('Sign in'); return; }
  const layout = res.body;
  document.title = `${layout.name} — Mullion`;
  app.textContent = '';
  renderReadonlyPage(layout, `/api/view/${token}/live`);
}

/* ---------- editor and view rendering ---------- */

const scopeName = (width) => width;

function scopeOfLayout(layout, scope) {
  if (scope === 'base') return { columns: layout.columns, rows: layout.rows, areas: layout.areas, gap: layout.gap, ownGap: true };
  const bp = layout.breakpoints.find((b) => b.min_width === scope);
  if (!bp) return null;
  return { columns: bp.columns, rows: bp.rows, areas: bp.areas, gap: bp.gap ?? inheritedGap(layout, scope), ownGap: bp.gap !== null };
}

function inheritedGap(layout, width) {
  let gap = layout.gap;
  for (const bp of layout.breakpoints) if (bp.min_width < width && bp.gap) gap = bp.gap;
  return gap;
}

function scopeInEffect(layout, width) {
  let current = 'base';
  for (const bp of layout.breakpoints) if (bp.min_width <= width) current = bp.min_width;
  return current;
}

function tabName(scope) { return scope === 'base' ? 'Base' : `From ${scope}px`; }

async function editorPage(id) {
  const me = await api('GET', '/api/me');
  if (me.status === 401) { location.href = `/signin?next=${encodeURIComponent(path)}`; return; }
  const res = await api('GET', `/api/layouts/${id}`);
  if (res.status !== 200) { await notAvailablePage('Your layouts'); return; }
  const layout = res.body;
  document.title = `${layout.name} — Mullion`;
  app.textContent = '';
  renderEditor(layout);
}

/* ---------- editor ---------- */

const PREVIEW_MIN = 320;
const PREVIEW_MAX = 1440;

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function trackSizeFromDomain(text) {
  // The single decision on track sizes, mirrored from the server's rule.
  const value = String(text).trim();
  const formMessage = 'Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).';
  const rangeMessage = 'Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%.';
  const frMinMaxMessage = 'A flexible size (fr) can only be the maximum in minmax.';
  const orderMinMaxMessage = 'The minimum is larger than the maximum.';
  const parsePart = (raw) => {
    if (raw === 'auto') return { unit: 'auto' };
    const m = /^(\d+(?:\.\d+)?)(fr|px|%)$/.exec(raw);
    if (!m) return null;
    return { unit: m[2], amount: Number(m[1]) };
  };
  const range = (part) => {
    if (!part) return formMessage;
    if (part.unit === 'auto') return null;
    if (part.unit === 'fr') return part.amount < 0.25 || part.amount > 100 ? rangeMessage : null;
    if (part.unit === 'px') return (!Number.isInteger(part.amount) || part.amount < 1 || part.amount > 4000) ? rangeMessage : null;
    return part.amount < 1 || part.amount > 100 ? rangeMessage : null;
  };
  const minmax = /^minmax\s*\((.*)\)$/.exec(value);
  if (minmax) {
    const inner = minmax[1];
    const comma = inner.split(',');
    if (comma.length !== 2) return { error: formMessage };
    const min = parsePart(comma[0].trim());
    const max = parsePart(comma[1].trim());
    if (!min || !max || min.unit === 'auto' && false) return { error: formMessage };
    if (min.unit === 'minmax' || max.unit === 'minmax') return { error: formMessage };
    if (min.unit === 'fr') return { error: frMinMaxMessage };
    const minErr = range(min);
    if (minErr) return { error: minErr };
    const maxErr = range(max);
    if (maxErr) return { error: maxErr };
    if (min.unit === 'px' && max.unit === 'px' && min.amount > max.amount) return { error: orderMinMaxMessage };
    if (min.unit === '%' && max.unit === '%' && min.amount > max.amount) return { error: orderMinMaxMessage };
    const canon = (part) => part.unit === 'auto' ? 'auto' : `${Number(part.amount.toFixed(2))}${part.unit}`;
    return { size: `minmax(${canon(min)}, ${canon(max)})` };
  }
  const part = parsePart(value);
  if (!part) return { error: formMessage };
  const err = range(part);
  if (err) return { error: err };
  return { size: `${Number(part.amount.toFixed(2))}${part.unit}` };
}

function trackUnit(size) {
  if (size === 'auto') return 'auto';
  if (size.startsWith('minmax')) return 'minmax';
  if (size.endsWith('fr')) return 'fr';
  if (size.endsWith('px')) return 'px';
  if (size.endsWith('%')) return '%';
  return 'fr';
}

function renderEditor(initialLayout) {
  const layoutId = initialLayout.id;
  const state = {
    layout: initialLayout,
    scope: 'base',
    previewWidth: 1280,
    cursor: { row: 1, column: 1 },
    anchor: { row: 1, column: 1 },
    designers: [],
    meUsername: '',
    saving: 0,
    noticeTimer: null,
  };

  const updates = el('div', { role: 'status', 'aria-label': 'Layout updates', 'aria-live': 'polite', class: 'status' });
  const problem = el('div', { role: 'alert', 'aria-label': 'Edit problem', class: 'alert problem' });
  const noticeHost = el('div', { role: 'alert', 'aria-label': 'Editor notice', class: 'alert' });
  const liveStatus = el('div', { role: 'status', 'aria-label': 'Live status', class: 'status' });
  const saveState = el('div', { role: 'status', 'aria-label': 'Save state', class: 'status', text: SAVED_TEXT });

  const topbar = el('div', { class: 'topbar editor-topbar' },
    el('a', { href: '/', text: 'Your layouts' }),
    el('h1', { text: state.layout.name }),
    el('span', { class: 'grow' }),
    saveState,
    el('button', { text: 'Save version', onclick: (e) => saveVersionDialog(e.currentTarget) }),
    el('button', { text: 'Versions', onclick: (e) => versionsDrawer(e.currentTarget) }),
    state.layout.role === 'owner' ? el('button', { text: 'Share', onclick: (e) => shareDialog(e.currentTarget) }) : null,
  );

  const breakpointTabs = el('div', { role: 'tablist', 'aria-label': 'Breakpoints', class: 'tablist' });
  const addBreakpointButton = el('button', { text: 'Add breakpoint', onclick: (e) => addBreakpointDialog(e.currentTarget) });
  const removeBreakpointButton = el('button', { text: 'Remove breakpoint', onclick: () => removeBreakpoint() });
  const rowGap = el('input', { type: 'text', 'aria-label': 'Row gap', class: 'mono' });
  const columnGap = el('input', { type: 'text', 'aria-label': 'Column gap', class: 'mono' });
  const gapNote = el('div', { class: 'gap-note' });
  const addColumn = el('button', { text: 'Add column', onclick: () => sendChange({ kind: 'add_track', scope: state.scope, axis: 'column', after: state.cursor.column }) });
  const addRow = el('button', { text: 'Add row', onclick: () => sendChange({ kind: 'add_track', scope: state.scope, axis: 'row', after: state.cursor.row }) });
  const designersList = el('ul', { role: 'list', 'aria-label': 'Designers here', class: 'presence-list' });

  const rail = el('div', { class: 'rail pane', 'data-pane': 'Tracks' },
    el('h3', { text: 'Breakpoints' }),
    breakpointTabs,
    el('div', { class: 'group' }, addBreakpointButton, removeBreakpointButton),
    el('div', { class: 'group' },
      el('div', {}, el('label', { for: 'row-gap-field' }, 'Row gap'), rowGap),
      el('div', {}, el('label', { for: 'column-gap-field' }, 'Column gap'), columnGap),
      gapNote,
    ),
    el('div', { class: 'group' }, addColumn, addRow),
    el('div', { class: 'group' }, el('h3', { text: 'Designers here' }), designersList),
  );

  const canvas = el('div', { class: 'canvas-wrap pane', 'data-pane': 'Grid' });

  const previewWidthInput = el('input', {
    type: 'range', 'aria-label': 'Preview width', class: 'mono',
    min: String(PREVIEW_MIN), max: String(PREVIEW_MAX), value: '1280', step: '10',
  });
  const previewReadout = el('span', { class: 'preview-readout mono', text: '1280px' });
  const previewFrame = el('iframe', { title: 'Layout preview', class: 'layout-preview' });
  const codeTabs = el('div', { role: 'tablist', 'aria-label': 'Code', class: 'tablist' });
  const cssPane = el('textarea', { 'aria-label': 'Layout CSS', class: 'mono', spellcheck: 'false' });
  const htmlPane = el('textarea', { 'aria-label': 'Layout HTML', class: 'mono', readonly: true, spellcheck: 'false' });
  const applyButton = el('button', { text: 'Apply CSS', onclick: () => applyCss() });

  const previewPane = el('div', { class: 'preview-pane pane', 'data-pane': 'Preview' },
    el('div', { class: 'preview-width-row' }, previewWidthInput, previewReadout),
    el('div', { class: 'preview-frame-wrap' }, previewFrame),
  );

  const codePane = el('div', { class: 'code-pane pane', 'data-pane': 'Code' },
    codeTabs,
    el('div', { class: 'css-holder' }, cssPane),
    el('div', {}, applyButton),
    el('div', { class: 'html-holder' }, htmlPane),
  );

  const phoneTabs = el('div', { role: 'tablist', 'aria-label': 'Editor panes', class: 'tablist pane-tabs' });

  const notices = el('div', { class: 'editor-notices' }, noticeHost, liveStatus, problem, updates);
  const editor = el('div', { class: 'editor' }, topbar, notices, rail, canvas, previewPane, codePane);
  app.append(editor, phoneTabs);

  for (const name of ['Grid', 'Tracks', 'Preview', 'Code']) {
    phoneTabs.append(el('button', {
      role: 'tab', 'data-pane': name, text: name,
      'aria-selected': name === 'Grid' ? 'true' : 'false',
      onclick: () => selectPane(name),
      onkeydown: (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const names = ['Grid', 'Tracks', 'Preview', 'Code'];
        const index = names.indexOf(name);
        const next = event.key === 'ArrowRight' ? names[(index + 1) % 4] : names[(index + 3) % 4];
        selectPane(next);
        phoneTabs.querySelector(`[data-pane="${next}"]`)?.focus();
      },
    }));
  }
  selectPane('Grid');

  function selectPane(name) {
    for (const pane of editor.querySelectorAll('.pane')) {
      if (pane.dataset.pane === name) pane.setAttribute('data-active', '');
      else pane.removeAttribute('data-active');
    }
    for (const tab of phoneTabs.children) {
      tab.setAttribute('aria-selected', String(tab.dataset.pane === name));
    }
  }

  for (const name of ['CSS', 'HTML']) {
    const tab = el('button', {
      role: 'tab', 'aria-selected': name === 'CSS' ? 'true' : 'false', text: name,
      onclick: () => {
        for (const t of codeTabs.children) t.setAttribute('aria-selected', 'false');
        tab.setAttribute('aria-selected', 'true');
        codePane.querySelector('.css-holder').classList.toggle('hidden', name !== 'CSS');
        applyButton.classList.toggle('hidden', name !== 'CSS');
        codePane.querySelector('.html-holder').classList.toggle('hidden', name !== 'HTML');
      },
    });
    codeTabs.append(tab);
  }
  codePane.querySelector('.html-holder').classList.add('hidden');

  function showNotice(text) {
    noticeHost.textContent = '';
    const row = el('div', { class: 'notice-slides notice-enter', style: 'display:flex;gap:8px;align-items:center' },
      el('span', { text, style: 'flex:1' }),
      el('button', { text: 'Dismiss notice', onclick: () => hideNotice() }),
    );
    noticeHost.append(row);
    requestAnimationFrame(() => row.classList.replace('notice-enter', 'notice-in'));
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => hideNotice(), 8000);
  }

  function hideNotice() {
    const row = noticeHost.querySelector('.notice-slides');
    if (!row) return;
    clearTimeout(state.noticeTimer);
    row.classList.remove('notice-in');
    row.classList.add('notice-exit');
    setTimeout(() => { row.remove(); }, prefersReducedMotion() ? 0 : 220);
  }

  function announceUpdate(text) { updates.textContent = text; }
  function setSaveState(text) { saveState.textContent = text; }

  function beginSaving() { state.saving += 1; setSaveState(SAVING_TEXT); }
  function endSaving(ok) {
    state.saving = Math.max(0, state.saving - 1);
    if (state.saving === 0) {
      if (ok) setSaveState(SAVED_TEXT);
      else { setSaveState(NOT_SAVED_TEXT); problem.textContent = OFFLINE_PROBLEM; }
    }
  }

  async function sendChange(change) {
    beginSaving();
    const res = await api('POST', `/api/layouts/${layoutId}/changes`, { base_revision: state.layout.revision, change });
    if (res.status === 0) { endSaving(false); return null; }
    if (res.status === 200) {
      endSaving(true);
      if (res.body.unchanged) { announceUpdate('No changes.'); return state.layout; }
      state.layout = res.body.layout;
      announceUpdate(res.body.announcement ?? 'No changes.');
      renderAll();
      return state.layout;
    }
    endSaving(true);
    if (res.status === 409) {
      state.layout = res.body.layout;
      renderAll();
      showNotice(`${res.body.username} changed ${res.body.target} first. Your change was not applied.`);
      return null;
    }
    if (res.status === 422) { problem.textContent = res.body.message ?? 'Unknown change.'; return null; }
    return null;
  }

  function currentScope() { return scopeOfLayout(state.layout, state.scope) ?? scopeOfLayout(state.layout, 'base'); }

  function renderAll() {
    renderBreakpointTabs();
    renderRail();
    renderCanvas();
    renderPreview();
    renderCode();
    renderLive();
  }

  function renderLive() { liveStatus.textContent = state.layout.live ? '' : LIVE_PAUSED; }

  function renderBreakpointTabs() {
    breakpointTabs.textContent = '';
    const scopes = ['base', ...state.layout.breakpoints.map((b) => b.min_width)];
    for (const scope of scopes) {
      breakpointTabs.append(el('button', {
        role: 'tab', 'aria-selected': String(String(state.scope) === String(scope)), text: tabName(scope),
        onclick: () => selectScope(scope),
      }));
    }
    removeBreakpointButton.disabled = state.scope === 'base';
  }

  function selectScope(scope) {
    state.scope = scope;
    state.previewWidth = scope === 'base' ? 375 : scope;
    previewWidthInput.value = String(state.previewWidth);
    previewReadout.textContent = `${state.previewWidth}px`;
    announceUpdate(`Showing ${tabName(scope)} at ${state.previewWidth}px.`);
    renderAll();
  }

  function renderRail() {
    const sc = currentScope();
    rowGap.value = `${sc.gap.row}px`;
    columnGap.value = `${sc.gap.column}px`;
    gapNote.textContent = sc.ownGap ? '' : 'inherited';
    designersList.textContent = '';
    for (const name of [...new Set(state.designers.filter(Boolean))].sort()) {
      designersList.append(el('li', { role: 'listitem', text: name }));
    }
  }

  function applyGap(axis, field) {
    const raw = String(field.value).replace('px', '').trim();
    const n = Number(raw);
    const sc = currentScope();
    if (!Number.isInteger(n) || n < 0 || n > 200 || raw === '') {
      problem.textContent = 'Gaps are whole pixels from 0 to 200.';
      field.setAttribute('aria-invalid', 'true');
      field.value = `${axis === 'row' ? sc.gap.row : sc.gap.column}px`;
      return;
    }
    field.removeAttribute('aria-invalid');
    const row = axis === 'row' ? n : sc.gap.row;
    const column = axis === 'column' ? n : sc.gap.column;
    void sendChange({ kind: 'set_gap', scope: state.scope, row, column });
  }

  rowGap.addEventListener('change', () => applyGap('row', rowGap));
  rowGap.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyGap('row', rowGap); } });
  columnGap.addEventListener('change', () => applyGap('column', columnGap));
  columnGap.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyGap('column', columnGap); } });

  function inSelection(r, c) {
    const rowStart = Math.min(state.anchor.row, state.cursor.row);
    const rowEnd = Math.max(state.anchor.row, state.cursor.row);
    const columnStart = Math.min(state.anchor.column, state.cursor.column);
    const columnEnd = Math.max(state.anchor.column, state.cursor.column);
    return r >= rowStart && r <= rowEnd && c >= columnStart && c <= columnEnd;
  }

  function selectionRect() {
    return {
      row_start: Math.min(state.anchor.row, state.cursor.row),
      row_end: Math.max(state.anchor.row, state.cursor.row) + 1,
      column_start: Math.min(state.anchor.column, state.cursor.column),
      column_end: Math.max(state.anchor.column, state.cursor.column) + 1,
    };
  }

  const CELL_W = 96;
  const CELL_H = 64;

  function renderCanvas() {
    const sc = currentScope();
    const rowCount = sc.rows.length;
    const columnCount = sc.columns.length;
    const cellHadFocus = document.activeElement?.classList?.contains('gridcell');
    const focusedCell = cellHadFocus
      ? { row: Number(document.activeElement.dataset.row), column: Number(document.activeElement.dataset.column) }
      : null;
    const grid = el('div', {
      role: 'grid', 'aria-label': 'Layout grid', class: 'layout-grid mono',
      style: `grid-template-columns: repeat(${columnCount}, ${CELL_W}px); grid-template-rows: repeat(${rowCount}, ${CELL_H}px);`,
    });
    grid.addEventListener('keydown', gridKeyDown);
    for (let r = 1; r <= rowCount; r += 1) {
      for (let c = 1; c <= columnCount; c += 1) {
        const area = sc.areas.find((a) => r >= a.row_start && r < a.row_end && c >= a.column_start && c < a.column_end);
        const isCursor = r === state.cursor.row && c === state.cursor.column;
        const cell = el('div', {
          role: 'gridcell',
          'data-row': String(r), 'data-column': String(c), 'data-area': area?.name ?? '',
          'aria-selected': String(inSelection(r, c)),
          tabindex: isCursor ? '0' : '-1',
          'aria-label': area ? `Row ${r}, column ${c}, ${area.name}` : `Row ${r}, column ${c}, empty`,
          class: 'gridcell' + (isCursor ? ' cursor' : ''),
        });
        cell.addEventListener('pointerdown', (event) => { event.preventDefault(); cellPointerDown(event, r, c, cell); });
        cell.addEventListener('pointerenter', () => { if (dragging) { state.cursor = { row: r, column: c }; refreshSelection(); } });
        cell.addEventListener('pointerup', (event) => { event.preventDefault(); cellPointerUp(event, r, c, cell); });
        grid.append(cell);
      }
    }
    const frame = el('div', { class: 'grid-frame' }, grid);
    const holder = el('div', { class: 'canvas-holder' });
    holder.append(rulers(sc), frame);
    canvas.textContent = '';
    canvas.append(holder);
    for (const area of sc.areas) {
      frame.append(el('div', {
        'data-area-name': area.name,
        'data-row-start': String(area.row_start), 'data-column-start': String(area.column_start),
        'data-row-end': String(area.row_end), 'data-column-end': String(area.column_end),
        class: 'area-block fold-glide', text: area.name,
        style: `position:absolute;left:${(area.column_start - 1) * CELL_W + 1}px;top:${(area.row_start - 1) * CELL_H + 1}px;width:${(area.column_end - area.column_start) * CELL_W - 2}px;height:${(area.row_end - area.row_start) * CELL_H - 2}px;`,
      }));
    }
    if (focusedCell) {
      canvas.querySelector(`[data-row="${focusedCell.row}"][data-column="${focusedCell.column}"]`)?.focus({ preventScroll: false });
    }
  }

  function refreshSelection() {
    const sc = currentScope();
    for (let r = 1; r <= sc.rows.length; r += 1) {
      for (let c = 1; c <= sc.columns.length; c += 1) {
        const cell = canvas.querySelector(`[data-row="${r}"][data-column="${c}"]`);
        if (cell) cell.setAttribute('aria-selected', String(inSelection(r, c)));
      }
    }
  }

  let dragging = false;

  function cellPointerDown(event, r, c, cell) {
    dragging = true;
    state.cursor = { row: r, column: c };
    state.anchor = { row: r, column: c };
    cell.setPointerCapture?.(event.pointerId);
    renderCanvas();
  }

  function cellPointerUp(event, r, c, cell) {
    if (!dragging) return;
    dragging = false;
    // Releasing on the pressed cell places the cursor and anchor; only a drag
    // that moved into other cells opens "Name area".
    const moved = state.cursor.row !== state.anchor.row || state.cursor.column !== state.anchor.column;
    if (!moved) return;
    const opener = cell;
    renderCanvas();
    openNameArea(opener, moved);
  }

  function gridKeyDown(event) {
    const target = event.target;
    if (!target.classList?.contains('gridcell')) return;
    const r = Number(target.dataset.row);
    const c = Number(target.dataset.column);
    const move = (dr, dc, extend) => {
      event.preventDefault();
      const nr = clamp(r + dr, 1, currentScope().rows.length);
      const nc = clamp(c + dc, 1, currentScope().columns.length);
      state.cursor = { row: nr, column: nc };
      if (!extend) state.anchor = { row: nr, column: nc };
      renderCanvas();
      canvas.querySelector(`[data-row="${nr}"][data-column="${nc}"]`)?.focus();
    };
    switch (event.key) {
      case 'ArrowUp': return move(-1, 0, event.shiftKey);
      case 'ArrowDown': return move(1, 0, event.shiftKey);
      case 'ArrowLeft': return move(0, -1, event.shiftKey);
      case 'ArrowRight': return move(0, 1, event.shiftKey);
      case 'Enter':
        event.preventDefault();
        return openNameArea(target, false);
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        return void sendChange({ kind: 'clear_cells', scope: state.scope, ...selectionRect() });
      case 'c': return void sendChange({ kind: 'add_track', scope: state.scope, axis: 'column', after: c });
      case 'C': return void sendChange({ kind: 'remove_track', scope: state.scope, axis: 'column', index: c });
      case 'r': return void sendChange({ kind: 'add_track', scope: state.scope, axis: 'row', after: r });
      case 'R': return void sendChange({ kind: 'remove_track', scope: state.scope, axis: 'row', index: r });
    }
  }

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() !== 'z') return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    event.preventDefault();
    void sendChange(event.shiftKey ? { kind: 'redo' } : { kind: 'undo' });
  });

  function rulers(sc) {
    const wrap = el('div', { class: 'rulers' });
    const columnHeads = el('div', { class: 'colheads', style: `display:grid;grid-template-columns:repeat(${sc.columns.length}, ${CELL_W}px);` });
    for (let c = 1; c <= sc.columns.length; c += 1) {
      const sizeField = el('input', { type: 'text', value: sc.columns[c - 1], 'aria-label': `Column ${c} size`, class: 'mono size-field' });
      sizeField.addEventListener('change', () => setTrack('column', c, sizeField));
      sizeField.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); setTrack('column', c, sizeField); } });
      columnHeads.append(el('div', {
        class: 'colhead', role: 'columnheader', 'aria-label': `Column ${c}`,
        'data-track-index': String(c), 'data-track-size': sc.columns[c - 1], 'data-track-unit': trackUnit(sc.columns[c - 1]),
      },
        el('span', { text: `Column ${c}` }),
        sizeField,
        separatorFor('column', c, sc.columns[c - 1]),
        el('button', { 'aria-label': `Remove column ${c}`, text: '×', class: 'remove-track', onclick: () => void sendChange({ kind: 'remove_track', scope: state.scope, axis: 'column', index: c }) }),
        el('span', { class: 'resolved', 'data-resolved': String(c), text: '' }),
      ));
    }
    const rowHeads = el('div', { class: 'rowheads', style: `display:grid;grid-template-rows:repeat(${sc.rows.length}, ${CELL_H}px);` });
    for (let r = 1; r <= sc.rows.length; r += 1) {
      const sizeField = el('input', { type: 'text', value: sc.rows[r - 1], 'aria-label': `Row ${r} size`, class: 'mono size-field' });
      sizeField.addEventListener('change', () => setTrack('row', r, sizeField));
      sizeField.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); setTrack('row', r, sizeField); } });
      rowHeads.append(el('div', {
        class: 'rowhead', role: 'rowheader', 'aria-label': `Row ${r}`,
        'data-track-index': String(r), 'data-track-size': sc.rows[r - 1], 'data-track-unit': trackUnit(sc.rows[r - 1]),
      },
        el('span', { text: `Row ${r}` }),
        sizeField,
        separatorFor('row', r, sc.rows[r - 1]),
        el('button', { 'aria-label': `Remove row ${r}`, text: '×', class: 'remove-track', onclick: () => void sendChange({ kind: 'remove_track', scope: state.scope, axis: 'row', index: r }) }),
      ));
    }
    wrap.append(columnHeads, rowHeads);
    return wrap;
  }

  const separatorDraft = new Map();

  function currentSize(axis, index) {
    const sc = currentScope();
    return axis === 'column' ? sc.columns[index - 1] : sc.rows[index - 1];
  }

  function separatorFor(axis, index, size) {
    const disabled = size === 'auto' || size.startsWith('minmax');
    const sep = el('div', { role: 'separator', 'aria-label': `Resize ${axis} ${index}`, 'aria-orientation': axis === 'column' ? 'vertical' : 'horizontal', tabindex: '0', class: 'separator' });
    if (disabled) sep.setAttribute('aria-disabled', 'true');
    sep.addEventListener('keydown', (event) => {
      if (disabled) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); stepSeparator(axis, index, 1, true); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); stepSeparator(axis, index, -1, true); }
    });
    let dragStart = null;
    let accumulated = 0;
    sep.addEventListener('pointerdown', (event) => {
      if (disabled) return;
      event.preventDefault();
      dragStart = event[axis === 'column' ? 'clientX' : 'clientY'];
      accumulated = 0;
      sep.setPointerCapture?.(event.pointerId);
    });
    sep.addEventListener('pointermove', (event) => {
      if (dragStart === null) return;
      const current = event[axis === 'column' ? 'clientX' : 'clientY'];
      const delta = current - dragStart;
      const wholeSteps = Math.trunc(delta / 20) - Math.trunc(accumulated / 20);
      if (wholeSteps !== 0) {
        accumulated += wholeSteps * 20;
        stepSeparator(axis, index, wholeSteps, false);
      }
    });
    sep.addEventListener('pointerup', () => {
      if (dragStart === null) return;
      dragStart = null;
      commitSeparator(axis, index);
    });
    sep.addEventListener('pointercancel', () => { dragStart = null; commitSeparator(axis, index); });
    return sep;
  }

  function stepSize(size, direction) {
    const m = /^(\d+(?:\.\d+)?)(fr|px|%)$/.exec(size);
    if (!m) return size;
    let amount = Number(m[1]);
    const unit = m[2];
    const step = unit === 'px' ? 10 : unit === '%' ? 1 : 0.25;
    amount += step * direction;
    if (unit === 'px') amount = Math.round(amount);
    if (amount < (unit === 'fr' ? 0.25 : 1)) return size;
    if (amount > (unit === 'fr' ? 100 : unit === 'px' ? 4000 : 100)) return size;
    return `${Number(amount.toFixed(2))}${unit}`;
  }

  function stepSeparator(axis, index, direction, send) {
    const size = separatorDraft.get(`${axis}:${index}`) ?? currentSize(axis, index);
    const next = stepSize(size, direction);
    if (next === size) return;
    separatorDraft.set(`${axis}:${index}`, next);
    const field = canvas.querySelector(`[aria-label="${axis === 'column' ? 'Column' : 'Row'} ${index} size"]`);
    if (field) field.value = next;
    const sep = canvas.querySelector(`[aria-label="Resize ${axis} ${index}"]`);
    if (sep) sep.setAttribute('aria-valuetext', next);
    if (send) commitSeparator(axis, index);
  }

  function commitSeparator(axis, index) {
    const next = separatorDraft.get(`${axis}:${index}`);
    separatorDraft.delete(`${axis}:${index}`);
    if (!next || next === currentSize(axis, index)) return;
    void sendChange({ kind: 'set_track', scope: state.scope, axis, index, size: next });
  }

  function setTrack(axis, index, field) {
    const res = trackSizeFromDomain(field.value);
    if (res.error) {
      problem.textContent = res.error;
      field.setAttribute('aria-invalid', 'true');
      field.value = currentSize(axis, index);
      return;
    }
    field.removeAttribute('aria-invalid');
    if (res.size === currentSize(axis, index)) { field.value = res.size; return; }
    void sendChange({ kind: 'set_track', scope: state.scope, axis, index, size: res.size });
  }

  function openNameArea(opener, fromDrag) {
    const rect = selectionRect();
    const sc = currentScope();
    const covering = sc.areas.filter((a) => a.row_start <= rect.row_start && a.row_end >= rect.row_end && a.column_start <= rect.column_start && a.column_end >= rect.column_end);
    const exactlyOne = covering.length === 1 && covering[0].row_start === rect.row_start && covering[0].column_start === rect.column_start && covering[0].row_end === rect.row_end && covering[0].column_end === rect.column_end;
    dialogHost((dialog, close) => {
      dialog.setAttribute('aria-label', 'Name area');
      const dialogProblem = el('div', { role: 'alert', 'aria-label': 'Dialog problem', class: 'alert problem' });
      const name = el('input', { type: 'text', 'aria-label': 'Area name', value: exactlyOne ? covering[0].name : '' });
      const form = el('form', {},
        el('label', { class: 'field' }, 'Area name', name),
        dialogProblem,
        el('div', { class: 'actions' },
          el('button', { class: 'primary', type: 'submit', text: 'Save area' }),
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        beginSaving();
        const res = await api('POST', `/api/layouts/${layoutId}/changes`, { base_revision: state.layout.revision, change: { kind: 'set_area', scope: state.scope, name: name.value, ...rect } });
        if (res.status === 0) { endSaving(false); dialogProblem.textContent = 'Mullion could not be reached.'; return; }
        endSaving(true);
        if (res.status === 200) {
          close();
          if (res.body.unchanged) announceUpdate('No changes.');
          else { state.layout = res.body.layout; announceUpdate(res.body.announcement ?? 'No changes.'); renderAll(); }
          return;
        }
        if (res.status === 409) {
          close();
          state.layout = res.body.layout;
          renderAll();
          showNotice(`${res.body.username} changed ${res.body.target} first. Your change was not applied.`);
          return;
        }
        dialogProblem.textContent = res.body?.message ?? 'Mullion could not be reached.';
      });
      dialog.append(el('h2', { text: 'Name area' }), form);
      name.focus();
      name.select();
    }, opener);
  }

  function addBreakpointDialog(opener) {
    dialogHost((dialog, close) => {
      dialog.setAttribute('aria-label', 'Add breakpoint');
      const dialogProblem = el('div', { role: 'alert', 'aria-label': 'Dialog problem', class: 'alert problem' });
      const width = el('input', { type: 'text', 'aria-label': 'Minimum width' });
      const form = el('form', {},
        el('label', { class: 'field' }, 'Minimum width', width),
        dialogProblem,
        el('div', { class: 'actions' },
          el('button', { class: 'primary', type: 'submit', text: 'Add' }),
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const res = await sendChange({ kind: 'add_breakpoint', min_width: Number(width.value) });
        if (res) close();
      });
      dialog.append(el('h2', { text: 'Add breakpoint' }), form);
      width.focus();
    }, opener);
  }

  async function removeBreakpoint() {
    if (state.scope === 'base') return;
    const width = state.scope;
    const res = await sendChange({ kind: 'remove_breakpoint', min_width: width });
    if (res) state.scope = 'base';
  }

  function previewEdges() {
    return [PREVIEW_MIN, ...state.layout.breakpoints.map((b) => b.min_width), PREVIEW_MAX];
  }

  previewWidthInput.addEventListener('input', () => setPreviewWidth(Number(previewWidthInput.value)));
  previewWidthInput.addEventListener('keydown', (event) => {
    const edges = previewEdges();
    const current = state.previewWidth;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setPreviewWidth(Math.min(PREVIEW_MAX, current + 10)); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setPreviewWidth(Math.max(PREVIEW_MIN, current - 10)); }
    else if (event.key === 'PageUp') { event.preventDefault(); const above = edges.filter((e) => e > current); setPreviewWidth(above.length ? above[0] : PREVIEW_MAX); }
    else if (event.key === 'PageDown') { event.preventDefault(); const below = edges.filter((e) => e < current).reverse(); setPreviewWidth(below.length ? below[0] : PREVIEW_MIN); }
    else if (event.key === 'Home') { event.preventDefault(); setPreviewWidth(PREVIEW_MIN); }
    else if (event.key === 'End') { event.preventDefault(); setPreviewWidth(PREVIEW_MAX); }
  });

  function setPreviewWidth(width) {
    const clamped = clamp(width, PREVIEW_MIN, PREVIEW_MAX);
    state.previewWidth = clamped;
    previewWidthInput.value = String(clamped);
    previewReadout.textContent = `${clamped}px`;
    const scope = scopeInEffect(state.layout, clamped);
    if (String(scope) !== String(state.scope)) {
      state.scope = scope;
      announceUpdate(`Showing ${tabName(scope)} at ${clamped}px.`);
    }
    renderBreakpointTabs();
    renderCanvas();
    renderPreview();
    renderRail();
  }

  function previewDocument() {
    const doc = previewFrame.contentDocument;
    if (!doc) return null;
    return doc;
  }

  function renderPreview() {
    previewFrame.style.width = `${state.previewWidth}px`;
    const doc = previewDocument();
    if (!doc) return;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${state.layout.css}body{margin:0;padding:0;}.layout{min-height:100%;}div[class]{box-sizing:border-box;}</style></head><body>${state.layout.html}</body></html>`);
    doc.close();
    requestAnimationFrame(updateResolvedWidths);
  }

  function updateResolvedWidths() {
    const doc = previewDocument();
    if (!doc) return;
    const sc = currentScope();
    for (let c = 1; c <= sc.columns.length; c += 1) {
      const head = canvas.querySelector(`[data-resolved="${c}"]`);
      if (!head) continue;
      // Measure a div that spans exactly this column: the browser resolves
      // fixed, auto, fr and percentage tracks for us.
      let width = null;
      for (const area of sc.areas) {
        if (area.column_start === c && area.column_end === c + 1) {
          const node = doc.querySelector(`.${area.name}`);
          if (node) width = node.getBoundingClientRect().width;
          break;
        }
      }
      if (width === null) {
        const probe = doc.createElement('div');
        probe.style.gridColumn = `${c} / ${c + 1}`;
        probe.style.gridRow = '1 / 2';
        (doc.querySelector('.layout') ?? doc.body).appendChild(probe);
        width = probe.getBoundingClientRect().width;
        probe.remove();
      }
      const rounded = Math.floor(width + 0.5);
      head.textContent = `${rounded}px`;
      head.parentElement.setAttribute('data-resolved-px', String(rounded));
      head.parentElement.setAttribute('data-track-index', String(c));
      head.parentElement.setAttribute('data-track-size', sc.columns[c - 1]);
      head.parentElement.setAttribute('data-track-unit', trackUnit(sc.columns[c - 1]));
    }
  }

  function renderCode() {
    cssPane.value = state.layout.css;
    htmlPane.value = state.layout.html;
  }

  function applyCss() { void sendChange({ kind: 'apply_css', css: cssPane.value }); }

  cssPane.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); applyCss(); }
  });

  function saveVersionDialog(opener) {
    dialogHost((dialog, close) => {
      dialog.setAttribute('aria-label', 'Save version');
      const dialogProblem = el('div', { role: 'alert', 'aria-label': 'Dialog problem', class: 'alert problem' });
      const name = el('input', { type: 'text', 'aria-label': 'Version name' });
      const form = el('form', {},
        el('label', { class: 'field' }, 'Version name', name),
        dialogProblem,
        el('div', { class: 'actions' },
          el('button', { class: 'primary', type: 'submit', text: 'Save' }),
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        beginSaving();
        const res = await api('POST', `/api/layouts/${layoutId}/versions`, { name: name.value });
        endSaving(res.status !== 0);
        if (res.status === 201) { close(); announceUpdate(`Version ${res.body.number} saved.`); return; }
        dialogProblem.textContent = res.body?.message ?? 'Mullion could not be reached.';
      });
      dialog.append(el('h2', { text: 'Save version' }), form);
      name.focus();
    }, opener);
  }

  function versionsDrawer(opener) {
    const existing = document.querySelector('.drawer');
    if (existing) { existing.remove(); if (opener && opener.isConnected) opener.focus(); return; }
    const host = el('div', { class: 'drawer', role: 'dialog', 'aria-label': 'Versions', tabindex: '-1' });
    document.body.append(host);
    requestAnimationFrame(() => host.setAttribute('data-open', ''));
    const list = el('ul', { role: 'list', 'aria-label': 'Saved versions', class: 'versions' });
    const differences = el('ul', { role: 'list', 'aria-label': 'Differences', class: 'differences' });
    const from = el('select', { 'aria-label': 'Compare from' });
    const to = el('select', { 'aria-label': 'Compare to' });
    const close = () => { host.remove(); if (opener && opener.isConnected) opener.focus(); };
    // Escape closes the drawer from anywhere on the page while it is open.
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    host.append(
      el('h2', { text: 'Versions' }),
      el('button', { text: 'Close versions', onclick: close }),
      list,
      el('div', { class: 'compare-row' }, from, to,
        el('button', { text: 'Compare', onclick: async () => {
          const res = await api('GET', `/api/layouts/${layoutId}/compare?from=${from.value}&to=${to.value}`);
          differences.textContent = '';
          if (res.body?.differences) for (const line of res.body.differences) differences.append(el('li', { text: line }));
        } })),
      el('h3', { text: 'Differences' }),
      differences,
    );
    const observer = new MutationObserver(() => {
      if (!document.body.contains(host)) {
        document.removeEventListener('keydown', onKey, true);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    void (async () => {
      const res = await api('GET', `/api/layouts/${layoutId}/versions`);
      if (!res.body?.versions) return;
      for (const version of res.body.versions) {
        from.append(el('option', { value: String(version.number), text: `Version ${version.number}: ${version.name}` }));
        to.append(el('option', { value: String(version.number), text: `Version ${version.number}: ${version.name}` }));
        list.append(el('li', { role: 'listitem' },
          el('span', { text: `Version ${version.number}: ${version.name}` }),
          el('button', { text: `Restore version ${version.number}`, onclick: (event) => confirmRestore(event.currentTarget, version.number) }),
        ));
      }
      if (from.options.length > 0) from.selectedIndex = 0;
      if (to.options.length > 1) to.selectedIndex = 1;
    })();
  }

  function confirmRestore(opener, number) {
    dialogHost((dialog, close) => {
      dialog.setAttribute('aria-label', `Restore version ${number}?`);
      const form = el('form', {},
        el('div', { class: 'actions' },
          el('button', { class: 'primary', type: 'submit', text: 'Restore' }),
          el('button', { type: 'button', text: 'Cancel', onclick: close }),
        ),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await sendChange({ kind: 'restore_version', number });
        close();
      });
      dialog.append(el('h2', { text: `Restore version ${number}?` }), form);
    }, opener);
  }

  function shareDialog(opener) {
    dialogHost((dialog, close) => {
      dialog.setAttribute('aria-label', 'Share');
      const viewLink = el('input', { type: 'text', readonly: true, 'aria-label': 'View link', class: 'mono' });
      const joinLink = el('input', { type: 'text', readonly: true, 'aria-label': 'Co-edit link', class: 'mono' });
      const collaborators = el('ul', { role: 'list', 'aria-label': 'Collaborators', class: 'presence-list' });
      const createButton = el('button', { text: 'Create view link' });
      const regenerate = el('button', { text: 'Regenerate view link' });
      const revoke = el('button', { text: 'Revoke view link' });
      const regenerateJoin = el('button', { text: 'Regenerate co-edit link' });
      async function load() {
        const res = await api('GET', `/api/layouts/${layoutId}/share`);
        if (res.status !== 200) return;
        viewLink.value = res.body.view_path ?? '';
        joinLink.value = res.body.join_path ?? '';
        collaborators.textContent = '';
        for (const name of res.body.collaborators) {
          collaborators.append(el('li', { role: 'listitem' },
            el('span', { text: name }),
            el('button', { text: `Remove ${name}`, onclick: async () => { await api('DELETE', `/api/layouts/${layoutId}/collaborators/${name}`); announceUpdate(`${name} removed from collaborators.`); await load(); } }),
          ));
        }
        createButton.classList.toggle('hidden', Boolean(res.body.view_path));
        regenerate.classList.toggle('hidden', !res.body.view_path);
        revoke.classList.toggle('hidden', !res.body.view_path);
      }
      createButton.addEventListener('click', async () => { beginSaving(); const res = await api('POST', `/api/layouts/${layoutId}/view-link`); endSaving(res.status !== 0); if (res.status === 201) { announceUpdate('View link created.'); await load(); } });
      regenerate.addEventListener('click', async () => { beginSaving(); const res = await api('POST', `/api/layouts/${layoutId}/view-link`); endSaving(res.status !== 0); if (res.status === 201) { announceUpdate('View link regenerated.'); await load(); } });
      revoke.addEventListener('click', async () => { beginSaving(); const res = await api('DELETE', `/api/layouts/${layoutId}/view-link`); endSaving(res.status !== 0); if (res.status === 204) { announceUpdate('View link revoked.'); await load(); } });
      regenerateJoin.addEventListener('click', async () => { beginSaving(); const res = await api('POST', `/api/layouts/${layoutId}/join-link`); endSaving(res.status !== 0); if (res.status === 201) { announceUpdate('Co-edit link regenerated.'); await load(); } });
      dialog.append(
        el('h2', { text: 'Share' }),
        createButton, regenerate, revoke,
        el('label', { class: 'field' }, 'View link', viewLink),
        el('label', { class: 'field' }, 'Co-edit link', joinLink),
        regenerateJoin,
        el('h3', { text: 'Collaborators' }),
        collaborators,
        el('div', { class: 'actions' }, el('button', { text: 'Close', onclick: close })),
      );
      void load();
    }, opener);
  }

  void api('GET', '/api/me').then((res) => {
    state.meUsername = res.body?.username ?? '';
    // The presence list already includes this designer; only seed it before any socket message arrives.
    if (state.designers.length === 0) {
      state.designers = [state.meUsername];
      renderRail();
    }
  });

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  let socket = null;
  try { socket = new WebSocket(`${protocol}://${location.host}/api/layouts/${layoutId}/live`); } catch { socket = null; }
  if (socket) {
    socket.addEventListener('message', (event) => {
      let message = null;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.kind === 'presence' && message.usernames) {
        state.designers = message.usernames;
        renderRail();
        return;
      }
      if (message.kind === 'change' && message.layout) {
        const previousScope = state.scope;
        state.layout = message.layout;
        const scope = scopeInEffect(state.layout, state.previewWidth);
        state.scope = scope;
        const text = message.announcement ?? '';
        if (message.username && message.username !== state.meUsername) {
          announceUpdate(`${message.username}: ${text}`);
          if (text.startsWith('Restored version')) showNotice(`${message.username} restored version ${text.slice('Restored version '.length)}`);
        }
        void previousScope;
        renderAll();
      }
    });
  }

  renderAll();
  setPreviewWidth(1280);
}

/* ---------- readonly view page ---------- */

function renderReadonlyPage(layout, socketPath) {
  const updates = el('div', { role: 'status', 'aria-label': 'Layout updates', 'aria-live': 'polite', class: 'status' });
  const liveStatus = el('div', { role: 'status', 'aria-label': 'Live status', class: 'status', text: layout.live ? '' : LIVE_PAUSED });
  const state = { layout, previewWidth: 1280 };
  const previewWidthInput = el('input', { type: 'range', 'aria-label': 'Preview width', min: '320', max: '1440', value: '1280', step: '10' });
  const previewReadout = el('span', { class: 'preview-readout mono', text: '1280px' });
  const previewFrame = el('iframe', { title: 'Layout preview', class: 'layout-preview' });
  const cssPane = el('textarea', { 'aria-label': 'Layout CSS', readonly: true, class: 'mono', spellcheck: 'false' });
  const htmlPane = el('textarea', { 'aria-label': 'Layout HTML', readonly: true, class: 'mono', spellcheck: 'false' });
  const codeTabs = el('div', { role: 'tablist', 'aria-label': 'Code', class: 'tablist' });
  const breakpointTabs = el('div', { role: 'tablist', 'aria-label': 'Breakpoints', class: 'tablist' });
  const canvas = el('div', { class: 'canvas-wrap' });

  const page = el('div', { class: 'view-page' },
    el('h1', { text: layout.name }),
    updates,
    liveStatus,
    breakpointTabs,
    el('div', { class: 'view-columns' },
      canvas,
      el('div', { class: 'preview-pane' },
        el('div', { class: 'preview-width-row' }, previewWidthInput, previewReadout),
        el('div', { class: 'preview-frame-wrap' }, previewFrame),
        el('div', { class: 'code-pane' },
          codeTabs,
          el('div', { class: 'css-holder' }, cssPane),
          el('div', { class: 'html-holder' }, htmlPane),
        ),
      ),
    ),
  );
  app.append(page);

  for (const name of ['CSS', 'HTML']) {
    const tab = el('button', { role: 'tab', 'aria-selected': name === 'CSS' ? 'true' : 'false', text: name, onclick: () => {
      for (const t of codeTabs.children) t.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-selected', 'true');
      page.querySelector('.css-holder').classList.toggle('hidden', name !== 'CSS');
      page.querySelector('.html-holder').classList.toggle('hidden', name !== 'HTML');
    } });
    codeTabs.append(tab);
  }
  page.querySelector('.html-holder').classList.add('hidden');

  function renderAll() {
    const scope = scopeInEffect(state.layout, state.previewWidth);
    breakpointTabs.textContent = '';
    for (const s of ['base', ...state.layout.breakpoints.map((b) => b.min_width)]) {
      breakpointTabs.append(el('button', { role: 'tab', 'aria-selected': String(String(s) === String(scope)), text: tabName(s) }));
    }
    renderGrid(scope);
    previewFrame.style.width = `${state.previewWidth}px`;
    const doc = previewFrame.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${state.layout.css}body{margin:0;padding:0;}</style></head><body>${state.layout.html}</body></html>`);
      doc.close();
    }
    cssPane.value = state.layout.css;
    htmlPane.value = state.layout.html;
  }

  const CELL_W = 96;
  const CELL_H = 64;

  function renderGrid(scope) {
    const sc = scopeOfLayout(state.layout, scope);
    const grid = el('div', {
      role: 'grid', 'aria-label': 'Layout grid', class: 'layout-grid mono',
      style: `grid-template-columns: repeat(${sc.columns.length}, ${CELL_W}px); grid-template-rows: repeat(${sc.rows.length}, ${CELL_H}px);`,
    });
    grid.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!target.classList?.contains('gridcell')) return;
      const r = Number(target.dataset.row);
      const c = Number(target.dataset.column);
      const move = (dr, dc) => {
        event.preventDefault();
        const nr = clamp(r + dr, 1, sc.rows.length);
        const nc = clamp(c + dc, 1, sc.columns.length);
        grid.querySelector(`[data-row="${nr}"][data-column="${nc}"]`)?.focus();
      };
      if (event.key === 'ArrowUp') move(-1, 0);
      else if (event.key === 'ArrowDown') move(1, 0);
      else if (event.key === 'ArrowLeft') move(0, -1);
      else if (event.key === 'ArrowRight') move(0, 1);
    });
    // The read-only ruler: sizes and resolved widths as text, with no editing controls.
    const columnHeads = el('div', { class: 'colheads', style: `display:grid;grid-template-columns:repeat(${sc.columns.length}, ${CELL_W}px);` });
    for (let c = 1; c <= sc.columns.length; c += 1) {
      columnHeads.append(el('div', {
        class: 'colhead', role: 'columnheader', 'aria-label': `Column ${c}`,
        'data-track-index': String(c), 'data-track-size': sc.columns[c - 1], 'data-track-unit': trackUnit(sc.columns[c - 1]),
      },
        el('span', { text: `Column ${c}` }),
        el('span', { class: 'mono', text: sc.columns[c - 1] }),
        el('span', { class: 'resolved', 'data-resolved': String(c), text: '' }),
      ));
    }
    const rowHeads = el('div', { class: 'rowheads', style: `display:grid;grid-template-rows:repeat(${sc.rows.length}, ${CELL_H}px);` });
    for (let r = 1; r <= sc.rows.length; r += 1) {
      rowHeads.append(el('div', {
        class: 'rowhead', role: 'rowheader', 'aria-label': `Row ${r}`,
        'data-track-index': String(r), 'data-track-size': sc.rows[r - 1], 'data-track-unit': trackUnit(sc.rows[r - 1]),
      },
        el('span', { text: `Row ${r}` }),
        el('span', { class: 'mono', text: sc.rows[r - 1] }),
      ));
    }
    for (let r = 1; r <= sc.rows.length; r += 1) {
      for (let c = 1; c <= sc.columns.length; c += 1) {
        const area = sc.areas.find((a) => r >= a.row_start && r < a.row_end && c >= a.column_start && c < a.column_end);
        const cell = el('div', {
          role: 'gridcell', 'data-row': String(r), 'data-column': String(c), 'data-area': area?.name ?? '',
          tabindex: r === 1 && c === 1 ? '0' : '-1',
          'aria-label': area ? `Row ${r}, column ${c}, ${area.name}` : `Row ${r}, column ${c}, empty`,
          class: 'gridcell',
        });
        grid.append(cell);
      }
    }
    canvas.textContent = '';
    const frame = el('div', { class: 'canvas-holder' }, el('div', { class: 'rulers' }, columnHeads, rowHeads), el('div', { class: 'grid-frame' }, grid));
    canvas.append(frame);
    for (const area of sc.areas) {
      frame.append(el('div', {
        'data-area-name': area.name,
        'data-row-start': String(area.row_start), 'data-column-start': String(area.column_start),
        'data-row-end': String(area.row_end), 'data-column-end': String(area.column_end),
        class: 'area-block', text: area.name,
        style: `position:absolute;left:${(area.column_start - 1) * CELL_W + 1}px;top:${(area.row_start - 1) * CELL_H + 1}px;width:${(area.column_end - area.column_start) * CELL_W - 2}px;height:${(area.row_end - area.row_start) * CELL_H - 2}px;`,
      }));
    }
  }

  function setPreviewWidth(width) {
    state.previewWidth = clamp(width, 320, 1440);
    previewWidthInput.value = String(state.previewWidth);
    previewReadout.textContent = `${state.previewWidth}px`;
    renderAll();
  }

  previewWidthInput.addEventListener('input', () => setPreviewWidth(Number(previewWidthInput.value)));
  previewWidthInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setPreviewWidth(state.previewWidth + 10); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setPreviewWidth(state.previewWidth - 10); }
    else if (event.key === 'Home') { event.preventDefault(); setPreviewWidth(320); }
    else if (event.key === 'End') { event.preventDefault(); setPreviewWidth(1440); }
  });

  renderAll();

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  let socket = null;
  try { socket = new WebSocket(`${protocol}://${location.host}${socketPath}`); } catch { return; }
  socket.addEventListener('message', (event) => {
    let message = null;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.kind === 'change' && message.layout) {
      state.layout = message.layout;
      renderAll();
      updates.textContent = 'Layout updated.';
    }
  });
}

void route();
