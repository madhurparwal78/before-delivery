import { randomUUID } from 'node:crypto';
import { pool, query } from '../db.js';
import { config } from '../config.js';
import { COPY_ID, accountsInSession } from '../presence.js';
import { appendEvent } from '../realtime/streams.js';
import { postSystemMessage } from '../chat.js';
import { publish } from '../realtime/bus.js';
import {
  CHECKPOINT,
  CHECKPOINT_RADIUS,
  GATE,
  GATE_RADIUS,
  GROUND_LIMIT,
  MAX_HEALTH,
  MOTE_LAYOUT,
  MOTE_RADIUS,
  MOVE_PER_TICK,
  PUDDLE,
  PUDDLE_DAMAGE_PER_TICK,
  SPAWN,
  TICKS_PER_SECOND,
} from '../../shared/constants.js';
import { roundHalfAway } from '../../shared/pose.js';
import type {
  EmoteName,
  Mote,
  SessionHero,
  SessionMember,
  Snapshot,
  Stats,
  Stroke,
  StoryMode,
} from '../../shared/types.js';
import {
  completeChapter,
  readProgress,
  saveCheckpoint,
  type ProgressScope,
} from '../domain/progress.js';

const TICK_MS = 1000 / TICKS_PER_SECOND;
const SNAPSHOT_INTERVAL_MS = 100;
const DROP_SCAN_MS = 400;
// Each tick is written, so a resumed session never replays a tick it already ran.
const PERSIST_INTERVAL_MS = 50;
/** Another copy takes a session over only after the stepping copy goes quiet this long. */
const STEPPER_TAKEOVER_MS = 5000;

export type SessionStatus = 'running' | 'complete' | 'ended';

interface MemberState {
  account_id: string;
  display_name: string;
  x: number;
  z: number;
  health: number;
  target: { x: number; z: number } | null;
  status: 'connected' | 'dropped';
  dropped_at: number | null;
  arrived: boolean;
  last_swing_tick: number | null;
  inside_checkpoint: boolean;
  last_damage_tick: number | null;
}

interface QueuedIntent {
  accountId: string;
  intentId: string;
  action: 'move_to' | 'swing' | 'emote';
  x?: number;
  z?: number;
  emote?: EmoteName;
}

interface SessionRuntime {
  id: string;
  story_id: string;
  chapter: number;
  mode: StoryMode;
  status: SessionStatus;
  tick: number;
  gate_open: boolean;
  checkpoint_reached: boolean;
  motes: Mote[];
  members: MemberState[];
  party_id: string | null;
  owner_account_id: string | null;
  queue: QueuedIntent[];
  lastTickAt: number;
  lastPersistAt: number;
  lastSnapshotAt: number;
  lastScanAt: number;
}

export interface IntentAck {
  applied: boolean;
  duplicate: boolean;
  tick: number;
  reason: null | 'cooldown' | 'out_of_bounds' | 'no_weapon';
}

type SnapshotListener = (sessionId: string, snapshot: Snapshot) => void;

const runtimes = new Map<string, SessionRuntime>();
const snapshotListeners: SnapshotListener[] = [];
const ackWaiters = new Map<string, (ack: IntentAck) => void>();

export function onSnapshot(listener: SnapshotListener): void {
  snapshotListeners.push(listener);
}

function notifyParty(partyId: string | null): void {
  if (partyId === null) return;
  void publish({ kind: 'party', party_id: partyId });
}

function scopeFor(runtime: SessionRuntime): ProgressScope {
  return runtime.party_id === null
    ? { kind: 'solo', accountId: runtime.owner_account_id ?? '' }
    : { kind: 'party', partyId: runtime.party_id };
}

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

// --- persistence -------------------------------------------------------------

interface SessionRow {
  id: string;
  story_id: string;
  chapter: number;
  mode: StoryMode;
  status: SessionStatus;
  tick: string;
  gate_open: boolean;
  checkpoint_reached: boolean;
  motes: Mote[];
  members: MemberState[];
  party_id: string | null;
  owner_account_id: string | null;
}

