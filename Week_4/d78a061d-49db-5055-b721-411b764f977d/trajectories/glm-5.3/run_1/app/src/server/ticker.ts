import { runningSessions, sessionState, stepSession, snapshotJson, persistSession } from './world.js';
import { openSessionConnections } from './presence.js';
import { publishSnapshot, socketsFollowingStream } from './realtime.js';
import { settleGraces } from './world-conn.js';

/**
 * The authoritative fixed-step loop (DP-32): one copy steps a session at a time,
 * taking over only after the previous stepper stopped writing for 5 seconds.
 */
const TICK_MS = 1000 / 20;
let interval: NodeJS.Timeout | null = null;
let tickCounter = 0;
const INSTANCE_ID = crypto.randomUUID();

function shouldStep(state: import('./world.js').SessionState): boolean {
  if (state.stepper === INSTANCE_ID) return true;
  if (state.steppedAt === null || state.steppedAt === undefined) return true;
  if (Date.now() - state.steppedAt > 5000) return true;
  return false;
}

async function tick(): Promise<void> {
  tickCounter++;
  for (const state of [...runningSessions.values()]) {
    if (state.status !== 'running') continue;
    if (!shouldStep(state)) continue;
    const hasConnectedMember = state.members.some((m) => m.status === 'connected');
    if (!hasConnectedMember && state.tick > 0 && state.members.length === 0) continue;
    state.stepper = INSTANCE_ID;
    state.steppedAt = Date.now();
    if (hasConnectedMember) {
      await stepSession(state);
    } else {
      state.tick += 1;
    }
    await persistSession(state);
    if (tickCounter % 2 === 0) {
      await publishSnapshot(state.id, snapshotJson(state));
    }
  }
  if (tickCounter % 20 === 0) {
    await settleGraces();
    const { tickReadyChecks } = await import('./parties.js');
    await tickReadyChecks();
  }
}

export function startTicker(): void {
  if (interval) return;
  interval = setInterval(() => {
    void tick().catch(() => { /* a failed tick never stops the loop */ });
  }, TICK_MS);
}

export function tickSoon(): void {
  void tick().catch(() => { /* ignored */ });
}

export async function deliverSnapshots(): Promise<void> {
  for (const state of runningSessions.values()) {
    if (state.status !== 'running') continue;
    await publishSnapshot(state.id, snapshotJson(state));
  }
}

export function instanceId(): string {
  return INSTANCE_ID;
}
