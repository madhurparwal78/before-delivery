import { formatPaise } from '../shared/money.js';
import { COPY, STATUS } from '../shared/strings.js';
import type { DeliveryDayView, Lock, Ride } from '../shared/types.js';
import {
  announce,
  ApiError,
  apiGet,
  apiPost,
  identityChanged,
  liveArrived,
  mineChanged,
  user,
} from './core.js';
import { CellGrid } from './grid.js';
import { hourOnly, labelDddDMon, weekdayNameOf, withoutIstSuffix } from './labels.js';
import { lockListeners, markLocalLockAction, refreshLocks } from './lockwatch.js';
import { openSignIn } from './signin.js';

interface Block {
  wrapper: HTMLElement;
  amounts: HTMLElement;
  hours: HTMLElement;
  checking: HTMLElement;
  actions: HTMLElement;
  release: HTMLButtonElement;
  makeSheet: HTMLButtonElement;
  download: HTMLAnchorElement;
  reminders: HTMLButtonElement;
  outage: HTMLElement;
}

interface DeliveryBlock {
  wrapper: HTMLElement;
  heading: HTMLElement;
  grid: CellGrid;
  setDay: HTMLButtonElement;
  wait: HTMLButtonElement;
  leave: HTMLButtonElement;
  line: HTMLElement;
  days: DeliveryDayView[];
}

const lockBlocks = new Map<string, Block>();
const deliveryBlocks = new Map<string, DeliveryBlock>();
let locks: Lock[] = [];
let rides: Ride[] = [];
let lockBand: HTMLElement | null = null;
let rideBand: HTMLElement | null = null;
let deliveryBand: HTMLElement | null = null;
let statement: HTMLElement | null = null;

export function startGarage(): void {
  const host = document.querySelector<HTMLElement>('[data-garage]');
  if (!host) return;
  statement = document.querySelector<HTMLElement>('[data-statement]');
  lockBand = band('Your lock');
  rideBand = band('Your ride');
  deliveryBand = band('Your delivery');
  host.replaceChildren(lockBand, rideBand, deliveryBand);
  lockListeners.add((next) => {
    locks = next;
    paint();
  });
  mineChanged.on(() => {
    void reload();
  });
  liveArrived.on(() => {
    paint();
  });
  identityChanged.on(() => {
    locks = [];
    rides = [];
    lockBlocks.clear();
    deliveryBlocks.clear();
    paint();
    void reload();
  });
  if (!user()) openSignIn();
  void reload();
}

function band(label: string): HTMLElement {
  const element = document.createElement('section');
  element.className = 'band';
  element.setAttribute('role', 'region');
  element.setAttribute('aria-label', label);
  return element;
}

async function reload(): Promise<void> {
  if (user()?.role !== 'rider') {
    locks = [];
    rides = [];
    paint();
    return;
  }
  locks = await refreshLocks();
  try {
    rides = (await apiGet<{ rides: Ride[] }>('/api/rides')).rides;
  } catch {
    rides = [];
  }
  paint();
  for (const lock of activeLocks()) void loadDeliveryDays(lock);
}

