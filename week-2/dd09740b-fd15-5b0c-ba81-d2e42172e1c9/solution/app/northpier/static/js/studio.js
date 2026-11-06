// Studio: sign-in pending state, the live queue (search, tabs, history), inquiry actions with the
// pipeline-in-step sequence, and notes. Every refusal shows where Feedback states places it.
const OUTAGE_MESSAGE = 'The studio desk is unavailable. Try again shortly.';
const newKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

const signinForm = document.querySelector('[data-signin]');
if (signinForm) {
  signinForm.addEventListener('submit', () => {
    const status = signinForm.querySelector('.signin-status');
    status.classList.remove('is-error');
    status.textContent = 'Signing in...';
  });
}

async function fetchPage(url) {
  const response = await fetch(url, { headers: { Accept: 'text/html' }, cache: 'no-store' });
  return { response, doc: new DOMParser().parseFromString(await response.text(), 'text/html') };
}

function fadeIn(element, delay = 0) {
  if (reduced()) return;
  element.animate([{ filter: 'opacity(0)' }, { filter: 'opacity(1)' }], { duration: MOTION_MS, delay, easing: EASE, fill: 'backwards' });
}

// The queue: tab and q live in the address; the list and counts come from the server's own render.
const queueRoot = document.getElementById('queue');
const search = document.getElementById('queue-search');
let queueRequest = 0;

function listParams(status, q) {
  const params = new URLSearchParams({ status });
  if (q.trim()) params.set('q', q);
  return params;
}

function swapCounts(fresh, delay = 0) {
  const tabs = document.getElementById('queue-tabs');
  const before = Object.fromEntries([...tabs.querySelectorAll('.tab')].map((tab) => [tab.dataset.tab, tab.querySelector('.count').textContent]));
  const focused = document.activeElement?.closest?.('.tab')?.dataset.tab;
  tabs.replaceChildren(...fresh.getElementById('queue-tabs').children);
  for (const tab of tabs.querySelectorAll('.tab')) {
    if (before[tab.dataset.tab] !== tab.querySelector('.count').textContent) fadeIn(tab.querySelector('.count'), delay);
    if (tab.dataset.tab === focused) tab.focus();
  }
}

function swapList(fresh) {
  const panel = document.getElementById('queue-panel');
  panel.replaceWith(fresh.getElementById('queue-panel'));
}

async function loadQueue(status, q, push) {
  const ticket = ++queueRequest;
  const params = listParams(status, q);
  const url = `${location.pathname}?${params}`;
  const error = document.getElementById('queue-error');
  let result;
  try {
    result = await fetchPage(url);
  } catch {
    result = null;
  }
  if (ticket !== queueRequest) return;
  const fresh = result?.doc;
  if (!result || !fresh.getElementById('queue-panel')) {
    error.textContent = OUTAGE_MESSAGE;
    return;
  }
  if (result.response.status === 422) {
    error.textContent = fresh.getElementById('queue-error').textContent;
    return;
  }
  error.textContent = '';
  queueRoot.dataset.status = status;
  queueRoot.querySelector('.search input[name="status"]').value = status;
  swapCounts(fresh);
  swapList(fresh);
  const crumb = document.querySelector('.breadcrumb a');
  if (crumb) crumb.href = `/studio?${params}`;
  if (push) history.pushState(null, '', url);
}

if (queueRoot) {
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => loadQueue(queueRoot.dataset.status, search.value, true), 150);
  });
  search.form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    loadQueue(queueRoot.dataset.status, search.value, true);
  });
  const tabs = document.getElementById('queue-tabs');
  tabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    event.preventDefault();
    loadQueue(tab.dataset.tab, search.value, true);
  });
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const all = [...tabs.querySelectorAll('.tab')];
    const index = all.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    event.preventDefault();
    all[next].focus();
    loadQueue(all[next].dataset.tab, search.value, true);
  });
  addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    search.value = params.get('q') || '';
    loadQueue(params.get('status') || 'new', search.value, false);
  });
}

