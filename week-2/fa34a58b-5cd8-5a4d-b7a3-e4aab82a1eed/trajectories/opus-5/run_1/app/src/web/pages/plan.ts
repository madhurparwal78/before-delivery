import { api } from '../api';
import { el, find, isWideViewport, must, openSheet, prefersReducedMotion, pulse, svgIcon } from '../dom';
import { abbrAt, abbrOf, addDays, dayOf, hhmm, longDate, pad2, shortWeekday } from '../format';
import { deviceCache, onSocket, setRegion, status } from '../live';
import { notifyDeviceSheets, openDeviceSheet, sendDeviceState } from '../sheets/device';
import type {
  Device,
  GuestScene,
  LightState,
  OwnerSource,
  PlanBody,
  PlanChange,
  Scene,
  StatusBody,
  ThermostatState,
  Tint,
} from '../../shared/types';

const STAGGER_MS = 40;
const FILL_MS = 240;
const SCRUB_SNAP_MINUTES = 5;
const KEY_STEP_MINUTES = 15;
const PAGE_STEP_MINUTES = 60;
const TINTS: Tint[] = ['amber', 'honey', 'ember', 'rose', 'dusk', 'candle'];

interface Owner {
  scene_id: string | null;
  since: string | null;
  source: OwnerSource;
  guest_scene_id: string | null;
}

const UNPLANNED: Owner = { scene_id: null, since: null, source: 'none', guest_scene_id: null };

let plan: PlanBody;
let scenes: Scene[] = [];
let guestScenes: GuestScene[] = [];
let minutes = 0;
let selectedRoom = 'hall';
let inspectorHost: HTMLElement | null = null;

/** What the drawing currently shows, which a new sweep starts from. */
const renderedScene = new Map<string, string | null>();
/** What the legend currently counts, stepped one room at a time as fills land. */
const legendScene = new Map<string, string | null>();
let sweepTimers: number[] = [];

const tintColours = new Map<Tint, string>();

function readTintColours(): void {
  const styles = getComputedStyle(document.documentElement);
  for (const tint of TINTS) {
    tintColours.set(tint, styles.getPropertyValue(`--tint-${tint}`).trim());
  }
}

function sceneById(id: string | null): Scene | undefined {
  return id === null ? undefined : scenes.find((scene) => scene.id === id);
}

function sceneName(id: string | null): string {
  return sceneById(id)?.name ?? 'Unplanned';
}

function dayLength(): number {
  return plan.hour_marks.length * 60;
}

function elapsedOf(instant: string): number {
  return Math.round((Date.parse(instant) - Date.parse(plan.start)) / 60000);
}

function markAt(value: number): { label: string; abbr: string; offset: string } {
  const mark = plan.hour_marks[Math.min(Math.floor(value / 60), plan.hour_marks.length - 1)];
  if (!mark) throw new Error('No hour mark');
  return { label: mark.label, abbr: mark.abbr, offset: mark.at.slice(19) };
}

function wallAt(value: number): string {
  return value >= dayLength() ? '24:00' : `${markAt(value).label}:${pad2(value % 60)}`;
}

function offsetAt(value: number): string {
  return value >= dayLength() ? plan.end.slice(19) : markAt(value).offset;
}

function isRepeatedHourLabel(label: string): boolean {
  return plan.hour_marks.filter((mark) => mark.label === label).length > 1;
}

function inRepeatedHour(value: number): boolean {
  return value < dayLength() && isRepeatedHourLabel(markAt(value).label);
}

function timeLabel(value: number): string {
  const wall = wallAt(value);
  return inRepeatedHour(value) ? `${wall} ${abbrOf(offsetAt(value))}` : wall;
}

