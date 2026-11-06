import { randomUUID, createHash } from 'node:crypto';
import { query, transaction } from '../db';
import { queueDueScheduleNotices, reconcileOwners } from '../engine';
import { isGuestClosed, initialGuestState, MAX_GUEST_DAYS, guestWindowsOverlap } from '../domain/guest';
import { planChanges, ownerAt, scheduleForDay } from '../domain/owner';
import {
  addDays,
  dayEnd,
  dayHours,
  dayStart,
  formatInstant,
  hourMarks,
  householdDayOf,
  isValidDay,
  isValidWallTime,
  parseWallDateTime,
  resolveWallInstant,
  type HouseholdDay,
} from '../domain/time';
import {
  loadClip,
  loadClips,
  loadDevice,
  loadDevices,
  loadGuestScene,
  loadGuestScenes,
  loadNotices,
  loadRooms,
  loadRuns,
  loadScenes,
  loadSchedules,
  toClip,
  toDevice,
  toGuestScene,
  toNotice,
  toRoom,
  toRun,
  toScene,
  toSchedule,
  writeDeviceState,
  type GuestSceneRow,
  type SceneRow,
} from '../repo';
import { broadcast, publishStatus } from '../services/broadcast';
import { hubNow } from '../services/hubClock';
import { serviceHealth } from '../services/health';
import { getObject, StorageUnavailable } from '../services/storage';
import { buildStatus, loadOwnerContext } from '../status';
import { TINTS, type LightState, type PlugState, type ThermostatState } from '../shared/types';
import { apiError, fieldMessage } from './errors';
import { asObject, FieldErrors, isInteger, isStringArray, truncateToMinute } from './validate';

export interface ApiRequestContext {
  method: string;
  segments: string[];
  search: URLSearchParams;
  body: unknown;
  rawBody: Buffer;
  idempotencyKey: string | undefined;
}

export type ApiResult =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'binary'; status: number; contentType: string; body: Buffer };

function json(status: number, body: unknown): ApiResult {
  return { kind: 'json', status, body };
}

function requireDayParam(search: URLSearchParams): HouseholdDay {
  const value = search.get('day');
  if (value === null) return householdDayOf(hubNow());
  if (!isValidDay(value)) throw apiError.invalid({ day: fieldMessage.day });
  return value;
}

export async function handleApi(context: ApiRequestContext): Promise<ApiResult> {
  const { method, segments } = context;
  const [first, second, third] = segments;

  if (method === 'GET' && segments.length === 1 && first === 'status') {
    return json(200, await buildStatus());
  }
  if (method === 'GET' && segments.length === 1 && first === 'plan') {
    return json(200, await getPlan(requireDayParam(context.search)));
  }
  if (method === 'GET' && segments.length === 1 && first === 'rooms') {
    return json(200, await getRooms());
  }
  if (method === 'GET' && segments.length === 1 && first === 'scenes') {
    const scenes = await loadScenes();
    return json(200, { scenes: scenes.map(toScene) });
  }
  if (method === 'POST' && segments.length === 1 && first === 'scenes') {
    return await createScene(context.body);
  }
  if (method === 'PUT' && segments.length === 2 && first === 'scenes' && second) {
    return await updateScene(second, context.body);
  }
  if (method === 'GET' && segments.length === 1 && first === 'schedules') {
    const schedules = await loadSchedules();
    return json(200, { schedules: schedules.map(toSchedule) });
  }
  if (method === 'GET' && segments.length === 2 && first === 'schedules' && second) {
    const schedules = await loadSchedules();
    const schedule = schedules.find((candidate) => candidate.id === second);
    if (!schedule) throw apiError.notFound();
    return json(200, { schedule: toSchedule(schedule) });
  }
  if (method === 'PUT' && segments.length === 2 && first === 'schedules' && second) {
    return await saveSchedule(second, context.body);
  }
  if (method === 'GET' && segments.length === 1 && first === 'devices') {
    const roomId = context.search.get('room_id');
    const devices = await loadDevices(roomId ?? undefined);
    return json(200, { devices: devices.map(toDevice) });
  }
  if (
    method === 'PUT' &&
    segments.length === 3 &&
    first === 'devices' &&
    second &&
    third === 'state'
  ) {
    return await setDeviceState(second, context.body);
  }
  if (method === 'GET' && segments.length === 1 && first === 'guest-scenes') {
    const rows = await loadGuestScenes();
    return json(200, { guest_scenes: rows.map(toGuestScene) });
  }
  if (method === 'POST' && segments.length === 1 && first === 'guest-scenes') {
    return await createGuestScene(context);
  }
  if (
    method === 'POST' &&
    segments.length === 3 &&
    first === 'guest-scenes' &&
    second &&
    third === 'cancel'
  ) {
    return await cancelGuestScene(second);
  }
  if (method === 'GET' && segments.length === 1 && first === 'runs') {
    const day = requireDayParam(context.search);
    const runs = await loadRuns(day);
    return json(200, { day, runs: runs.map(toRun) });
  }
  if (method === 'GET' && segments.length === 1 && first === 'clips') {
    const day = requireDayParam(context.search);
    const clips = await loadClips(day);
    return json(200, { day, clips: clips.map(toClip) });
  }
  if (method === 'GET' && segments.length === 2 && first === 'clips' && second) {
    const clip = await loadClip(second);
    if (!clip) throw apiError.notFound();
    return json(200, { clip: toClip(clip) });
  }
  if (
    method === 'GET' &&
    segments.length === 3 &&
    first === 'clips' &&
    second &&
    third === 'media'
  ) {
    return await getClipMedia(second);
  }
  if (method === 'GET' && segments.length === 1 && first === 'notices') {
    const notices = await loadNotices();
    return json(200, { notices: notices.map(toNotice) });
  }

  throw apiError.notFound();
}

