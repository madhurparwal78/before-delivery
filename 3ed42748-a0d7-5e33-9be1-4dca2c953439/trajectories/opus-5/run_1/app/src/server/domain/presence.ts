import { query, withTransaction } from '../db/pool.js';
import { validation, type FieldReasons } from '../http/errors.js';
import {
  TOKEN_SHAPE,
  isWholeNumber,
  readPresencePosition,
  type JsonObject,
  type PresencePosition,
} from './requestFields.js';
import type { Actor } from './sessions.js';
import type { Role } from './couriers.js';

export const EMOTES = ['wave', 'cheer', 'sleepy', 'heart'] as const;
export type Emote = (typeof EMOTES)[number];

export const FRESH_SECONDS = 15;
export const EMOTE_WINDOW_SECONDS = 4;
const MAX_SEQ = 9_007_199_254_740_991;

export interface Heartbeat {
  stream: string;
  seq: number;
  position: PresencePosition;
  emote: Emote | null;
}

/** Reads the published heartbeat fields, each with its own reason. */
export function readHeartbeat(body: JsonObject): Heartbeat {
  const reasons: FieldReasons = {};
  const rawStream = body.stream;
  if (rawStream === undefined) reasons.stream = 'required';
  else if (typeof rawStream !== 'string' || !TOKEN_SHAPE.test(rawStream)) reasons.stream = 'invalid';

  const rawSeq = body.seq;
  if (rawSeq === undefined) reasons.seq = 'required';
  else if (!isWholeNumber(rawSeq)) reasons.seq = 'invalid';
  else if (rawSeq < 1 || rawSeq > MAX_SEQ) reasons.seq = 'out_of_range';

  const position = readPresencePosition(body.position, reasons);

  const rawEmote = body.emote ?? null;
  let emote: Emote | null = null;
  if (rawEmote !== null) {
    if (EMOTES.includes(rawEmote as Emote)) emote = rawEmote as Emote;
    else reasons.emote = 'invalid';
  }

  if (Object.keys(reasons).length > 0) throw validation(reasons);
  return { stream: rawStream as string, seq: rawSeq as number, position: position!, emote };
}

export interface HeartbeatResult {
  accepted: boolean;
  last_seq: number;
  emote: Emote | null;
  muted: boolean;
}

/** Stores the newest heartbeat of a page, ignoring repeated and out-of-order ones. */
export async function recordHeartbeat(
  actor: Actor,
  beat: Heartbeat,
  now: Date,
): Promise<HeartbeatResult> {
  return withTransaction(async (tx) => {
    await tx.lock(`heartbeat:${actor.sessionId}:${beat.stream}`);
    const accepted = await tx.one<{ seq: string }>(
      `insert into heartbeats (session_id, stream, courier_id, seq, lat, lon, heading_deg,
                               received_at, accepted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (session_id, stream) do update
         set courier_id = excluded.courier_id, seq = excluded.seq, lat = excluded.lat,
             lon = excluded.lon, heading_deg = excluded.heading_deg,
             received_at = excluded.received_at, accepted_at = excluded.accepted_at
         where heartbeats.seq < excluded.seq
       returning seq::text as seq`,
      [
        actor.sessionId,
        beat.stream,
        actor.courier.courier_id,
        beat.seq,
        beat.position.lat,
        beat.position.lon,
        beat.position.heading_deg,
        now,
      ],
    );
    const muted = actor.courier.muted;
    if (accepted !== null && beat.emote !== null && !muted) {
      await tx.query('update couriers set emote = $2, emote_at = $3 where courier_id = $1', [
        actor.courier.courier_id,
        beat.emote,
        now,
      ]);
    }
    const highest =
      accepted !== null
        ? beat.seq
        : Number(
            (
              await tx.one<{ seq: string }>(
                'select seq::text as seq from heartbeats where session_id = $1 and stream = $2',
                [actor.sessionId, beat.stream],
              )
            )?.seq ?? '0',
          );
    const current = await tx.one<{ emote: Emote | null; emote_at: Date | null; muted: boolean }>(
      'select emote, emote_at, muted from couriers where courier_id = $1',
      [actor.courier.courier_id],
    );
    return {
      accepted: accepted !== null,
      last_seq: highest,
      emote: visibleEmote(current!, now),
      muted: current!.muted,
    };
  });
}

export function visibleEmote(
  courier: { emote: Emote | string | null; emote_at: Date | null; muted: boolean },
  now: Date,
): Emote | null {
  if (courier.muted || courier.emote === null || courier.emote_at === null) return null;
  const alive = now.getTime() - courier.emote_at.getTime() < EMOTE_WINDOW_SECONDS * 1000;
  return alive ? (courier.emote as Emote) : null;
}

export interface OnlineCourier {
  courier_id: string;
  role: Role;
  display_name: string;
  satchel_colour: string;
  position: PresencePosition;
  emote: Emote | null;
  muted: boolean;
  name_locked: boolean;
  moderation_ref: string;
}

interface OnlineRow {
  courier_id: string;
  role: Role;
  display_name: string;
  satchel_colour: string;
  lat: number;
  lon: number;
  heading_deg: number;
  emote: Emote | null;
  emote_at: Date | null;
  muted: boolean;
  name_locked: boolean;
  moderation_ref: string;
}

/** Each online courier once, at their newest accepted heartbeat across live sessions. */
export async function onlineCouriers(now: Date): Promise<OnlineCourier[]> {
  const rows = await query<OnlineRow>(
    `select distinct on (h.courier_id)
            h.courier_id, h.lat, h.lon, h.heading_deg,
            c.role, c.display_name, c.emote, c.emote_at, c.muted, c.name_locked, c.moderation_ref,
            sa.colour as satchel_colour
     from heartbeats h
     join sessions s on s.session_id = h.session_id and s.ended_at is null
     join couriers c on c.courier_id = h.courier_id
     join satchels sa on sa.satchel_id = c.worn_satchel_id
     where h.accepted_at > $1::timestamptz - make_interval(secs => $2)
     order by h.courier_id, h.accepted_at desc`,
    [now, FRESH_SECONDS],
  );
  return rows.map((row) => ({
    courier_id: row.courier_id,
    role: row.role,
    display_name: row.display_name,
    satchel_colour: row.satchel_colour,
    position: { lat: row.lat, lon: row.lon, heading_deg: row.heading_deg },
    emote: visibleEmote(row, now),
    muted: row.muted,
    name_locked: row.name_locked,
    moderation_ref: row.moderation_ref,
  }));
}

/** Presence carries only public fields, and never the reader's own courier. */
export function publicPresence(couriers: OnlineCourier[], readerCourierId: string): unknown {
  return {
    couriers: couriers
      .filter((courier) => courier.courier_id !== readerCourierId)
      .map((courier) => ({
        display_name: courier.display_name,
        satchel_colour: courier.satchel_colour,
        position: courier.position,
        emote: courier.emote,
      })),
  };
}

export async function sweepStaleHeartbeats(): Promise<void> {
  await query('delete from heartbeats where accepted_at < now() - interval \'60 seconds\'');
}
