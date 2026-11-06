// The live store: the server's status, scenes, devices and guest scenes, kept current by /api/socket.
// Hub time, the hub's today and each room's live scene come only from here, never from the device clock.

import { HouseholdZone } from "../shared/zone.ts";
import type { Device, GuestScene, Scene, SocketMessage, Status } from "../shared/types.ts";
import { load } from "./api.ts";

type Listener<T extends SocketMessage["type"]> = (message: Extract<SocketMessage, { type: T }>) => void;

class Live {
  status!: Status;
  zone!: HouseholdZone;
  scenes: Scene[] = [];
  devices = new Map<string, Device>();
  guests = new Map<string, GuestScene>();
  private listeners = new Map<string, Set<(message: SocketMessage) => void>>();
  private reconnectListeners = new Set<() => void>();
  private regions: { devices: HTMLElement; scenes: HTMLElement; connection: HTMLElement } | null = null;
  private retry = 0;
  private dropped = false;

  async start(): Promise<void> {
    const [status, scenes, devices, guests] = await Promise.all([
      load<Status>("/api/status"),
      load<{ scenes: Scene[] }>("/api/scenes"),
      load<{ devices: Device[] }>("/api/devices"),
      load<{ guest_scenes: GuestScene[] }>("/api/guest-scenes"),
    ]);
    this.status = status;
    this.zone = new HouseholdZone(status.zone);
    this.scenes = scenes.scenes;
    this.devices = new Map(devices.devices.map((device) => [device.id, device]));
    this.guests = new Map(guests.guest_scenes.map((guest) => [guest.id, guest]));
    this.connect();
  }

  useRegions(regions: { devices: HTMLElement; scenes: HTMLElement; connection: HTMLElement }): void {
    this.regions = regions;
  }

  on<T extends SocketMessage["type"]>(type: T, listener: Listener<T>): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (message: SocketMessage) => void);
    this.listeners.set(type, set);
  }

  /** Called after the socket comes back, so pages can refetch what they show. */
  onReconnect(listener: () => void): void {
    this.reconnectListeners.add(listener);
  }

  sceneName(id: string | null): string {
    if (id === null) return "Unplanned";
    return this.scenes.find((scene) => scene.id === id)?.name ?? "Unplanned";
  }

  scene(id: string | null): Scene | undefined {
    return this.scenes.find((scene) => scene.id === id);
  }

  async refreshScenes(): Promise<void> {
    this.scenes = (await load<{ scenes: Scene[] }>("/api/scenes")).scenes;
  }

  private connect(): void {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/socket`);
    socket.addEventListener("open", () => {
      this.retry = 0;
      if (this.dropped) {
        this.dropped = false;
        this.announce("connection", "Live updates resumed.");
        document.body.classList.remove("is-offline");
        void this.resync();
      }
    });
    socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data)) as SocketMessage));
    socket.addEventListener("close", () => {
      if (!this.dropped) {
        this.dropped = true;
        this.announce("connection", "Live updates paused. Reconnecting…");
        document.body.classList.add("is-offline");
      }
      this.retry = Math.min(this.retry + 1, 5);
      setTimeout(() => this.connect(), 500 * 2 ** this.retry);
    });
  }

  private async resync(): Promise<void> {
    const devices = await load<{ devices: Device[] }>("/api/devices");
    for (const device of devices.devices) this.devices.set(device.id, device);
    const guests = await load<{ guest_scenes: GuestScene[] }>("/api/guest-scenes");
    this.guests = new Map(guests.guest_scenes.map((guest) => [guest.id, guest]));
    await this.refreshScenes();
    for (const listener of this.reconnectListeners) listener();
  }

  private announce(region: "devices" | "scenes" | "connection", text: string): void {
    const element = this.regions?.[region];
    if (element) element.textContent = text;
  }

  private receive(message: SocketMessage): void {
    if (message.type === "status") {
      const previous = this.status;
      const { type: _type, ...status } = message;
      this.status = status;
      for (const room of status.rooms) {
        const before = previous.rooms.find((candidate) => candidate.room_id === room.room_id);
        if (before && before.scene_id !== room.scene_id) {
          this.announce("scenes", `${room.name} is now in ${room.scene_name ?? "Unplanned"}`);
        }
      }
    } else if (message.type === "device") {
      const before = this.devices.get(message.device.id);
      this.devices.set(message.device.id, message.device);
      this.announce("devices", `${message.device.name}: ${deviceSummary(message.device, before)}`);
    } else if (message.type === "guest_scene") {
      this.guests.set(message.guest_scene.id, message.guest_scene);
    } else if (message.type === "scene") {
      const index = this.scenes.findIndex((scene) => scene.id === message.scene.id);
      if (index >= 0) this.scenes[index] = message.scene;
      else this.scenes.push(message.scene);
    }
    for (const listener of this.listeners.get(message.type) ?? []) listener(message);
  }
}

/** The "Device updates" summary for a device change. */
function deviceSummary(device: Device, before: Device | undefined): string {
  if (!device.online) return "offline";
  if (before && !before.online) return "back online";
  const state = device.state as { on?: boolean; brightness?: number; setpoint_f?: number; current_f?: number };
  if (device.kind === "light") return state.on ? `on at ${state.brightness}%` : "off";
  if (device.kind === "plug") return state.on ? "on" : "off";
  if (device.kind === "thermostat") return `set to ${state.setpoint_f}°F, reading ${state.current_f}°F`;
  return "camera";
}

export const live = new Live();

/** "HH:MM" from a household ISO instant. */
export const clockOf = (iso: string): string => iso.slice(11, 16);
/** "HH:MM:SS" from a household ISO instant. */
export const secondsOf = (iso: string): string => iso.slice(11, 19);
