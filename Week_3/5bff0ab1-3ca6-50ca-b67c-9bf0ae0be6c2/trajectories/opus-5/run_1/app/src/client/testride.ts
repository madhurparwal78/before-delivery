import { HUBS, MODELS, type HubId, type ModelId } from '../shared/catalogue.js';
import { COPY, FIELD_TEXT, STATUS } from '../shared/strings.js';
import { isSlotParam } from '../shared/urlstate.js';
import type { Ride, SlotView } from '../shared/types.js';
import {
  announce,
  ApiError,
  apiGet,
  apiPost,
  currentSelection,
  identityChanged,
  liveArrived,
  mineChanged,
  setSelection,
  user,
} from './core.js';
import { CellGrid } from './grid.js';
import { openSignIn } from './signin.js';

interface DaysReply {
  days: { date: string; dayLabel: string }[];
}

interface SlotsReply {
  date: string;
  dayLabel: string;
  open: boolean;
  slots: SlotView[];
}

let grid: CellGrid | null = null;
let hub: HubId = 'pune';
let model: ModelId = 'megh-349';
let date = '';
let days: DaysReply['days'] = [];
let slots: SlotView[] = [];
let rides: Ride[] = [];
let token = 0;

const fields = {
  licence: null as HTMLInputElement | null,
  validUntil: null as HTMLInputElement | null,
  mcwg: null as HTMLInputElement | null,
};

let daySelect: HTMLSelectElement | null = null;
let hubSelect: HTMLSelectElement | null = null;
let emptyNote: HTMLElement | null = null;
let nextDayButton: HTMLButtonElement | null = null;
let bookButton: HTMLButtonElement | null = null;
let moveButton: HTMLButtonElement | null = null;
let cancelButton: HTMLButtonElement | null = null;

export function startTestRide(): void {
  const params = new URLSearchParams(window.location.search);
  const selection = currentSelection();
  hub = (HUBS.find((entry) => entry.id === params.get('hub'))?.id ?? selection.hub) as HubId;
  model = (MODELS.find((entry) => entry.id === params.get('model'))?.id ?? selection.model) as ModelId;
  date = params.get('date') ?? '';
  setSelection({ hub, model, finish: selection.finish });
  build();
  void load(params.get('slot'));
  liveArrived.on(() => {
    void refreshSlots();
  });
  mineChanged.on(() => {
    void refreshRides();
  });
  identityChanged.on(() => {
    if (fields.licence) fields.licence.value = '';
    if (fields.validUntil) fields.validUntil.value = '';
    if (fields.mcwg) fields.mcwg.checked = false;
    void refreshRides();
  });
}

