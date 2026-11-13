import { ApiFailure, del, get, post } from '../api';
import type { Debrief, Session } from '../../shared/types';
import { refreshRoom } from './rooms';
import { mss } from '../../shared/format';
import { canMove, isOpen, isRunning } from '../../shared/playtest';
import { closeDialog, editor, openDialog, say } from './state';
import { EDITS_PAUSED } from './copy';

export const LIVE_PAUSED_COPY = 'Live editing is paused. Solo editing still works.';
const BUSY_COPY = 'Another playtest is running in this room.';

export const controlsSession = (session: Session): boolean => {
  const me = editor.get().me;
  return me !== null && (me.role === 'owner' || me.id === session.hostUserId);
};

type PlayMode = 'start' | 'stop' | 'blocked';

/** What the round Play button does right now: start (walk in, or start the lobby), stop, or nothing. */
export function playMode(): PlayMode {
  const { session } = editor.get();
  if (!session) return 'start';
  if (!controlsSession(session)) return 'blocked';
  if (canMove(session.state, 'end')) return 'stop';
  return canMove(session.state, 'start') ? 'start' : 'blocked';
}

function refusal(error: unknown): void {
  if (error instanceof ApiFailure && error.code === 'room_busy') say(BUSY_COPY);
  else if (error instanceof ApiFailure && error.code === 'live_unavailable') say(LIVE_PAUSED_COPY);
  else if (error instanceof ApiFailure && error.code === 'playtest_running') say(EDITS_PAUSED);
}

function startedWalkIn(session: Session): void {
  editor.set((s) => ({ session, cam: { ...s.cam, target: 'eye', nonce: s.cam.nonce + 1 }, selectedId: null }));
  say('Playtest running.');
  void refreshRoom();
}

/** Walks in (a new server-timed walk-in playtest), or starts the room's lobby session at the overview. */
export async function beginPlay(): Promise<void> {
  const { roomId, session } = editor.get();
  if (!roomId) return;
  try {
    if (session && canMove(session.state, 'start')) {
      const { session: running } = await post<{ session: Session }>(`/api/playtests/${session.id}/start`);
      editor.set({ session: running });
      say('Playtest running.');
      void refreshRoom();
    } else {
      const { session: running } = await post<{ session: Session }>(`/api/rooms/${roomId}/walk-in`);
      startedWalkIn(running);
    }
  } catch (error) {
    refusal(error);
    await refreshRoom();
  }
}

async function stopPlaytest(): Promise<void> {
  const { session } = editor.get();
  if (!session) return;
  try {
    const { session: ended } = await post<{ session: Session }>(`/api/playtests/${session.id}/end`);
    sessionEnded(ended);
  } catch (error) {
    refusal(error);
    await refreshRoom();
  }
}

export function pressPlay(): void {
  const mode = playMode();
  if (mode === 'stop') void stopPlaytest();
  else if (mode === 'start') void beginPlay();
}

const handledEnds = new Set<string>();

function sessionEnded(session: Session): void {
  editor.set((s) => ({
    session: s.session?.id === session.id ? null : s.session,
    latestSession: session,
    cam: s.cam.target === 'eye' ? { ...s.cam, target: 'overview', nonce: s.cam.nonce + 1 } : s.cam,
  }));
  void refreshRoom();
  if (handledEnds.has(session.id)) return;
  handledEnds.add(session.id);
  if (session.hostUserId === editor.get().me?.id) showDebrief(session);
  say('Playtest ended');
}

/** A `session` event of the open room: keeps the clock, the roster and the Playtests sheet current. */
export function applySessionEvent(session: Session): void {
  const state = editor.get();
  if (session.roomId !== state.roomId) return;
  editor.set((s) => ({ sessions: [session, ...s.sessions.filter((x) => x.id !== session.id)].sort((a, b) => b.startsAt.localeCompare(a.startsAt)) }));
  if (isOpen(session.state) && session.state !== 'scheduled') {
    editor.set({ session });
    if (isRunning(session.state)) editor.set({ latestSession: session });
  } else if (session.state === 'ended') {
    sessionEnded(session);
  } else if (state.session?.id === session.id) {
    editor.set({ session: null });
  }
}