function sinceLabel(instant: string): string {
  const instantDay = dayOf(instant);
  const base =
    instantDay === plan.day ? hhmm(instant) : `${shortWeekday(instantDay)} ${hhmm(instant)}`;
  if (instantDay === plan.day) {
    const value = elapsedOf(instant);
    if (value >= 0 && inRepeatedHour(value)) return `${base} ${abbrAt(instant)}`;
  }
  return base;
}

function sourceOfChange(change: PlanChange): OwnerSource {
  if (change.source === 'guest') return 'guest';
  return change.scene_id === null ? 'none' : 'schedule';
}

function ownersAt(value: number): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const room of plan.rooms) {
    const start = plan.start_owners.find((candidate) => candidate.room_id === room.room_id);
    owners.set(
      room.room_id,
      start
        ? {
            scene_id: start.scene_id,
            since: start.since,
            source: start.source,
            guest_scene_id: start.guest_scene_id,
          }
        : UNPLANNED,
    );
  }
  for (const change of plan.changes) {
    if (elapsedOf(change.at) > value) continue;
    for (const roomId of change.room_ids) {
      owners.set(roomId, {
        scene_id: change.scene_id,
        since: change.at,
        source: sourceOfChange(change),
        guest_scene_id: change.source === 'guest' ? change.guest_scene_id : null,
      });
    }
  }
  return owners;
}

function guestEndFor(guestSceneId: string | null): string | null {
  if (!guestSceneId) return null;
  return guestScenes.find((guest) => guest.id === guestSceneId)?.ends_at ?? null;
}

function roomCount(count: number): string {
  return `${count} ${count === 1 ? 'room' : 'rooms'}`;
}

function planTimeCopy(owners: Map<string, Owner>, value: number): string {
  const parts: string[] = [];
  for (const scene of scenes) {
    const count = [...owners.values()].filter((owner) => owner.scene_id === scene.id).length;
    if (count > 0) parts.push(`${roomCount(count)} in ${scene.name}`);
  }
  const unplanned = [...owners.values()].filter((owner) => owner.scene_id === null).length;
  if (unplanned > 0) parts.push(`${roomCount(unplanned)} unplanned`);
  return `At ${timeLabel(value)}, ${parts.join(', ')}`;
}

function paintLegend(): void {
  const list = must<HTMLElement>('[data-legend]');
  list.replaceChildren(
    ...scenes.map((scene) => {
      const count = [...legendScene.values()].filter((id) => id === scene.id).length;
      return el('li', { class: 'legend-item', 'data-scene': scene.id }, [
        el('span', { class: `swatch tint-${scene.tint}` }),
        el('span', { class: 'legend-name' }, [scene.name]),
        el('span', { class: 'legend-count num' }, [String(count)]),
      ]);
    }),
  );
}

function paintRoomFill(roomId: string, sceneId: string | null): void {
  const group = find<SVGGElement>(`.room[data-room="${roomId}"]`);
  if (!group) return;
  const fill = find<SVGRectElement>('.room-fill', group);
  const scene = sceneById(sceneId);
  if (fill) {
    if (scene) {
      fill.style.fill = tintColours.get(scene.tint) ?? '';
      fill.style.fillOpacity = '0.34';
    } else {
      fill.style.fillOpacity = '0';
    }
  }
  group.setAttribute('aria-label', `${group.dataset['roomName'] ?? roomId}: ${sceneName(sceneId)}`);
  group.dataset['scene'] = sceneId ?? 'none';
}

function cancelSweep(): void {
  for (const timer of sweepTimers) window.clearTimeout(timer);
  sweepTimers = [];
}

function settleAll(owners: Map<string, Owner>): void {
  cancelSweep();
  for (const room of plan.rooms) {
    const sceneId = owners.get(room.room_id)?.scene_id ?? null;
    renderedScene.set(room.room_id, sceneId);
    legendScene.set(room.room_id, sceneId);
    paintRoomFill(room.room_id, sceneId);
  }
  paintLegend();
}

