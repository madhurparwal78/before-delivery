import { h, uid } from '../core/dom.js';
import { api, upload } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { createDialog } from '../core/dialog.js';
import { createErrorSummary, field } from '../core/forms.js';
import { FILTERS, oneDecimal, staleWarning, stateWord } from '../core/format.js';
import { isoToWall } from '../core/time.js';
import { mountShell } from '../shell.js';
import { formDialog } from './form-dialog.js';
import { skyDisc } from './sky-disc.js';
import { parseNumber } from './values.js';

const EMPTY_LIBRARY = 'Your calibration library is empty. Add a dark, flat or bias set to start matching frames.';
const WIDE = window.matchMedia('(min-width: 768px)');
const KINDS = ['dark', 'flat', 'bias'];
const MASTER_TYPE = 'image/fits';
const COLUMNS = ['Name', 'Kind', 'Camera', 'Gain', 'Offset', 'Exposure', 'Temperature', 'Binning', 'Filter', 'Age in days', 'State'];

function setDialog({ set = null, opener, defaultCapturedOn, onSaved }) {
  const inputs = {
    name: h('input', { type: 'text', maxlength: '80', value: set?.name ?? '', 'data-field': 'name' }),
    kind: h('select', { 'data-field': 'kind', onchange: applicability }, KINDS.map((kind) => h('option', { value: kind }, kind))),
    camera: h('input', { type: 'text', maxlength: '60', value: set?.camera ?? '', 'data-field': 'camera' }),
    gain: h('input', { type: 'number', min: '0', max: '1000', step: '1', value: set?.gain ?? '', 'data-field': 'gain' }),
    offset: h('input', { type: 'number', min: '0', max: '1000', step: '1', value: set?.offset ?? '', 'data-field': 'offset' }),
    exposure_s: h('input', { type: 'number', min: '1', max: '3600', step: '1', value: set?.exposure_s ?? '', 'data-field': 'exposure_s' }),
    temperature_c: h('input', { type: 'number', min: '-40', max: '40', step: '0.1', value: set?.temperature_c ?? '', 'data-field': 'temperature_c' }),
    binning: h('input', { type: 'number', min: '1', max: '4', step: '1', value: set?.binning ?? '', 'data-field': 'binning' }),
    filter: h('select', { 'data-field': 'filter' }, FILTERS.map((name) => h('option', { value: name, selected: name === set?.filter }, name))),
    frame_count: h('input', { type: 'number', min: '1', max: '1000', step: '1', value: set?.frame_count ?? '', 'data-field': 'frame_count' }),
    captured_on: h('input', { type: 'text', placeholder: 'YYYY-MM-DD', value: set?.captured_on ?? defaultCapturedOn, 'data-field': 'captured_on', autocomplete: 'off' }),
  };
  if (set) inputs.kind.value = set.kind;
  const fields = {
    name: field({ label: 'Set name', input: inputs.name }),
    kind: field({ label: 'Kind', input: inputs.kind }),
    camera: field({ label: 'Camera', input: inputs.camera }),
    gain: field({ label: 'Gain', input: inputs.gain }),
    offset: field({ label: 'Offset', input: inputs.offset }),
    exposure_s: field({ label: 'Exposure (s)', input: inputs.exposure_s }),
    temperature_c: field({ label: 'Sensor temperature (C)', input: inputs.temperature_c }),
    binning: field({ label: 'Binning', input: inputs.binning }),
    filter: field({ label: 'Filter', input: inputs.filter }),
    frame_count: field({ label: 'Frames combined', input: inputs.frame_count }),
    captured_on: field({ label: 'Captured on', input: inputs.captured_on, hint: 'YYYY-MM-DD, not after today' }),
  };

  function applicability() {
    fields.exposure_s.hidden = inputs.kind.value !== 'dark';
    fields.filter.hidden = inputs.kind.value !== 'flat';
  }

  const view = formDialog({
    name: set ? 'Edit calibration set' : 'New calibration set',
    submitLabel: set ? 'Save set' : 'Add set',
    wide: true,
    onSubmit: async () => {
      const kind = inputs.kind.value;
      const body = {
        name: inputs.name.value.trim(),
        camera: inputs.camera.value.trim(),
        gain: parseNumber(inputs.gain.value),
        offset: parseNumber(inputs.offset.value),
        exposure_s: kind === 'dark' ? parseNumber(inputs.exposure_s.value) : null,
        temperature_c: parseNumber(inputs.temperature_c.value),
        binning: parseNumber(inputs.binning.value),
        filter: kind === 'flat' ? inputs.filter.value : null,
        frame_count: parseNumber(inputs.frame_count.value),
        captured_on: inputs.captured_on.value.trim(),
      };
      const saved = set
        ? await api('PATCH', `/api/calibration-sets/${set.id}`, { body })
        : await api('POST', '/api/calibration-sets', { body: { ...body, kind } });
      view.dialog.close();
      await onSaved(saved);
    },
  });
  if (set) fields.kind.hidden = true;
  view.fieldsHost.append(...Object.values(fields));
  view.fieldsHost.classList.add('form-grid');
  applicability();
  view.dialog.open(opener);
}