// The inquiry page.
const detail = document.getElementById('detail');
if (detail) {
  const actionStatus = () => detail.querySelector('.action-status');
  const block = () => document.getElementById('status-block');
  let opened = null;

  const setBusy = (busy) => {
    for (const button of block().querySelectorAll('.actions button, .panel button')) button.disabled = busy;
  };

  const clearFieldError = (panel) => {
    const input = panel.querySelector('.field-input');
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
    panel.querySelector('.field-msg').textContent = '';
  };

  const closePanel = (focusOpener) => {
    if (!opened) return;
    const { panel, opener } = opened;
    panel.hidden = true;
    opened = null;
    if (focusOpener) opener.focus();
  };

  const openPanel = (opener) => {
    const panel = block().querySelector(`[data-panel="${opener.dataset.action}"]`);
    if (opened && opened.panel === panel) { closePanel(true); return; }
    closePanel(false);
    panel.reset();
    clearFieldError(panel);
    panel.hidden = false;
    opened = { panel, opener, key: newKey() };
    if (!reduced()) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS, easing: EASE });
    panel.querySelector('.field-input').focus();
  };

  const showFieldError = (panel, message) => {
    const input = panel.querySelector('.field-input');
    const holder = panel.querySelector('.field-msg');
    holder.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', holder.id);
    input.focus();
  };

  const playSequence = (fresh, ghost, oldColor, historyCount) => {
    const now = block();
    const freshBlock = fresh.getElementById('status-block');
    now.replaceWith(freshBlock);
    if (ghost) {
      freshBlock.querySelector('.actions').after(ghost);
      ghost.animate([{ height: `${ghost.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
        { duration: MOTION_MS, easing: EASE, fill: 'forwards' }).finished.then(() => ghost.remove());
    }
    const pill = freshBlock.querySelector('.status-heading .pill');
    const newColor = getComputedStyle(pill).getPropertyValue('--pc');
    if (!reduced()) {
      pill.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: MOTION_MS, easing: EASE });
      pill.querySelector('.dot').animate([{ backgroundColor: oldColor }, { backgroundColor: newColor }], { duration: MOTION_MS, easing: EASE });
      pill.animate([{ borderColor: oldColor }, { borderColor: newColor }], { duration: MOTION_MS, easing: EASE });
    }
    const history = document.getElementById('history');
    history.replaceChildren(...fresh.getElementById('history').children);
    if (!reduced()) {
      [...history.children].slice(historyCount).forEach((item) => item.animate(
        [{ filter: 'opacity(0)', transform: 'translateY(18px)' }, { filter: 'opacity(1)', transform: 'none' }],
        { duration: MOTION_MS, delay: 150, easing: EASE, fill: 'backwards' }));
    }
    swapCounts(fresh, 250);
    const row = document.querySelector(`#queue-list [data-id="${detail.dataset.id}"]`);
    const stays = fresh.querySelector(`#queue-list [data-id="${detail.dataset.id}"]`);
    if (row && !stays && !reduced()) {
      row.animate([{ opacity: 1, height: `${row.offsetHeight}px` }, { opacity: 0, height: '0px' }],
        { duration: MOTION_MS, delay: 350, easing: EASE, fill: 'forwards' }).finished.then(() => swapList(fresh));
    } else {
      swapList(fresh);
    }
    const freshDetail = fresh.getElementById('detail');
    detail.dataset.version = freshDetail.dataset.version;
    detail.dataset.status = freshDetail.dataset.status;
    freshBlock.querySelector('.status-heading').focus();
  };

  const apply = async (opener, fields) => {
    const action = opener.dataset.action;
    const panel = opened?.panel;
    const key = opened?.key || newKey();
    const alert = block().querySelector('.alert');
    alert.textContent = '';
    actionStatus().textContent = 'Saving...';
    setBusy(true);
    let response;
    let payload;
    try {
      response = await fetch(`/api/studio/inquiries/${detail.dataset.id}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ action, version: Number(detail.dataset.version), ...fields }),
      });
      payload = await response.json();
    } catch {
      response = null;
    }
    setBusy(false);
    if (response && response.ok) {
      const oldColor = getComputedStyle(block().querySelector('.status-heading .pill')).getPropertyValue('--pc');
      const historyCount = document.getElementById('history').children.length;
      let ghost = null;
      if (panel && !reduced()) {
        ghost = panel.cloneNode(true);
        ghost.inert = true;
        ghost.setAttribute('aria-hidden', 'true');
        for (const node of ghost.querySelectorAll('[id], [for]')) { node.removeAttribute('id'); node.removeAttribute('for'); }
      }
      opened = null;
      const { doc } = await fetchPage(location.href);
      const done = action === 'reschedule_call'
        ? `Call moved to ${doc.querySelector('.call-time span').textContent}.`
        : `Status changed to ${doc.querySelector('.status-heading').textContent.trim()}.`;
      playSequence(doc, ghost, oldColor, historyCount);
      actionStatus().textContent = done;
      return;
    }
    actionStatus().textContent = '';
    const error = payload?.error;
    if (panel && response?.status === 422 && error && ['call_at', 'decline_reason'].includes(error.field)) {
      showFieldError(panel, error.message);
      return;
    }
    if (panel && response?.status === 409 && error?.field === 'call_at') {
      showFieldError(panel, error.message);
      return;
    }
    alert.textContent = error?.message || OUTAGE_MESSAGE;
    closePanel(false);
    opener.focus();
  };

  detail.addEventListener('click', (event) => {
    const button = event.target.closest('.actions [data-action]');
    if (!button) return;
    if (block().querySelector(`[data-panel="${button.dataset.action}"]`)) openPanel(button);
    else apply(button, {});
  });

  detail.addEventListener('submit', (event) => {
    const panel = event.target.closest('.panel');
    if (!panel || !opened) return;
    event.preventDefault();
    const fields = panel.dataset.panel === 'decline'
      ? { decline_reason: panel.elements.decline_reason.value } : { call_at: panel.elements.call_at.value };
    apply(opened.opener, fields);
  });

  detail.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && opened && opened.panel.contains(event.target)) {
      event.preventDefault();
      closePanel(true);
    }
    if (event.key === 'Enter' && event.target.classList.contains('call-input')) {
      event.preventDefault();
      event.target.form.requestSubmit();
    }
  });

  // Notes
  const noteForm = document.getElementById('note-form');
  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = noteForm.querySelector('.note-status');
    const body = noteForm.elements.body;
    const message = noteForm.querySelector('.field-msg');
    message.textContent = '';
    body.removeAttribute('aria-invalid');
    status.textContent = 'Adding note...';
    let response;
    let payload;
    try {
      response = await fetch(`/api/studio/inquiries/${detail.dataset.id}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body.value }),
      });
      payload = await response.json();
    } catch {
      response = null;
    }
    if (response?.status === 201) {
      const { doc } = await fetchPage(location.href);
      const notes = document.getElementById('notes');
      notes.replaceChildren(...doc.getElementById('notes').children);
      if (notes.firstElementChild && !reduced()) {
        notes.firstElementChild.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS, easing: EASE });
      }
      body.value = '';
      status.textContent = 'Note added.';
    } else if (response?.status === 422) {
      message.textContent = payload.error.message;
      body.setAttribute('aria-invalid', 'true');
      body.focus();
      status.textContent = '';
    } else {
      status.textContent = payload?.error?.message || OUTAGE_MESSAGE;
    }
  });
}
