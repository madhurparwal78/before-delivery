import { api, upload } from '../api.js';
import { announce, clear, el, spinbutton, textbox } from '../dom.js';
import { staleWarningFor } from '../copy.js';
import { close, openDialog } from '../dialog.js';
import { paintSkyDisc } from '../skychart.js';

const EMPTY_LIBRARY =
  'Your calibration library is empty. Add a dark, flat or bias set to start ' +
  'matching frames.';
const KINDS = ['dark', 'flat', 'bias'];
const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'];
const TABLE_WIDTH = 768;

function setFieldSet(values = {}, { withKind }) {
  const kind = el(
    'select',
    { 'aria-label': 'Kind' },
    KINDS.map((name) =>
      el('option', { value: name, text: name, selected: values.kind === name }),
    ),
  );
  const controls = {
    name: textbox('Set name', { value: values.name ?? '' }),
    camera: textbox('Camera', { value: values.camera ?? '' }),
    gain: spinbutton('Gain', { min: '0', max: '1000', value: String(values.gain ?? 100) }),
    offset: spinbutton('Offset', {
      min: '0',
      max: '1000',
      value: String(values.offset ?? 50),
    }),
    exposure_s: spinbutton('Exposure (s)', {
      min: '1',
      max: '3600',
      value: values.exposure_s === null || values.exposure_s === undefined
        ? ''
        : String(values.exposure_s),
    }),
    temperature_c: spinbutton('Sensor temperature (C)', {
      min: '-40',
      max: '40',
      step: '0.1',
      value: String(values.temperature_c ?? -10),
    }),
    binning: spinbutton('Binning', { min: '1', max: '4', value: String(values.binning ?? 1) }),
    filter: el(
      'select',
      { 'aria-label': 'Filter' },
      [el('option', { value: '', text: 'none' })].concat(
        FILTERS.map((name) =>
          el('option', { value: name, text: name, selected: values.filter === name }),
        ),
      ),
    ),
    frame_count: spinbutton('Frames combined', {
      min: '1',
      max: '1000',
      value: String(values.frame_count ?? 30),
    }),
    captured_on: textbox('Captured on', {
      placeholder: 'YYYY-MM-DD',
      value: values.captured_on ?? '',
    }),
  };
  const labels = {
    name: 'Set name',
    camera: 'Camera',
    gain: 'Gain',
    offset: 'Offset',
    exposure_s: 'Exposure (s)',
    temperature_c: 'Sensor temperature (C)',
    binning: 'Binning',
    filter: 'Filter',
    frame_count: 'Frames combined',
    captured_on: 'Captured on',
  };
  const rows = [];
  if (withKind) {
    kind.id = `sf-kind-${Math.random().toString(36).slice(2, 8)}`;
    rows.push(
      el('div', { class: 'field' }, [el('label', { for: kind.id, text: 'Kind' }), kind]),
    );
  }
  for (const key of Object.keys(controls)) {
    const id = `sf-${key}-${Math.random().toString(36).slice(2, 8)}`;
    controls[key].id = id;
    rows.push(
      el('div', { class: 'field' }, [
        el('label', { for: id, text: labels[key] }),
        controls[key],
      ]),
    );
  }
  const grid = el('div', { class: 'form-grid' }, rows);
  const read = () => ({
    ...(withKind ? { kind: kind.value } : {}),
    name: controls.name.value.trim(),
    camera: controls.camera.value.trim(),
    gain: Number(controls.gain.value),
    offset: Number(controls.offset.value),
    exposure_s: controls.exposure_s.value === '' ? null : Number(controls.exposure_s.value),
    temperature_c: Number(controls.temperature_c.value),
    binning: Number(controls.binning.value),
    filter: controls.filter.value || null,
    frame_count: Number(controls.frame_count.value),
    captured_on: controls.captured_on.value.trim(),
  });
  return { grid, read, kind };
}