async function persist(runtime: SessionRuntime): Promise<void> {
  runtime.lastPersistAt = Date.now();
  await pool.query(
    `UPDATE game_sessions SET status = $2, tick = $3, gate_open = $4, checkpoint_reached = $5,
            motes = $6, members = $7, stepper_id = $8, stepper_at = now(), updated_at = now()
     WHERE id = $1`,
    [
      runtime.id,
      runtime.status,
      runtime.tick,
      runtime.gate_open,
      runtime.checkpoint_reached,
      JSON.stringify(runtime.motes),
      JSON.stringify(runtime.members),
      COPY_ID,
    ],
  );
}

function rowToRuntime(row: SessionRow): SessionRuntime {
  const now = Date.now();
  return {
    id: row.id,
    story_id: row.story_id,
    chapter: row.chapter,
    mode: row.mode,
    status: row.status,
    tick: Number(row.tick),
    gate_open: row.gate_open,
    checkpoint_reached: row.checkpoint_reached,
    motes: row.motes,
    members: row.members.map((member) => ({
      ...member,
      status: 'dropped',
      dropped_at: now,
      arrived: true,
      target: null,
    })),
    party_id: row.party_id,
    owner_account_id: row.owner_account_id,
    queue: [],
    lastTickAt: now,
    lastPersistAt: 0,
    lastSnapshotAt: 0,
    lastScanAt: now,
  };
}

// --- creation ----------------------------------------------------------------