async function getRooms(): Promise<unknown> {
  const [rooms, devices] = await Promise.all([loadRooms(), loadDevices()]);
  return {
    rooms: rooms.map((room) =>
      toRoom(
        room,
        devices.filter((device) => device.room_id === room.id).map((device) => device.id),
      ),
    ),
  };
}

async function getPlan(day: HouseholdDay): Promise<unknown> {
  const context = await loadOwnerContext();
  const schedule = scheduleForDay(context.schedules, day);
  const start = dayStart(day);
  return {
    day,
    schedule_id: schedule.id,
    hours: dayHours(day),
    start: formatInstant(start),
    end: formatInstant(dayEnd(day)),
    hour_marks: hourMarks(day),
    rooms: context.rooms.map((room) => ({
      room_id: room.id,
      name: room.name,
      order: room.plan_order,
    })),
    start_owners: context.rooms.map((room) => {
      const owner = ownerAt(context, room.id, start);
      return {
        room_id: room.id,
        scene_id: owner.scene_id,
        since: owner.since ? formatInstant(owner.since) : null,
        source: owner.source,
        guest_scene_id: owner.guest_scene_id,
      };
    }),
    changes: planChanges(context, day),
  };
}

interface SceneInput {
  name: string;
  tint: string;
  brightness: number;
  setpoint_f: number | null;
}