export async function renderLibrary(main, context) {
  const holder = el('div', {});
  const updates = el('div', { role: 'status', 'aria-label': 'Library updates' });
  const newSet = el('button', {
    type: 'button',
    class: 'pill',
    text: 'New calibration set',
  });
  const uploadPicker = el('input', {
    type: 'file',
    'aria-label': 'Master file',
    style: 'display:none',
  });
  let uploadTarget = null;

  main.append(
    el('div', { class: 'stack' }, [
      el('h1', { text: 'Library' }),
      context.card,
      newSet,
      holder,
      updates,
      uploadPicker,
    ]),
  );

  function actionsFor(set) {
    const buttons = [
      el('button', {
        type: 'button',
        text: 'Edit',
        'aria-label': `Edit ${set.name}`,
        onclick: () => openEdit(set),
      }),
      el('button', {
        type: 'button',
        text: 'Upload master',
        'aria-label': `Upload master ${set.name}`,
        onclick: () => {
          uploadTarget = set;
          uploadPicker.click();
        },
      }),
    ];
    if (set.status === 'building') {
      buttons.push(
        el('button', {
          type: 'button',
          text: 'Mark ready',
          'aria-label': `Mark ready ${set.name}`,
          onclick: () => transition(set, 'ready', `${set.name} is ready.`),
        }),
      );
    }
    if (set.status !== 'retired') {
      buttons.push(
        el('button', {
          type: 'button',
          text: 'Retire',
          'aria-label': `Retire ${set.name}`,
          onclick: () => transition(set, 'retired', `${set.name} retired.`),
        }),
      );
    }
    buttons.push(
      el('button', {
        type: 'button',
        text: 'History',
        'aria-label': `History ${set.name}`,
        onclick: () => openHistory(set),
      }),
    );
    return buttons;
  }

  function stateCell(set) {
    if (set.status !== 'stale') return el('td', { text: set.status });
    return el('td', {}, [
      el('span', {
        text: 'Stale',
        title: staleWarningFor(set.max_age_days),
        'aria-description': staleWarningFor(set.max_age_days),
      }),
    ]);
  }

  async function paint() {
    const { calibration_sets: sets } = await api('GET', '/api/calibration-sets');
    clear(holder);
    if (!sets.length) {
      const disc = el('canvas', { role: 'img', 'aria-label': 'Sky disc' });
      holder.append(
        el('div', { class: 'hero-empty' }, [disc, el('p', { text: EMPTY_LIBRARY })]),
      );
      requestAnimationFrame(() => paintSkyDisc(disc, null));
      return;
    }
    const columns = [
      'Name', 'Kind', 'Camera', 'Gain', 'Offset', 'Exposure', 'Temperature',
      'Binning', 'Filter', 'Age in days', 'State',
    ];
    if (window.innerWidth >= TABLE_WIDTH) {
      holder.append(
        el('div', { class: 'table-sheet' }, [
          el('table', { 'aria-label': 'Calibration library' }, [
            el('thead', {}, [
              el('tr', {}, columns.concat(['']).map((label) => el('th', { text: label }))),
            ]),
            el(
              'tbody',
              {},
              sets.map((set) =>
                el('tr', {}, [
                  el('td', { text: set.name }),
                  el('td', { text: set.kind }),
                  el('td', { text: set.camera }),
                  el('td', { class: 'num', text: String(set.gain) }),
                  el('td', { class: 'num', text: String(set.offset) }),
                  el('td', { class: 'num', text: set.exposure_s === null ? '\u2014' : String(set.exposure_s) }),
                  el('td', { class: 'num', text: String(set.temperature_c) }),
                  el('td', { class: 'num', text: String(set.binning) }),
                  el('td', { text: set.filter || '\u2014' }),
                  el('td', { class: 'num', text: String(set.age_days) }),
                  stateCell(set),
                  el('td', {}, [el('div', { class: 'dialog-actions' }, actionsFor(set))]),
                ]),
              ),
            ),
          ]),
        ]),
      );
    } else {
      holder.append(
        el(
          'ul',
          { class: 'session-list', 'aria-label': 'Calibration library' },
          sets.map((set) =>
            el('li', { class: 'card' }, [
              el('strong', { text: set.name }),
              el('p', {
                class: 'muted num',
                text:
                  `${set.kind} \u00b7 ${set.camera} \u00b7 gain ${set.gain} \u00b7 ` +
                  `offset ${set.offset} \u00b7 ${
                    set.exposure_s === null ? 'no exposure' : `${set.exposure_s} s`
                  } \u00b7 ${set.temperature_c} C \u00b7 bin ${set.binning} \u00b7 ` +
                  `${set.filter || 'no filter'} \u00b7 ${set.age_days} days`,
              }),
              set.status === 'stale'
                ? el('p', { text: 'Stale', 'aria-description': staleWarningFor(set.max_age_days) })
                : el('p', { text: set.status }),
              el('div', { class: 'dialog-actions' }, actionsFor(set)),
            ]),
          ),
        ),
      );
    }
  }

  async function transition(set, to, message) {
    try {
      await api('POST', `/api/calibration-sets/${set.id}/transition`, { to });
      await paint();
      announce(updates, message);
    } catch (error) {
      announce(updates, error.message);
    }
  }

  uploadPicker.addEventListener('change', async () => {
    const file = uploadPicker.files[0];
    uploadPicker.value = '';
    if (!file || !uploadTarget) return;
    const set = uploadTarget;
    try {
      await upload(
        `/api/calibration-sets/${set.id}/master?filename=${encodeURIComponent(file.name)}`,
        file,
        () => {},
      );
      await paint();
      announce(updates, `Master stored for ${set.name}.`);
    } catch (error) {
      announce(updates, error.message);
    }
  });

  newSet.addEventListener('click', () => {
    const fields = setFieldSet({}, { withKind: true });
    const summary = el('div', {
      role: 'alert',
      'aria-label': 'Error summary',
      class: 'error-summary',
      hidden: true,
    });
    const dialog = openDialog({
      name: 'New calibration set',
      body: [
        el('h2', { text: 'New calibration set' }),
        summary,
        fields.grid,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Add set',
            onclick: async () => {
              clear(summary);
              summary.hidden = true;
              const values = fields.read();
              try {
                const created = await api('POST', '/api/calibration-sets', values);
                close(dialog);
                await paint();
                announce(updates, `${created.name} added to the library.`);
              } catch (error) {
                summary.hidden = false;
                summary.append(el('p', { text: error.message }));
                if (error.fields) {
                  summary.append(
                    el(
                      'ul',
                      {},
                      Object.entries(error.fields).map(([name, message]) =>
                        el('li', { text: `${name}: ${message}` }),
                      ),
                    ),
                  );
                }
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  });

  function openEdit(set) {
    const fields = setFieldSet(set, { withKind: false });
    const error = el('p', { class: 'field-error' });
    const dialog = openDialog({
      name: 'Edit calibration set',
      body: [
        el('h2', { text: 'Edit calibration set' }),
        fields.grid,
        error,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Save set',
            onclick: async () => {
              try {
                await api('PATCH', `/api/calibration-sets/${set.id}`, fields.read());
                close(dialog);
                await paint();
              } catch (failure) {
                error.textContent = failure.message;
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  }

  async function openHistory(set) {
    const { versions } = await api('GET', `/api/calibration-sets/${set.id}/versions`);
    const dialog = openDialog({
      name: 'Version history',
      body: [
        el('h2', { text: 'Version history' }),
        el(
          'div',
          { class: 'stack' },
          versions.map((version) =>
            el('div', { class: 'batch-block' }, [
              el('p', {
                class: 'num',
                text:
                  `Version ${version.version} \u00b7 ${version.name} \u00b7 ` +
                  `${version.temperature_c} C \u00b7 ${
                    version.master ? version.master.filename : 'no master'
                  }`,
              }),
              version.version === set.version
                ? null
                : el('button', {
                    type: 'button',
                    text: `Restore version ${version.version}`,
                    onclick: async () => {
                      try {
                        await api('POST', `/api/calibration-sets/${set.id}/restore`, {
                          version: version.version,
                        });
                        close(dialog);
                        await paint();
                        announce(
                          updates,
                          `${set.name} restored to version ${version.version}.`,
                        );
                      } catch (error) {
                        announce(updates, error.message);
                      }
                    },
                  }),
            ]),
          ),
        ),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', text: 'Close', onclick: () => close(dialog) }),
        ]),
      ],
    });
  }

  const resize = () => paint();
  window.addEventListener('resize', resize);
  await paint();
  return () => window.removeEventListener('resize', resize);
}
