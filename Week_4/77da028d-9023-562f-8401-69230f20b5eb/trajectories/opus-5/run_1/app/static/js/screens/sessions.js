import { api, upload } from '../api.js';
import { announce, clear, el, spinbutton, textbox } from '../dom.js';
import { staleWarningFor } from '../copy.js';
import { close, isOpen, openDialog } from '../dialog.js';
import { duration, siteStamp } from '../format.js';
import { paintSkyDisc } from '../skychart.js';

const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'];
const LOCK_EXPIRED =
  'Your edit lock expired. Your notes are kept; save to take the lock again.';
const HELD_ELSEWHERE = 'This session is open for editing on another device.';
const TABLE_WIDTH = 768;

function batchFieldSet(values = {}) {
  const controls = {
    filter: el(
      'select',
      { 'aria-label': 'Filter' },
      FILTERS.map((name) =>
        el('option', { value: name, text: name, selected: values.filter === name }),
      ),
    ),
    sub_count: spinbutton('Subs', {
      min: '1',
      max: '10000',
      value: String(values.sub_count ?? 30),
    }),
    exposure_s: spinbutton('Sub exposure (s)', {
      min: '1',
      max: '3600',
      value: String(values.exposure_s ?? 300),
    }),
    gain: spinbutton('Gain', { min: '0', max: '1000', value: String(values.gain ?? 100) }),
    offset: spinbutton('Offset', {
      min: '0',
      max: '1000',
      value: String(values.offset ?? 50),
    }),
    temperature_c: spinbutton('Sensor temperature (C)', {
      min: '-40',
      max: '40',
      step: '0.1',
      value: String(values.temperature_c ?? -10),
    }),
    binning: spinbutton('Binning', {
      min: '1',
      max: '4',
      value: String(values.binning ?? 1),
    }),
    camera: textbox('Camera', { value: values.camera ?? '' }),
  };
  const labels = {
    filter: 'Filter',
    sub_count: 'Subs',
    exposure_s: 'Sub exposure (s)',
    gain: 'Gain',
    offset: 'Offset',
    temperature_c: 'Sensor temperature (C)',
    binning: 'Binning',
    camera: 'Camera',
  };
  const grid = el(
    'div',
    { class: 'grid' },
    Object.keys(controls).map((key) => {
      const id = `bf-${key}-${Math.random().toString(36).slice(2, 8)}`;
      controls[key].id = id;
      return el('div', { class: 'field' }, [
        el('label', { for: id, text: labels[key] }),
        controls[key],
      ]);
    }),
  );
  const read = () => ({
    filter: controls.filter.value,
    sub_count: Number(controls.sub_count.value),
    exposure_s: Number(controls.exposure_s.value),
    camera: controls.camera.value.trim(),
    gain: Number(controls.gain.value),
    offset: Number(controls.offset.value),
    temperature_c: Number(controls.temperature_c.value),
    binning: Number(controls.binning.value),
  });
  return { grid, read };
}