/** Rooms change in plan order, staggered, and each legend count steps as its fill lands. */
function runSweep(owners: Map<string, Owner>): void {
  cancelSweep();
  if (prefersReducedMotion()) {
    settleAll(owners);
    return;
  }
  const changed = plan.rooms
    .map((room) => room.room_id)
    .filter(
      (roomId) =>
        (renderedScene.get(roomId) ?? null) !== (owners.get(roomId)?.scene_id ?? null),
    );
  changed.forEach((roomId, index) => {
    const sceneId = owners.get(roomId)?.scene_id ?? null;
    sweepTimers.push(
      window.setTimeout(() => {
        renderedScene.set(roomId, sceneId);
        paintRoomFill(roomId, sceneId);
      }, index * STAGGER_MS),
    );
    sweepTimers.push(
      window.setTimeout(
        () => {
          legendScene.set(roomId, sceneId);
          paintLegend();
        },
        index * STAGGER_MS + FILL_MS,
      ),
    );
  });
}

function paintAtThisTime(owners: Map<string, Owner>): void {
  must<HTMLElement>('[data-at-this-time]').replaceChildren(
    ...plan.rooms.map((room) => {
      const owner = owners.get(room.room_id) ?? UNPLANNED;
      let text: string;
      if (owner.scene_id === null) {
        text = `${room.name} · Unplanned`;
      } else if (owner.source === 'guest') {
        const end = guestEndFor(owner.guest_scene_id);
        text = `${room.name} · ${sceneName(owner.scene_id)} · guest until ${end ? hhmm(end) : ''}`;
      } else {
        const since = owner.since ? sinceLabel(owner.since) : '';
        text = `${room.name} · ${sceneName(owner.scene_id)} · since ${since}`;
      }
      return el('li', { class: 'at-item', 'data-room': room.room_id }, [text]);
    }),
  );
}

function paintDay(): void {
  const extra = plan.hours === 25 ? ' · 25 hours' : plan.hours === 23 ? ' · 23 hours' : '';
  must<HTMLElement>('[data-day-line]').textContent = `${longDate(plan.day)}${extra}`;

  const total = dayLength();
  must<HTMLElement>('[data-ticks]').replaceChildren(
    ...plan.hour_marks.map((mark, index) => {
      const label = isRepeatedHourLabel(mark.label) ? `${mark.label} ${mark.abbr}` : mark.label;
      return el('span', { class: 'tick', style: `left:${((index * 60) / total) * 100}%` }, [
        el('span', { class: 'tick-line' }),
        el('span', { class: 'tick-label num' }, [label]),
      ]);
    }),
  );

  const dayInput = must<HTMLInputElement>('[data-plan-day]');
  if (dayInput.value !== plan.day) dayInput.value = plan.day;
}

function paintNowMarker(): void {
  const marker = must<HTMLElement>('[data-now-marker]');
  const current = status();
  if (!current || current.day !== plan.day) {
    marker.hidden = true;
    return;
  }
  const value = Math.floor((Date.parse(current.now) - Date.parse(plan.start)) / 60000);
  marker.hidden = false;
  marker.style.left = `${Math.min(Math.max((value / dayLength()) * 100, 0), 100)}%`;
  marker.textContent = `Now ${hhmm(current.now)}`;
}

function paintScrubber(): void {
  const slider = must<HTMLElement>('[data-slider]');
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', String(dayLength()));
  slider.setAttribute('aria-valuenow', String(minutes));
  slider.setAttribute('aria-valuetext', `${wallAt(minutes)} ${abbrOf(offsetAt(minutes))}`);
  const ratio = (minutes / dayLength()) * 100;
  must<HTMLElement>('[data-thumb]').style.left = `${ratio}%`;
  must<HTMLElement>('[data-scrub-fill]').style.width = `${ratio}%`;
}

function writeAddress(): void {
  window.history.replaceState(
    null,
    '',
    `/plan?day=${plan.day}&at=${wallAt(minutes)}${offsetAt(minutes)}`,
  );
}

