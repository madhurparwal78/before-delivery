import { query, transaction, type DBClient } from './db.js';
import { isAccountOnline, sessionConnectionCount } from './presence.js';
import type { Locale } from '../shared/domain.js';
import { tr } from '../shared/i18n.js';
import { stories, storyById, layout, TICKS_PER_SECOND, MOVE_PER_TICK, PUDDLE_DAMAGE_PER_TICK, clamp, type Emote, type Stroke } from '../shared/domain.js';

export type MoteState = { id: string; x: number; z: number; collected_by: string | null };

export type SessionMemberState = {
  account_id: string;
  display_name: string;
  status: 'connected' | 'dropped';
  graceUntil: number | null;
  position: { x: number; z: number };
  target: { x: number; z: number } | null;
  health: number;
  checkpointReached: boolean;
  lastSwingTick: number;
  hero: Record<string, unknown>;
  weapon: { strokes: Stroke[]; stats: { reach_m: number; weight_kg: number; swing_per_s: number } } | null;
  modelId: string | null;
};

export type SessionState = {
  id: string;
  story_id: string;
  chapter: number;
  mode: 'solo' | 'coop';
  owner_id: string;
  party_id: string | null;
  status: 'running' | 'complete';
  tick: number;
  gate_open: boolean;
  checkpoint_reached: boolean;
  motes: MoteState[];
  members: SessionMemberState[];
  stepper: string | null;
  steppedAt: number | null;
};

export const runningSessions = new Map<string, SessionState>();

export function sessionState(id: string): SessionState | undefined {
  return runningSessions.get(id);
}

function freshMotes(saved: string[]): MoteState[] {
  return layout.motes.map((m) => ({ ...m, collected_by: saved.includes(m.id) ? 'seed' : null }));
}

export type StartOptions = {
  graceMs: number;
  storyId: string;
  chapter: number;
  mode: 'solo' | 'coop';
  ownerId: string;
  partyId: string | null;
  memberAccounts: { account_id: string; display_name: string }[];
  resumeCheckpoint: { chapter: number; motes: string[] } | null;
};

export async function createSession(opts: StartOptions): Promise<SessionState> {
  const id = crypto.randomUUID();
  const savedMotes = opts.resumeCheckpoint && opts.resumeCheckpoint.chapter === opts.chapter ? opts.resumeCheckpoint.motes : [];
  const spawn = savedMotes.length > 0 || (opts.resumeCheckpoint && opts.resumeCheckpoint.chapter === opts.chapter)
    ? layout.checkpoint
    : layout.spawn;
  const members: SessionMemberState[] = [];
  for (const m of opts.memberAccounts) {
    const hero = await heroForMember(m.account_id);
    const weapon = await weaponForMember(m.account_id);
    members.push({
      account_id: m.account_id,
      display_name: m.display_name,
      status: 'dropped',
      graceUntil: Date.now() + opts.graceMs,
      position: { x: spawn.x, z: spawn.z },
      target: null,
      health: 100,
      checkpointReached: savedMotes.length > 0,
      lastSwingTick: -1000,
      hero: hero.hero,
      weapon: weapon ?? null,
      modelId: hero.modelId,
    });
  }
  const state: SessionState = {
    id,
    story_id: opts.storyId,
    chapter: opts.chapter,
    mode: opts.mode,
    owner_id: opts.ownerId,
    party_id: opts.partyId,
    status: 'running',
    tick: 0,
    gate_open: false,
    checkpoint_reached: false,
    motes: freshMotes(savedMotes),
    members,
    stepper: null,
    steppedAt: null,
  };
  runningSessions.set(id, state);
  await persistSession(state);
  return state;
}

async function heroForMember(accountId: string): Promise<{ hero: Record<string, unknown>; modelId: string | null }> {
  const res = await query<{ name: string; parts: unknown; proportions: unknown; pose: unknown; material: string; accessories: unknown; model_id: string | null }>(
    `select name, parts, proportions, pose, material, accessories, model_id
       from characters where account_id = $1 and equipped = true`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) {
    return { hero: { name: '', parts: {}, proportions: {}, pose: { right_arm_raise: 0 }, material: 'graphite', accessories: {} }, modelId: null };
  }
  return {
    hero: { name: row.name, parts: row.parts, proportions: row.proportions, pose: row.pose, material: row.material, accessories: row.accessories },
    modelId: row.model_id,
  };
}

