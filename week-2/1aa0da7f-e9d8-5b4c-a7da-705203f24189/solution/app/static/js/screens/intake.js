// /intake: the registration form with real upload progress, and the live quarantine table.

import {
  api, clearFieldError, CONNECTION_LOST, ConnectionLost, digestLine, emptyState, field, figure, h, icon, newKey, notifySessionEnded, refusalCopy, registerUnsaved,
  ruledTable, setFieldError, setFigure, syncRows, whenSignedIn,
} from '../core.js';
import { stepUp } from '../dialogs.js';
import { actionStatus, docketPanes, noRecordCopy } from '../shell.js';

const REFRESH_MS = 4000;
const ANNOUNCE_GAP_MS = 60;
const THRESHOLDS = [0, 25, 50, 75, 100];
const SCOPE_RECHECKS_PER_REFRESH = 4;
const PARALLEL_CHECKS = 6;
const TOO_LARGE = 'This file is over the 20,000,000 byte limit.';
const REGISTER_CONNECTION_LOST = 'Connection lost. Press Register exhibit to try again; it will not create a second exhibit.';
const STORAGE_DOWN = 'Not registered. Exhibit storage is unreachable, and nothing was kept. Try again when the notice clears.';
const TYPES = [
  ['PDF document', 'application/pdf'], ['PNG image', 'image/png'], ['JPEG image', 'image/jpeg'], ['WAV audio', 'audio/wav'], ['MPEG audio', 'audio/mpeg'],
];

async function inParallel(items, work) {
  const queue = [...items];
  const worker = async () => {
    while (queue.length) await work(queue.shift());
  };
  await Promise.all(Array.from({ length: PARALLEL_CHECKS }, worker));
}

// The compartments where the caller holds a full grant, and their quarantined exhibits. The list has no scope, so
// each compartment's scope is read once and then rechecked in turn, sooner when it has anything in quarantine.
function custodyReader(screen) {
  const scopes = new Map();
  let recheckFrom = 0;
  const get = (path) => api('GET', path, { background: true, signal: screen.signal });

  const checkScope = async (compartment) => {
    const answer = await get(`/api/compartments/${compartment.id}`);
    if (answer.ok) scopes.set(compartment.id, answer.data.caller_scope);
    else if (answer.status === 404) scopes.delete(compartment.id);
  };

  return async function read() {
    const listed = await get('/api/compartments');
    if (!listed.ok) return null;
    const { compartments } = listed.data;
    const inTurn = compartments.slice(recheckFrom, recheckFrom + SCOPE_RECHECKS_PER_REFRESH);
    recheckFrom = recheckFrom + SCOPE_RECHECKS_PER_REFRESH >= compartments.length ? 0 : recheckFrom + SCOPE_RECHECKS_PER_REFRESH;
    await inParallel(compartments.filter((c) => !scopes.has(c.id) || c.quarantine_count > 0 || inTurn.includes(c)), checkScope);
    const full = compartments.filter((c) => scopes.get(c.id) === 'full');
    const found = new Map();
    await inParallel(full.filter((c) => c.quarantine_count > 0), async (compartment) => {
      const answer = await get(`/api/compartments/${compartment.id}/exhibits?state=quarantined`);
      if (answer.ok) found.set(compartment.id, answer.data.exhibits);
    });
    return { full, exhibits: full.flatMap((c) => found.get(c.id) ?? []) };
  };
}