function buildRoomList(): void {
  must<HTMLElement>('[data-room-list]').replaceChildren(
    ...plan.rooms.map((room) => {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'control room-button',
          'aria-label': room.name,
          'data-room-button': room.room_id,
        },
        [
          el('span', { class: 'room-button-name' }, [room.name]),
          el('span', { class: 'room-button-now', 'data-room-now': room.room_id }, ['Now: —']),
          el('span', { class: 'room-button-guest', 'data-room-guest': room.room_id }),
        ],
      );
      button.addEventListener('click', () => selectRoom(room.room_id, button));
      return el('li', { class: 'room-row', 'data-room-row': room.room_id }, [button]);
    }),
  );
  updateRoomListLive();
}

/** The live scene of each room, updated in place so focus and layout hold still. */
function updateRoomListLive(): void {
  const current = status();
  for (const room of plan.rooms) {
    const now = find<HTMLElement>(`[data-room-now="${room.room_id}"]`);
    const guest = find<HTMLElement>(`[data-room-guest="${room.room_id}"]`);
    const live = current?.rooms.find((candidate) => candidate.room_id === room.room_id);
    if (now) now.textContent = `Now: ${live?.scene_name ?? 'Unplanned'}`;
    if (guest) {
      const end = guestEndFor(live?.guest_scene_id ?? null);
      guest.textContent = end ? `Guest until ${hhmm(end)}` : '';
    }
  }
}

interface DeviceRowView {
  element: HTMLElement;
  update: (device: Device) => void;
}

const deviceRowViews = new Map<string, DeviceRowView>();

function deviceDetailText(device: Device): string {
  if (device.kind === 'thermostat') {
    const state = device.state as ThermostatState;
    return `Set to ${state.setpoint_f}°F, reading ${state.current_f}°F`;
  }
  if (device.kind === 'camera') return 'Camera';
  const state = device.state as LightState;
  if (!state.on) return 'Off';
  return device.kind === 'light' ? `On at ${state.brightness}%` : 'On';
}

function deviceRow(device: Device): DeviceRowView {
  const detail = el('span', {
    class: device.kind === 'camera' ? 'device-detail' : 'device-detail num',
  });
  detail.textContent = deviceDetailText(device);

  const pendingNote = el('span', { class: 'pending-note' });
  const alertSlot = el('div', { class: 'alert-slot' });
  const children: (Node | string)[] = [el('span', { class: 'device-name' }, [device.name])];
  let powerToggle: HTMLButtonElement | null = null;

  if (device.kind === 'light' || device.kind === 'plug') {
    const toggle = el('button', {
      type: 'button',
      class: 'control switch',
      role: 'switch',
      'aria-label': device.name,
      'aria-checked': String((device.state as LightState).on),
    }) as HTMLButtonElement;
    toggle.append(el('span', { class: 'switch-track' }));
    toggle.addEventListener('click', () => {
      const latest = deviceCache.get(device.id) ?? device;
      const next = !(latest.state as LightState).on;
      toggle.setAttribute('aria-checked', String(next));
      pendingNote.textContent = 'Sending…';
      void sendDeviceState(latest, { on: next }, (message) => {
        const server = deviceCache.get(device.id) ?? latest;
        toggle.setAttribute('aria-checked', String((server.state as LightState).on));
        alertSlot.replaceChildren(el('p', { class: 'alert', role: 'alert' }, [message]));
      }).then(() => {
        pendingNote.textContent = '';
      });
    });
    powerToggle = toggle;
    children.push(toggle);
  }

  const details = el(
    'button',
    { type: 'button', class: 'control icon-button', 'aria-label': `Details for ${device.name}` },
    [svgIcon('square-pen')],
  );
  details.addEventListener('click', () => {
    openDeviceSheet(deviceCache.get(device.id) ?? device, details, (id) => deviceCache.get(id));
  });
  children.push(detail, pendingNote, details, alertSlot);

  const element = el('li', { class: 'device-row', 'data-device-row': device.id }, children);
  return {
    element,
    update: (next: Device) => {
      detail.textContent = deviceDetailText(next);
      if (powerToggle) {
        powerToggle.setAttribute('aria-checked', String((next.state as LightState).on));
      }
    },
  };
}

