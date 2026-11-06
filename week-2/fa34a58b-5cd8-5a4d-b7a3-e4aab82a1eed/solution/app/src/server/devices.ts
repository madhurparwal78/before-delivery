// Devices: the state API, simulated device reports, and scenes driving devices.

import type pg from "pg";
import type { Device, DeviceKind, DeviceState, LightState, Scene, ThermostatState } from "../shared/types.ts";
import { pool, rows, transaction, type Queryable } from "./db.ts";
import { ApiError, FIELD, FieldErrors } from "./errors.ts";
import { hubNow } from "./clock.ts";
import { householdZone } from "./plan.ts";
import { broadcast } from "./socket.ts";

interface DeviceRow {
  id: string;
  name: string;
  room_id: string;
  kind: DeviceKind;
  online: boolean;
  state: DeviceState;
  revision: number;
  updated_at: Date;
}

const COLUMNS = "id, name, room_id, kind, online, state, revision, updated_at";

async function toDevice(row: DeviceRow): Promise<Device> {
  const zone = await householdZone();
  return { ...row, updated_at: zone.iso(row.updated_at.getTime()) };
}

export async function listDevices(roomId: string | null): Promise<Device[]> {
  const found = roomId === null
    ? await rows<DeviceRow>(pool, `SELECT ${COLUMNS} FROM devices ORDER BY position`)
    : await rows<DeviceRow>(pool, `SELECT ${COLUMNS} FROM devices WHERE room_id = $1 ORDER BY position`, [roomId]);
  return Promise.all(found.map(toDevice));
}

// Changes to one device apply in the order received.
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(deviceId: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(deviceId) ?? Promise.resolve();
  const next = previous.then(work, work);
  queues.set(deviceId, next.catch(() => undefined));
  return next;
}

const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sameState(a: DeviceState, b: DeviceState): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

const SETTINGS: Record<DeviceKind, string[]> = {
  light: ["on", "brightness"],
  plug: ["on"],
  thermostat: ["setpoint_f"],
  camera: [],
};

/** Validates requested settings for a device kind and returns the resulting state. */
function nextState(kind: DeviceKind, current: DeviceState, wanted: unknown, report: boolean): DeviceState {
  const errors = new FieldErrors();
  if (kind === "camera" || !isObject(wanted)) {
    errors.add("state", FIELD.noSuchSetting);
    errors.throwIfAny();
  }
  const request = wanted as Record<string, unknown>;
  const allowed = report && kind === "thermostat" ? [...SETTINGS.thermostat, "current_f"] : SETTINGS[kind];
  for (const key of Object.keys(request)) if (!allowed.includes(key)) errors.add(key, FIELD.noSuchSetting);
  if ("on" in request && typeof request.on !== "boolean") errors.add("on", FIELD.onOff);
  if ("brightness" in request && !isWhole(request.brightness, 1, 100)) errors.add("brightness", FIELD.deviceBrightness);
  if ("setpoint_f" in request && !isWhole(request.setpoint_f, 60, 80)) errors.add("setpoint_f", FIELD.setpoint);
  if ("current_f" in request && !isWhole(request.current_f, -100, 200)) errors.add("current_f", FIELD.report);
  if (kind === "light" && !("on" in request) && !("brightness" in request)) errors.add("on", FIELD.onOff);
  if (kind === "plug" && !("on" in request)) errors.add("on", FIELD.onOff);
  if (kind === "thermostat" && !report && !("setpoint_f" in request)) errors.add("setpoint_f", FIELD.setpoint);
  errors.throwIfAny();
  if (kind === "light") {
    const light = current as LightState;
    const brightness = typeof request.brightness === "number" ? request.brightness : light.brightness;
    const on = typeof request.on === "boolean" ? request.on : "brightness" in request ? true : light.on;
    return { on, brightness };
  }
  if (kind === "plug") return { on: request.on === true };
  const thermostat = current as ThermostatState;
  return {
    setpoint_f: typeof request.setpoint_f === "number" ? request.setpoint_f : thermostat.setpoint_f,
    current_f: typeof request.current_f === "number" ? request.current_f : thermostat.current_f,
  };
}

async function lockDevice(client: pg.PoolClient, deviceId: string): Promise<DeviceRow> {
  const [row] = await rows<DeviceRow>(client, `SELECT ${COLUMNS} FROM devices WHERE id = $1 FOR UPDATE`, [deviceId]);
  if (!row) throw ApiError.of("not_found");
  return row;
}

async function write(client: Queryable, row: DeviceRow, online: boolean, state: DeviceState): Promise<Device> {
  const [saved] = await rows<DeviceRow>(
    client,
    `UPDATE devices SET online = $2, state = $3, revision = revision + 1, updated_at = $4 WHERE id = $1 RETURNING ${COLUMNS}`,
    [row.id, online, JSON.stringify(state), new Date(hubNow())],
  );
  return toDevice(saved as DeviceRow);
}

/** PUT /api/devices/{id}/state */
export function changeDeviceState(deviceId: string, body: unknown): Promise<Device> {
  return inOrder(deviceId, async () => {
    const device = await transaction(async (client) => {
      const row = await lockDevice(client, deviceId);
      if (!row.online) throw ApiError.of("device_offline", row.name);
      return write(client, row, row.online, nextState(row.kind, row.state, body, false));
    });
    broadcast({ type: "device", device });
    return device;
  });
}

/** POST /api/sim/devices/{id}/report */
export function reportDevice(deviceId: string, body: unknown): Promise<Device> {
  return inOrder(deviceId, async () => {
    const device = await transaction(async (client) => {
      const row = await lockDevice(client, deviceId);
      const request = isObject(body) ? body : {};
      const errors = new FieldErrors();
      if (!("online" in request) && !("state" in request)) errors.add("body", FIELD.report);
      if ("online" in request && typeof request.online !== "boolean") errors.add("online", FIELD.onOff);
      errors.throwIfAny();
      const state = "state" in request ? nextState(row.kind, row.state, request.state, true) : row.state;
      return write(client, row, (request.online as boolean | undefined) ?? row.online, state);
    });
    broadcast({ type: "device", device });
    return device;
  });
}

/** Scenes drive devices: online lights take the scene's brightness (0 = off), thermostats its setpoint. */
export async function applyScene(roomId: string, scene: Scene): Promise<void> {
  const targets = await rows<{ id: string }>(
    pool, "SELECT id FROM devices WHERE room_id = $1 AND kind IN ('light', 'thermostat') ORDER BY position", [roomId],
  );
  for (const { id } of targets) {
    await inOrder(id, async () => {
      const device = await transaction(async (client) => {
        const row = await lockDevice(client, id);
        if (!row.online) return null;
        let state: DeviceState;
        if (row.kind === "light") {
          const light = row.state as { on: boolean; brightness: number };
          state = scene.brightness === 0 ? { on: false, brightness: light.brightness } : { on: true, brightness: scene.brightness };
        } else {
          if (scene.setpoint_f === null) return null;
          state = { ...(row.state as { setpoint_f: number; current_f: number }), setpoint_f: scene.setpoint_f };
        }
        if (sameState(state, row.state)) return null;
        return write(client, row, true, state);
      });
      if (device) broadcast({ type: "device", device });
    });
  }
}