function build(): void {
  const host = document.querySelector<HTMLElement>('[data-test-ride]');
  if (!host) return;
  const top = document.createElement('div');
  top.className = 'fields';

  const hubLabel = document.createElement('label');
  const hubSpan = document.createElement('span');
  hubSpan.textContent = 'Hub city';
  hubSelect = document.createElement('select');
  hubSelect.setAttribute('aria-label', 'Hub city');
  for (const entry of HUBS) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.name;
    option.selected = entry.id === hub;
    hubSelect.append(option);
  }
  hubSelect.addEventListener('change', () => {
    hub = hubSelect?.value as HubId;
    setSelection({ ...currentSelection(), hub });
    date = '';
    void load(null);
  });
  hubLabel.append(hubSpan, hubSelect);

  const modelSet = document.createElement('fieldset');
  modelSet.className = 'radios';
  modelSet.setAttribute('role', 'radiogroup');
  modelSet.setAttribute('aria-label', 'Model');
  for (const entry of MODELS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'ride-model';
    input.value = entry.id;
    input.checked = entry.id === model;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      model = entry.id;
      setSelection({ ...currentSelection(), model });
      writeUrl();
      void refreshRides();
      paintActions();
    });
    const span = document.createElement('span');
    span.textContent = entry.name;
    label.append(input, span);
    modelSet.append(label);
  }

  const dayLabel = document.createElement('label');
  const daySpan = document.createElement('span');
  daySpan.textContent = 'Ride day';
  daySelect = document.createElement('select');
  daySelect.setAttribute('aria-label', 'Ride day');
  daySelect.addEventListener('change', () => {
    date = daySelect?.value ?? date;
    grid?.set(null);
    writeUrl();
    void refreshSlots();
  });
  dayLabel.append(daySpan, daySelect);

  top.append(hubLabel, modelSet, dayLabel);

  const gridHost = document.createElement('div');
  grid = new CellGrid(gridHost, 'Test-ride slots', () => {
    writeUrl();
    paintActions();
  });

  emptyNote = document.createElement('p');
  emptyNote.className = 'statement';
  emptyNote.hidden = true;
  emptyNote.textContent = COPY.dayFullEmpty;
  nextDayButton = document.createElement('button');
  nextDayButton.type = 'button';
  nextDayButton.textContent = COPY.tryNextDay;
  nextDayButton.hidden = true;
  nextDayButton.addEventListener('click', () => {
    const index = days.findIndex((day) => day.date === date);
    const next = days[index + 1];
    if (!next) return;
    date = next.date;
    if (daySelect) daySelect.value = date;
    writeUrl();
    void refreshSlots();
  });

  const licenceFields = document.createElement('div');
  licenceFields.className = 'fields';
  const licence = textField('Licence number', FIELD_TEXT.licenceNumber);
  const validUntil = textField('Licence valid until', FIELD_TEXT.licenceDate);
  fields.licence = licence.input;
  fields.validUntil = validUntil.input;
  const mcwgLabel = document.createElement('label');
  const mcwgInput = document.createElement('input');
  mcwgInput.type = 'checkbox';
  const mcwgText = document.createElement('span');
  mcwgText.textContent = 'My licence covers motorcycles with gear (MCWG)';
  mcwgLabel.append(mcwgInput, mcwgText);
  const mcwgNote = document.createElement('p');
  mcwgNote.className = 'field-note';
  mcwgNote.textContent = FIELD_TEXT.mcwg;
  fields.mcwg = mcwgInput;
  licenceFields.append(licence.wrap, validUntil.wrap, mcwgLabel, mcwgNote);

  const actions = document.createElement('div');
  actions.className = 'band-actions';
  bookButton = action('Book this ride', () => void book());
  moveButton = action('Move this ride', () => void move());
  cancelButton = action('Cancel this ride', () => void cancel());
  bookButton.classList.add('primary');
  actions.append(bookButton, moveButton, cancelButton);

  host.replaceChildren(top, gridHost, emptyNote, nextDayButton, licenceFields, actions);
}

function action(text: string, onPress: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', onPress);
  return button;
}

function textField(
  label: string,
  note: string,
): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement('div');
  const field = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('aria-label', label);
  field.append(span, input);
  const hint = document.createElement('p');
  hint.className = 'field-note';
  hint.textContent = note;
  wrap.append(field, hint);
  return { wrap, input };
}

function writeUrl(): void {
  const params = new URLSearchParams();
  params.set('hub', hub);
  params.set('model', model);
  if (date) params.set('date', date);
  const chosen = grid?.chosen();
  if (chosen) params.set('slot', chosen.slice(11, 16));
  window.history.replaceState(window.history.state, '', `/test-ride?${params.toString()}`);
}

async function load(slotParam: string | null): Promise<void> {
  const mine = (token += 1);
  try {
    const reply = await apiGet<DaysReply>(`/api/hubs/${hub}/ride-days`);
    if (mine !== token) return;
    days = reply.days;
  } catch {
    return;
  }
  if (!days.some((day) => day.date === date)) date = days[0]?.date ?? '';
  paintDays();
  await refreshSlots();
  if (slotParam !== null) {
    if (!isSlotParam(slotParam)) {
      announce(STATUS.slotClosed, 'other');
    } else {
      const match = slots.find((slot) => slot.startsAt.slice(11, 16) === slotParam);
      if (!match) {
        announce(STATUS.slotClosed, 'other');
      } else if (match.state === 'taken') {
        announce(STATUS.slotTaken, 'other');
      } else if (match.state === 'past_cut_off') {
        announce(STATUS.slotClosed, 'other');
      } else {
        grid?.set(match.startsAt);
      }
    }
  }
  writeUrl();
  await refreshRides();
}

function paintDays(): void {
  if (!daySelect) return;
  const existing = [...daySelect.options];
  days.forEach((day, index) => {
    let option = existing[index];
    if (!option) {
      option = document.createElement('option');
      daySelect?.append(option);
    }
    option.value = day.date;
    option.textContent = day.dayLabel;
  });
  for (let index = days.length; index < existing.length; index += 1) existing[index]?.remove();
  daySelect.value = date;
}