function inspectorTarget(): HTMLElement | null {
  const sheetHost = find<HTMLElement>('[data-sheet-root] [data-inspector-body]');
  if (sheetHost) return sheetHost;
  return isWideViewport() ? find<HTMLElement>('.inspector [data-inspector-body]') : null;
}

async function buildInspector(): Promise<void> {
  const host = inspectorTarget();
  if (!host) return;
  inspectorHost = host;
  const room = plan.rooms.find((candidate) => candidate.room_id === selectedRoom);
  if (!room) return;

  const { devices } = await api.get<{ devices: Device[] }>(
    `/api/devices?room_id=${encodeURIComponent(selectedRoom)}`,
  );
  for (const device of devices) deviceCache.set(device.id, device);

  const planRows = plan.changes
    .filter((change) => change.room_ids.includes(selectedRoom))
    .map((change) =>
      el('li', { class: 'plan-row num' }, [`${hhmm(change.at)} ${sceneName(change.scene_id)}`]),
    );

  deviceRowViews.clear();
  const rows = devices.map((device) => {
    const view = deviceRow(device);
    deviceRowViews.set(device.id, view);
    return view.element;
  });

  host.replaceChildren(
    el('h2', { class: 'inspector-heading' }, [room.name]),
    el('p', { class: 'inspector-now', 'data-inspector-now': '' }),
    el('ul', { class: 'device-list', 'aria-label': 'Devices' }, rows),
    el('h3', { class: 'inspector-subheading' }, [`Plan for ${room.name}`]),
    el('ul', { class: 'plan-for-list', 'aria-label': `Plan for ${room.name}` }, planRows),
  );
  updateInspectorNow();
}

function updateInspectorNow(): void {
  const line = find<HTMLElement>('[data-inspector-now]', inspectorHost ?? document);
  if (!line) return;
  const live = status()?.rooms.find((candidate) => candidate.room_id === selectedRoom);
  const since = live?.since ? ` since ${sinceLabel(live.since)}` : '';
  line.textContent = `Now: ${live?.scene_name ?? 'Unplanned'}${since}`;
}

function updateDeviceRow(device: Device): void {
  const view = deviceRowViews.get(device.id);
  if (!view) return;
  view.update(device);
  pulse(view.element);
}

function selectRoom(roomId: string, opener: HTMLElement | null): void {
  selectedRoom = roomId;
  for (const group of document.querySelectorAll<SVGGElement>('.room')) {
    group.classList.toggle('selected', group.dataset['room'] === roomId);
  }
  for (const row of document.querySelectorAll<HTMLElement>('[data-room-row]')) {
    row.classList.toggle('selected', row.dataset['roomRow'] === roomId);
  }

  if (isWideViewport()) {
    void buildInspector();
    return;
  }

  const sheet = openSheet({
    name: 'Room inspector',
    opener: opener ?? find<HTMLElement>(`[data-room-button="${roomId}"]`),
    className: 'inspector-sheet',
  });
  const host = el('div', { 'data-inspector-body': '' });
  const close = el('button', { type: 'button', class: 'control sheet-close' }, [
    svgIcon('x'),
    el('span', {}, ['Close']),
  ]);
  close.addEventListener('click', () => sheet.close());
  sheet.body.replaceChildren(host, close);
  void buildInspector().then(() => {
    const items = sheet.element.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [role="switch"]',
    );
    (items[0] ?? sheet.element).focus();
  });
}