function quarantineTable(refresh) {
  const { table, body, row } = ruledTable('Quarantine', ['Exhibit', 'Seal check', 'Name', 'Digest', 'Actions']);
  table.tabIndex = -1;
  const empty = emptyState('Nothing in quarantine.');
  const keys = () => [...body.children].map((element) => element.dataset.rowKey);

  // The next row's Clear button, else the new last row's, else the table. `order` is the rows before this one left.
  const focusAfterLeaving = (id, order) => {
    const nextKey = order.slice(order.indexOf(id) + 1).find((key) => keys().includes(key));
    const target = nextKey ? body.querySelector(`[data-row-key="${nextKey}"]`) : body.lastElementChild;
    if (target) target.querySelector('[data-clear]').focus();
    else table.focus();
  };

  const decide = (opener, exhibit, { pending, done, path, needsReason, outage }) => {
    const order = keys();
    stepUp({
      opener,
      fallback: () => focusAfterLeaving(exhibit.id, order),
      needsReason,
      run: (proof, reason) => {
        actionStatus(pending);
        return api('POST', `/api/exhibits/${exhibit.id}/${path}`, { body: needsReason ? { reason } : {}, proof });
      },
      onAnswer: (answer) => {
        if (answer.ok) actionStatus(`${done} ${exhibit.id}.`, 'done');
        else if (answer.error === 'storage_unavailable' && outage) actionStatus(outage, 'refusal');
        else actionStatus(refusalCopy(answer, { separation: 'exhibit', race: true }), 'refusal');
        refresh();
      },
      onFailure: () => actionStatus(CONNECTION_LOST),
    });
  };

  const renderRow = (exhibit) => row(
    h('a', { href: `/exhibits/${exhibit.id}`, class: 'row-link mono' }, exhibit.id),
    exhibit.seal_check === 'failed' ? h('span', { class: 'seal-failed' }, icon('refuse'), 'Seal failed') : '',
    { wide: exhibit.name },
    { wide: digestLine(exhibit.sha256) },
    {
      wide: h('div', { class: 'button-row' },
        h('button', {
          type: 'button',
          class: 'btn',
          'data-clear': true,
          onclick: (event) => decide(event.currentTarget, exhibit, {
            pending: 'Clearing.', done: 'Cleared', path: 'clear', outage: 'Not cleared. Exhibit storage is unreachable.',
          }),
        }, h('span', {}, 'Clear ', h('span', { class: 'mono' }, exhibit.id))),
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: (event) => decide(event.currentTarget, exhibit, { pending: 'Refusing.', done: 'Refused', path: 'refuse', needsReason: true }),
        }, h('span', {}, 'Refuse ', h('span', { class: 'mono' }, exhibit.id)))),
    },
  );

  const update = (exhibits) => {
    const order = keys();
    const active = document.activeElement;
    const focused = body.contains(active) ? active.closest('[data-row-key]').dataset.rowKey : null;
    syncRows(body, exhibits, {
      key: (exhibit) => exhibit.id,
      signature: (exhibit) => JSON.stringify([exhibit.name, exhibit.sha256, exhibit.seal_check]),
      render: renderRow,
    });
    if (focused && !keys().includes(focused)) focusAfterLeaving(focused, order);
    empty.hidden = exhibits.length > 0;
  };
  return { table, empty, update };
}

function progressBar() {
  const fill = h('span', { class: 'progress-fill' });
  const element = h('div', {
    role: 'progressbar', 'aria-label': 'Upload progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, class: 'progress',
  }, fill);
  const set = (percent) => {
    element.setAttribute('aria-valuenow', percent);
    fill.style.inlineSize = `${percent}%`;
  };
  return { element, set };
}

// Sends the form with XMLHttpRequest, the one browser API that reports bytes sent.
function sendForm(path, formData, key, signal, { onProgress, onSent }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.responseType = 'json';
    request.setRequestHeader('Idempotency-Key', key);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.floor((event.loaded / event.total) * 100));
    });
    request.upload.addEventListener('load', onSent);
    request.addEventListener('load', () => resolve({
      status: request.status, ok: request.status < 300, data: request.response, error: request.response?.error, errors: request.response?.errors,
    }));
    request.addEventListener('error', () => reject(new ConnectionLost()));
    request.addEventListener('abort', () => reject(new DOMException('Left the page', 'AbortError')));
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(formData);
  });
}

