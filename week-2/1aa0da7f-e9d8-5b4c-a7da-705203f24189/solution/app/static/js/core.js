// DOM builder, icons, the API client, session state and the published refusal copy.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  el.append(...kids.flat().filter((kid) => kid !== null && kid !== undefined && kid !== false));
  return el;
}

const PATHS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  cross: '<path d="M18 6 6 18M6 6l12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  hold: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M8 12h8"/>',
  refuse: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>',
  superseded: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  signOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
};

export function icon(name, extra = '') {
  const span = document.createElement('span');
  span.className = `icon ${extra}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}

// The one figure of a screen. `--chars` lets the stylesheet fit it to its pane.
export function figure(label, value) {
  const text = String(value);
  const number = h('span', { 'data-figure': true, style: `--chars:${Math.max(text.length, 1)}` }, text);
  return h('div', { class: 'figure-block' }, h('span', { 'data-figure-label': true }, label), number);
}

export function setFigure(block, value) {
  const number = block.querySelector('[data-figure]');
  const text = String(value);
  if (number.textContent !== text) {
    number.textContent = text;
    number.style.setProperty('--chars', Math.max(text.length, 1));
  }
}

export class ConnectionLost extends Error {}
export const CONNECTION_LOST = 'Connection lost. Try again.';

export const session = { me: null, breakGlass: [], ended: false };

let sessionEndedHandler = null;
export function onUnauthenticated(handler) {
  sessionEndedHandler = handler;
}

// Every API call goes through here. Automatic checks pass `background: true`.
export async function api(method, path, options = {}) {
  const headers = {};
  if (options.background) headers['X-Wardline-Background'] = '1';
  if (options.proof) headers['X-Step-Up-Proof'] = options.proof;
  if (options.key) headers['Idempotency-Key'] = options.key;
  const init = { method, headers, credentials: 'same-origin' };
  if (options.signal) init.signal = options.signal;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  let answer;
  try {
    answer = await readAnswer(await fetch(path, init));
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ConnectionLost(error.message);
  }
  if (answer.status === 401 && answer.error === 'unauthenticated' && !options.quietSession) notifySessionEnded();
  return answer;
}

// For a request made outside `api` (the upload's XHR) that received `unauthenticated`.
export function notifySessionEnded() {
  sessionEndedHandler();
}

export function newKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readAnswer(response) {
  let data = null;
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    data = await response.json();
  }
  return {
    status: response.status,
    ok: response.ok,
    data,
    error: data?.error,
    errors: data?.errors,
    retryAfter: response.headers.get('Retry-After'),
  };
}

// Claims a download token into memory, so a refusal or a failed digest check never lands on disk.
export async function claimFile(token) {
  try {
    const response = await fetch(`/api/download/${token}`, { credentials: 'same-origin' });
    if (!response.ok) return { ok: false, status: response.status };
    const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '');
    return { ok: true, status: response.status, blob: await response.blob(), filename: name?.[1] ?? 'download' };
  } catch (error) {
    throw new ConnectionLost(error.message);
  }
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function skeletonRows(count = 3) {
  return h('div', { class: 'skeleton-rows', 'aria-hidden': 'true' }, Array.from({ length: count }, () => h('span')));
}

// Screens register what counts as unsaved work; a session end consults every source.
const unsavedSources = new Set();
export function registerUnsaved(source) {
  unsavedSources.add(source);
  return () => unsavedSources.delete(source);
}
export function hasUnsaved() {
  return [...unsavedSources].some((source) => source());
}

let signedInResolvers = [];
export function whenSignedIn() {
  return new Promise((resolve) => signedInResolvers.push(resolve));
}
export function signedInAgain() {
  const waiting = signedInResolvers;
  signedInResolvers = [];
  for (const resolve of waiting) resolve();
}

// Published refusal copy, chosen from the API's answer. `context` names what the record is.
export function refusalCopy(answer, context = {}) {
  switch (answer.error) {
    case 'stale_access_list': return 'Someone else changed this access list. Review it and try again.';
    case 'last_case_lead': return 'This compartment needs another case lead with full access first.';
    case 'stale_marks': return 'Someone else changed these marks. Review them and try again.';
    case 'derivative_superseded': return `A newer set of marks exists for ${answer.data.derivative_id}. Render again and replace it.`;
    case 'release_changed': return 'This release changed while you were reviewing it. Review it again.';
    case 'items_unopened': return `Open every item before signing off. Not opened yet: ${answer.data.item_ids.length}.`;
    case 'seal_mismatch': return 'Not cleared. The stored file no longer matches its seal.';
    case 'legal_hold': return 'Under legal hold. This exhibit cannot be disposed of.';
    case 'hold_exists': return 'This matter already holds this exhibit.';
    case 'exhibit_not_cleared': return 'This exhibit has not been cleared.';
    case 'separation_of_duties':
      return {
        release: 'You worked on this release, so someone else must decide it.',
        exhibit: 'You registered this exhibit, so another officer must decide it.',
        disposal: 'You proposed this disposal, so another case lead must confirm it.',
      }[context.separation];
    case 'illegal_transition':
      return context.race ? 'Already decided by someone else.' : 'This action is no longer available.';
    default: return 'This action is no longer available.';
  }
}

export function canonicalTime(iso) {
  return iso.slice(11, 16) + ' UTC';
}

// In-place table rows: unchanged rows keep their elements, changed ones are replaced, departed ones removed.
export function syncRows(container, rows, { key, signature, render, onLeave }) {
  const existing = new Map([...container.children].map((row) => [row.dataset.rowKey, row]));
  const wanted = new Set(rows.map(key));
  for (const [rowKey, element] of existing) {
    if (!wanted.has(rowKey)) {
      onLeave?.(element, rowKey);
      element.remove();
      existing.delete(rowKey);
    }
  }
  let cursor = container.firstElementChild;
  for (const row of rows) {
    const rowKey = key(row);
    const stamp = signature(row);
    let element = existing.get(rowKey);
    if (element && element.dataset.rowStamp !== stamp) {
      const focusedName = element.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent : null;
      const replacement = stampRow(render(row), rowKey, stamp);
      element.replaceWith(replacement);
      if (cursor === element) cursor = replacement;
      element = replacement;
      if (focusedName !== null) {
        [...element.querySelectorAll('a,button,input,select,textarea')]
          .find((control) => (control.getAttribute('aria-label') ?? control.textContent) === focusedName)?.focus();
      }
    } else if (!element) {
      element = stampRow(render(row), rowKey, stamp);
    }
    if (element === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(element, cursor);
  }
}

// A ruled table whose elements keep explicit roles, because the narrow layout turns its rows into grids.
// A cell passed as `{ wide: content }` takes a whole line of the narrow layout; others take half.
export function ruledTable(name, headers) {
  const body = h('tbody', { role: 'rowgroup' });
  const table = h('table', { role: 'table', 'aria-label': name, class: 'ruled' },
    h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, headers.map((label) => h('th', { role: 'columnheader', scope: 'col' }, label)))),
    body);
  const cell = (content) => {
    const wide = content !== null && typeof content === 'object' && 'wide' in content;
    return h('td', { role: 'cell', class: wide ? 'cell-wide' : 'cell-half' }, wide ? content.wide : content);
  };
  const row = (...cells) => h('tr', { role: 'row' }, cells.map(cell));
  return { table, body, row };
}

function sealMark() {
  return h('span', { 'data-seal-mark': true }, icon('link'), 'Sealed');
}

export function heldMarker() {
  return h('span', { 'data-held-marker': true }, icon('hold'), 'Held');
}

export function digestLine(sha256) {
  return h('div', { class: 'digest-line' }, sealMark(), h('span', { class: 'digest' }, sha256));
}

// The ruled sheet behind the empty and not-found moments: closed with a seal, or left unsigned on a blank line.
function drawing(lastMark) {
  const span = document.createElement('span');
  span.className = 'drawing';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 48 64" preserveAspectRatio="xMinYMid" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M1 1h46v62H1zM9 13h30M9 22h30M9 31h30"/>${lastMark}</svg>`;
  return span;
}

