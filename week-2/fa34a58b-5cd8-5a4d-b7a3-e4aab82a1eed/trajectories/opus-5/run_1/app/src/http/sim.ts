import { randomUUID } from 'node:crypto';
import { query } from '../db';
import { clipAcceptsBytes, clipObjectKey, confirmClip, isDeclaredSizeValid } from '../domain/clip';
import { formatInstant, householdDayOf, parseInstantText } from '../domain/time';
import { queueMotionNotice } from '../engine';
import {
  loadClip,
  loadDevice,
  toClip,
  toDevice,
  writeDeviceState,
  type ClipRow,
} from '../repo';
import { broadcast } from '../services/broadcast';
import { hubNow, moveHubClock } from '../services/hubClock';
import { serviceHealth } from '../services/health';
import {
  deleteObject,
  headObjectSize,
  putObject,
  StorageUnavailable,
} from '../services/storage';
import type { LightState, PlugState, ThermostatState } from '../shared/types';
import { apiError, fieldMessage } from './errors';
import { asObject, FieldErrors, isInteger } from './validate';
import type { ApiRequestContext, ApiResult } from './api';

function json(status: number, body: unknown): ApiResult {
  return { kind: 'json', status, body };
}

export async function handleSim(context: ApiRequestContext): Promise<ApiResult> {
  const { method, segments } = context;
  const [, second, third, fourth] = segments;

  if (method === 'GET' && segments.length === 2 && second === 'clock') {
    return json(200, { now: formatInstant(hubNow()) });
  }
  if (method === 'PUT' && segments.length === 2 && second === 'clock') {
    return setClock(context.body);
  }
  if (
    method === 'POST' &&
    segments.length === 4 &&
    second === 'devices' &&
    third &&
    fourth === 'report'
  ) {
    return await reportDevice(third, context.body);
  }
  if (
    method === 'POST' &&
    segments.length === 4 &&
    second === 'cameras' &&
    third &&
    fourth === 'clips'
  ) {
    return await announceClip(third, context.body);
  }
  if (
    method === 'PUT' &&
    segments.length === 4 &&
    second === 'clips' &&
    third &&
    fourth === 'bytes'
  ) {
    return await storeClipBytes(third, context.rawBody);
  }

  throw apiError.notFound();
}

function setClock(body: unknown): ApiResult {
  const input = asObject(body);
  const raw = input['now'];
  const parsed = typeof raw === 'string' ? parseInstantText(raw) : null;
  if (!parsed) throw apiError.invalid({ now: fieldMessage.instantWithOffset });
  moveHubClock(parsed);
  return json(200, { now: formatInstant(hubNow()) });
}

async function reportDevice(id: string, body: unknown): Promise<ApiResult> {
  const device = await loadDevice(id);
  if (!device) throw apiError.notFound();

  const input = asObject(body);
  const errors = new FieldErrors();
  const hasOnline = input['online'] !== undefined;
  const hasState = input['state'] !== undefined;
  if (!hasOnline && !hasState) throw apiError.invalid({ body: fieldMessage.deviceReportBody });
  if (hasOnline && typeof input['online'] !== 'boolean') errors.add('online', fieldMessage.on);

  let nextState: LightState | PlugState | ThermostatState | undefined;
  if (hasState) {
    if (device.kind === 'camera') {
      errors.add('state', fieldMessage.noSuchSetting);
    } else {
      const patch = asObject(input['state']);
      const allowed =
        device.kind === 'light'
          ? ['on', 'brightness']
          : device.kind === 'plug'
            ? ['on']
            : ['setpoint_f', 'current_f'];
      for (const key of Object.keys(patch)) {
        if (!allowed.includes(key)) errors.add(`state.${key}`, fieldMessage.noSuchSetting);
      }
      if (device.kind === 'light') {
        const current = device.state as LightState;
        if (patch['on'] !== undefined && typeof patch['on'] !== 'boolean') {
          errors.add('state.on', fieldMessage.on);
        }
        if (patch['brightness'] !== undefined && !isInteger(patch['brightness'], 1, 100)) {
          errors.add('state.brightness', fieldMessage.deviceBrightness);
        }
        nextState = {
          on: (patch['on'] as boolean | undefined) ?? current.on,
          brightness: (patch['brightness'] as number | undefined) ?? current.brightness,
        };
      } else if (device.kind === 'plug') {
        const current = device.state as PlugState;
        if (patch['on'] !== undefined && typeof patch['on'] !== 'boolean') {
          errors.add('state.on', fieldMessage.on);
        }
        nextState = { on: (patch['on'] as boolean | undefined) ?? current.on };
      } else {
        const current = device.state as ThermostatState;
        if (patch['setpoint_f'] !== undefined && !isInteger(patch['setpoint_f'], 60, 80)) {
          errors.add('state.setpoint_f', fieldMessage.setpoint);
        }
        if (patch['current_f'] !== undefined && !isInteger(patch['current_f'], 0, 200)) {
          errors.add('state.current_f', fieldMessage.setpoint);
        }
        nextState = {
          setpoint_f: (patch['setpoint_f'] as number | undefined) ?? current.setpoint_f,
          current_f: (patch['current_f'] as number | undefined) ?? current.current_f,
        };
      }
    }
  }

  if (!errors.empty) throw apiError.invalid(errors.all);

  const row = await writeDeviceState(
    id,
    {
      ...(hasOnline ? { online: input['online'] as boolean } : {}),
      ...(nextState ? { state: nextState } : {}),
    },
    hubNow(),
  );
  broadcast({ type: 'device', device: toDevice(row) });
  return json(200, { device: toDevice(row) });
}