export interface CreateSessionInput {
  storyId: string;
  chapter: number;
  mode: StoryMode;
  members: { account_id: string; display_name: string }[];
  partyId: string | null;
  ownerAccountId: string | null;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<{ session_id: string; chapter: number; resumed_from_checkpoint: boolean }> {
  const scope: ProgressScope =
    input.partyId === null
      ? { kind: 'solo', accountId: input.ownerAccountId ?? '' }
      : { kind: 'party', partyId: input.partyId };
  const progress = await readProgress(scope, input.storyId);
  const checkpoint =
    progress.checkpoint !== null && progress.checkpoint.chapter === input.chapter
      ? progress.checkpoint
      : null;

  const start = checkpoint === null ? SPAWN : CHECKPOINT;
  const motes: Mote[] = MOTE_LAYOUT.map((mote) => ({
    id: mote.id,
    x: mote.x,
    z: mote.z,
    collected_by: checkpoint?.motes.includes(mote.id) ? (input.members[0]?.account_id ?? null) : null,
  }));

  const id = randomUUID();
  const members: MemberState[] = input.members.map((member) => ({
    account_id: member.account_id,
    display_name: member.display_name,
    x: start.x,
    z: start.z,
    health: MAX_HEALTH,
    target: null,
    status: 'connected',
    dropped_at: null,
    arrived: false,
    last_swing_tick: null,
    inside_checkpoint: checkpoint !== null,
    last_damage_tick: null,
  }));

  await pool.query(
    `INSERT INTO game_sessions
       (id, story_id, chapter, mode, status, tick, gate_open, checkpoint_reached, motes, members,
        party_id, owner_account_id, stepper_id, stepper_at)
     VALUES ($1, $2, $3, $4, 'running', 0, $5, $6, $7, $8, $9, $10, $11, now())`,
    [
      id,
      input.storyId,
      input.chapter,
      input.mode,
      motes.every((mote) => mote.collected_by !== null),
      checkpoint !== null,
      JSON.stringify(motes),
      JSON.stringify(members),
      input.partyId,
      input.ownerAccountId,
      COPY_ID,
    ],
  );

  const runtime: SessionRuntime = {
    id,
    story_id: input.storyId,
    chapter: input.chapter,
    mode: input.mode,
    status: 'running',
    tick: 0,
    gate_open: motes.every((mote) => mote.collected_by !== null),
    checkpoint_reached: checkpoint !== null,
    motes,
    members,
    party_id: input.partyId,
    owner_account_id: input.ownerAccountId,
    queue: [],
    lastTickAt: Date.now(),
    lastPersistAt: Date.now(),
    lastSnapshotAt: 0,
    lastScanAt: Date.now(),
  };
  runtimes.set(id, runtime);
  return { session_id: id, chapter: input.chapter, resumed_from_checkpoint: checkpoint !== null };
}

/** Starting a new solo session ends the player's running solo session. */
export async function endRunningSoloSessions(accountId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM game_sessions WHERE owner_account_id = $1 AND party_id IS NULL AND status = 'running'`,
    [accountId],
  );
  for (const row of rows) {
    const runtime = runtimes.get(row.id);
    if (runtime) {
      runtime.status = 'ended';
      await persist(runtime);
      runtimes.delete(row.id);
    } else {
      await pool.query(`UPDATE game_sessions SET status = 'ended' WHERE id = $1`, [row.id]);
    }
  }
}

// --- snapshot ----------------------------------------------------------------

interface HeroBundle {
  hero: SessionHero;
  weapon: { strokes: Stroke[]; stats: Stats } | null;
  hasModel: boolean;
}

const heroCache = new Map<string, { at: number; bundle: HeroBundle }>();
const HERO_CACHE_MS = 300;

const FALLBACK_HERO: SessionHero = {
  name: 'Linewright',
  parts: { head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' },
  proportions: {
    head_size: 1,
    neck_length: 1,
    spine_length: 1,
    upper_arm_length: 1,
    forearm_length: 1,
    thigh_length: 1,
    shin_length: 1,
  },
  pose: { right_arm_raise: 0 },
  material: 'graphite',
  accessories: { head: 'none', back: 'none', left_hand: 'none' },
};

async function heroBundle(accountId: string): Promise<HeroBundle> {
  const cached = heroCache.get(accountId);
  if (cached && Date.now() - cached.at < HERO_CACHE_MS) return cached.bundle;
  const rows = await query<{
    name: string;
    parts: SessionHero['parts'];
    proportions: SessionHero['proportions'];
    pose: SessionHero['pose'];
    material: SessionHero['material'];
    accessories: SessionHero['accessories'];
    strokes: Stroke[] | null;
    stats: Stats | null;
    model_status: string | null;
  }>(
    `SELECT c.name, c.parts, c.proportions, c.pose, c.material, c.accessories,
            w.strokes, w.stats, m.status AS model_status
     FROM accounts a
     JOIN characters c ON c.id = a.equipped_character_id
     LEFT JOIN weapons w ON w.id = c.weapon_id
     LEFT JOIN models m ON m.id = c.model_id
     WHERE a.id = $1`,
    [accountId],
  );
  const row = rows[0];
  const bundle: HeroBundle = row
    ? {
        hero: {
          name: row.name,
          parts: row.parts,
          proportions: row.proportions,
          pose: row.pose,
          material: row.material,
          accessories: row.accessories,
        },
        weapon: row.strokes && row.stats ? { strokes: row.strokes, stats: row.stats } : null,
        hasModel: row.model_status === 'accepted' || row.model_status === 'equipped',
      }
    : { hero: FALLBACK_HERO, weapon: null, hasModel: false };
  heroCache.set(accountId, { at: Date.now(), bundle });
  return bundle;
}

function graceRemaining(member: MemberState): number | null {
  if (member.status !== 'dropped' || member.dropped_at === null) return null;
  const left = config.rejoinGraceSeconds * 1000 - (Date.now() - member.dropped_at);
  return Math.max(0, Math.ceil(left / 1000));
}

async function buildSnapshot(runtime: SessionRuntime): Promise<Snapshot> {
  const members: SessionMember[] = [];
  for (const member of runtime.members) {
    const bundle = await heroBundle(member.account_id);
    members.push({
      account_id: member.account_id,
      display_name: member.display_name,
      status: member.status,
      grace_remaining_seconds: graceRemaining(member),
      position: { x: roundHalfAway(member.x, 3), z: roundHalfAway(member.z, 3) },
      health: roundHalfAway(member.health, 3),
      hero: bundle.hero,
      weapon: bundle.weapon,
      model_url: bundle.hasModel
        ? `/api/sessions/${runtime.id}/members/${member.account_id}/model`
        : null,
    });
  }
  return {
    id: runtime.id,
    story_id: runtime.story_id,
    chapter: runtime.chapter,
    mode: runtime.mode,
    status: runtime.status === 'complete' ? 'complete' : 'running',
    tick: runtime.tick,
    gate_open: runtime.gate_open,
    checkpoint_reached: runtime.checkpoint_reached,
    motes: runtime.motes,
    members,
  };
}

export async function snapshotFor(sessionId: string): Promise<Snapshot | null> {
  const runtime = runtimes.get(sessionId);
  if (runtime) return buildSnapshot(runtime);
  const rows = await query<SessionRow>('SELECT * FROM game_sessions WHERE id = $1', [sessionId]);
  const row = rows[0];
  if (row === undefined || row.status === 'ended') return null;
  return buildSnapshot(rowToRuntime({ ...row, members: row.members }));
}

export async function sessionRecord(sessionId: string): Promise<{
  status: SessionStatus;
  story_id: string;
  chapter: number;
  party_id: string | null;
  members: { account_id: string }[];
} | null> {
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    return {
      status: runtime.status,
      story_id: runtime.story_id,
      chapter: runtime.chapter,
      party_id: runtime.party_id,
      members: runtime.members.map((member) => ({ account_id: member.account_id })),
    };
  }
  const rows = await query<SessionRow>('SELECT * FROM game_sessions WHERE id = $1', [sessionId]);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    status: row.status,
    story_id: row.story_id,
    chapter: row.chapter,
    party_id: row.party_id,
    members: row.members.map((member) => ({ account_id: member.account_id })),
  };
}

export function isSessionMember(sessionId: string, accountId: string): boolean {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  return runtime.members.some((member) => member.account_id === accountId);
}

// --- joining and intents -----------------------------------------------------

export type JoinOutcome =
  | { kind: 'joined'; tick: number }
  | { kind: 'not_a_member' }
  | { kind: 'session_ended' }
  | { kind: 'session_complete'; story_id: string; chapter: number };

/**
 * A running session written by a copy that has stopped is taken over here, so a
 * member who reconnects right after a restart waits for the resume instead of
 * being told the session ended.
 */
async function waitForRuntime(sessionId: string): Promise<SessionRuntime | undefined> {
  const deadline = Date.now() + STEPPER_TAKEOVER_MS + 2000;
  for (;;) {
    const runtime = runtimes.get(sessionId);
    if (runtime !== undefined) return runtime;
    await adoptOrphans();
    const adopted = runtimes.get(sessionId);
    if (adopted !== undefined) return adopted;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function joinSession(sessionId: string, accountId: string): Promise<JoinOutcome> {
  const record = await sessionRecord(sessionId);
  if (record === null) return { kind: 'not_a_member' };
  if (!record.members.some((member) => member.account_id === accountId)) {
    return { kind: 'not_a_member' };
  }
  if (record.status === 'complete') {
    return { kind: 'session_complete', story_id: record.story_id, chapter: record.chapter };
  }
  if (record.status === 'ended') return { kind: 'session_ended' };

  const runtime = await waitForRuntime(sessionId);
  if (runtime === undefined) return { kind: 'session_ended' };
  const member = runtime.members.find((entry) => entry.account_id === accountId);
  if (member === undefined) return { kind: 'not_a_member' };

  const wasDropped = member.status === 'dropped';
  member.arrived = true;
  member.status = 'connected';
  member.dropped_at = null;
  if (wasDropped) {
    await onRejoined(runtime, member);
  }
  return { kind: 'joined', tick: runtime.tick };
}

export async function submitIntent(
  sessionId: string,
  accountId: string,
  intent: QueuedIntent,
): Promise<IntentAck> {
  const runtime = runtimes.get(sessionId);
  if (runtime === undefined || runtime.status !== 'running') {
    return { applied: false, duplicate: false, tick: runtime?.tick ?? 0, reason: null };
  }
  if (!runtime.members.some((member) => member.account_id === accountId)) {
    return { applied: false, duplicate: false, tick: runtime.tick, reason: null };
  }

  const inserted = await query<{ intent_id: string }>(
    `INSERT INTO processed_intents (session_id, account_id, intent_id, tick, applied)
     VALUES ($1, $2, $3, -1, false)
     ON CONFLICT DO NOTHING
     RETURNING intent_id`,
    [sessionId, accountId, intent.intentId],
  );
  if (inserted.length === 0) {
    const stored = await query<{ tick: string }>(
      `SELECT tick FROM processed_intents WHERE session_id = $1 AND account_id = $2 AND intent_id = $3`,
      [sessionId, accountId, intent.intentId],
    );
    return {
      applied: false,
      duplicate: true,
      tick: Math.max(0, Number(stored[0]?.tick ?? runtime.tick)),
      reason: null,
    };
  }

  const key = `${sessionId}:${accountId}:${intent.intentId}`;
  const ack = new Promise<IntentAck>((resolve) => ackWaiters.set(key, resolve));
  runtime.queue.push({ ...intent, accountId });
  return ack;
}

async function settleIntent(
  runtime: SessionRuntime,
  intent: QueuedIntent,
  ack: IntentAck,
): Promise<void> {
  await pool.query(
    `UPDATE processed_intents SET tick = $4, applied = $5, reason = $6
     WHERE session_id = $1 AND account_id = $2 AND intent_id = $3`,
    [runtime.id, intent.accountId, intent.intentId, ack.tick, ack.applied, ack.reason],
  );
  const key = `${runtime.id}:${intent.accountId}:${intent.intentId}`;
  const waiter = ackWaiters.get(key);
  if (waiter) {
    ackWaiters.delete(key);
    waiter(ack);
  }
}

// --- stepping ----------------------------------------------------------------

async function emit(runtime: SessionRuntime, payload: Record<string, unknown> & { kind: string }): Promise<void> {
  await appendEvent(`session:${runtime.id}`, payload);
}

function collectedCount(runtime: SessionRuntime): number {
  return runtime.motes.filter((mote) => mote.collected_by !== null).length;
}

async function collectMote(
  runtime: SessionRuntime,
  mote: Mote,
  member: MemberState,
): Promise<void> {
  mote.collected_by = member.account_id;
  await emit(runtime, {
    kind: 'pickup',
    account_id: member.account_id,
    display_name: member.display_name,
    mote_id: mote.id,
    collected: collectedCount(runtime),
    tick: runtime.tick,
  });
  if (collectedCount(runtime) === runtime.motes.length && !runtime.gate_open) {
    runtime.gate_open = true;
    await emit(runtime, { kind: 'gate_open', tick: runtime.tick });
  }
  await persist(runtime);
}

async function applyIntent(runtime: SessionRuntime, intent: QueuedIntent): Promise<void> {
  const member = runtime.members.find((entry) => entry.account_id === intent.accountId);
  if (member === undefined) {
    await settleIntent(runtime, intent, {
      applied: false,
      duplicate: false,
      tick: runtime.tick,
      reason: null,
    });
    return;
  }

  if (intent.action === 'move_to') {
    const x = intent.x ?? 0;
    const z = intent.z ?? 0;
    if (Math.abs(x) > GROUND_LIMIT || Math.abs(z) > GROUND_LIMIT) {
      await settleIntent(runtime, intent, {
        applied: false,
        duplicate: false,
        tick: runtime.tick,
        reason: 'out_of_bounds',
      });
      return;
    }
    member.target = { x, z };
    await settleIntent(runtime, intent, {
      applied: true,
      duplicate: false,
      tick: runtime.tick,
      reason: null,
    });
    return;
  }

  if (intent.action === 'emote') {
    await emit(runtime, {
      kind: 'emote',
      account_id: member.account_id,
      display_name: member.display_name,
      emote: intent.emote ?? 'wave',
      tick: runtime.tick,
    });
    await settleIntent(runtime, intent, {
      applied: true,
      duplicate: false,
      tick: runtime.tick,
      reason: null,
    });
    return;
  }

  const bundle = await heroBundle(member.account_id);
  if (bundle.weapon === null) {
    await settleIntent(runtime, intent, {
      applied: false,
      duplicate: false,
      tick: runtime.tick,
      reason: 'no_weapon',
    });
    return;
  }
  const cooldownTicks = TICKS_PER_SECOND / bundle.weapon.stats.swing_per_s;
  if (
    member.last_swing_tick !== null &&
    runtime.tick - member.last_swing_tick < cooldownTicks
  ) {
    await settleIntent(runtime, intent, {
      applied: false,
      duplicate: false,
      tick: runtime.tick,
      reason: 'cooldown',
    });
    return;
  }
  member.last_swing_tick = runtime.tick;
  const range = 1 + bundle.weapon.stats.reach_m;
  for (const mote of runtime.motes) {
    if (mote.collected_by !== null) continue;
    if (distance(member.x, member.z, mote.x, mote.z) <= range) {
      await collectMote(runtime, mote, member);
    }
  }
  await settleIntent(runtime, intent, {
    applied: true,
    duplicate: false,
    tick: runtime.tick,
    reason: null,
  });
}

async function stepOnce(runtime: SessionRuntime): Promise<void> {
  runtime.tick += 1;

  const queued = runtime.queue.splice(0, runtime.queue.length);
  for (const intent of queued) await applyIntent(runtime, intent);

  for (const member of runtime.members) {
    if (member.target !== null) {
      const gap = distance(member.x, member.z, member.target.x, member.target.z);
      if (gap <= MOVE_PER_TICK) {
        member.x = member.target.x;
        member.z = member.target.z;
        member.target = null;
      } else {
        member.x += ((member.target.x - member.x) / gap) * MOVE_PER_TICK;
        member.z += ((member.target.z - member.z) / gap) * MOVE_PER_TICK;
      }
    }
  }

  for (const member of runtime.members) {
    for (const mote of runtime.motes) {
      if (mote.collected_by !== null) continue;
      if (distance(member.x, member.z, mote.x, mote.z) <= MOTE_RADIUS) {
        await collectMote(runtime, mote, member);
      }
    }
  }

  for (const member of runtime.members) {
    const atCheckpoint =
      distance(member.x, member.z, CHECKPOINT.x, CHECKPOINT.z) <= CHECKPOINT_RADIUS;
    if (atCheckpoint && !member.inside_checkpoint) {
      member.inside_checkpoint = true;
      runtime.checkpoint_reached = true;
      await saveCheckpoint(
        scopeFor(runtime),
        runtime.story_id,
        runtime.chapter,
        runtime.motes.filter((mote) => mote.collected_by !== null).map((mote) => mote.id),
      );
      await emit(runtime, { kind: 'checkpoint', tick: runtime.tick });
      await persist(runtime);
    } else if (!atCheckpoint) {
      member.inside_checkpoint = false;
    }
  }

  for (const member of runtime.members) {
    if (distance(member.x, member.z, PUDDLE.x, PUDDLE.z) <= PUDDLE.radius) {
      member.health = Math.max(0, member.health - PUDDLE_DAMAGE_PER_TICK);
      if (member.last_damage_tick === null || runtime.tick - member.last_damage_tick >= TICKS_PER_SECOND) {
        member.last_damage_tick = runtime.tick;
        await emit(runtime, {
          kind: 'damage',
          account_id: member.account_id,
          display_name: member.display_name,
          health: roundHalfAway(member.health, 3),
          tick: runtime.tick,
        });
      }
      if (member.health <= 0) {
        const back = runtime.checkpoint_reached ? CHECKPOINT : SPAWN;
        member.x = back.x;
        member.z = back.z;
        member.health = MAX_HEALTH;
        member.target = null;
        member.last_damage_tick = null;
        await emit(runtime, {
          kind: 'knocked_out',
          account_id: member.account_id,
          display_name: member.display_name,
          tick: runtime.tick,
        });
      }
    }
  }

  if (runtime.gate_open) {
    const atGate = runtime.members.some(
      (member) => distance(member.x, member.z, GATE.x, GATE.z) <= GATE_RADIUS,
    );
    if (atGate) await completeSession(runtime);
  }
}

async function completeSession(runtime: SessionRuntime): Promise<void> {
  runtime.status = 'complete';
  await completeChapter(scopeFor(runtime), runtime.story_id, runtime.chapter);
  await emit(runtime, {
    kind: 'session_complete',
    story_id: runtime.story_id,
    chapter: runtime.chapter,
    tick: runtime.tick,
  });
  await persist(runtime);
  if (runtime.party_id !== null) {
    await pool.query(`UPDATE parties SET status = 'chapter_complete' WHERE id = $1`, [
      runtime.party_id,
    ]);
    notifyParty(runtime.party_id);
  }
  runtimes.delete(runtime.id);
}

// --- drops, rejoins and grace ------------------------------------------------

async function onDropped(runtime: SessionRuntime, member: MemberState): Promise<void> {
  await emit(runtime, {
    kind: 'member_dropped',
    account_id: member.account_id,
    display_name: member.display_name,
    grace_remaining_seconds: config.rejoinGraceSeconds,
    tick: runtime.tick,
  });
  if (runtime.party_id !== null) {
    await postSystemMessage(`party-${runtime.party_id}`, 'dropped', {
      name: member.display_name,
      seconds: config.rejoinGraceSeconds,
    });
    await pool.query(`UPDATE parties SET status = 'member_dropped' WHERE id = $1 AND status = 'in_session'`, [
      runtime.party_id,
    ]);
    notifyParty(runtime.party_id);
  }
  await persist(runtime);
}

async function onRejoined(runtime: SessionRuntime, member: MemberState): Promise<void> {
  await emit(runtime, {
    kind: 'member_rejoined',
    account_id: member.account_id,
    display_name: member.display_name,
    tick: runtime.tick,
  });
  if (runtime.party_id !== null) {
    await postSystemMessage(`party-${runtime.party_id}`, 'rejoined', {
      name: member.display_name,
    });
    if (!runtime.members.some((entry) => entry.status === 'dropped')) {
      await pool.query(
        `UPDATE parties SET status = 'in_session' WHERE id = $1 AND status = 'member_dropped'`,
        [runtime.party_id],
      );
    }
    notifyParty(runtime.party_id);
  }
  await persist(runtime);
}

async function removeMember(runtime: SessionRuntime, member: MemberState): Promise<void> {
  runtime.members = runtime.members.filter((entry) => entry.account_id !== member.account_id);
  await emit(runtime, {
    kind: 'member_removed',
    account_id: member.account_id,
    display_name: member.display_name,
    tick: runtime.tick,
  });
  if (runtime.party_id !== null) {
    // Imported here because the party module reads this engine's grace state.
    const party = await import('../domain/party.js');
    await party.removeMemberFromParty(runtime.party_id, member.account_id, 'removed');
    if (!runtime.members.some((entry) => entry.status === 'dropped')) {
      await pool.query(
        `UPDATE parties SET status = 'in_session' WHERE id = $1 AND status = 'member_dropped'`,
        [runtime.party_id],
      );
    }
    notifyParty(runtime.party_id);
  }
  await persist(runtime);
}

async function endSession(runtime: SessionRuntime): Promise<void> {
  runtime.status = 'ended';
  await persist(runtime);
  if (runtime.party_id !== null) {
    await pool.query(
      `UPDATE parties SET status = 'forming', session_id = NULL WHERE id = $1`,
      [runtime.party_id],
    );
    notifyParty(runtime.party_id);
  }
  runtimes.delete(runtime.id);
}

async function scanConnections(runtime: SessionRuntime): Promise<void> {
  const connected = await accountsInSession(runtime.id);
  for (const member of runtime.members) {
    if (!member.arrived) continue;
    if (connected.has(member.account_id)) {
      if (member.status === 'dropped') {
        member.status = 'connected';
        member.dropped_at = null;
        await onRejoined(runtime, member);
      }
      continue;
    }
    if (member.status === 'connected') {
      member.status = 'dropped';
      member.dropped_at = Date.now();
      await onDropped(runtime, member);
    }
  }

  const expired = runtime.members.filter(
    (member) =>
      member.status === 'dropped' &&
      member.dropped_at !== null &&
      Date.now() - member.dropped_at >= config.rejoinGraceSeconds * 1000,
  );
  if (expired.length === 0) return;

  const anyConnected = runtime.members.some((member) => member.status === 'connected');
  if (!anyConnected) {
    await endSession(runtime);
    return;
  }
  for (const member of expired) await removeMember(runtime, member);
}

// --- loop --------------------------------------------------------------------

async function tickAll(): Promise<void> {
  const now = Date.now();
  for (const runtime of [...runtimes.values()]) {
    if (runtime.status !== 'running') continue;
    const due = Math.floor((now - runtime.lastTickAt) / TICK_MS);
    if (due > 0) {
      runtime.lastTickAt += due * TICK_MS;
      for (let i = 0; i < Math.min(due, 10); i += 1) {
        if (runtime.status !== 'running') break;
        await stepOnce(runtime);
      }
    }
    if (!runtimes.has(runtime.id)) continue;
    if (now - runtime.lastScanAt >= DROP_SCAN_MS) {
      runtime.lastScanAt = now;
      await scanConnections(runtime);
    }
    if (!runtimes.has(runtime.id)) continue;
    if (now - runtime.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      runtime.lastSnapshotAt = now;
      const snapshot = await buildSnapshot(runtime);
      for (const listener of snapshotListeners) listener(runtime.id, snapshot);
      await publish({ kind: 'session', session_id: runtime.id });
    }
    if (now - runtime.lastPersistAt >= PERSIST_INTERVAL_MS) await persist(runtime);
  }
}

async function adoptOrphans(): Promise<void> {
  const rows = await query<SessionRow>(
    `SELECT * FROM game_sessions
     WHERE status = 'running'
       AND (stepper_at IS NULL OR stepper_at < now() - make_interval(secs => $1))`,
    [STEPPER_TAKEOVER_MS / 1000],
  );
  for (const row of rows) {
    if (runtimes.has(row.id)) continue;
    const runtime = rowToRuntime(row);
    runtimes.set(row.id, runtime);
    await persist(runtime);
  }
}

let loopRunning = false;

export function startEngine(): void {
  if (loopRunning) return;
  loopRunning = true;
  setInterval(() => {
    void tickAll();
  }, 25);
  setInterval(() => {
    void adoptOrphans();
  }, 2000);
  void adoptOrphans();
}

export function droppedMembersOf(sessionId: string): Map<string, number> {
  const runtime = runtimes.get(sessionId);
  const dropped = new Map<string, number>();
  if (!runtime) return dropped;
  for (const member of runtime.members) {
    const remaining = graceRemaining(member);
    if (remaining !== null) dropped.set(member.account_id, remaining);
  }
  return dropped;
}