function registrationForm(screen, compartments, onRegistered) {
  const compartment = h('select', {});
  const name = h('input', { type: 'text', autocomplete: 'off' });
  const source = h('input', { type: 'text', autocomplete: 'off' });
  const collectedBy = h('input', { type: 'text', autocomplete: 'off' });
  const collectedOn = h('input', { type: 'text', class: 'mono', autocomplete: 'off', spellcheck: 'false' });
  const notes = h('textarea', { rows: 3 });
  const declared = h('select', {}, TYPES.map(([label, value]) => h('option', { value }, label)));
  const file = h('input', { type: 'file' });
  const digest = h('input', { type: 'text', class: 'mono', autocomplete: 'off', spellcheck: 'false' });
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Register exhibit');
  const status = h('div', { role: 'status', 'aria-label': 'Intake status', class: 'status-line' });
  const barSlot = h('div', { class: 'progress-slot' });
  const summarySlot = h('div', {});

  // Each field's API name and control, in form order.
  const controls = {
    compartment,
    name,
    source,
    collected_by: collectedBy,
    collected_on: collectedOn,
    capture_notes: notes,
    declared_type: declared,
    file,
    submitted_sha256: digest,
  };

  const form = h('form', { 'aria-label': 'Register exhibit', class: 'stack', novalidate: true },
    summarySlot,
    field('Compartment', compartment),
    field('Exhibit name', name),
    field('Source', source),
    field('Collected by', collectedBy),
    field('Collected on', collectedOn, { hint: 'YYYY-MM-DD' }),
    field('Capture notes', notes),
    field('Declared type', declared),
    field('File', file),
    field('Submitted digest', digest),
    h('div', { class: 'button-row' }, submit),
    barSlot,
    status);

  const setCompartments = (list) => {
    const selected = compartment.value;
    syncRows(compartment, list, {
      key: (entry) => entry.id,
      signature: (entry) => entry.name,
      render: (entry) => h('option', { value: entry.id }, entry.name),
    });
    if (list.some((entry) => entry.id === selected)) compartment.value = selected;
  };
  setCompartments(compartments);

  let key = newKey();
  let busy = false;
  form.addEventListener('input', () => {
    key = newKey();
  });
  screen.onCleanup(registerUnsaved(() => [name, source, collectedBy, collectedOn, notes, digest].some((box) => box.value !== '') || file.files.length > 0));

  const say = (copy, kind = '') => {
    const mark = { refusal: 'refuse', done: 'check' }[kind];
    status.classList.toggle('refusal', kind === 'refusal');
    status.replaceChildren(...(mark ? [icon(mark)] : []), document.createTextNode(copy));
  };

  const clearErrors = () => {
    summarySlot.replaceChildren();
    for (const control of Object.values(controls)) clearFieldError(control);
  };

  // `errors` maps field names to copy. Every copy goes to the status, in form order, and the summary takes focus.
  const showErrors = (errors) => {
    const named = Object.keys(controls).filter((fieldName) => errors[fieldName]);
    const others = Object.keys(errors).filter((fieldName) => !controls[fieldName]);
    for (const fieldName of named) setFieldError(controls[fieldName], errors[fieldName]);
    say([...named, ...others].map((fieldName) => errors[fieldName]).join(' '), 'refusal');
    const summary = h('div', { role: 'alert', 'aria-label': 'There is a problem', class: 'error-summary', tabindex: -1 },
      h('p', { class: 'error-summary-title' }, icon('refuse'), 'There is a problem'),
      h('ul', {},
        named.map((fieldName) => h('li', {}, `${controls[fieldName].labels[0].textContent}: `, h('a', {
          href: `#${controls[fieldName].id}`,
          onclick: (event) => {
            event.preventDefault();
            controls[fieldName].focus();
          },
        }, errors[fieldName]))),
        others.map((fieldName) => h('li', {}, errors[fieldName]))));
    summarySlot.replaceChildren(summary);
    summary.focus();
  };

  const formData = () => {
    const data = new FormData();
    data.append('name', name.value);
    data.append('declared_type', declared.value);
    data.append('source', source.value);
    data.append('collected_by', collectedBy.value);
    data.append('collected_on', collectedOn.value);
    if (notes.value.trim()) data.append('capture_notes', notes.value);
    if (digest.value.trim()) data.append('submitted_sha256', digest.value);
    if (file.files.length) data.append('file', file.files[0]);
    return data;
  };

  // One attempt: announces each threshold once, in order and far enough apart to be heard, then `Confirming storage.`
  const upload = async () => {
    const bar = progressBar();
    barSlot.replaceChildren(bar.element);
    let announced = Promise.resolve();
    const announce = (copy) => {
      announced = announced.then(() => {
        say(copy);
        return new Promise((resolve) => setTimeout(resolve, ANNOUNCE_GAP_MS));
      });
    };
    let nextThreshold = 0;
    let shown = 0;
    const progress = (percent) => {
      shown = Math.max(shown, percent);
      bar.set(shown);
      while (nextThreshold < THRESHOLDS.length && THRESHOLDS[nextThreshold] <= shown) {
        announce(`Uploading ${THRESHOLDS[nextThreshold]} percent.`);
        nextThreshold += 1;
      }
    };
    progress(0);
    try {
      return await sendForm(`/api/compartments/${compartment.value}/exhibits`, formData(), key, screen.signal, {
        onProgress: progress,
        onSent: () => {
          progress(100);
          announce('Confirming storage.');
        },
      });
    } finally {
      await announced;
      barSlot.replaceChildren();
    }
  };

  // A 401 waits for Sign in again and resends once with the same key; a second one leaves the next press to the person.
  const uploadResuming = async () => {
    let answer = await upload();
    if (answer.status !== 401) return answer;
    notifySessionEnded();
    await whenSignedIn();
    answer = await upload();
    if (answer.status === 401) {
      notifySessionEnded();
      await whenSignedIn();
    }
    return answer;
  };

  const showAnswer = (answer) => {
    if (answer.ok) {
      const kept = compartment.value;
      form.reset();
      compartment.value = kept;
      key = newKey();
      status.classList.remove('refusal');
      status.replaceChildren(icon('check'), 'Sealed ', h('span', { class: 'mono' }, answer.data.id), '. In quarantine until a second officer clears it.');
      onRegistered();
    } else if (answer.status === 413) {
      showErrors({ file: TOO_LARGE });
    } else if (answer.errors) {
      showErrors(answer.errors);
    } else if (answer.error === 'storage_unavailable') {
      say(STORAGE_DOWN, 'refusal');
    } else if (answer.status === 401) {
      say('');
    } else {
      say(refusalCopy(answer), 'refusal');
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    clearErrors();
    if (!compartment.value) {
      showErrors({ compartment: 'This field is required.' });
      return;
    }
    busy = true;
    const hadFocus = document.activeElement === submit;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    try {
      showAnswer(await uploadResuming());
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (!(error instanceof ConnectionLost)) throw error;
      say(REGISTER_CONNECTION_LOST);
    } finally {
      busy = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      if (hadFocus && document.activeElement === document.body) submit.focus();
    }
  });
  return { form, setCompartments };
}