function readSceneInput(body: unknown, scenes: readonly SceneRow[], selfId: string | null): SceneInput {
  const input = asObject(body);
  const errors = new FieldErrors();

  const rawName = input['name'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > 40) {
    errors.add('name', fieldMessage.sceneName);
  } else if (
    scenes.some(
      (scene) => scene.id !== selfId && scene.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    errors.add('name', fieldMessage.sceneNameTaken);
  }

  const tint = input['tint'];
  if (typeof tint !== 'string' || !TINTS.includes(tint as never)) {
    errors.add('tint', fieldMessage.tint);
  }

  const brightness = input['brightness'];
  if (!isInteger(brightness, 0, 100)) errors.add('brightness', fieldMessage.sceneBrightness);

  const rawSetpoint = input['setpoint_f'];
  const setpointGiven = rawSetpoint !== null && rawSetpoint !== undefined;
  if (setpointGiven && !isInteger(rawSetpoint, 60, 80)) {
    errors.add('setpoint_f', fieldMessage.setpoint);
  }

  if (!errors.empty) throw apiError.invalid(errors.all);
  return {
    name,
    tint: tint as string,
    brightness: brightness as number,
    setpoint_f: setpointGiven ? (rawSetpoint as number) : null,
  };
}

async function createScene(body: unknown): Promise<ApiResult> {
  const scenes = await loadScenes();
  const input = readSceneInput(body, scenes, null);
  const nextOrder = scenes.reduce((max, scene) => Math.max(max, scene.catalogue_order), 0) + 1;
  const rows = await query<SceneRow>(
    `insert into scenes (id, name, tint, brightness, setpoint_f, catalogue_order)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, tint, brightness, setpoint_f, catalogue_order`,
    [randomUUID(), input.name, input.tint, input.brightness, input.setpoint_f, nextOrder],
  );
  const row = rows[0];
  if (!row) throw new Error('Scene insert returned nothing');
  broadcast({ type: 'scene', scene: toScene(row) });
  return json(201, { scene: toScene(row) });
}

async function updateScene(id: string, body: unknown): Promise<ApiResult> {
  const scenes = await loadScenes();
  if (!scenes.some((scene) => scene.id === id)) throw apiError.notFound();
  const input = readSceneInput(body, scenes, id);
  const rows = await query<SceneRow>(
    `update scenes set name = $2, tint = $3, brightness = $4, setpoint_f = $5
     where id = $1
     returning id, name, tint, brightness, setpoint_f, catalogue_order`,
    [id, input.name, input.tint, input.brightness, input.setpoint_f],
  );
  const row = rows[0];
  if (!row) throw new Error('Scene update returned nothing');
  broadcast({ type: 'scene', scene: toScene(row) });
  return json(200, { scene: toScene(row) });
}

interface SlotInput {
  time: string;
  scene_id: string;
  room_ids: string[];
}

async function saveSchedule(id: string, body: unknown): Promise<ApiResult> {
  const schedules = await loadSchedules();
  const schedule = schedules.find((candidate) => candidate.id === id);
  if (!schedule) throw apiError.notFound();

  const input = asObject(body);
  const revision = input['revision'];
  if (isInteger(revision, 0, Number.MAX_SAFE_INTEGER) && revision !== schedule.revision) {
    throw apiError.scheduleChanged();
  }

  const errors = new FieldErrors();
  if (!isInteger(revision, 0, Number.MAX_SAFE_INTEGER)) {
    errors.add('revision', fieldMessage.revision);
  }

  const today = householdDayOf(hubNow());
  const from = input['from'];
  if (typeof from !== 'string' || !isValidDay(from)) {
    errors.add('from', fieldMessage.fromShape);
  } else if (from < today) {
    errors.add('from', fieldMessage.fromTooEarly);
  } else if (from > addDays(today, 366)) {
    errors.add('from', fieldMessage.fromTooLate);
  }

  const [scenes, rooms] = await Promise.all([loadScenes(), loadRooms()]);
  const rawSlots = input['slots'];
  const slots: SlotInput[] = [];
  if (!Array.isArray(rawSlots) || rawSlots.length < 1 || rawSlots.length > 48) {
    errors.add('slots', fieldMessage.slotsCount);
  } else {
    for (const [index, rawSlot] of rawSlots.entries()) {
      const slot = asObject(rawSlot);
      const time = slot['time'];
      if (typeof time !== 'string' || !isValidWallTime(time)) {
        errors.add(`slots.${index}.time`, fieldMessage.slotTime);
      }
      const sceneId = slot['scene_id'];
      if (typeof sceneId !== 'string' || !scenes.some((scene) => scene.id === sceneId)) {
        errors.add(`slots.${index}.scene_id`, fieldMessage.slotScene);
      }
      const roomIds = slot['room_ids'];
      const roomsValid =
        isStringArray(roomIds) &&
        roomIds.length > 0 &&
        new Set(roomIds).size === roomIds.length &&
        roomIds.every((roomId) => rooms.some((room) => room.id === roomId));
      if (!roomsValid) errors.add(`slots.${index}.room_ids`, fieldMessage.slotRooms);
      slots.push({
        time: typeof time === 'string' ? time : '',
        scene_id: typeof sceneId === 'string' ? sceneId : '',
        room_ids: isStringArray(roomIds) ? roomIds : [],
      });
    }
    for (const [index, slot] of slots.entries()) {
      const clash = slots.some(
        (other, otherIndex) =>
          otherIndex < index &&
          other.time === slot.time &&
          other.room_ids.some((roomId) => slot.room_ids.includes(roomId)),
      );
      if (clash) errors.add(`slots.${index}.time`, fieldMessage.slotRoomClash);
    }
  }

  if (!errors.empty) throw apiError.invalid(errors.all);

  const fromDay = from as HouseholdDay;
  const saved = await transaction(async (client) => {
    const bumped = await client.query<{ revision: number }>(
      'update schedules set revision = revision + 1 where id = $1 and revision = $2 returning revision',
      [id, revision],
    );
    if (bumped.rowCount === 0) return null;
    await client.query('delete from schedule_versions where schedule_id = $1 and from_date = $2', [
      id,
      fromDay,
    ]);
    const versionId = randomUUID();
    await client.query(
      'insert into schedule_versions (id, schedule_id, from_date, seeded) values ($1, $2, $3, false)',
      [versionId, id, fromDay],
    );
    const ordered = [...slots].sort((a, b) => a.time.localeCompare(b.time));
    for (const [index, slot] of ordered.entries()) {
      await client.query(
        'insert into schedule_slots (id, version_id, slot_time, scene_id, room_ids, ordinal) values ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), versionId, slot.time, slot.scene_id, slot.room_ids, index + 1],
      );
    }
    return bumped.rows[0]?.revision ?? null;
  });

  if (saved === null) throw apiError.scheduleChanged();

  broadcast({ type: 'schedule', schedule_id: id, revision: saved });
  await queueDueScheduleNotices(hubNow());
  await reconcileOwners();

  const after = (await loadSchedules()).find((candidate) => candidate.id === id);
  if (!after) throw new Error('Schedule vanished after save');
  return json(200, { schedule: toSchedule(after) });
}

async function setDeviceState(id: string, body: unknown): Promise<ApiResult> {
  const device = await loadDevice(id);
  if (!device) throw apiError.notFound();
  if (!device.online) throw apiError.deviceOffline(device.name);
  if (device.kind === 'camera') {
    throw apiError.invalid({ state: fieldMessage.noSuchSetting });
  }

  const input = asObject(body);
  const errors = new FieldErrors();
  const allowed =
    device.kind === 'light' ? ['on', 'brightness'] : device.kind === 'plug' ? ['on'] : ['setpoint_f'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) errors.add(key, fieldMessage.noSuchSetting);
  }

  if (device.kind === 'light') {
    const current = device.state as LightState;
    const hasOn = input['on'] !== undefined;
    const hasBrightness = input['brightness'] !== undefined;
    if (hasOn && typeof input['on'] !== 'boolean') errors.add('on', fieldMessage.on);
    if (hasBrightness && !isInteger(input['brightness'], 1, 100)) {
      errors.add('brightness', fieldMessage.deviceBrightness);
    }
    if (!hasOn && !hasBrightness) errors.add('on', fieldMessage.on);
    if (!errors.empty) throw apiError.invalid(errors.all);
    const next: LightState = {
      on: hasBrightness && !hasOn ? true : (input['on'] as boolean | undefined) ?? current.on,
      brightness: hasBrightness ? (input['brightness'] as number) : current.brightness,
    };
    return await writeAndBroadcast(id, next);
  }

  if (device.kind === 'plug') {
    if (typeof input['on'] !== 'boolean') errors.add('on', fieldMessage.on);
    if (!errors.empty) throw apiError.invalid(errors.all);
    const next: PlugState = { on: input['on'] as boolean };
    return await writeAndBroadcast(id, next);
  }

  const current = device.state as ThermostatState;
  if (!isInteger(input['setpoint_f'], 60, 80)) errors.add('setpoint_f', fieldMessage.setpoint);
  if (!errors.empty) throw apiError.invalid(errors.all);
  const next: ThermostatState = {
    setpoint_f: input['setpoint_f'] as number,
    current_f: current.current_f,
  };
  return await writeAndBroadcast(id, next);
}

