// The Session editor dialog: lifecycle actions, batches, calibration, frame uploads and notes under an edit lock.
import { h, replace } from '../core/dom.js';
import { api, upload } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { createDialog } from '../core/dialog.js';
import { createErrorSummary, field } from '../core/forms.js';
import { duration, oneDecimal, stateWord } from '../core/format.js';
import { wallToIso } from '../core/time.js';
import { createBatchFields } from './batch-fields.js';
import { openCalibrationChooser } from './calibration-chooser.js';
import { formDialog } from './form-dialog.js';
import { newKey } from './values.js';

const LOCK_EXPIRED = 'Your edit lock expired. Your notes are kept; save to take the lock again.';
const LOCK_HELD = 'This session is open for editing on another device.';
const START_FORMAT = 'Enter the start as YYYY-MM-DD HH:MM in site time.';
const PROGRESS_MARKS = [25, 50, 75, 100];

const ACTIONS_BY_STATE = {
  planned: ['start', 'trash'],
  imaging: ['logBatch', 'finish', 'upload'],
  logged: ['amend', 'trash', 'upload'],
  amended: ['amend', 'trash', 'upload'],
  trashed: ['restore'],
};

let siteZone = null;

function siteTimeZone() {
  siteZone ??= api('GET', '/api/site').then((site) => site.time_zone);
  return siteZone;
}