function paintTime(animate: boolean): void {
  const owners = ownersAt(minutes);
  paintScrubber();
  paintAtThisTime(owners);
  setRegion('plan-time', planTimeCopy(owners, minutes));
  if (animate) runSweep(owners);
  else settleAll(owners);
  writeAddress();
}

function setMinutes(value: number): void {
  const clamped = Math.min(Math.max(Math.round(value), 0), dayLength());
  if (clamped === minutes) return;
  minutes = clamped;
  paintTime(true);
}

function minutesForWallTime(wall: string): number {
  if (wall === '24:00') return dayLength();
  const [hour, minute] = wall.split(':');
  const index = plan.hour_marks.findIndex((mark) => mark.label === hour);
  if (index === -1) {
    const three = plan.hour_marks.findIndex((mark) => mark.label === '03');
    return three === -1 ? 0 : three * 60;
  }
  return index * 60 + Number(minute ?? 0);
}

function minutesFromAddress(at: string): number | null {
  const match = /^(\d{2}):(\d{2})([+-]\d{2}:\d{2})?$/.exec(at);
  if (!match) return null;
  const hour = match[1] as string;
  const minute = Number(match[2]);
  const offset = match[3];
  if (`${hour}:${match[2]}` === '24:00') return dayLength();
  if (minute > 59) return null;
  const candidates = plan.hour_marks
    .map((mark, index) => ({ mark, index }))
    .filter((entry) => entry.mark.label === hour)
    .filter((entry) => offset === undefined || entry.mark.at.slice(19) === offset);
  const first = candidates[0];
  if (!first) {
    const three = plan.hour_marks.findIndex((mark) => mark.label === '03');
    return three === -1 ? null : three * 60;
  }
  return first.index * 60 + minute;
}

function installScrubber(): void {
  const slider = must<HTMLElement>('[data-slider]');
  const track = must<HTMLElement>('[data-track]');

  slider.addEventListener('keydown', (event) => {
    const steps: Record<string, number> = {
      ArrowRight: KEY_STEP_MINUTES,
      ArrowUp: KEY_STEP_MINUTES,
      ArrowLeft: -KEY_STEP_MINUTES,
      ArrowDown: -KEY_STEP_MINUTES,
      PageUp: PAGE_STEP_MINUTES,
      PageDown: -PAGE_STEP_MINUTES,
    };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setMinutes(minutes + step);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setMinutes(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setMinutes(dayLength());
    }
  });

  const minutesFromPointer = (clientX: number): number => {
    const box = track.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
    return Math.round((ratio * dayLength()) / SCRUB_SNAP_MINUTES) * SCRUB_SNAP_MINUTES;
  };

  let dragging = false;
  track.addEventListener('pointerdown', (event) => {
    dragging = true;
    track.setPointerCapture(event.pointerId);
    setMinutes(minutesFromPointer(event.clientX));
    slider.focus();
  });
  track.addEventListener('pointermove', (event) => {
    if (dragging) setMinutes(minutesFromPointer(event.clientX));
  });
  const stop = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    writeAddress();
  };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);
}

async function showDay(nextDay: string, pickMinutes: () => number): Promise<void> {
  plan = await api.get<PlanBody>(`/api/plan?day=${encodeURIComponent(nextDay)}`);
  minutes = Math.min(Math.max(pickMinutes(), 0), dayLength());
  paintDay();
  paintNowMarker();
  paintTime(true);
  buildRoomList();
  await buildInspector();
}

