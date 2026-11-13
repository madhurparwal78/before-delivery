import {
  localTimeLine,
  parseTimestamp,
  parseUtFieldValue,
  toUtFieldValue,
  withinObservationWindow,
} from '../../shared/clock.js';
import { FIELD_MESSAGES, FIELD_COPY, SAVE_COPY, savePending, savedOnDevice } from '../../shared/messages.js';
import { deriveFromKit, sortEyepieces } from '../../shared/optics.js';
import { serialiseStrokeFile } from '../../shared/strokes.js';
import type {
  CatalogueObject,
  Kit,
  Observation,
  ObservationFields,
  ObservingSession,
  Optics,
  SkyPoint,
} from '../../shared/types.js';
import { fetchBytes } from '../api.js';
import { missingScreen, workingScreen } from '../chrome.js';
import { viewObservation, viewSession, viewSessionObservations, viewStrokeFile } from '../derive.js';
import { el, labelledField, select, setStatus } from '../dom.js';
import { dropDraft, newObservationKey, readDraft, saveDraft } from '../drafts.js';
import { FieldRegion, type FieldSnapshot, type PairMarks } from '../field.js';
import { enqueue } from '../journal.js';
import { askToDeleteObservation } from '../observation-actions.js';
import { prefetchAccount } from '../prefetch.js';
import { announceSave, regions } from '../regions.js';
import { onLeaveScreen, replaceAddress, type ScreenContext } from '../router.js';
import { appState, subscribe } from '../state.js';
import { sendSoon } from '../sync.js';