export async function renderSessions(main, context) {
  const site = await api('GET', '/api/site');
  const listHolder = el('div', {});
  const showTrashed = el('input', { type: 'checkbox', id: 'show-trashed' });
  const newSession = el('button', {
    type: 'button',
    class: 'pill',
    text: 'New session',
  });

  main.append(
    el('div', { class: 'stack' }, [
      el('h1', { text: 'Sessions' }),
      context.card,
      el('div', { class: 'dialog-actions' }, [
        newSession,
        el('label', { for: 'show-trashed' }, [showTrashed, ' Show trashed']),
      ]),
      listHolder,
    ]),
  );
  showTrashed.setAttribute('aria-label', 'Show trashed');

  async function paint() {
    const query = showTrashed.checked ? '?include_trashed=true' : '';
    const { sessions } = await api('GET', `/api/sessions${query}`);
    clear(listHolder);
    const asTable = window.innerWidth >= TABLE_WIDTH;
    if (!sessions.length) {
      const disc = el('canvas', { role: 'img', 'aria-label': 'Sky disc' });
      listHolder.append(
        el('div', { class: 'hero-empty' }, [
          disc,
          el('p', { text: 'No sessions logged yet. Start one with New session.' }),
        ]),
      );
      requestAnimationFrame(() => paintSkyDisc(disc, null));
      return;
    }
    const openButton = (session) =>
      el('button', {
        type: 'button',
        text: 'Open',
        'aria-label':
          `Open session ${session.observing_date} ${session.project_name}`,
        onclick: () => openEditor(session.id),
      });
    if (asTable) {
      listHolder.append(
        el('div', { class: 'table-sheet' }, [
          el('table', { 'aria-label': 'Sessions' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Observing date' }),
                el('th', { text: 'Project' }),
                el('th', { text: 'State' }),
                el('th', { text: 'Integration' }),
                el('th', { text: 'Frames' }),
                el('th', { text: '' }),
              ]),
            ]),
            el(
              'tbody',
              {},
              sessions.map((session) =>
                el('tr', {}, [
                  el('td', { class: 'num', text: session.observing_date }),
                  el('td', { text: session.project_name }),
                  el('td', { text: session.state }),
                  el('td', { class: 'num', text: duration(session.integration_seconds) }),
                  el('td', { class: 'num', text: String(session.frame_count) }),
                  el('td', {}, [openButton(session)]),
                ]),
              ),
            ),
          ]),
        ]),
      );
    } else {
      listHolder.append(
        el(
          'ul',
          { class: 'session-list', 'aria-label': 'Sessions' },
          sessions.map((session) =>
            el('li', { class: 'card' }, [
              el('strong', { class: 'num', text: session.observing_date }),
              el('p', { class: 'muted', text: `${session.project_name} \u00b7 ${session.state}` }),
              el('p', {
                class: 'num',
                text: `${duration(session.integration_seconds)} \u00b7 ${session.frame_count} frames`,
              }),
              openButton(session),
            ]),
          ),
        ),
      );
    }
  }

  showTrashed.addEventListener('change', paint);

  newSession.addEventListener('click', async () => {
    const { projects } = await api('GET', '/api/projects');
    const active = projects.filter((project) => project.state === 'active');
    const picker = el(
      'select',
      { 'aria-label': 'Project', id: 'ns-project' },
      active.map((project) =>
        el('option', { value: project.id, text: project.name }),
      ),
    );
    const dateBox = textbox('Observing date', {
      id: 'ns-date',
      placeholder: 'YYYY-MM-DD',
      value: siteStamp(new Date().toISOString(), site.time_zone).slice(0, 10),
    });
    const error = el('p', { class: 'field-error' });
    const dialog = openDialog({
      name: 'New session',
      body: [
        el('h2', { text: 'New session' }),
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'field' }, [
            el('label', { for: 'ns-project', text: 'Project' }),
            picker,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'ns-date', text: 'Observing date' }),
            dateBox,
          ]),
        ]),
        error,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Create session',
            onclick: async () => {
              try {
                const created = await api('POST', '/api/sessions', {
                  project_id: picker.value,
                  observing_date: dateBox.value.trim(),
                  notes: '',
                });
                close(dialog);
                await paint();
                openEditor(created.id, `Session created for ${created.observing_date}.`);
              } catch (failure) {
                error.textContent = failure.message;
              }
            },
          }),
          el('button', { type: 'button', text: 'Cancel', onclick: () => close(dialog) }),
        ]),
      ],
    });
  });

  // --- the session editor --------------------------------------------------

  async function openEditor(sessionId, firstMessage) {
    let session = await api('GET', `/api/sessions/${sessionId}`);
    let lockToken = null;

    const notes = el('textarea', {
      'aria-label': 'Session notes',
      id: 'se-notes',
    });
    notes.value = session.notes;
    const startedAt = textbox('Started at', {
      id: 'se-started',
      placeholder: 'YYYY-MM-DD HH:MM',
      value: session.started_at ? siteStamp(session.started_at, site.time_zone) : '',
    });
    const log = el('div', { role: 'status', 'aria-label': 'Session log' });
    const progress = el('div', { role: 'status', 'aria-label': 'Upload progress' });
    const actions = el('div', { class: 'dialog-actions' });
    const batchList = el('div', { class: 'stack' });
    const summary = el('p', { class: 'muted num' });
    const filePicker = el('input', {
      type: 'file',
      multiple: true,
      'aria-label': 'Frame files',
      style: 'display:none',
    });

    async function takeLock() {
      try {
        const lock = await api('POST', `/api/sessions/${sessionId}/lock`, {
          lock_token: lockToken,
        });
        lockToken = lock.lock_token;
        return true;
      } catch (error) {
        announce(log, error.code === 'session_locked' ? HELD_ELSEWHERE : error.message);
        return false;
      }
    }

    async function saveNotes() {
      const text = notes.value;
      try {
        session = await api('PATCH', `/api/sessions/${sessionId}/notes`, {
          notes: text,
          lock_token: lockToken || '',
        });
        announce(log, 'Notes saved.');
      } catch (error) {
        if (error.code === 'lock_expired') {
          announce(log, LOCK_EXPIRED);
          if (await takeLock()) {
            try {
              session = await api('PATCH', `/api/sessions/${sessionId}/notes`, {
                notes: text,
                lock_token: lockToken,
              });
              announce(log, 'Notes saved.');
              return;
            } catch (retry) {
              announce(log, retry.message);
            }
          }
        } else if (error.code === 'session_locked') {
          announce(log, HELD_ELSEWHERE);
        } else {
          announce(log, error.message);
        }
      }
    }

    async function reload() {
      session = await api('GET', `/api/sessions/${sessionId}`);
      paintEditor();
      await paint();
    }

    function act(label, run) {
      return el('button', {
        type: 'button',
        text: label,
        onclick: async () => {
          try {
            await run();
          } catch (error) {
            announce(log, error.message);
          }
        },
      });
    }

    function paintActions() {
      clear(actions);
      const state = session.state;
      if (state === 'planned') {
        actions.append(
          act('Start imaging', async () => {
            const raw = startedAt.value.trim();
            session = await api('POST', `/api/sessions/${sessionId}/start`, {
              started_at: raw ? new Date(`${raw.replace(' ', 'T')}:00`).toISOString() : null,
            });
            paintEditor();
            await paint();
            announce(log, `Imaging started. Night of ${session.observing_date}.`);
          }),
        );
      }
      if (state === 'imaging') {
        actions.append(
          act('Log batch', () => openLogBatch()),
          act('Finish and log', async () => {
            session = await api('POST', `/api/sessions/${sessionId}/log`, {});
            paintEditor();
            await paint();
            announce(
              log,
              `Session logged: ${duration(session.integration_seconds)} integrated.`,
            );
          }),
        );
      }
      if (state === 'logged' || state === 'amended') {
        actions.append(act('Amend', () => openAmend()));
      }
      if (state !== 'trashed' && state !== 'planned') {
        actions.append(
          act('Upload frames', () => {
            filePicker.click();
          }),
        );
      }
      if (state !== 'trashed') {
        actions.append(
          act('Trash session', async () => {
            session = await api('POST', `/api/sessions/${sessionId}/trash`, {});
            paintEditor();
            await paint();
            announce(log, 'Session moved to trash.');
          }),
        );
      } else {
        actions.append(
          act('Restore session', async () => {
            session = await api('POST', `/api/sessions/${sessionId}/restore`, {});
            paintEditor();
            await paint();
            announce(log, 'Session restored.');
          }),
        );
      }
      actions.append(
        el('button', { type: 'button', text: 'Save notes', onclick: saveNotes }),
        el('button', { type: 'button', text: 'Close', onclick: () => close(dialog) }),
      );
    }

    function paintBatches() {
      clear(batchList);
      session.batches.forEach((batch, index) => {
        batchList.append(
          el('div', { class: 'batch-block' }, [
            el('p', {
              class: 'num',
              text:
                `${batch.filter}: ${batch.sub_count} subs of ${batch.exposure_s} s ` +
                `(${duration(batch.integration_seconds)}), ${batch.frame_count} frames`,
            }),
            el('p', {
              class: 'muted num',
              text:
                `${batch.camera} gain ${batch.gain} offset ${batch.offset} ` +
                `${batch.temperature_c} C bin ${batch.binning}`,
            }),
            el('button', {
              type: 'button',
              text: `Calibrate ${batch.filter} batch ${index + 1}`,
              onclick: () => openCalibration(batch),
            }),
          ]),
        );
      });
      summary.textContent =
        `${session.state} \u00b7 ${session.observing_date} \u00b7 ` +
        `${duration(session.integration_seconds)} \u00b7 ${session.frame_count} frames`;
    }

    function paintEditor() {
      paintActions();
      paintBatches();
    }

    function openLogBatch() {
      const fields = batchFieldSet({ camera: 'Umbra 26M' });
      const error = el('p', { class: 'field-error' });
      let busy = false;
      const key = `batch-${sessionId}-${Date.now()}`;
      const inner = openDialog({
        name: 'Log batch',
        body: [
          el('h2', { text: 'Log batch' }),
          fields.grid,
          error,
          el('div', { class: 'dialog-actions' }, [
            el('button', {
              type: 'button',
              class: 'pill',
              text: 'Add batch',
              onclick: async (event) => {
                if (busy) return;
                busy = true;
                event.target.disabled = true;
                const values = fields.read();
                try {
                  const reply = await api(
                    'POST',
                    `/api/sessions/${sessionId}/batches`,
                    values,
                    { headers: { 'Idempotency-Key': key } },
                  );
                  session = reply.session;
                  close(inner);
                  paintEditor();
                  await paint();
                  announce(
                    log,
                    `${values.sub_count} subs of ${values.exposure_s} s in ` +
                      `${values.filter} added.`,
                  );
                } catch (failure) {
                  error.textContent = failure.message;
                  announce(log, failure.message);
                  busy = false;
                  event.target.disabled = false;
                }
              },
            }),
            el('button', { type: 'button', text: 'Cancel', onclick: () => close(inner) }),
          ]),
        ],
      });
    }

    function openAmend() {
      const blocks = [];
      const holder = el('div', {});
      const error = el('p', { class: 'field-error' });

      function addBlock(batch) {
        const fields = batchFieldSet(batch || { camera: 'Umbra 26M' });
        const index = blocks.length + 1;
        const entry = { fields, id: batch ? batch.id : null, removed: false };
        const block = el('div', { class: 'batch-block' }, [
          fields.grid,
          el('button', {
            type: 'button',
            text: `Remove batch ${index}`,
            onclick: () => {
              entry.removed = true;
              block.remove();
            },
          }),
        ]);
        blocks.push(entry);
        holder.append(block);
      }

      session.batches.forEach((batch) => addBlock(batch));
      const inner = openDialog({
        name: 'Amend session',
        body: [
          el('h2', { text: 'Amend session' }),
          holder,
          error,
          el('div', { class: 'dialog-actions' }, [
            el('button', {
              type: 'button',
              text: 'Add another batch',
              onclick: () => addBlock(null),
            }),
            el('button', {
              type: 'button',
              class: 'pill',
              text: 'Save amendment',
              onclick: async () => {
                try {
                  session = await api('POST', `/api/sessions/${sessionId}/amend`, {
                    batches: blocks
                      .filter((entry) => !entry.removed)
                      .map((entry) => ({
                        ...(entry.id ? { id: entry.id } : {}),
                        ...entry.fields.read(),
                      })),
                  });
                  close(inner);
                  paintEditor();
                  await paint();
                  announce(log, 'Session amended.');
                } catch (failure) {
                  error.textContent = failure.message;
                  announce(log, failure.message);
                }
              },
            }),
            el('button', { type: 'button', text: 'Cancel', onclick: () => close(inner) }),
          ]),
        ],
      });
    }

    async function openCalibration(batch) {
      const { candidates } = await api(
        'GET',
        `/api/batches/${batch.id}/calibration-candidates`,
      );
      const result = el('div', { role: 'status', 'aria-label': 'Calibration result' });
      const inner = openDialog({
        name: 'Choose calibration',
        body: [
          el('h2', { text: 'Choose calibration' }),
          el(
            'div',
            { class: 'stack' },
            candidates.map((candidate) =>
              el('div', { class: 'batch-block' }, [
                el('p', {}, [
                  el('strong', { text: candidate.name }),
                  el('span', {
                    class: 'muted',
                    text: ` ${candidate.kind} \u00b7 ${candidate.status}`,
                  }),
                ]),
                candidate.reasons.length
                  ? el('p', { class: 'muted', text: candidate.reasons.join('; ') })
                  : null,
                el('button', {
                  type: 'button',
                  text: `Use ${candidate.name}`,
                  onclick: async () => {
                    try {
                      const reply = await api(
                        'POST',
                        `/api/batches/${batch.id}/calibration`,
                        { calibration_set_id: candidate.calibration_set_id },
                      );
                      result.textContent = reply.warning
                        ? await staleWarning(candidate.calibration_set_id)
                        : `${candidate.name} will calibrate this batch.`;
                      await reload();
                    } catch (failure) {
                      result.textContent = failure.message;
                    }
                  },
                }),
              ]),
            ),
          ),
          result,
          el('div', { class: 'dialog-actions' }, [
            el('button', { type: 'button', text: 'Close', onclick: () => close(inner) }),
          ]),
        ],
      });
    }

    async function staleWarning(setId) {
      const set = await api('GET', `/api/calibration-sets/${setId}`);
      return staleWarningFor(set.max_age_days);
    }

    filePicker.addEventListener('change', async () => {
      const files = [...filePicker.files];
      filePicker.value = '';
      const batch = session.batches[session.batches.length - 1];
      if (!batch) {
        announce(progress, 'Add a batch before uploading frames.');
        return;
      }
      for (const file of files) {
        let lastAnnounced = -1;
        try {
          const reply = await upload(
            `/api/batches/${batch.id}/frames/${encodeURIComponent(file.name)}`,
            file,
            (percent) => {
              if (percent === 0 || percent === 100 || percent - lastAnnounced >= 25) {
                lastAnnounced = percent;
                announce(progress, `Uploading ${file.name}: ${percent}%`);
              }
            },
          );
          announce(
            progress,
            `${file.name} stored. ${reply.session_frame_count} frames in this session.`,
          );
          await reload();
        } catch (error) {
          announce(progress, `${file.name} was not stored: ${error.message}`);
        }
      }
    });

    const dialog = openDialog({
      name: 'Session editor',
      body: [
        el('h2', { text: 'Session editor' }),
        summary,
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'field' }, [
            el('label', { for: 'se-started', text: 'Started at' }),
            startedAt,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'se-notes', text: 'Session notes' }),
            notes,
          ]),
        ]),
        actions,
        batchList,
        log,
        progress,
        filePicker,
      ],
      onClose: async () => {
        if (lockToken) {
          await api('DELETE', `/api/sessions/${sessionId}/lock`, {
            lock_token: lockToken,
          }).catch(() => null);
        }
      },
    });

    paintEditor();
    await takeLock();
    if (firstMessage) announce(log, firstMessage);
  }

  const shortcut = (event) => {
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (isOpen('Session editor') || isOpen('New session')) return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      newSession.click();
    }
  };
  document.addEventListener('keydown', shortcut);
  const resize = () => paint();
  window.addEventListener('resize', resize);

  await paint();
  return () => {
    document.removeEventListener('keydown', shortcut);
    window.removeEventListener('resize', resize);
  };
}