function showDebrief(session: Session): void {
  editor.set({ debrief: { session, detail: null } });
  openDialog('debrief');
  void loadDebrief(session.id);
}

async function loadDebrief(id: string): Promise<void> {
  const detail = await get<Debrief>(`/api/playtests/${id}/debrief`).catch(() => null);
  const current = editor.get().debrief;
  if (!detail || current?.session.id !== id) return;
  editor.set({ debrief: { session: current.session, detail } });
  if (detail.emailStatus === 'queued' && editor.get().dialogs.debrief) window.setTimeout(() => void loadDebrief(id), 2000);
}

export function closeDebrief(): void {
  closeDialog('debrief');
}

/* ---------- the Playtests sheet ---------- */

export async function loadSessions(): Promise<void> {
  const { roomId } = editor.get();
  if (!roomId) return;
  const { sessions } = await get<{ sessions: Session[] }>(`/api/rooms/${roomId}/playtests`);
  editor.set({ sessions });
}

export async function schedulePlaytest(startsAtIso: string): Promise<Record<string, string>> {
  const { roomId } = editor.get();
  try {
    const { session } = await post<{ session: Session }>('/api/playtests', { roomId, startsAt: startsAtIso });
    applySessionEvent(session);
    return {};
  } catch (error) {
    if (error instanceof ApiFailure) return error.fieldErrors;
    throw error;
  }
}

export async function moveSession(id: string, action: 'open' | 'start' | 'end' | 'cancel'): Promise<void> {
  try {
    const { session } = await post<{ session: Session }>(`/api/playtests/${id}/${action}`);
    if (action === 'start') say('Playtest running.');
    if (action === 'end') sessionEnded(session);
    else applySessionEvent(session);
  } catch (error) {
    refusal(error);
    await loadSessions().catch(() => undefined);
  }
}

export async function inviteTester(sessionId: string, email: string): Promise<Record<string, string>> {
  try {
    const { invite } = await post<{ invite: { email: string; emailStatus: string } }>(`/api/playtests/${sessionId}/invites`, { email });
    say(invite.emailStatus === 'sent' ? `Invite sent to ${invite.email}.` : `Invite to ${invite.email} is queued.`);
    await loadSessions();
    return {};
  } catch (error) {
    if (error instanceof ApiFailure) return error.fieldErrors;
    throw error;
  }
}

export async function revokeInvite(sessionId: string, inviteId: string): Promise<void> {
  await del(`/api/playtests/${sessionId}/invites/${inviteId}`);
  await loadSessions();
}

export async function resendInvite(sessionId: string, inviteId: string, email: string): Promise<void> {
  await post(`/api/playtests/${sessionId}/invites/${inviteId}/resend`);
  say(`Invite to ${email} is queued.`);
  await loadSessions();
}

export async function sendHint(sessionId: string, text: string): Promise<Record<string, string>> {
  try {
    await post(`/api/playtests/${sessionId}/hints`, { text });
    await loadSessions();
    return {};
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'hint_cooldown') {
      const left = Number(error.body.retryAfterSeconds);
      say(`Next hint in ${mss(left)}`);
      await loadSessions();
      return {};
    }
    refusal(error);
    if (error instanceof ApiFailure) return error.fieldErrors;
    throw error;
  }
}


/** The clock and roster resync from the server at least every 15 seconds. */
export async function resyncSession(): Promise<void> {
  const { session } = editor.get();
  if (!session) return;
  const { session: fresh } = await get<{ session: Session }>(`/api/playtests/${session.id}`);
  applySessionEvent(fresh);
}