function activeLocks(): Lock[] {
  return locks
    .filter((lock) => ['requested', 'locked', 'delivery_set'].includes(lock.state))
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

function paint(): void {
  paintStatement();
  paintLockBand();
  paintRideBand();
  paintDeliveryBand();
}

function paintStatement(): void {
  if (!statement) return;
  const locked = activeLocks()
    .filter((lock) => lock.state === 'locked' && lock.expiresAt)
    .sort((a, b) => (a.expiresAt as string).localeCompare(b.expiresAt as string));
  if (locked.length > 0) {
    const lock = locked[0] as Lock;
    const date = (lock.expiresAt as string).slice(0, 10);
    const time = hourOnly(withoutIstSuffix((lock.expiresLabel as string).split(', ')[1] ?? ''));
    statement.textContent = `Yours until ${weekdayNameOf(date)}, ${time} IST.`;
    return;
  }
  const delivery = activeLocks()
    .filter((lock) => lock.state === 'delivery_set' && lock.deliveryDate)
    .sort((a, b) => (a.deliveryDate as string).localeCompare(b.deliveryDate as string));
  if (delivery.length > 0) {
    statement.textContent = `Yours to collect on ${labelDddDMon(
      (delivery[0] as Lock).deliveryDate as string,
    )}.`;
    return;
  }
  statement.textContent = COPY.lockEmpty;
}

function paintLockBand(): void {
  if (!lockBand) return;
  const active = activeLocks();
  if (active.length === 0) {
    lockBlocks.clear();
    const sentence = document.createElement('h2');
    sentence.textContent = COPY.lockEmpty;
    const link = document.createElement('a');
    link.href = '/showroom?at=0.000';
    link.textContent = COPY.startBuild;
    const ended = locks.find((lock) => lock.sheetReady);
    const children: HTMLElement[] = [sentence, link];
    if (ended) {
      const download = document.createElement('a');
      download.href = `/api/locks/${ended.id}/sheet`;
      download.textContent = 'Download price sheet';
      children.push(download);
    }
    lockBand.replaceChildren(...children);
    return;
  }
  const order: HTMLElement[] = [];
  for (const lock of active) {
    let block = lockBlocks.get(lock.id);
    if (!block) {
      block = buildLockBlock(lock);
      lockBlocks.set(lock.id, block);
    }
    paintLockBlock(block, lock);
    order.push(block.wrapper);
  }
  for (const [id, block] of lockBlocks) {
    if (!active.some((lock) => lock.id === id)) {
      block.wrapper.remove();
      lockBlocks.delete(id);
    }
  }
  lockBand.replaceChildren(...order);
}

function buildLockBlock(lock: Lock): Block {
  const wrapper = document.createElement('div');
  const amounts = document.createElement('div');
  const hours = document.createElement('p');
  hours.className = 'numeral';
  const checking = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'band-actions';
  const release = document.createElement('button');
  release.type = 'button';
  release.textContent = 'Release this lock';
  release.addEventListener('click', () => void releaseLock(lock.id));
  const makeSheet = document.createElement('button');
  makeSheet.type = 'button';
  makeSheet.textContent = 'Make price sheet';
  makeSheet.addEventListener('click', () => void makeSheetFor(lock.id));
  const download = document.createElement('a');
  download.textContent = 'Download price sheet';
  const reminders = document.createElement('button');
  reminders.type = 'button';
  reminders.textContent = 'Turn on reminders';
  reminders.addEventListener('click', () => void turnOnReminders());
  const outage = document.createElement('p');
  outage.className = 'outage-field';
  outage.hidden = true;
  actions.append(release, makeSheet, download, reminders);
  wrapper.append(amounts, hours, checking, outage, actions);
  return { wrapper, amounts, hours, checking, actions, release, makeSheet, download, reminders, outage };
}

function paintLockBlock(block: Block, lock: Lock): void {
  if (lock.state === 'requested') {
    block.amounts.replaceChildren();
    block.hours.textContent = '';
    block.checking.textContent = STATUS.lockChecking;
    block.actions.hidden = true;
    return;
  }
  block.checking.textContent = '';
  block.actions.hidden = false;
  const lines = [
    `Ex-showroom ${formatPaise(lock.exShowroomPaise)}`,
    `Road tax ${formatPaise(lock.roadTaxPaise)}`,
    `Insurance ${formatPaise(lock.insurancePaise)}`,
    `On-road ${formatPaise(lock.onRoadPaise)}`,
  ];
  const existing = [...block.amounts.children] as HTMLElement[];
  lines.forEach((line, index) => {
    let node = existing[index];
    if (!node) {
      node = document.createElement('p');
      block.amounts.append(node);
    }
    node.textContent = line;
  });
  for (let index = lines.length; index < existing.length; index += 1) existing[index]?.remove();
  block.hours.textContent =
    lock.state === 'delivery_set'
      ? `Collect on ${labelDddDMon(lock.deliveryDate ?? '')}`
      : `${lock.hoursLeft} hours left`;
  block.release.hidden = lock.state !== 'locked';
  block.makeSheet.hidden = !(lock.state === 'locked' || lock.state === 'delivery_set');
  block.download.hidden = !lock.sheetReady;
  block.download.href = `/api/locks/${lock.id}/sheet`;
  const remindersOn = user()?.remindersOn === true;
  block.reminders.hidden = remindersOn;
  if (remindersOn && !block.wrapper.querySelector('[data-reminders-on]')) {
    const note = document.createElement('p');
    note.dataset.remindersOn = '';
    note.textContent = STATUS.remindersOn;
    block.actions.append(note);
  }
}

function paintRideBand(): void {
  if (!rideBand) return;
  const booked = rides
    .filter((ride) => ride.state === 'booked')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const marked = rides
    .filter((ride) => ride.state === 'ridden' || ride.state === 'no_show')
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const children: HTMLElement[] = [];
  if (booked) {
    const word = document.createElement('p');
    word.textContent = 'Booked';
    const detail = document.createElement('p');
    detail.textContent = `${booked.dayLabel}, ${booked.label}`;
    const link = document.createElement('a');
    link.href = `/test-ride?hub=${booked.hub}&model=${booked.model}`;
    link.textContent = 'Change this ride';
    children.push(word, detail, link);
  } else if (marked) {
    const word = document.createElement('p');
    word.textContent = marked.state === 'ridden' ? 'Ridden' : 'No-show';
    const detail = document.createElement('p');
    detail.textContent = `${marked.dayLabel}, ${marked.label}`;
    children.push(word, detail);
  } else {
    const sentence = document.createElement('h2');
    sentence.textContent = COPY.rideEmpty;
    const link = document.createElement('a');
    link.href = '/test-ride';
    link.textContent = COPY.pickSlot;
    children.push(sentence, link);
  }
  rideBand.replaceChildren(...children);
}

function paintDeliveryBand(): void {
  if (!deliveryBand) return;
  const active = activeLocks().filter((lock) => lock.state !== 'requested');
  if (active.length === 0) {
    deliveryBlocks.clear();
    const sentence = document.createElement('h2');
    sentence.textContent = COPY.deliveryEmpty;
    const link = document.createElement('a');
    link.href = '/showroom?at=0.000';
    link.textContent = COPY.startBuild;
    deliveryBand.replaceChildren(sentence, link);
    return;
  }
  const order: HTMLElement[] = [];
  for (const lock of active) {
    let block = deliveryBlocks.get(lock.id);
    if (!block) {
      block = buildDeliveryBlock(lock);
      deliveryBlocks.set(lock.id, block);
    }
    paintDeliveryBlock(block, lock);
    order.push(block.wrapper);
  }
  for (const [id, block] of deliveryBlocks) {
    if (!active.some((lock) => lock.id === id)) {
      block.wrapper.remove();
      deliveryBlocks.delete(id);
    }
  }
  deliveryBand.replaceChildren(...order);
}

function buildDeliveryBlock(lock: Lock): DeliveryBlock {
  const wrapper = document.createElement('div');
  const heading = document.createElement('p');
  const gridHost = document.createElement('div');
  const line = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'band-actions';
  const setDay = document.createElement('button');
  setDay.type = 'button';
  setDay.className = 'primary';
  setDay.textContent = 'Set delivery day';
  const wait = document.createElement('button');
  wait.type = 'button';
  wait.textContent = 'Wait for a place';
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.textContent = 'Leave the line';
  actions.append(setDay, wait, leave);
  wrapper.append(heading, gridHost, line, actions);
  const block: DeliveryBlock = {
    wrapper,
    heading,
    grid: new CellGrid(gridHost, 'Delivery days', () => paint()),
    setDay,
    wait,
    leave,
    line,
    days: [],
  };
  setDay.addEventListener('click', () => {
    if (setDay.getAttribute('aria-disabled') === 'true') return;
    void setDelivery(lock.id, block);
  });
  wait.addEventListener('click', () => void joinLine(lock.id, block));
  leave.addEventListener('click', () => void leaveLine(lock.id));
  return block;
}

function cellLabel(day: DeliveryDayView): string {
  const date = labelDddDMon(day.date);
  if (day.state === 'closed') return `${date}, closed`;
  if (day.state === 'full') return `${date}, full`;
  if (day.placesLeft === 1) return `${date}, 1 place left`;
  return `${date}, ${day.placesLeft} places left`;
}

async function loadDeliveryDays(lock: Lock): Promise<void> {
  const block = deliveryBlocks.get(lock.id);
  if (!block) return;
  try {
    const reply = await apiGet<{ days: DeliveryDayView[] }>(
      `/api/locks/${lock.id}/delivery-days`,
    );
    block.days = reply.days;
  } catch {
    return;
  }
  paintDeliveryBlock(block, lock);
}

function paintDeliveryBlock(block: DeliveryBlock, lock: Lock): void {
  block.heading.textContent =
    lock.state === 'delivery_set' && lock.deliveryDate
      ? `Delivery day ${labelDddDMon(lock.deliveryDate)}`
      : 'Choose a delivery day.';
  block.grid.update(
    block.days.map((day) => ({
      key: day.date,
      label: cellLabel(day),
      disabled: day.state === 'closed',
    })),
  );
  const chosen = block.grid.chosen();
  const day = block.days.find((entry) => entry.date === chosen) ?? null;
  const isFull = day?.state === 'full';
  block.setDay.setAttribute(
    'aria-disabled',
    chosen === null || isFull || lock.state !== 'locked' ? 'true' : 'false',
  );
  block.wait.hidden = !(isFull && lock.waitingFor !== chosen && lock.state === 'locked');
  block.leave.hidden = lock.waitingFor === null;
  block.line.textContent =
    lock.waitingFor !== null
      ? STATUS.inLine(lock.waitPosition ?? 1, labelDddDMon(lock.waitingFor))
      : '';
}

async function setDelivery(lockId: string, block: DeliveryBlock): Promise<void> {
  const chosen = block.grid.chosen();
  if (!chosen) return;
  announce(STATUS.deliveryPending, 'other');
  markLocalLockAction(lockId);
  try {
    await apiPost(`/api/locks/${lockId}/delivery`, { date: chosen });
    announce(STATUS.deliverySet(labelDddDMon(chosen)), 'other');
    await reload();
  } catch (error) {
    deliveryFailure(error, lockId);
  }
}

async function joinLine(lockId: string, block: DeliveryBlock): Promise<void> {
  const chosen = block.grid.chosen();
  if (!chosen) return;
  announce(STATUS.joiningLine, 'other');
  markLocalLockAction(lockId);
  try {
    const reply = await apiPost<{ lock: Lock }>(`/api/locks/${lockId}/delivery/wait`, {
      date: chosen,
    });
    announce(
      STATUS.inLine(reply.data.lock.waitPosition ?? 1, labelDddDMon(chosen)),
      'other',
    );
    await reload();
  } catch (error) {
    deliveryFailure(error, lockId);
  }
}

async function leaveLine(lockId: string): Promise<void> {
  markLocalLockAction(lockId);
  try {
    await apiPost(`/api/locks/${lockId}/delivery/wait/leave`);
    announce(STATUS.leftLine, 'other');
    await reload();
  } catch (error) {
    deliveryFailure(error, lockId);
  }
}

function deliveryFailure(error: unknown, lockId: string): void {
  if (!(error instanceof ApiError)) throw error;
  const code = error.failure.code;
  if (error.failure.status === 401) {
    openSignIn();
    return;
  }
  if (code === 'delivery_day_full') announce(STATUS.dayFull, 'other');
  else if (code === 'delivery_day_closed') announce(STATUS.dayClosed, 'other');
  else if (code === 'delivery_day_has_places') announce(STATUS.dayHasPlaces, 'other');
  else if (code === 'hub_unreachable') announce(STATUS.deliveryRefused, 'other');
  else if (code === 'lock_expired') announce(STATUS.lockEnded, 'lock');
  void loadDeliveryDaysById(lockId);
}

async function loadDeliveryDaysById(lockId: string): Promise<void> {
  const lock = locks.find((entry) => entry.id === lockId);
  if (lock) await loadDeliveryDays(lock);
}

async function releaseLock(lockId: string): Promise<void> {
  markLocalLockAction(lockId);
  try {
    await apiPost(`/api/locks/${lockId}/release`);
    announce(STATUS.lockReleased, 'lock');
    await reload();
    document.querySelector<HTMLElement>('[aria-label="Your lock"] a')?.focus();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.failure.status === 401) {
      openSignIn();
      return;
    }
    if (error.failure.code === 'hub_unreachable') announce(STATUS.releaseRefused, 'stale');
    else if (error.failure.code === 'lock_expired') announce(STATUS.lockEnded, 'lock');
    else if (error.failure.code === 'illegal_state') await reload();
  }
}