export async function mount(screen) {
  const panes = docketPanes(screen, 'docket');
  noRecordCopy(panes.inspector);
  panes.docket.append(h('div', { class: 'skeleton' }, h('div'), h('div'), h('div')));

  const read = custodyReader(screen);
  const first = await read();
  if (screen.stopped || !first) return;

  let generation = 0;
  let count = null;
  let quarantine = null;
  let registration = null;
  const apply = ({ full, exhibits }) => {
    setFigure(count, exhibits.length);
    registration.setCompartments(full);
    quarantine.update(exhibits);
  };
  // Answers from an older read never overwrite a newer one.
  const refresh = async () => {
    generation += 1;
    const mine = generation;
    const data = await read();
    if (data && mine === generation && !screen.stopped) apply(data);
  };
  const refreshQuietly = () => refresh().catch((error) => {
    if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
  });

  count = figure('In quarantine', first.exhibits.length);
  quarantine = quarantineTable(refreshQuietly);
  registration = registrationForm(screen, first.full, refreshQuietly);
  panes.docket.replaceChildren(
    count,
    h('section', { class: 'sheet-section stack' }, h('h3', {}, 'Register exhibit'), registration.form),
    h('section', { class: 'sheet-section stack' }, h('h3', {}, 'Quarantine'), quarantine.table, quarantine.empty),
  );
  apply(first);
  screen.every(REFRESH_MS, refresh, { now: false });
}