const CONCENTRATION_OPTIONS = [
  'Not recorded',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

interface FormControls {
  object: HTMLSelectElement;
  observedAt: HTMLInputElement;
  seeing: HTMLInputElement;
  transparency: HTMLInputElement;
  concentration: HTMLSelectElement;
  description: HTMLTextAreaElement;
}

function readFormValues(controls: FormControls): Record<string, string> {
  return {
    object: controls.object.value,
    observed_at: controls.observedAt.value,
    seeing: controls.seeing.value,
    transparency: controls.transparency.value,
    concentration: controls.concentration.value,
    description: controls.description.value,
  };
}

function writeFormValues(controls: FormControls, values: Record<string, string>): void {
  if (values.object !== undefined) controls.object.value = values.object;
  if (values.observed_at !== undefined) controls.observedAt.value = values.observed_at;
  if (values.seeing !== undefined) controls.seeing.value = values.seeing;
  if (values.transparency !== undefined) controls.transparency.value = values.transparency;
  if (values.concentration !== undefined) controls.concentration.value = values.concentration;
  if (values.description !== undefined) controls.description.value = values.description;
}

export async function renderSession(context: ScreenContext): Promise<HTMLElement> {
  const sessionId = context.params.id ?? '';
  await prefetchAccount();
  const state = appState();
  const foundSession: ObservingSession | null = viewSession(sessionId);
  const foundKit = state.copy.kit;
  if (!foundSession || !foundKit) return missingScreen();
  const session: ObservingSession = foundSession;
  const kit: Kit = foundKit;

  const requestedObservation = context.query.get('observation');
  if (requestedObservation) {
    const found = viewObservation(requestedObservation);
    if (!found || found.session_id !== sessionId) return missingScreen();
  }

  const { root, content } = workingScreen(
    `Session ${session.evening_date} · ${session.site.name}`,
  );

  let openObservationId: string | null = requestedObservation;
  let optics: Optics = { ...(viewObservation(openObservationId ?? '')?.optics ?? session.optics) };
  let objects: CatalogueObject[] = state.copy.objects;
  let lastSavedMarks = '';
  let lastSavedPair: PairMarks = { primary: null, secondary: null };
  let restoringDraft = false;

  const objectPicker = select(
    'Object',
    objects.map((object) => ({ value: object.id, label: object.designation })),
    objects[0]?.id ?? null,
  );
  const observedAt = el('input', {
    class: 'input',
    attrs: {
      type: 'text',
      'aria-label': 'UT date and time',
      placeholder: 'YYYY-MM-DD HH:MM',
      autocomplete: 'off',
    },
  });
  const localTime = el('div', {
    class: 'status-line local-time',
    attrs: { role: 'status', 'aria-label': 'Local time', 'aria-live': 'polite' },
  });
  regions.localTime = localTime;
  const seeing = el('input', {
    class: 'input',
    attrs: { type: 'number', min: '1', max: '10', step: '1', 'aria-label': 'Seeing (1–10)' },
  });
  const transparency = el('input', {
    class: 'input',
    attrs: { type: 'text', 'aria-label': 'Transparency (limiting magnitude)', autocomplete: 'off' },
  });
  const concentration = select(
    'Concentration class',
    CONCENTRATION_OPTIONS.map((value) => ({
      value: value === 'Not recorded' ? '' : value,
      label: value,
    })),
    '',
  );
  const description = el('textarea', {
    class: 'input description',
    attrs: { 'aria-label': 'Description', rows: '5' },
  });
  const controls: FormControls = {
    object: objectPicker,
    observedAt,
    seeing,
    transparency,
    concentration,
    description,
  };

  const chosenObject = (): CatalogueObject | null =>
    objects.find((object) => object.id === objectPicker.value) ?? null;

  const field = new FieldRegion(
    deriveFromKit(kit, optics) ?? session.derived,
    {
      onEyepieceStep: (direction) => stepEyepiece(direction),
      onMarksChanged: () => void writeDraft(),
      isDoubleStar: () => chosenObject()?.kind === 'double_star',
      onClearRequest: (confirmed) => {
        import('../dialogs.js').then(({ openDialog }) => {
          openDialog({
            name: 'Clear sketch?',
            text: 'Clear every stroke and star from this sketch?',
            confirmLabel: 'Clear',
            cancelLabel: 'Keep sketch',
            opener: clearButton(),
            onConfirm: confirmed,
          });
        });
      },
    },
  );

  const clearButton = (): HTMLElement | null =>
    [...field.element.querySelectorAll<HTMLButtonElement>('button.tool')].find(
      (node) => node.textContent === 'Clear sketch',
    ) ?? null;

  // ---- optics pickers ----------------------------------------------------

  const telescopePicker = select(
    'Telescope',
    kit.telescopes.map((item) => ({ value: item.id, label: item.name })),
    optics.telescope_id,
  );
  const eyepieceOrder = sortEyepieces(kit.eyepieces);
  const eyepiecePicker = select(
    'Eyepiece',
    eyepieceOrder.map((item) => ({ value: item.id, label: item.name })),
    optics.eyepiece_id,
  );
  const barlowPicker = select(
    'Barlow',
    [{ value: '', label: 'No Barlow' }, ...kit.barlows.map((item) => ({ value: item.id, label: item.name }))],
    optics.barlow_id ?? '',
  );
  const trainPicker = select(
    'Train',
    kit.trains.map((item) => ({ value: item.id, label: item.name })),
    optics.train,
  );

  function paintPickers(): void {
    telescopePicker.value = optics.telescope_id;
    eyepiecePicker.value = optics.eyepiece_id;
    barlowPicker.value = optics.barlow_id ?? '';
    trainPicker.value = optics.train;
  }

  function queueOpticsChange(next: Optics): void {
    void (async () => {
      await enqueue(
        {
          client_op_id: crypto.randomUUID(),
          kind: 'session.optics',
          session_id: sessionId,
          optics: next,
        },
        { session_id: sessionId, evening_date: session.evening_date },
      );
      const openId = openObservationId;
      if (openId && viewObservation(openId)) {
        const observation = viewObservation(openId) as Observation;
        await enqueue(
          {
            client_op_id: crypto.randomUUID(),
            kind: 'observation.update',
            observation_id: openId,
            base_version: observation.version,
            edited_at: nowStamp(),
            fields: { optics: next },
          },
          {
            observation_id: openId,
            designation: observation.designation,
            evening_date: observation.evening_date,
          },
        );
      }
      sendSoon();
    })();
  }

  function applyOptics(next: Optics, options: { swap: boolean }): void {
    const derived = deriveFromKit(kit, next);
    if (!derived) return;
    optics = next;
    paintPickers();
    if (options.swap) {
      field.endStrokeForOpticsChange();
      field.applyPick(derived);
      queueOpticsChange(next);
    } else {
      field.setOpticsWithoutSwap(derived);
    }
  }

  function currentFromPickers(): Optics {
    return {
      telescope_id: telescopePicker.value,
      eyepiece_id: eyepiecePicker.value,
      barlow_id: barlowPicker.value === '' ? null : barlowPicker.value,
      train: trainPicker.value as Optics['train'],
    };
  }

  for (const picker of [telescopePicker, eyepiecePicker, barlowPicker, trainPicker]) {
    picker.addEventListener('change', () => applyOptics(currentFromPickers(), { swap: true }));
  }

  // On a phone on its side the circle sits beside the pickers, so focusing the
  // Eyepiece field brings the whole circle into the viewport.
  eyepiecePicker.addEventListener('focus', () => {
    if (window.innerHeight > 500) return;
    field.circle.scrollIntoView({ block: 'start', inline: 'nearest' });
  });

  function stepEyepiece(direction: 1 | -1): void {
    const index = eyepieceOrder.findIndex((item) => item.id === optics.eyepiece_id);
    const next = eyepieceOrder[index + direction];
    if (!next) {
      announceFieldEdge(direction);
      return;
    }
    applyOptics({ ...optics, eyepiece_id: next.id }, { swap: true });
  }

  function announceFieldEdge(direction: 1 | -1): void {
    setStatus(
      regions.fieldAnnouncements,
      direction === 1 ? FIELD_COPY.no_shorter : FIELD_COPY.no_longer,
    );
  }

  // ---- the form ----------------------------------------------------------

  function nowStamp(): string {
    return `${new Date().toISOString().slice(0, 19)}Z`;
  }

  function paintLocalTime(): void {
    const parsed = parseUtFieldValue(observedAt.value);
    setStatus(localTime, parsed ? localTimeLine(parsed, session.site.time_zone) : '');
  }

  function paintObjectDependent(): void {
    const object = chosenObject();
    concentration.parentElement?.classList.toggle('hidden', object?.kind !== 'globular');
    field.refreshForObjectKind();
  }

  observedAt.addEventListener('input', () => {
    paintLocalTime();
    void writeDraft();
  });
  objectPicker.addEventListener('change', () => {
    paintObjectDependent();
    void writeDraft();
  });
  for (const control of [seeing, transparency, concentration, description]) {
    control.addEventListener('input', () => void writeDraft());
    control.addEventListener('change', () => void writeDraft());
  }

  function draftSubject(): string {
    return openObservationId ?? newObservationKey(sessionId);
  }

  async function writeDraft(): Promise<void> {
    if (restoringDraft) return;
    await saveDraft(draftSubject(), readFormValues(controls), field.snapshot());
  }

  const errorsAlert = el('div', {
    class: 'fix-first hidden',
    attrs: { role: 'alert', 'aria-label': 'Fix these first' },
  });
  const saveStatus = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Save status', 'aria-live': 'polite' },
  });
  regions.saveStatus = saveStatus;

  interface Problem {
    message: string;
    control: HTMLElement;
  }

  function validate(): { problems: Problem[]; fields: ObservationFields } {
    const problems: Problem[] = [];
    const fields: ObservationFields = {};
    const object = chosenObject();
    if (!object) problems.push({ message: FIELD_MESSAGES.object_id, control: objectPicker });

    if (observedAt.value.trim() === '') fields.observed_at = null;
    else {
      const parsed = parseUtFieldValue(observedAt.value);
      const started = parseTimestamp(session.started_at);
      if (!parsed || !started || !withinObservationWindow(parsed, started)) {
        problems.push({ message: FIELD_MESSAGES.observed_at, control: observedAt });
      } else fields.observed_at = `${parsed.toISOString().slice(0, 19)}Z`;
    }

    if (seeing.value.trim() === '') fields.seeing = null;
    else {
      const value = Number(seeing.value);
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        problems.push({ message: FIELD_MESSAGES.seeing, control: seeing });
      } else fields.seeing = value;
    }

    if (transparency.value.trim() === '') fields.transparency_nelm = null;
    else {
      const value = Number(transparency.value);
      const oneDecimal = Math.round(value * 10) / 10;
      if (!Number.isFinite(value) || value < 1 || value > 8 || Math.abs(oneDecimal - value) > 1e-9) {
        problems.push({ message: FIELD_MESSAGES.transparency_nelm, control: transparency });
      } else fields.transparency_nelm = oneDecimal;
    }

    if (description.value.trim().length > 4000) {
      problems.push({ message: FIELD_MESSAGES.description, control: description });
    } else fields.description = description.value;

    if (object?.kind === 'globular') {
      fields.concentration_class = concentration.value === '' ? null : concentration.value;
    } else if (concentration.value !== '') {
      problems.push({ message: FIELD_MESSAGES.concentration_class, control: concentration });
    }

    const pair = field.pair();
    if (object?.kind === 'double_star') {
      fields.pair =
        pair.primary && pair.secondary
          ? { primary: pair.primary, secondary: pair.secondary }
          : null;
    }
    return { problems, fields };
  }

  function showProblems(problems: Problem[]): void {
    errorsAlert.replaceChildren(
      ...problems.map((problem) => {
        const anchor = el('a', {
          class: 'link',
          text: problem.message,
          attrs: { href: '#' },
          on: {
            click: (event) => {
              event.preventDefault();
              problem.control.focus();
            },
          },
        });
        return el('p', {}, [anchor]);
      }),
    );
    errorsAlert.classList.toggle('hidden', problems.length === 0);
    if (problems.length > 0) {
      errorsAlert.setAttribute('tabindex', '-1');
      errorsAlert.focus();
    }
  }

  const save = el('button', {
    class: 'button accent save',
    text: 'Save observation',
    attrs: { type: 'submit' },
  });
  const newObservation = el('button', {
    class: 'button',
    text: 'New observation',
    attrs: { type: 'button' },
  });

  async function doSave(): Promise<void> {
    const { problems, fields } = validate();
    if (problems.length > 0) {
      showProblems(problems);
      return;
    }
    showProblems([]);
    const object = chosenObject();
    if (!object) return;
    const onDevice = appState().offline;
    const editedAt = nowStamp();
    const strokeText = serialiseStrokeFile(field.strokeFile());
    const pair = field.pair();
    const pairChanged =
      JSON.stringify(pair) !== JSON.stringify(lastSavedPair) && object.kind === 'double_star';

    announceSave(savePending(object.designation));

    if (openObservationId === null) {
      const observationId = crypto.randomUUID();
      await enqueue(
        {
          client_op_id: crypto.randomUUID(),
          kind: 'observation.create',
          observation_id: observationId,
          session_id: sessionId,
          object_id: object.id,
          edited_at: editedAt,
          fields: { ...fields, optics },
        },
        {
          observation_id: observationId,
          designation: object.designation,
          evening_date: session.evening_date,
          origin: onDevice ? 'queued' : 'online_save',
        },
      );
      if (field.hasMarks()) {
        await enqueue(
          {
            client_op_id: crypto.randomUUID(),
            kind: 'sketch.put',
            observation_id: observationId,
            base_version: 1,
            edited_at: editedAt,
            strokes: strokeText,
            raster_png_base64: null,
          },
          {
            observation_id: observationId,
            designation: object.designation,
            evening_date: session.evening_date,
            origin: onDevice ? 'queued' : 'online_save',
          },
        );
      }
      await dropDraft(newObservationKey(sessionId));
      openObservationId = observationId;
      replaceAddress(`/sessions/${sessionId}?observation=${observationId}`);
    } else {
      const existing = viewObservation(openObservationId);
      if (!existing) return;
      const changed: ObservationFields = {};
      if ((fields.observed_at ?? null) !== (existing.observed_at ?? null)) {
        changed.observed_at = fields.observed_at ?? null;
      }
      if ((fields.seeing ?? null) !== (existing.seeing ?? null)) changed.seeing = fields.seeing ?? null;
      if ((fields.transparency_nelm ?? null) !== (existing.transparency_nelm ?? null)) {
        changed.transparency_nelm = fields.transparency_nelm ?? null;
      }
      if ((fields.concentration_class ?? null) !== (existing.concentration_class ?? null)) {
        changed.concentration_class = fields.concentration_class ?? null;
      }
      if ((fields.description ?? '') !== existing.description) {
        changed.description = fields.description ?? '';
      }
      if (pairChanged) changed.pair = fields.pair ?? null;

      if (Object.keys(changed).length > 0) {
        await enqueue(
          {
            client_op_id: crypto.randomUUID(),
            kind: 'observation.update',
            observation_id: openObservationId,
            base_version: existing.version,
            edited_at: editedAt,
            fields: changed,
          },
          {
            observation_id: openObservationId,
            designation: existing.designation,
            evening_date: existing.evening_date,
            origin: onDevice ? 'queued' : 'online_save',
          },
        );
      }
      // A sketch whose marks equal the last saved marks has not changed.
      if (strokeText !== lastSavedMarks) {
        await enqueue(
          {
            client_op_id: crypto.randomUUID(),
            kind: 'sketch.put',
            observation_id: openObservationId,
            base_version: existing.version,
            edited_at: editedAt,
            strokes: strokeText,
            raster_png_base64: null,
          },
          {
            observation_id: openObservationId,
            designation: existing.designation,
            evening_date: existing.evening_date,
            origin: onDevice ? 'queued' : 'online_save',
          },
        );
      }
      await dropDraft(openObservationId);
    }

    lastSavedMarks = strokeText;
    lastSavedPair = { ...pair };
    if (onDevice) announceSave(savedOnDevice(object.designation));
    sendSoon();
    paintList();
  }

  const form = el('form', { class: 'form observation-form' }, [
    labelledField('Object', objectPicker),
    el('div', { class: 'field-with-note' }, [
      labelledField('UT date and time', observedAt),
      localTime,
    ]),
    el('div', { class: 'field-pair' }, [
      labelledField('Seeing (1–10)', seeing),
      labelledField('Transparency (limiting magnitude)', transparency),
    ]),
    labelledField('Concentration class', concentration),
    labelledField('Description', description),
    errorsAlert,
    save,
    newObservation,
    saveStatus,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void doSave();
  });

  // ---- open and new ------------------------------------------------------

  async function loadObservation(observationId: string | null): Promise<void> {
    field.abandonSwap();
    openObservationId = observationId;
    restoringDraft = true;
    if (observationId === null) {
      objectPicker.value = objects[0]?.id ?? '';
      observedAt.value = '';
      seeing.value = '';
      transparency.value = '';
      concentration.value = '';
      description.value = '';
      lastSavedMarks = '';
      lastSavedPair = { primary: null, secondary: null };
      field.loadStrokeFile(null, { primary: null, secondary: null });
      applyOptics({ ...session.optics }, { swap: false });
      replaceAddress(`/sessions/${sessionId}`);
    } else {
      const observation = viewObservation(observationId);
      if (!observation) return;
      objectPicker.value = observation.object_id;
      observedAt.value = observation.observed_at ? toUtFieldValue(observation.observed_at) : '';
      seeing.value = observation.seeing === null ? '' : String(observation.seeing);
      transparency.value =
        observation.transparency_nelm === null ? '' : observation.transparency_nelm.toFixed(1);
      concentration.value = observation.concentration_class ?? '';
      description.value = observation.description;
      const pair: PairMarks = observation.pair
        ? {
            primary: observation.pair.primary as SkyPoint,
            secondary: observation.pair.secondary as SkyPoint,
          }
        : { primary: null, secondary: null };
      lastSavedPair = { ...pair };
      const stored = viewStrokeFile(observationId);
      if (stored === null && observation.sketch !== null) {
        const fetched = await fetchBytes(`/api/observations/${observationId}/strokes`);
        if (fetched.status === 503) {
          field.setReadable(false);
          field.loadStrokeFile(null, pair);
        } else {
          field.setReadable(true);
          field.loadStrokeFile(viewStrokeFile(observationId), pair);
        }
      } else {
        field.setReadable(true);
        field.loadStrokeFile(stored, pair);
      }
      lastSavedMarks = serialiseStrokeFile(field.strokeFile());
      applyOptics({ ...observation.optics }, { swap: false });
      replaceAddress(`/sessions/${sessionId}?observation=${observationId}`);
    }
    paintObjectDependent();
    paintLocalTime();

    const draft = await readDraft(draftSubject());
    if (draft) {
      writeFormValues(controls, draft.fields);
      if (draft.snapshot) field.restore(draft.snapshot as FieldSnapshot);
      paintObjectDependent();
      paintLocalTime();
      announceSave(SAVE_COPY.restored);
    }
    restoringDraft = false;
  }

  newObservation.addEventListener('click', () => {
    void (async () => {
      if (openObservationId === null) await dropDraft(newObservationKey(sessionId));
      await loadObservation(null);
    })();
  });

  // ---- the session list --------------------------------------------------

  const list = el('ul', { class: 'list', attrs: { 'aria-label': 'This session' } });

  function paintList(): void {
    const rows = viewSessionObservations(sessionId);
    list.replaceChildren(
      ...rows.map((observation, index) => {
        const open = el('button', {
          class: 'button row-button open',
          text: `Open ${observation.designation}`,
          attrs: { type: 'button' },
        });
        open.addEventListener('click', () => void loadObservation(observation.id));
        const remove = el('button', {
          class: 'button row-button',
          text: `Delete ${observation.designation}`,
          attrs: { type: 'button' },
        });
        remove.addEventListener('click', () =>
          askToDeleteObservation({
            observation,
            opener: remove,
            afterQueued: () => {
              if (openObservationId === observation.id) void loadObservation(null);
              paintList();
              const buttons = [...list.querySelectorAll<HTMLElement>('button.open')];
              const target = buttons[index] ?? buttons[index - 1];
              (target ?? newObservation).focus();
            },
          }),
        );
        return el('li', { class: 'row' }, [
          el('span', { class: 'row-name', text: observation.designation }),
          el('span', {
            class: 'row-detail',
            text:
              observation.local_time && observation.local_offset
                ? `${observation.local_time} local, UTC${observation.local_offset}`
                : observation.evening_date,
          }),
          el('div', { class: 'row-actions' }, [open, remove]),
        ]);
      }),
    );
  }

  content.append(
    field.element,
    el('div', { class: 'pickers' }, [
      labelledField('Telescope', telescopePicker),
      labelledField('Eyepiece', eyepiecePicker),
      labelledField('Barlow', barlowPicker),
      labelledField('Train', trainPicker),
    ]),
    form,
    list,
  );

  paintList();
  const unsubscribe = subscribe(paintList);
  onLeaveScreen(() => {
    unsubscribe();
    field.abandonSwap();
    field.destroy();
  });

  void loadObservation(openObservationId);
  return root;
}