/** Day changes keep the wall time; Jump to now takes the hub's day and minute. */
function installDayControls(): void {
  const keepWallTime = (nextDay: string): void => {
    const wall = wallAt(minutes);
    void showDay(nextDay, () => minutesForWallTime(wall));
  };
  must<HTMLButtonElement>('[data-prev-day]').addEventListener('click', () => {
    keepWallTime(addDays(plan.day, -1));
  });
  must<HTMLButtonElement>('[data-next-day]').addEventListener('click', () => {
    keepWallTime(addDays(plan.day, 1));
  });
  must<HTMLInputElement>('[data-plan-day]').addEventListener('change', (event) => {
    const value = (event.target as HTMLInputElement).value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) keepWallTime(value);
  });
  must<HTMLButtonElement>('[data-jump-now]').addEventListener('click', () => {
    void (async () => {
      const current = status() ?? (await api.get<StatusBody>('/api/status'));
      await showDay(current.day, () =>
        Math.floor((Date.parse(current.now) - Date.parse(plan.start)) / 60000),
      );
    })();
  });
}

async function refreshPlan(): Promise<void> {
  plan = await api.get<PlanBody>(`/api/plan?day=${encodeURIComponent(plan.day)}`);
  paintDay();
  paintNowMarker();
  paintTime(false);
  await buildInspector();
}

export async function startPlanPage(initial: { status: StatusBody; scenes: Scene[] }): Promise<void> {
  readTintColours();
  scenes = initial.scenes;
  const params = new URLSearchParams(window.location.search);
  const requestedDay = params.get('day');
  const requestedAt = params.get('at');
  const dayGiven = requestedDay !== null && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay);

  guestScenes = (await api.get<{ guest_scenes: GuestScene[] }>('/api/guest-scenes')).guest_scenes;

  const loadFor = async (value: string): Promise<void> => {
    plan = await api.get<PlanBody>(`/api/plan?day=${encodeURIComponent(value)}`);
  };
  try {
    await loadFor(dayGiven ? (requestedDay as string) : initial.status.day);
  } catch {
    await loadFor(initial.status.day);
  }

  const hubMinute = (): number =>
    Math.floor((Date.parse(initial.status.now) - Date.parse(plan.start)) / 60000);
  let target = requestedAt === null ? null : minutesFromAddress(requestedAt);
  if (requestedAt !== null && target === null && plan.day !== initial.status.day) {
    // An unreadable instant falls back to the hub's now, day and all.
    await loadFor(initial.status.day);
  }
  if (target === null) {
    target = plan.day === initial.status.day ? hubMinute() : 0;
  }
  minutes = Math.min(Math.max(target, 0), dayLength());

  for (const device of (await api.get<{ devices: Device[] }>('/api/devices')).devices) {
    deviceCache.set(device.id, device);
  }

  installScrubber();
  installDayControls();
  for (const group of document.querySelectorAll<SVGGElement>('.room')) {
    group.addEventListener('click', () => {
      const roomId = group.dataset['room'];
      if (roomId) selectRoom(roomId, null);
    });
  }

  paintDay();
  paintNowMarker();
  paintTime(false);
  buildRoomList();
  if (isWideViewport()) await buildInspector();

  onSocket((message) => {
    if (message.type === 'status') {
      const previous = status();
      paintNowMarker();
      updateRoomListLive();
      updateInspectorNow();
      if (previous) {
        for (const room of message.rooms) {
          const before = previous.rooms.find((candidate) => candidate.room_id === room.room_id);
          if (before && before.scene_id !== room.scene_id) {
            const row = find<HTMLElement>(`[data-room-row="${room.room_id}"]`);
            if (row) pulse(row);
          }
        }
      }
    }
    if (message.type === 'device') {
      deviceCache.set(message.device.id, message.device);
      updateDeviceRow(message.device);
      notifyDeviceSheets(message.device);
    }
    if (message.type === 'schedule' || message.type === 'guest_scene') {
      void (async () => {
        guestScenes = (
          await api.get<{ guest_scenes: GuestScene[] }>('/api/guest-scenes')
        ).guest_scenes;
        await refreshPlan();
        updateRoomListLive();
      })();
    }
    if (message.type === 'scene') {
      void (async () => {
        scenes = (await api.get<{ scenes: Scene[] }>('/api/scenes')).scenes;
        paintTime(false);
      })();
    }
  });
}
