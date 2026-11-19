import type pg from 'pg';
import { cascadeStyles } from '../shared/derive.ts';
import { ApiError } from '../shared/errors.ts';
import type { AudiencePayload, AudienceTopic, MapDoc, PresentationInfo, PresentationState, SkippedSlide } from '../shared/model.ts';
import { PRESENTATION_TRANSITIONS, PRESENTER_TARGETS, canStep, canTransition } from '../shared/rules.ts';
import { branchOf, isRestricted, withoutRestricted } from '../shared/tree.ts';
import { serverIso, serverNow, toIso } from './clock.ts';
import { config } from './config.ts';
import { database, query, withMapLock, type Db } from './db.ts';
import { Effects, emitEvent } from './groups.ts';
import { followerCount, hasSocket, onCommitted, sendAudience, transient } from './hub.ts';
import { randomId } from './ids.ts';
import { loadMap, type MapRow } from './mapStore.ts';
import { onTick } from './tick.ts';

interface NewPresentation {
  mapId: string;
  presenterId: string;
  presenterName: string;
}

export interface Session {
  id: string;
  map_id: string;
  code: string;
  state: PresentationState;
  slide_index: number;
  presenter_id: string;
  presenter: string;
  presenter_seen_at: Date;
}

const CODE_LENGTH = 10;
const SELECT_SESSION =
  'SELECT id, map_id, code, state, slide_index, presenter_id, presenter, presenter_seen_at FROM presentations';

export async function createPresentation(db: Db, args: NewPresentation): Promise<{ id: string; code: string }> {
  const created = { id: randomId(), code: randomId(CODE_LENGTH) };
  const now = toIso(serverNow());
  await query(
    db,
    `INSERT INTO presentations (id, map_id, code, state, slide_index, presenter_id, presenter, presenter_seen_at, created_at)
     VALUES ($1, $2, $3, 'waiting', 0, $4, $5, $6, $6)`,
    [created.id, args.mapId, created.code, args.presenterId, args.presenterName, now],
  );
  return created;
}

async function oneSession(db: Db, where: string, value: string): Promise<Session | null> {
  if (value.includes('\0')) return null;
  return (await query<Session>(db, `${SELECT_SESSION} WHERE ${where}`, [value]))[0] ?? null;
}

function required(session: Session | null): Session {
  if (!session) throw new ApiError('not_found', "We couldn't find that presentation.");
  return session;
}

export async function sessionById(db: Db, id: string): Promise<Session> {
  return required(await oneSession(db, 'id = $1', id));
}

export async function sessionByCode(db: Db, code: string): Promise<Session> {
  return required(await oneSession(db, 'code = $1', code));
}

const activeSession = (db: Db, mapId: string): Promise<Session | null> => oneSession(db, "map_id = $1 AND state <> 'ended'", mapId);

/** A map has at most one session that has not ended. */
export async function assertNoActiveSession(db: Db, mapId: string): Promise<void> {
  if (await activeSession(db, mapId)) throw new ApiError('already_presenting', 'This map already has a presentation that has not ended.');
}

const infoOf = (session: Session): PresentationInfo => ({
  id: session.id,
  code: session.code,
  state: session.state,
  slide_index: session.slide_index,
  followers: followerCount(session.code),
});

const docOf = async (db: Db, mapId: string): Promise<MapDoc> => ((await loadMap(db, mapId)) as MapRow).doc;

// ---------------------------------------------------------------- audience

/** What the audience gets: the shown slide's branch as people without access to restricted branches see it, and no notes. */
export async function audiencePayload(db: Db, session: Session): Promise<AudiencePayload> {
  const full = await docOf(db, session.map_id);
  const doc = withoutRestricted(full);
  const slideId = full.slides[session.slide_index];
  const shown = session.state === 'live' || session.state === 'paused';
  const styles = cascadeStyles(doc);
  const slide =
    shown && slideId !== undefined && doc.topics[slideId]
      ? {
          topic_id: slideId,
          topics: branchOf(doc.topics, slideId).flatMap((topic): AudienceTopic[] => {
            const style = styles.get(topic.id);
            return style
              ? [{ id: topic.id, parent_id: topic.id === slideId ? null : topic.parent_id, rank: topic.rank, title: topic.title, derived: style, icon: topic.icon }]
              : [];
          }),
        }
      : null;
  return {
    state: session.state,
    slide_index: session.slide_index,
    slide_count: full.slides.length,
    presenter: session.presenter,
    followers: followerCount(session.code),
    server_time: serverIso(),
    layout: doc.layout,
    theme: doc.theme,
    slide,
  };
}

/** Send every open audience screen the current payload of a map's running session. Call after a group commits. */
async function refreshAudiences(mapId: string): Promise<void> {
  const session = await activeSession(database(), mapId);
  if (session && followerCount(session.code) > 0) sendAudience(session.code, await audiencePayload(database(), session));
}