// openSessionEditor({sessionId, opener, log, logHome, onChange, onClosed})
// `log` is the page's single Session log region; it moves into the editor while the editor is open.
export async function openSessionEditor({ sessionId, opener, log, logHome, onChange, onClosed }) {
  let session = await api('GET', `/api/sessions/${sessionId}`);
  let setNames = new Map();
  let lock = null;
  let expiryTimer = 0;
  let frameBatchId = null;

  const dialog = createDialog({ name: 'Session editor', wide: true, onClose: cleanup });
  const summary = createErrorSummary();
  const heading = h('div', { class: 'editor-summary' });
  const startedAt = h('input', { type: 'text', placeholder: 'YYYY-MM-DD HH:MM', autocomplete: 'off', 'data-field': 'started_at' });
  const startField = field({ label: 'Started at', input: startedAt, hint: 'Site time. Leave blank to start now.' });
  const actionRow = h('div', { class: 'button-row' });
  const batchList = h('ul', { class: 'batch-list', role: 'list', 'aria-label': 'Batches' });
  const progress = liveRegion('Upload progress');
  const logSlot = h('div', { class: 'log-slot' });
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => sendFiles() });
  const notes = h('textarea', { id: 'session-notes', value: session.notes, maxlength: '10000' });
  const saveNotesButton = h('button', { type: 'button', class: 'btn', onclick: () => saveNotes() }, 'Save notes');

  function button(label, key, onclick, extra = '') {
    return h('button', { type: 'button', class: `btn${extra}`, 'data-key': key, onclick }, label);
  }

  async function run(request, message) {
    summary.clear();
    try {
      const next = await request();
      applySession(next);
      announce(log, message(next));
      onChange();
    } catch (error) {
      announce(log, error.message);
    }
  }

  async function start() {
    summary.clear();
    const text = startedAt.value.trim();
    const iso = text === '' ? null : wallToIso(text, await siteTimeZone());
    if (text !== '' && iso === null) {
      summary.showFields({ started_at: START_FORMAT }, () => startedAt);
      return;
    }
    await run(() => api('POST', `/api/sessions/${sessionId}/start`, { body: iso ? { started_at: iso } : {} }),
      (next) => `Imaging started. Night of ${next.observing_date}.`);
  }

  async function logBatch(opener) {
    const project = await api('GET', `/api/projects/${session.project_id}`);
    const last = session.batches.at(-1);
    const fields = createBatchFields({ filters: project.filters.map((row) => row.filter), values: last ? { ...last, id: null } : {} });
    let key = null;
    const view = formDialog({
      name: 'Log batch',
      submitLabel: 'Add batch',
      onSubmit: async () => {
        key ??= newKey();
        const reply = await api('POST', `/api/sessions/${sessionId}/batches`, { body: fields.read(), headers: { 'Idempotency-Key': key } });
        view.dialog.close();
        applySession(reply.session);
        announce(log, `${reply.batch.sub_count} subs of ${reply.batch.exposure_s} s in ${reply.batch.filter} added.`);
        onChange();
      },
    });
    view.form.addEventListener('input', () => { key = null; });
    view.fieldsHost.append(fields.element);
    view.dialog.open(opener);
  }

  async function amend(opener) {
    const project = await api('GET', `/api/projects/${session.project_id}`);
    const filters = project.filters.map((row) => row.filter);
    let drafts = session.batches.map((batch) => ({ values: batch }));
    let editors = [];
    const view = formDialog({
      name: 'Amend session',
      submitLabel: 'Save amendment',
      wide: true,
      onSubmit: async () => {
        const next = await api('POST', `/api/sessions/${sessionId}/amend`, { body: { batches: editors.map((editor) => editor.read()) } });
        view.dialog.close();
        applySession(next);
        announce(log, 'Session amended.');
        onChange();
      },
    });
    const addAnother = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { keepTyped(); drafts.push({ values: {} }); render(); } }, 'Add another batch');

    function keepTyped() {
      drafts = drafts.map((draft, index) => ({ values: editors[index].read() }));
    }

    function render() {
      editors = drafts.map((draft, index) => createBatchFields({ filters, values: draft.values, prefix: `batches[${index}].` }));
      view.fieldsHost.replaceChildren(...editors.map((editor, index) => h('fieldset', { class: 'batch-set' },
        h('legend', {}, `Batch ${index + 1}`),
        editor.element,
        h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { keepTyped(); drafts.splice(index, 1); render(); } }, `Remove batch ${index + 1}`))),
      addAnother);
    }

    render();
    view.dialog.open(opener);
  }

  function chooseCalibration(batch, opener) {
    openCalibrationChooser({
      batch,
      opener,
      onLinked: async () => {
        await loadSetNames();
        applySession(await api('GET', `/api/sessions/${sessionId}`));
        onChange();
      },
    }).catch((error) => announce(log, error.message));
  }

  async function unlink(batch, kind) {
    try {
      await api('DELETE', `/api/batches/${batch.id}/calibration/${kind}`);
      applySession(await api('GET', `/api/sessions/${sessionId}`));
      onChange();
    } catch (error) {
      announce(log, error.message);
    }
  }

  async function loadSetNames() {
    const { calibration_sets: sets } = await api('GET', '/api/calibration-sets');
    setNames = new Map(sets.map((set) => [set.id, set.name]));
  }

  async function sendFiles() {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const file of files) await sendFile(file);
    applySession(await api('GET', `/api/sessions/${sessionId}`));
    onChange();
  }

  async function sendFile(file) {
    const said = new Set();
    const say = (percent) => {
      if (said.has(percent)) return;
      said.add(percent);
      announce(progress, `Uploading ${file.name}: ${percent}%`);
    };
    say(0);
    try {
      const stored = await upload('PUT', `/api/batches/${frameBatchId}/frames/${encodeURIComponent(file.name)}`, file, {
        contentType: file.type || 'application/octet-stream',
        onProgress: (percent) => PROGRESS_MARKS.filter((mark) => percent >= mark).forEach(say),
      });
      say(100);
      announce(progress, `${file.name} stored. ${stored.session_frame_count} frames in this session.`);
    } catch (error) {
      announce(progress, `${file.name} was not stored: ${error.message}`);
    }
  }

  async function takeLock() {
    try {
      const grant = await api('POST', `/api/sessions/${sessionId}/lock`, { body: {} });
      const mine = { token: grant.lock_token, live: true };
      lock = mine;
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => { mine.live = false; announce(log, LOCK_EXPIRED); }, grant.expires_in_seconds * 1000);
      return true;
    } catch (error) {
      lock = null;
      if (error.code === 'session_locked') announce(log, LOCK_HELD);
      else if (error.code !== 'wrong_state') announce(log, error.message);
      return false;
    }
  }

  async function saveNotes(retry = true) {
    if ((!lock || !lock.live) && !(await takeLock())) return;
    try {
      session = await api('PATCH', `/api/sessions/${sessionId}/notes`, { body: { notes: notes.value, lock_token: lock.token } });
      announce(log, 'Notes saved.');
    } catch (error) {
      if (error.code === 'lock_expired' && retry) {
        lock = null;
        await saveNotes(false);
      } else announce(log, error.code === 'session_locked' ? LOCK_HELD : error.message);
    }
  }

  function cleanup() {
    clearTimeout(expiryTimer);
    if (lock) api('DELETE', `/api/sessions/${sessionId}/lock`, { body: { lock_token: lock.token } }).catch(() => {});
    logHome.append(log);
    onClosed(sessionId);
  }

  function actionButtons() {
    const buttons = {
      start: () => button('Start imaging', 'start', start, ' btn--primary'),
      logBatch: () => button('Log batch', 'log-batch', (event) => logBatch(event.currentTarget).catch((error) => announce(log, error.message))),
      finish: () => button('Finish and log', 'finish', () => run(() => api('POST', `/api/sessions/${sessionId}/log`, { body: {} }),
        (next) => `Session logged: ${duration(next.integration_seconds)} integrated.`)),
      amend: () => button('Amend', 'amend', (event) => amend(event.currentTarget).catch((error) => announce(log, error.message))),
      trash: () => button('Trash session', 'trash', () => run(() => api('POST', `/api/sessions/${sessionId}/trash`), () => 'Session moved to trash.')),
      restore: () => button('Restore session', 'restore', async () => {
        await run(() => api('POST', `/api/sessions/${sessionId}/restore`), () => 'Session restored.');
        if (session.state !== 'trashed' && (!lock || !lock.live)) takeLock();
      }),
      upload: () => (session.batches.length === 0 ? [] : [
        session.batches.length > 1 ? h('select', { 'aria-label': 'Frame batch', onchange: (event) => { frameBatchId = event.target.value; } },
          session.batches.map((batch, index) => h('option', { value: batch.id, selected: batch.id === frameBatchId }, `${batch.filter} batch ${index + 1}`))) : null,
        button('Upload frames', 'upload', () => fileInput.click()),
      ]),
    };
    return ACTIONS_BY_STATE[session.state].flatMap((name) => buttons[name]());
  }

  function batchItem(batch, index) {
    const number = index + 1;
    const linked = Object.entries(batch.calibration).filter(([, id]) => id !== null);
    return h('li', { class: 'batch-item' },
      h('div', {},
        h('strong', {}, `Batch ${number}: ${batch.filter}`),
        h('p', {}, `${batch.sub_count} subs of ${batch.exposure_s} s, ${duration(batch.integration_seconds)} integrated`),
        h('p', { class: 'muted' }, `${batch.camera}, gain ${batch.gain}, offset ${batch.offset}, ${oneDecimal(batch.temperature_c)} C, binning ${batch.binning}, ${batch.frame_count} frames`),
        linked.length ? h('ul', { class: 'linked-sets', role: 'list' }, linked.map(([kind, id]) => h('li', {},
          h('span', {}, `${stateWord(kind)}: ${setNames.get(id) || id}`),
          h('button', { type: 'button', class: 'btn btn--quiet', 'aria-label': `Remove ${kind} calibration from ${batch.filter} batch ${number}`, onclick: () => unlink(batch, kind) }, 'Remove'))) ) : null),
      ['imaging', 'logged', 'amended'].includes(session.state)
        ? button(`Calibrate ${batch.filter} batch ${number}`, `calibrate-${batch.id}`, (event) => chooseCalibration(batch, event.currentTarget), ' btn--ghost')
        : null);
  }

  function applySession(next) {
    const focusKey = dialog.dialog.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    session = next;
    if (!session.batches.some((batch) => batch.id === frameBatchId)) frameBatchId = session.batches[0]?.id ?? null;
    replace(heading,
      h('h3', {}, `${session.observing_date} ${session.project_name}`),
      h('p', {}, h('span', { class: 'chip' }, stateWord(session.state)), ` ${duration(session.integration_seconds)} integrated, ${session.frame_count} frames`),
      session.started_at ? h('p', { class: 'muted' }, `Started ${session.started_at.slice(0, 16).replace('T', ' ')}`) : null);
    startField.hidden = session.state !== 'planned';
    replace(actionRow, actionButtons());
    batchList.replaceChildren(...session.batches.map(batchItem));
    notes.disabled = session.state === 'trashed';
    saveNotesButton.hidden = session.state === 'trashed';
    if (focusKey) dialog.dialog.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  await loadSetNames();
  logSlot.append(log);
  dialog.body.append(
    heading, summary.element, startField, actionRow, batchList, progress,
    field({ label: 'Session notes', input: notes }),
    h('div', { class: 'button-row' }, saveNotesButton),
    logSlot, fileInput);
  dialog.actions.append(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Close'));
  applySession(session);
  dialog.open(opener);
  takeLock();
}