async function makeSheetFor(lockId: string): Promise<void> {
  const block = lockBlocks.get(lockId);
  announce(STATUS.sheetPending, 'other');
  try {
    await apiPost(`/api/locks/${lockId}/sheet`);
    if (block) {
      block.outage.hidden = true;
      block.outage.textContent = '';
    }
    announce(STATUS.sheetReady, 'other');
    await reload();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.failure.status === 401) {
      openSignIn();
      return;
    }
    if (error.failure.code === 'sheet_unreachable') {
      announce(STATUS.sheetFailed, 'other');
      if (block) {
        block.outage.hidden = false;
        block.outage.textContent = STATUS.sheetFailed;
      }
      return;
    }
    if (error.failure.code === 'lock_expired') announce(STATUS.lockEnded, 'lock');
    await reload();
  }
}

async function turnOnReminders(): Promise<void> {
  announce(STATUS.remindersPending, 'other');
  try {
    await apiPost('/api/reminders');
    const me = user();
    if (me) me.remindersOn = true;
    announce(STATUS.remindersOn, 'other');
    for (const [, block] of lockBlocks) {
      block.outage.hidden = true;
      block.outage.textContent = '';
    }
    paint();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.failure.status === 401) {
      openSignIn();
      return;
    }
    announce(STATUS.remindersFailed, 'other');
    for (const [, block] of lockBlocks) {
      block.outage.hidden = false;
      block.outage.textContent = STATUS.remindersFailed;
    }
  }
}
