import type {
  Clip,
  Device,
  LightState,
  PlugState,
  SocketMessage,
  StatusBody,
  ThermostatState,
} from '../shared/types';
import { abbrAt, hhmm } from './format';
import { el, find } from './dom';

export const STORAGE_BANNER_COPY =
  "Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back.";
export const MAIL_BANNER_COPY =
  'Mail is unreachable. Notices are queued and each will be sent once when it is back.';

type RegionName =
  | 'device-updates'
  | 'scene-changes'
  | 'connection'
  | 'plan-time'
  | 'guest-scene'
  | 'mail';

export function setRegion(name: RegionName, text: string): void {
  const region = find<HTMLElement>(`[data-region="${name}"]`);
  if (region) region.textContent = text;
}

type Listener = (message: SocketMessage) => void;

const listeners = new Set<Listener>();
let currentStatus: StatusBody | null = null;
export const deviceCache = new Map<string, Device>();

export function status(): StatusBody | null {
  return currentStatus;
}

export function onSocket(listener: Listener): void {
  listeners.add(listener);
}

export function deviceSummary(device: Device, previous: Device | undefined): string {
  if (!device.online) return 'offline';
  if (previous && !previous.online) return 'back online';
  if (device.kind === 'light') {
    const state = device.state as LightState;
    return state.on ? `on at ${state.brightness}%` : 'off';
  }
  if (device.kind === 'plug') return (device.state as PlugState).on ? 'on' : 'off';
  if (device.kind === 'thermostat') {
    const state = device.state as ThermostatState;
    return `set to ${state.setpoint_f}°F, reading ${state.current_f}°F`;
  }
  return 'offline';
}

function applyHubTime(next: StatusBody): void {
  const timeNode = find<HTMLElement>('[data-hub-time]');
  const abbrNode = find<HTMLElement>('[data-hub-abbr]');
  if (timeNode) timeNode.textContent = hhmm(next.now);
  if (abbrNode) abbrNode.textContent = abbrAt(next.now);
}

function applyStorageBanner(next: StatusBody): void {
  const slot = find<HTMLElement>('[data-banner-slot]');
  if (!slot) return;
  const existing = find<HTMLElement>('[data-storage-banner]', slot);
  if (next.services.storage === 'down') {
    if (!existing) {
      slot.append(
        el('p', { class: 'banner alert', role: 'alert', 'data-storage-banner': '' }, [
          STORAGE_BANNER_COPY,
        ]),
      );
    }
  } else if (existing) {
    existing.remove();
  }
}

function announceSceneChanges(next: StatusBody): void {
  if (!currentStatus) return;
  for (const room of next.rooms) {
    const before = currentStatus.rooms.find((candidate) => candidate.room_id === room.room_id);
    if (!before) continue;
    if (before.scene_id !== room.scene_id) {
      setRegion('scene-changes', `${room.name} is now in ${room.scene_name ?? 'Unplanned'}`);
    }
  }
}

function handle(message: SocketMessage): void {
  if (message.type === 'status') {
    const { type: _ignored, ...body } = message;
    const next = body as StatusBody;
    announceSceneChanges(next);
    applyHubTime(next);
    applyStorageBanner(next);
    currentStatus = next;
  }
  if (message.type === 'device') {
    const previous = deviceCache.get(message.device.id);
    setRegion(
      'device-updates',
      `${message.device.name}: ${deviceSummary(message.device, previous)}`,
    );
    deviceCache.set(message.device.id, message.device);
  }
  for (const listener of listeners) listener(message);
}

let socket: WebSocket | null = null;
let dropped = false;

function connect(): void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/api/socket`);
  socket.addEventListener('message', (event) => {
    handle(JSON.parse(String(event.data)) as SocketMessage);
  });
  socket.addEventListener('open', () => {
    if (dropped) {
      setRegion('connection', 'Live updates resumed.');
      dropped = false;
    }
  });
  socket.addEventListener('close', () => {
    dropped = true;
    setRegion('connection', 'Live updates paused. Reconnecting…');
    window.setTimeout(connect, 1000);
  });
  socket.addEventListener('error', () => socket?.close());
}

export function seedStatus(next: StatusBody): void {
  applyHubTime(next);
  applyStorageBanner(next);
  currentStatus = next;
}

export function startLive(): void {
  connect();
}

export function clipStateCopy(clip: Clip): string {
  if (clip.state === 'announced' || clip.state === 'storing') return 'Storing clip…';
  if (clip.state === 'size_mismatch') return 'Clip incomplete. Not saved.';
  return `${clip.stored_size ?? 0} bytes`;
}