async function writeAndBroadcast(
  id: string,
  state: LightState | PlugState | ThermostatState,
): Promise<ApiResult> {
  const row = await writeDeviceState(id, { state }, hubNow());
  broadcast({ type: 'device', device: toDevice(row) });
  return json(200, { device: toDevice(row) });
}

function readIdempotencyKey(key: string | undefined): void {
  if (key === undefined) return;
  if (!/^[\x21-\x7e]{1,100}$/.test(key)) {
    throw apiError.invalid({ 'Idempotency-Key': fieldMessage.idempotencyKey });
  }
}

async function createGuestScene(context: ApiRequestContext): Promise<ApiResult> {
  const key = context.idempotencyKey;
  const bodyHash = createHash('sha256').update(context.rawBody).digest('hex');
  if (key !== undefined && /^[\x21-\x7e]{1,100}$/.test(key)) {
    const stored = await query<{ body_hash: string; response_status: number; response_body: string }>(
      'select body_hash, response_status, response_body from idempotency_keys where key = $1',
      [key],
    );
    const row = stored[0];
    if (row) {
      if (row.body_hash !== bodyHash) throw apiError.idempotencyConflict();
      return json(row.response_status, JSON.parse(row.response_body));
    }
  }
  readIdempotencyKey(key);

  const now = hubNow();
  const input = asObject(context.body);
  const errors = new FieldErrors();
  const [rooms, scenes] = await Promise.all([loadRooms(), loadScenes()]);

  const roomId = input['room_id'];
  const room = rooms.find((candidate) => candidate.id === roomId);
  if (!room) errors.add('room_id', fieldMessage.roomId);
  const sceneId = input['scene_id'];
  const scene = scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) errors.add('scene_id', fieldMessage.sceneId);

  const rawStart = input['starts_at'];
  let startsAt: Date | null = null;
  if (rawStart === null || rawStart === undefined) {
    startsAt = truncateToMinute(now);
  } else if (typeof rawStart !== 'string' || parseWallDateTime(rawStart) === null) {
    errors.add('starts_at', fieldMessage.instantShape);
  } else {
    const parsed = parseWallDateTime(rawStart);
    if (!parsed) throw new Error('unreachable');
    const resolved = resolveWallInstant(parsed.day, parsed.time);
    if (!resolved) {
      errors.add('starts_at', fieldMessage.skippedTime);
    } else if (resolved.getTime() < truncateToMinute(now).getTime()) {
      errors.add('starts_at', fieldMessage.startNotPast);
    } else {
      startsAt = resolved;
    }
  }

  const rawEnd = input['ends_at'];
  let endsAt: Date | null = null;
  if (typeof rawEnd !== 'string' || parseWallDateTime(rawEnd) === null) {
    errors.add('ends_at', fieldMessage.instantShape);
  } else {
    const parsed = parseWallDateTime(rawEnd);
    if (!parsed) throw new Error('unreachable');
    const resolved = resolveWallInstant(parsed.day, parsed.time);
    if (!resolved) {
      errors.add('ends_at', fieldMessage.skippedTime);
    } else if (startsAt && resolved.getTime() <= startsAt.getTime()) {
      errors.add('ends_at', fieldMessage.endAfterStart);
    } else if (
      startsAt &&
      resolved.getTime() - startsAt.getTime() > MAX_GUEST_DAYS * 86_400_000
    ) {
      errors.add('ends_at', fieldMessage.endTooFar);
    } else {
      endsAt = resolved;
    }
  }

  if (!errors.empty) throw apiError.invalid(errors.all);
  if (!room || !scene || !startsAt || !endsAt) throw apiError.invalid(errors.all);

  const existing = await loadGuestScenes();
  const clash = existing.some(
    (candidate) =>
      candidate.room_id === room.id &&
      !isGuestClosed(candidate.state) &&
      guestWindowsOverlap(
        { starts_at: candidate.starts_at, ends_at: candidate.ends_at },
        { starts_at: startsAt, ends_at: endsAt },
      ),
  );
  if (clash) throw apiError.guestOverlap(room.name);

  const rows = await query<GuestSceneRow>(
    `insert into guest_scenes (id, room_id, scene_id, starts_at, ends_at, state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at`,
    [
      randomUUID(),
      room.id,
      scene.id,
      startsAt,
      endsAt,
      initialGuestState(startsAt, now),
      now,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Guest scene insert returned nothing');
  broadcast({ type: 'guest_scene', guest_scene: toGuestScene(row) });
  await reconcileOwners();
  await publishStatus();

  const result = json(201, { guest_scene: toGuestScene(row) });
  if (key !== undefined) {
    await query(
      `insert into idempotency_keys (key, body_hash, response_status, response_body, created_at)
       values ($1, $2, $3, $4, $5) on conflict (key) do nothing`,
      [key, bodyHash, 201, JSON.stringify(result.body), now],
    );
  }
  return result;
}

async function cancelGuestScene(id: string): Promise<ApiResult> {
  const row = await loadGuestScene(id);
  if (!row) throw apiError.notFound();
  if (isGuestClosed(row.state)) throw apiError.guestSceneClosed();
  const updated = await query<GuestSceneRow>(
    `update guest_scenes set state = 'cancelled', cancelled_at = $2
     where id = $1 and state in ('scheduled', 'active')
     returning id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at`,
    [id, hubNow()],
  );
  const after = updated[0];
  if (!after) throw apiError.guestSceneClosed();
  broadcast({ type: 'guest_scene', guest_scene: toGuestScene(after) });
  await reconcileOwners();
  await publishStatus();
  return json(200, { guest_scene: toGuestScene(after) });
}

async function getClipMedia(id: string): Promise<ApiResult> {
  const clip = await loadClip(id);
  if (!clip) throw apiError.notFound();
  if (clip.state !== 'stored') throw apiError.clipNotPlayable();
  if (serviceHealth().storage === 'down') throw apiError.storageUnavailable();
  try {
    const bytes = await getObject(clip.object_key);
    return { kind: 'binary', status: 200, contentType: 'video/mp4', body: bytes };
  } catch (error) {
    if (error instanceof StorageUnavailable) throw apiError.storageUnavailable();
    throw error;
  }
}