function versionItem(version, current, onRestore) {
  return h('li', { class: 'version-item' },
    h('div', {},
      h('strong', {}, `Version ${version.version}`),
      h('p', { class: 'muted' }, `${version.name}, ${version.camera}, gain ${version.gain}, offset ${version.offset}, ${oneDecimal(version.temperature_c)} C, binning ${version.binning}${version.exposure_s ? `, ${version.exposure_s} s` : ''}${version.filter ? `, ${version.filter}` : ''}, ${version.frame_count} frames, captured ${version.captured_on}`),
      h('p', { class: 'muted' }, version.master ? `Master ${version.master.filename}` : 'No master')),
    version.version < current
      ? h('button', { type: 'button', class: 'btn', onclick: () => onRestore(version.version) }, `Restore version ${version.version}`)
      : h('span', { class: 'chip' }, 'Current'));
}

async function openHistory({ set, opener, onRestored }) {
  const { versions } = await api('GET', `/api/calibration-sets/${set.id}/versions`);
  const current = versions[versions.length - 1].version;
  const dialog = createDialog({ name: 'Version history', wide: true });
  const summary = createErrorSummary();

  async function restore(version) {
    try {
      await api('POST', `/api/calibration-sets/${set.id}/restore`, { body: { version } });
      dialog.close();
      await onRestored(version);
    } catch (error) {
      summary.showMessage(error.message);
    }
  }

  dialog.body.append(summary.element, h('ul', { class: 'version-list', role: 'list' },
    [...versions].reverse().map((version) => versionItem(version, current, restore))));
  dialog.actions.append(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Close'));
  dialog.open(opener);
}

export async function mount() {
  const { main } = mountShell({ page: 'library' });
  const updates = liveRegion('Library updates');
  const listHost = h('div', { class: 'library-list' });
  const masterInput = h('input', { type: 'file', hidden: true, onchange: () => sendMaster() });
  let sets = [];
  let masterTarget = null;

  async function load() {
    ({ calibration_sets: sets } = await api('GET', '/api/calibration-sets'));
    paint();
  }

  async function failing(action) {
    try {
      await action();
    } catch (error) {
      announce(updates, error.message);
    }
  }

  async function transition(set, to, message) {
    await failing(async () => {
      await api('POST', `/api/calibration-sets/${set.id}/transition`, { body: { to } });
      announce(updates, message);
      await load();
    });
  }

  async function sendMaster() {
    const file = masterInput.files[0];
    masterInput.value = '';
    const set = masterTarget;
    await failing(async () => {
      await upload('PUT', `/api/calibration-sets/${set.id}/master?filename=${encodeURIComponent(file.name)}`, file, {
        contentType: file.type === MASTER_TYPE ? MASTER_TYPE : 'application/octet-stream',
      });
      announce(updates, `Master stored for ${set.name}.`);
      await load();
    });
  }

  async function capturedOnDefault() {
    const [site, tonight] = await Promise.all([api('GET', '/api/site'), api('GET', '/api/tonight')]);
    return isoToWall(tonight.server_time, site.time_zone).slice(0, 10);
  }

  function actions(set) {
    if (set.status === 'retired') return [button(`History ${set.name}`, 'History', set, (opener) => openHistory({ set, opener, onRestored: (version) => restored(set, version) }))];
    return [
      button(`Edit ${set.name}`, 'Edit', set, async (opener) => setDialog({ set, opener, defaultCapturedOn: '', onSaved: async () => { announce(updates, `${set.name} updated.`); await load(); } })),
      button(`Upload master ${set.name}`, 'Upload master', set, () => { masterTarget = set; masterInput.click(); }),
      set.status === 'building' ? button(`Mark ready ${set.name}`, 'Mark ready', set, () => transition(set, 'ready', `${set.name} is ready.`)) : null,
      button(`Retire ${set.name}`, 'Retire', set, () => transition(set, 'retired', `${set.name} retired.`)),
      button(`History ${set.name}`, 'History', set, (opener) => openHistory({ set, opener, onRestored: (version) => restored(set, version) })),
    ];
  }

  function button(name, label, set, handler) {
    return h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': name, onclick: (event) => failing(() => handler(event.currentTarget)) }, label);
  }

  async function restored(set, version) {
    announce(updates, `${set.name} restored to version ${version}.`);
    await load();
  }

  function stateCell(set) {
    if (set.status !== 'stale') return h('span', { class: 'chip' }, stateWord(set.status));
    const describedBy = uid('stale');
    return h('span', {},
      h('span', { class: 'chip', 'aria-describedby': describedBy }, 'Stale'),
      h('span', { id: describedBy, class: 'sr-only' }, staleWarning(set.max_age_days)));
  }

  function values(set) {
    return [set.name, set.kind, set.camera, set.gain, set.offset, set.exposure_s ?? '-', `${oneDecimal(set.temperature_c)} C`,
      set.binning, set.filter ?? '-', set.age_days];
  }

  function table() {
    return h('div', { class: 'sheet', tabindex: '0' },
      h('table', { 'aria-label': 'Calibration library' },
        h('thead', {}, h('tr', {}, COLUMNS.map((label) => h('th', {}, label)))),
        h('tbody', {}, sets.flatMap((set) => [
          h('tr', { class: 'set-row' },
            ...values(set).map((value) => h('td', { class: 'num' }, String(value))),
            h('td', {}, stateCell(set))),
          h('tr', { class: 'set-actions' },
            h('td', { colspan: String(COLUMNS.length) }, h('div', { class: 'button-row' }, actions(set)))),
        ]))));
  }

  function cards() {
    return h('ul', { class: 'library-cards', role: 'list', 'aria-label': 'Calibration library' },
      sets.map((set) => h('li', { class: 'card library-card' },
        h('h2', {}, set.name),
        h('p', {}, stateCell(set)),
        h('p', { class: 'muted num' }, `${stateWord(set.kind)}, ${set.camera}, gain ${set.gain}, offset ${set.offset}, ${oneDecimal(set.temperature_c)} C, binning ${set.binning}${set.exposure_s ? `, ${set.exposure_s} s` : ''}${set.filter ? `, ${set.filter}` : ''}, ${set.age_days} days old`),
        h('div', { class: 'button-row' }, actions(set)))));
  }

  function paint() {
    listHost.replaceChildren(sets.length
      ? (WIDE.matches ? table() : cards())
      : h('div', { class: 'empty' }, skyDisc({ size: 200 }), h('p', {}, EMPTY_LIBRARY)));
  }

  const newSet = h('button', { type: 'button', class: 'btn btn--primary', onclick: () => failing(async () => setDialog({
    opener: newSet,
    defaultCapturedOn: await capturedOnDefault(),
    onSaved: async (saved) => { announce(updates, `${saved.name} added to the library.`); await load(); },
  })) }, 'New calibration set');

  WIDE.addEventListener('change', paint);
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Library'), newSet), updates, listHost, masterInput);
  await load();
}