/** Tell the audience and the presenter that the follower count changed. Failures are logged, never thrown into a socket handler. */
export async function announceFollowers(code: string): Promise<void> {
  try {
    const session = await sessionByCode(database(), code);
    sendAudience(code, await audiencePayload(database(), session));
    transient(session.map_id, { type: 'presentation', presentation: infoOf(session), skipped: [] }, session.presenter_id);
  } catch (error) {
    process.stderr.write(`followers: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

// ---------------------------------------------------------------- stepping

function skipReason(doc: MapDoc, topicId: string): SkippedSlide['reason'] | null {
  if (!doc.topics[topicId]) return 'deleted';
  return isRestricted(doc.topics, topicId) ? 'restricted' : null;
}

/**
 * The slide a step lands on: the requested one, or the nearest one in the stepping direction that is neither deleted
 * nor restricted. Every slide passed over is reported. When none is left the current slide stays.
 */
function landOn(doc: MapDoc, requested: number, current: number, forward: boolean): { index: number; skipped: SkippedSlide[] } {
  const path = doc.slides.map((topicId, index) => ({ topicId, index })).filter((slide) => (forward ? slide.index >= requested : slide.index <= requested));
  if (!forward) path.reverse();
  const skipped: SkippedSlide[] = [];
  for (const { topicId, index } of path) {
    const reason = skipReason(doc, topicId);
    if (reason === null) return { index, skipped };
    skipped.push({ index, reason });
  }
  return { index: current, skipped };
}

/** A session that has ended answers every request with session_ended. */
export function assertNotEnded(session: Session): void {
  if (session.state === 'ended') throw new ApiError('session_ended', 'This presentation has ended.');
}

export function assertPresenterTransition(session: Session, to: PresentationState): void {
  assertNotEnded(session);
  if (!PRESENTER_TARGETS.includes(to) || !canTransition(PRESENTATION_TRANSITIONS, session.state, to)) {
    throw new ApiError('invalid_transition', 'The presentation cannot change that way.');
  }
}

/** Steps are allowed only while the session is live. */
export function assertStepping(session: Session): void {
  assertNotEnded(session);
  if (!canStep(session.state)) throw new ApiError('invalid_transition', 'Slides can be stepped only while the presentation is live.');
}

/** Store a session change and, once the transaction commits, show it to the presenter and the audience. */
async function save(client: pg.PoolClient, fx: Effects, session: Session, change: Pick<Session, 'state' | 'slide_index'>, skipped: SkippedSlide[]): Promise<PresentationInfo> {
  const next: Session = { ...session, ...change };
  const seen = next.state === 'live' ? toIso(serverNow()) : session.presenter_seen_at;
  await query(client, 'UPDATE presentations SET state = $2, slide_index = $3, presenter_seen_at = $4 WHERE id = $1', [session.id, next.state, next.slide_index, seen]);
  const info = infoOf(next);
  await emitEvent(client, session.map_id, { type: 'presentation', presentation: info, skipped }, 'user', session.presenter_id, fx);
  const payload = await audiencePayload(client, next);
  fx.add(() => sendAudience(next.code, payload));
  return info;
}

/** Move a session to another state. Going live from waiting counts as stepping forward from the first slide. */
export async function switchState(client: pg.PoolClient, fx: Effects, session: Session, to: PresentationState): Promise<PresentationInfo> {
  if (!canTransition(PRESENTATION_TRANSITIONS, session.state, to)) throw new ApiError('invalid_transition', 'The presentation cannot change that way.');
  if (session.state === 'waiting' && to === 'live') {
    const landing = landOn(await docOf(client, session.map_id), 0, session.slide_index, true);
    return save(client, fx, session, { state: to, slide_index: landing.index }, landing.skipped);
  }
  return save(client, fx, session, { state: to, slide_index: session.slide_index }, []);
}

/** Show the requested slide, or the nearest one that can be shown. */
export async function stepTo(client: pg.PoolClient, fx: Effects, session: Session, requested: number): Promise<{ presentation: PresentationInfo; skipped: SkippedSlide[] }> {
  const landing = landOn(await docOf(client, session.map_id), requested, session.slide_index, requested > session.slide_index);
  const presentation = await save(client, fx, session, { state: session.state, slide_index: landing.index }, landing.skipped);
  return { presentation, skipped: landing.skipped };
}

// ------------------------------------------------------------ the presenter

/** Move a session between live and paused on the server's own account, unless it changed since it was read. */
async function switchOnTick(session: Session, to: 'live' | 'paused'): Promise<void> {
  const fx = new Effects();
  await withMapLock(session.map_id, async (client) => {
    const fresh = await sessionById(client, session.id);
    if (fresh.state === session.state) await switchState(client, fx, fresh, to);
  });
  fx.run();
}

/** Pause a live show whose presenter has been away for the grace period, and resume a paused one when they are back. */
async function watchPresenters(): Promise<void> {
  const running = await query<Session>(database(), `${SELECT_SESSION} WHERE state IN ('live', 'paused')`);
  for (const session of running) {
    if (hasSocket(session.map_id, session.presenter_id)) {
      if (session.state === 'paused') await switchOnTick(session, 'live');
      else await query(database(), 'UPDATE presentations SET presenter_seen_at = $2 WHERE id = $1', [session.id, toIso(serverNow())]);
    } else if (session.state === 'live' && serverNow() - session.presenter_seen_at.getTime() >= config.presenterGraceMs) {
      await switchOnTick(session, 'paused');
    }
  }
}

onTick(watchPresenters);
onCommitted((mapId) => void refreshAudiences(mapId));