export const sealedSheet = () => drawing('<circle cx="33" cy="49" r="7"/><path d="m29.5 49 2.5 2.5 4.5-5"/>');
export const unsignedSheet = () => drawing('<path d="M9 51h30" stroke-dasharray="3 4"/>');

export function emptyState(copy) {
  return h('div', { class: 'empty-state' }, sealedSheet(), h('p', {}, copy));
}

function stampRow(element, rowKey, stamp) {
  element.dataset.rowKey = rowKey;
  element.dataset.rowStamp = stamp;
  return element;
}

let fieldCounter = 0;

// A labelled control with an error slot directly below it.
export function field(label, control, options = {}) {
  fieldCounter += 1;
  control.id ||= `field-${fieldCounter}`;
  const error = h('p', { class: 'field-error', id: `${control.id}-error`, hidden: true });
  const wrapper = h('div', { class: `field ${options.class ?? ''}`.trim() },
    h('label', { for: control.id }, label), options.hint ? h('p', { class: 'field-hint' }, options.hint) : null, control, error);
  control.fieldError = error;
  return wrapper;
}

export function setFieldError(control, copy) {
  const slot = control.fieldError;
  slot.replaceChildren(icon('refuse'), document.createTextNode(copy));
  slot.hidden = false;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', slot.id);
}

export function clearFieldError(control) {
  control.fieldError.hidden = true;
  control.fieldError.replaceChildren();
  control.removeAttribute('aria-invalid');
  control.removeAttribute('aria-describedby');
}