async function weaponForMember(accountId: string): Promise<{ strokes: Stroke[]; stats: { reach_m: number; weight_kg: number; swing_per_s: number } } | null> {
  const res = await query<{ strokes: Stroke[]; stats: { reach_m: number; weight_kg: number; swing_per_s: number } }>(
    `select w.strokes, w.stats from characters c join weapons w on w.id = c.weapon_id where c.account_id = $1 and c.equipped = true`,
    [accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { strokes: row.strokes, stats: row.stats };
}

export async function createSessionForParty(party: { id: string; story_id: string; leader_id: string }, members: { account_id: string; display_name: string }[]): Promise<SessionState> {
  const { progressFor } = await import('./progress.js');
  const progress = await progressFor('party', party.id, party.story_id);
  const chapter = progress ? progress.unlocked_chapter : 1;
  const checkpoint = progress && progress.checkpoint && progress.checkpoint.chapter === chapter ? progress.checkpoint : null;
  const config = (await import('./config.js')).default;
  return createSession({
    storyId: party.story_id,
    chapter,
    mode: 'coop',
    ownerId: party.leader_id,
    partyId: party.id,
    memberAccounts: members,
    resumeCheckpoint: checkpoint,
    graceMs: config.rejoinGraceSeconds * 1000,
  });
}

export async function createSoloSession(accountId: string, storyId: string, chapter: number): Promise<SessionState> {
  const { progressFor } = await import('./progress.js');
  const progress = await progressFor('account', accountId, storyId);
  const checkpoint = progress && progress.checkpoint && progress.checkpoint.chapter === chapter ? progress.checkpoint : null;
  const config = (await import('./config.js')).default;
  const res = await query<{ display_name: string }>('select display_name from accounts where id = $1', [accountId]);
  const displayName = res.rows[0]?.display_name ?? '';
  const state = await createSession({
    storyId,
    chapter,
    mode: 'solo',
    ownerId: accountId,
    partyId: null,
    memberAccounts: [{ account_id: accountId, display_name: displayName }],
    resumeCheckpoint: checkpoint,
    graceMs: config.rejoinGraceSeconds * 1000,
  });
  // A new solo session ends the player's running solo session of the same story.
  for (const [id, s] of runningSessions) {
    if (id !== state.id && s.mode === 'solo' && s.owner_id === accountId) {
      await endSession(s);
    }
  }
  return state;
}

export async function endSession(state: SessionState): Promise<void> {
  state.status = 'complete';
  await persistSession(state);
  runningSessions.delete(state.id);
}

export async function persistSession(state: SessionState): Promise<void> {
  await query(
    `insert into sessions_world (id, story_id, chapter, mode, owner_id, party_id, status, tick, state, stepper, stepped_at, resumed_from_checkpoint)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
     on conflict (id) do update set status = excluded.status, tick = excluded.tick, state = excluded.state,
       stepper = excluded.stepper, stepped_at = now()`,
    [state.id, state.story_id, state.chapter, state.mode, state.owner_id, state.party_id, state.status, state.tick, JSON.stringify(sessionToPersistable(state)), state.stepper, false],
  );
}

type PersistableSession = Omit<SessionState, 'steppedAt'>;

function sessionToPersistable(state: SessionState): PersistableSession {
  const { steppedAt, ...rest } = state;
  void steppedAt;
  return rest;
}

export async function loadRunningSessions(): Promise<void> {
  const res = await query<{ id: string; story_id: string; chapter: number; mode: string; owner_id: string; party_id: string | null; status: string; tick: string; state: unknown; created_at: Date }>(
    "select id, story_id, chapter, mode, owner_id, party_id, status, tick, state, created_at from sessions_world where status = 'running'",
  );
  const config = (await import('./config.js')).default;
  for (const row of res.rows) {
    const persisted = row.state as SessionState;
    if (!persisted) continue;
    // Every member counts as dropped after a restart, with a fresh grace.
    const grace = config.rejoinGraceSeconds * 1000;
    persisted.members = persisted.members.map((m) => ({ ...m, status: 'dropped' as const, graceUntil: Date.now() + grace }));
    persisted.tick = Number(row.tick);
    persisted.steppedAt = null;
    persisted.stepper = null;
    runningSessions.set(row.id, persisted);
  }
}

export function snapshotJson(state: SessionState): Record<string, unknown> {
  return {
    id: state.id,
    story_id: state.story_id,
    chapter: state.chapter,
    mode: state.mode,
    status: state.status,
    tick: state.tick,
    gate_open: state.gate_open,
    checkpoint_reached: state.checkpoint_reached,
    motes: state.motes.map((m) => ({ id: m.id, x: m.x, z: m.z, collected_by: m.collected_by })),
    members: state.members.map((m) => ({
      account_id: m.account_id,
      display_name: m.display_name,
      status: m.status,
      grace_remaining_seconds: m.status === 'dropped' && m.graceUntil ? Math.max(0, Math.ceil((m.graceUntil - Date.now()) / 1000)) : null,
      position: { x: round3(m.position.x), z: round3(m.position.z) },
      health: m.health,
      hero: m.hero,
      weapon: m.weapon,
      model_url: modelUrlFor(state, m),
    })),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function modelUrlFor(state: SessionState, member: SessionMemberState): string | null {
  if (!member.modelId) return null;
  // A dropped member inside their grace still holds their seat, so their model still streams.
  if (member.status === 'dropped' && member.graceUntil && member.graceUntil <= Date.now()) return null;
  return `/api/sessions/${state.id}/members/${member.account_id}/model`;
}

export async function refreshMemberHero(state: SessionState, accountId: string): Promise<void> {
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member) return;
  const hero = await heroForMember(accountId);
  member.hero = hero.hero;
  member.modelId = hero.modelId;
  const weaponRes = await query<{ strokes: Stroke[]; stats: { reach_m: number; weight_kg: number; swing_per_s: number } }>(
    `select w.strokes, w.stats from characters c join weapons w on w.id = c.weapon_id where c.account_id = $1 and c.equipped = true`,
    [accountId],
  );
  member.weapon = weaponRes.rows[0] ? { strokes: weaponRes.rows[0].strokes, stats: weaponRes.rows[0].stats } : null;
}

/** The tick step (DP-32), decided in this one function. */
export async function stepSession(state: SessionState): Promise<void> {
  state.tick += 1;
  const events: { kind: string; params: Record<string, unknown> }[] = [];
  const collectedNow = new Set(state.motes.filter((m) => m.collected_by).map((m) => m.id));

  for (const member of state.members) {
    if (member.status === 'dropped') continue;
    if (member.target) {
      const dx = member.target.x - member.position.x;
      const dz = member.target.z - member.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= MOVE_PER_TICK) {
        member.position = { x: member.target.x, z: member.target.z };
        member.target = null;
      } else {
        member.position = { x: member.position.x + (dx / dist) * MOVE_PER_TICK, z: member.position.z + (dz / dist) * MOVE_PER_TICK };
      }
    }
    // puddle damage
    const pd = Math.hypot(member.position.x - layout.puddle.x, member.position.z - layout.puddle.z);
    if (pd <= layout.puddle.radius) {
      member.health = Math.max(0, member.health - PUDDLE_DAMAGE_PER_TICK);
    }
    // pickup by proximity
    for (const mote of state.motes) {
      if (mote.collected_by) continue;
      const d = Math.hypot(member.position.x - mote.x, member.position.z - mote.z);
      if (d <= 1) {
        mote.collected_by = member.account_id;
        events.push({ kind: 'pickup', params: { account_id: member.account_id, name: member.display_name, mote_id: mote.id, collected: countCollected(state) } });
      }
    }
    // checkpoint
    if (!member.checkpointReached) {
      const cd = Math.hypot(member.position.x - layout.checkpoint.x, member.position.z - layout.checkpoint.z);
      if (cd <= layout.checkpointRadius) {
        member.checkpointReached = true;
        state.checkpoint_reached = true;
        events.push({ kind: 'checkpoint', params: { account_id: member.account_id } });
        await saveCheckpoint(state, countCollectedMotes(state));
      }
    }
    // gate completion
    if (state.gate_open) {
      const gd = Math.hypot(member.position.x - layout.gate.x, member.position.z - layout.gate.z);
      if (gd <= layout.gateRadius) {
        await completeChapter(state);
        return;
      }
    }
    if (member.health <= 0) {
      const respawn = state.checkpoint_reached ? layout.checkpoint : layout.spawn;
      member.position = { x: respawn.x, z: respawn.z };
      member.health = 100;
      member.target = null;
      events.push({ kind: 'knocked_out', params: { account_id: member.account_id, name: member.display_name } });
    }
  }

  if (!state.gate_open && state.motes.every((m) => m.collected_by)) {
    state.gate_open = true;
    events.push({ kind: 'gate_open', params: {} });
  }

  for (const event of events) {
    const { publishSessionEvent } = await import('./realtime.js');
    await publishSessionEvent(state.id, event.kind, event.params);
  }
}

export function countCollected(state: SessionState): number {
  return state.motes.filter((m) => m.collected_by).length;
}

export function countCollectedMotes(state: SessionState): string[] {
  return state.motes.filter((m) => m.collected_by).map((m) => m.id);
}

export async function saveCheckpoint(state: SessionState, motes: string[]): Promise<void> {
  const { saveProgressCheckpoint } = await import('./progress.js');
  const ownerKind = state.mode === 'solo' ? 'account' : 'party';
  const ownerId = state.mode === 'solo' ? state.owner_id : (state.party_id ?? '');
  await saveProgressCheckpoint(ownerKind, ownerId, state.story_id, state.chapter, motes);
}

export async function completeChapter(state: SessionState): Promise<void> {
  const { completeProgress } = await import('./progress.js');
  const ownerKind = state.mode === 'solo' ? 'account' : 'party';
  const ownerId = state.mode === 'solo' ? state.owner_id : (state.party_id ?? '');
  await completeProgress(ownerKind, ownerId, state.story_id, state.chapter, countCollectedMotes(state));
  state.status = 'complete';
  await persistSession(state);
  const { publishSessionEvent } = await import('./realtime.js');
  await publishSessionEvent(state.id, 'session_complete', { story_id: state.story_id, chapter: state.chapter });
  if (state.party_id) {
    await query("update parties set status = 'chapter_complete' where id = $1", [state.party_id]);
    const { publishPartyState } = await import('./realtime.js');
    publishPartyState(state.party_id);
  }
  runningSessions.delete(state.id);
}

export type IntentAction = 'move_to' | 'swing' | 'emote';

export type Intent = {
  intent_id: string;
  action: IntentAction;
  x?: number | undefined;
  z?: number | undefined;
  emote?: Emote | undefined;
};

export type Ack = { intent_id: string; applied: boolean; duplicate: boolean; tick: number; reason: null | 'cooldown' | 'out_of_bounds' | 'no_weapon' };

export async function applyIntent(state: SessionState, accountId: string, intent: Intent): Promise<Ack> {
  const { publishSessionEvent } = await import('./realtime.js');
  const existing = await query<{ intent_id: string }>(
    'select intent_id from intents where session_id = $1 and account_id = $2 and intent_id = $3',
    [state.id, accountId, intent.intent_id],
  );
  if (existing.rows.length > 0) {
    return { intent_id: intent.intent_id, applied: false, duplicate: true, tick: state.tick, reason: null };
  }
  await query('insert into intents (session_id, account_id, intent_id) values ($1, $2, $3)', [state.id, accountId, intent.intent_id]);
  const member = state.members.find((m) => m.account_id === accountId);
  if (!member) {
    return { intent_id: intent.intent_id, applied: false, duplicate: false, tick: state.tick, reason: null };
  }
  const appliedTick = state.tick;
  if (intent.action === 'move_to') {
    const x = intent.x ?? 0;
    const z = intent.z ?? 0;
    if (x < layout.bounds.min || x > layout.bounds.max || z < layout.bounds.min || z > layout.bounds.max) {
      return { intent_id: intent.intent_id, applied: false, duplicate: false, tick: appliedTick, reason: 'out_of_bounds' };
    }
    member.target = { x, z };
  } else if (intent.action === 'swing') {
    if (!member.weapon) {
      return { intent_id: intent.intent_id, applied: false, duplicate: false, tick: appliedTick, reason: 'no_weapon' };
    }
    const swing = member.weapon.stats.swing_per_s;
    const cooldownTicks = Math.ceil(TICKS_PER_SECOND / Math.max(swing, 0.01));
    if (appliedTick - member.lastSwingTick < cooldownTicks) {
      return { intent_id: intent.intent_id, applied: false, duplicate: false, tick: appliedTick, reason: 'cooldown' };
    }
    member.lastSwingTick = appliedTick;
    const reach = member.weapon.stats.reach_m;
    for (const mote of state.motes) {
      if (mote.collected_by) continue;
      const d = Math.hypot(member.position.x - mote.x, member.position.z - mote.z);
      if (d <= 1 + reach) {
        mote.collected_by = member.account_id;
        await publishSessionEvent(state.id, 'pickup', { account_id: member.account_id, name: member.display_name, mote_id: mote.id, collected: countCollected(state) });
      }
    }
    if (!state.gate_open && state.motes.every((m) => m.collected_by)) {
      state.gate_open = true;
      await publishSessionEvent(state.id, 'gate_open', {});
    }
  } else if (intent.action === 'emote') {
    await publishSessionEvent(state.id, 'emote', { account_id: member.account_id, name: member.display_name, emote: intent.emote ?? 'wave' });
  }
  return { intent_id: intent.intent_id, applied: true, duplicate: false, tick: appliedTick, reason: null };
}
