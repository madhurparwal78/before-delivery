// DOM helpers: notices, dialogs, focus management, refresh loop.

const state = {
  me: null,
  notices: [],
  refreshTimer: null,
  pendingFast: false,
  pendingSeen: new Set(),
  sseByStream: new Map()
};

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function setNotices(msg) {
  const region = document.querySelector('[aria-label="Notices"], #notices');
  if (region) region.textContent = msg ?? '';
}

function announce(msg) {
  if (!msg) return;
  setNotices(msg);
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (!msg) return;
  const toast = el('div', { class: 'toast' },
    el('span', { 'aria-hidden': 'true', text: msg }),
    el('button', {
      class: 'btn', 'aria-label': 'Dismiss notice',
      onclick: () => toast.remove()
    }, 'Dismiss'));
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

function trapFocus(container) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

function openDialog(name, build, opener) {
  const dlg = el('dialog', { 'aria-label': name });
  const body = build(dlg);
  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('button, input, select, textarea');
  if (first) first.focus();
  trapFocus(dlg);
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener && document.contains(opener)) opener.focus();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { dlg.close(); }
  });
  return dlg;
}

function fieldError(parent, field, message) {
  const existing = parent.querySelector(`[data-error-for="${field}"]`);
  if (existing) existing.remove();
  if (!message) return;
  const p = el('p', { class: 'field-error', 'data-error-for': field, id: `${field}-error`, text: message });
  const input = parent.querySelector(`[name="${field}"]`) || parent.querySelector(`#${field}`);
  if (input) {
    input.setAttribute('aria-describedby', `${field}-error`);
    input.after(p);
  } else {
    parent.append(p);
  }
}

function showErrors(form, errors) {
  for (const [field, message] of Object.entries(errors || {})) fieldError(form, field, message);
  const first = form.querySelector('.field-error');
  if (first) {
    const input = form.querySelector(`[aria-describedby="${first.id}"]`);
    if (input) input.focus();
  }
}

// 30s refresh; 10s while any pending row is on screen (DP-53).
function setRefresh(fn, hasPending) {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const period = hasPending ? 10000 : 30000;
  state.refreshTimer = setInterval(fn, period);
}

// SSE stream with self-reconnect (DP-60, DP-61).
function openStream(path, streamKey, onEvent) {
  closeStream(streamKey);
  const es = new EventSource(path);
  state.sseByStream.set(streamKey, es);
  es.onmessage = (ev) => onEvent({ event: 'message', data: ev.data, id: ev.lastEventId });
  const handler = (ev) => onEvent({ event: ev.type, data: ev.data, id: ev.lastEventId });
  for (const t of ['booking_added', 'booking_removed', 'booking_moved', 'day_status', 'allocation_fixed', 'allocation_adjusted', 'marks_saved', 'visit_closed', 'reset']) {
    es.addEventListener(t, handler);
  }
  es.onerror = () => { /* EventSource reconnects by itself */ };
  return es;
}

function closeStream(streamKey) {
  const es = state.sseByStream.get(streamKey);
  if (es) { es.close(); state.sseByStream.delete(streamKey); }
}

function closeAllStreams() {
  for (const k of [...state.sseByStream.keys()]) closeStream(k);
}