async function refreshSlots(): Promise<void> {
  const mine = (token += 1);
  if (!date) return;
  try {
    const reply = await apiGet<SlotsReply>(`/api/hubs/${hub}/slots?date=${date}`);
    if (mine !== token) return;
    slots = reply.slots;
  } catch {
    return;
  }
  const chosenBefore = grid?.chosen();
  grid?.update(
    slots.map((slot) => ({
      key: slot.startsAt,
      label: slot.label,
      disabled: slot.state !== 'free',
    })),
  );
  const chosenAfter = grid?.chosen();
  if (chosenBefore && !chosenAfter) {
    const before = slots.find((slot) => slot.startsAt === chosenBefore);
    const mine = activeRide();
    if (!mine || mine.startsAt !== chosenBefore) {
      announce(before?.state === 'taken' ? STATUS.slotTaken : STATUS.slotClosed, 'other');
    }
    writeUrl();
  }
  const free = slots.some((slot) => slot.state === 'free');
  if (emptyNote) emptyNote.hidden = free;
  if (nextDayButton) nextDayButton.hidden = free;
  paintActions();
}

async function refreshRides(): Promise<void> {
  if (user()?.role !== 'rider') {
    rides = [];
    paintActions();
    return;
  }
  try {
    rides = (await apiGet<{ rides: Ride[] }>('/api/rides')).rides;
  } catch {
    rides = [];
  }
  paintActions();
}

function activeRide(): Ride | null {
  return rides.find((ride) => ride.state === 'booked' && ride.model === model) ?? null;
}

function paintActions(): void {
  const active = activeRide();
  if (bookButton) bookButton.hidden = active !== null;
  if (moveButton) moveButton.hidden = active === null;
  if (cancelButton) cancelButton.hidden = active === null;
}

function licenceBody(): Record<string, unknown> {
  return {
    licenceNumber: fields.licence?.value ?? '',
    licenceValidUntil: fields.validUntil?.value ?? '',
    hasMcwg: fields.mcwg?.checked ?? false,
  };
}

async function book(): Promise<void> {
  const chosen = grid?.chosen();
  if (!chosen) return;
  if (!user()) {
    openSignIn();
    return;
  }
  announce(STATUS.ridePending, 'other');
  try {
    const reply = await apiPost<{ ride: Ride }>('/api/rides', {
      hub,
      model,
      startsAt: chosen,
      ...licenceBody(),
    });
    announce(
      STATUS.rideBooked(`${reply.data.ride.dayLabel.replace(/^(Today|Tomorrow), /, '')}, ${
        reply.data.ride.label
      }`),
      'other',
    );
    await refreshRides();
    await refreshSlots();
  } catch (error) {
    rideFailure(error);
  }
}

async function move(): Promise<void> {
  const ride = activeRide();
  const chosen = grid?.chosen();
  if (!ride || !chosen) return;
  try {
    const reply = await apiPost<{ ride: Ride }>(`/api/rides/${ride.id}/move`, {
      startsAt: chosen,
    });
    announce(
      STATUS.rideBooked(`${reply.data.ride.dayLabel.replace(/^(Today|Tomorrow), /, '')}, ${
        reply.data.ride.label
      }`),
      'other',
    );
    await refreshRides();
    await refreshSlots();
  } catch (error) {
    rideFailure(error);
  }
}

async function cancel(): Promise<void> {
  const ride = activeRide();
  if (!ride) return;
  try {
    await apiPost(`/api/rides/${ride.id}/cancel`);
    announce(STATUS.rideCancelled, 'other');
    await refreshRides();
    await refreshSlots();
  } catch (error) {
    rideFailure(error);
  }
}

function rideFailure(error: unknown): void {
  if (!(error instanceof ApiError)) throw error;
  const code = error.failure.code;
  if (error.failure.status === 401) {
    openSignIn();
    return;
  }
  if (code === 'slot_taken') announce(STATUS.slotTaken, 'other');
  else if (code === 'ride_cut_off') announce(STATUS.slotClosed, 'other');
  else if (code === 'illegal_state') announce(STATUS.rideCutOff, 'other');
  else if (code === 'ride_exists') announce(STATUS.rideExists, 'other');
  else if (code === 'hub_unreachable') announce(STATUS.rideRefused, 'other');
  else if (code === 'licence_invalid') announce(FIELD_TEXT.licenceNumber, 'other');
  else if (code === 'licence_expired') announce(FIELD_TEXT.licenceDate, 'other');
  else if (code === 'mcwg_required') announce(FIELD_TEXT.mcwg, 'other');
  else if (code === 'invalid_body' || code === 'invalid_slot') {
    announce(FIELD_TEXT.licenceNumber, 'other');
  }
  void refreshSlots();
}