async function announceClip(cameraId: string, body: unknown): Promise<ApiResult> {
  const device = await loadDevice(cameraId);
  if (!device || device.kind !== 'camera') throw apiError.notFound();

  const input = asObject(body);
  const errors = new FieldErrors();
  const rawRecorded = input['recorded_at'];
  const recordedAt = typeof rawRecorded === 'string' ? parseInstantText(rawRecorded) : null;
  if (!recordedAt) errors.add('recorded_at', fieldMessage.instantWithOffset);
  const declaredSize = input['declared_size'];
  if (!isDeclaredSizeValid(declaredSize)) {
    errors.add('declared_size', fieldMessage.declaredSize);
  }
  if (!errors.empty) throw apiError.invalid(errors.all);
  if (!recordedAt || !isDeclaredSizeValid(declaredSize)) throw apiError.invalid(errors.all);

  const clipId = randomUUID();
  const day = householdDayOf(recordedAt);
  await query(
    `insert into clips (id, camera_id, recorded_at, day, declared_size, stored_size, state, object_key)
     values ($1, $2, $3, $4, $5, null, 'announced', $6)`,
    [clipId, cameraId, recordedAt, day, declaredSize, clipObjectKey(cameraId, day, clipId)],
  );
  const clip = await loadClip(clipId);
  if (!clip) throw new Error('Clip insert returned nothing');
  broadcast({ type: 'clip', clip: toClip(clip) });
  return json(201, { clip: toClip(clip) });
}

async function setClipState(
  id: string,
  state: ClipRow['state'],
  storedSize: number | null,
): Promise<ClipRow> {
  await query('update clips set state = $2, stored_size = $3 where id = $1', [
    id,
    state,
    storedSize,
  ]);
  const clip = await loadClip(id);
  if (!clip) throw new Error(`Clip ${id} vanished`);
  broadcast({ type: 'clip', clip: toClip(clip) });
  return clip;
}

async function storeClipBytes(id: string, bytes: Buffer): Promise<ApiResult> {
  const clip = await loadClip(id);
  if (!clip) throw apiError.notFound();
  if (!clipAcceptsBytes(clip.state)) throw apiError.clipClosed();

  if (clip.state === 'announced') await setClipState(id, 'storing', null);
  if (serviceHealth().storage === 'down') throw apiError.storageUnavailable();

  const declaredSize = Number(clip.declared_size);
  try {
    await putObject(clip.object_key, bytes, 'video/mp4');
    const reported = await headObjectSize(clip.object_key);
    if (reported === null) throw apiError.storageUnavailable();
    const confirmation = confirmClip(declaredSize, reported);
    if (confirmation.state === 'size_mismatch') {
      await deleteObject(clip.object_key);
      await setClipState(id, 'size_mismatch', confirmation.stored_size);
      throw apiError.sizeMismatch(confirmation.stored_size, declaredSize);
    }
    const stored = await setClipState(id, 'stored', confirmation.stored_size);
    await queueMotionNotice(stored);
    return json(200, { clip: toClip(stored) });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw apiError.storageUnavailable();
    throw error;
  }
}
