import type { PoolClient } from 'pg';
import type { DamageKind, Firing, Plan, Stage } from '../../shared/types';
import { FIRING_STATUS_LABELS } from '../../shared/labels';
import { query, withTransaction } from '../db/pool';
import { unloadOutcome } from '../domain/pieceStatus';
import { studioLabel } from '../domain/time';
import type { FieldErrors } from '../domain/measure';
import * as errors from '../http/errors';
import { attachPhoto, findPhoto } from '../repo/photos';
import { addHistory, trackingUrl } from '../repo/pieces';
import {
  finishUnload,
  lockFiring,
  placementsOfLocked,
  statusOf,
  toFiring,
  type FiringRow,
} from '../repo/firings';
import type { KilnRecord } from '../repo/catalog';
import { insertDamageReport } from '../repo/damage';
import { queueMessage } from '../repo/outbox';
import { readyNotice } from '../services/messages';
import type { UserRow } from '../repo/users';

const PICKUP_SHELF_PATTERN = /^[A-Z0-9]{1,8}$/;
const NOTE_LIMIT = 500;

export const UNLOAD_MSG = {
  shelf: 'Enter a pickup shelf',
  shelfShape: 'Use 1 to 8 capital letters or digits',
  piece: 'Choose a piece in this firing',
  kind: 'Choose glaze run or crack',
  photo: 'Add a photo of the shelf',
  photoUsed: 'Photo already used or not yours',
  note: `Keep the note to ${NOTE_LIMIT} characters`,
} as const;

interface DamageEntry {
  pieceNumber: string;
  kind: DamageKind;
  photoId: string;
  note: string;
}

interface OwnerRow {
  number: string;
  owner_kind: 'member' | 'guest';
  guest_email: string | null;
  member_email: string | null;
  token: string | null;
}

async function readDamage(
  body: Record<string, unknown>,
  inFiring: Set<string>,
  uploaderId: string,
  fields: FieldErrors,
): Promise<DamageEntry[]> {
  const raw = body.damage;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    fields.damage = 'Send the damage reports as a list';
    return [];
  }
  const entries: DamageEntry[] = [];
  for (const [index, item] of raw.entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const pieceNumber = typeof row.piece_number === 'string' ? row.piece_number : '';
    if (!inFiring.has(pieceNumber)) fields[`damage.${index}.piece_number`] = UNLOAD_MSG.piece;
    const kind = row.kind === 'glaze_run' || row.kind === 'crack' ? row.kind : null;
    if (!kind) fields[`damage.${index}.kind`] = UNLOAD_MSG.kind;
    const photo = await findPhoto(row.photo_id);
    if (!photo) fields[`damage.${index}.photo_id`] = UNLOAD_MSG.photo;
    else if (photo.attached || photo.uploader_id !== uploaderId) {
      fields[`damage.${index}.photo_id`] = UNLOAD_MSG.photoUsed;
    }
    const note = typeof row.note === 'string' ? row.note : '';
    if (note.length > NOTE_LIMIT) fields[`damage.${index}.note`] = UNLOAD_MSG.note;
    if (kind && photo) entries.push({ pieceNumber, kind, photoId: photo.id, note });
  }
  return entries;
}

/** Unloads a cooled firing: pieces come off, notices queue, damage is logged. */
export async function runUnload(args: {
  firing: FiringRow;
  kiln: KilnRecord;
  body: Record<string, unknown>;
  actor: UserRow;
  now: Date;
}): Promise<Firing> {
  const status = statusOf(args.firing, args.now);
  const coolUntil = args.firing.cool_until;
  if (coolUntil && (status === 'firing' || status === 'cooling')) {
    throw errors.conflict(
      'kiln_not_cool',
      status === 'firing' ? 'Kiln still firing' : FIRING_STATUS_LABELS.cooling,
      { cool_until: coolUntil.toISOString(), cool_until_label: studioLabel(coolUntil) },
    );
  }
  if (status !== 'unloadable') {
    throw errors.conflict('invalid_transition', 'This firing cannot be unloaded.');
  }

  const loaded = await piecesInFiring(args.firing.id);
  const inFiring = new Set(loaded.map((piece) => piece.number));

  const fields: FieldErrors = {};
  const damage = await readDamage(args.body, inFiring, args.actor.id, fields);

  const rawShelf = typeof args.body.pickup_shelf === 'string' ? args.body.pickup_shelf.trim() : '';
  const shelfNeeded = loaded.some(
    (piece) => unloadOutcome(piece.plan, piece.stage).status === 'ready',
  );
  if (rawShelf === '') {
    if (shelfNeeded) fields.pickup_shelf = UNLOAD_MSG.shelf;
  } else if (!PICKUP_SHELF_PATTERN.test(rawShelf)) {
    fields.pickup_shelf = UNLOAD_MSG.shelfShape;
  }
  if (Object.keys(fields).length > 0) throw errors.unprocessable(fields);

  return withTransaction(async (client) => {
    // Held under the row lock, so of simultaneous unloads exactly one goes on.
    const locked = await lockFiring(client, args.firing.id);
    if (!locked || statusOf(locked, args.now) !== 'unloadable') {
      throw errors.conflict('invalid_transition', 'This firing cannot be unloaded.');
    }
    const unloaded = await finishUnload(client, args.firing.id, rawShelf || null, args.now);
    if (!unloaded) throw errors.conflict('invalid_transition', 'This firing cannot be unloaded.');

    const rows = await placementsOfLocked(client, args.firing.id);
    const pieces = await client.query<{
      number: string;
      plan: 'bisque_and_glaze' | 'bisque_only' | 'glaze_only';
      stage: 'bisque' | 'glaze' | null;
    }>(
      `select number, plan, stage from pieces where number = any($1::text[]) for update`,
      [rows.map((row) => row.piece_number)],
    );

    const readyNumbers: string[] = [];
    for (const piece of pieces.rows) {
      const outcome = unloadOutcome(piece.plan, piece.stage);
      if (outcome.status === 'ready') {
        await client.query(
          `update pieces set status = 'ready', stage = null, pickup_shelf = $2, ready_at = $3,
             reminder_sent_at = null
           where number = $1`,
          [piece.number, rawShelf, args.now],
        );
        readyNumbers.push(piece.number);
      } else {
        await client.query(
          `update pieces set status = 'queued', stage = $2, pickup_shelf = null where number = $1`,
          [piece.number, outcome.stage],
        );
      }
      await addHistory(client, piece.number, args.actor.name, 'unloaded');
    }

    for (const entry of damage) {
      if (!(await attachPhoto(client, entry.photoId))) {
        throw errors.unprocessable({ 'damage.photo_id': UNLOAD_MSG.photoUsed });
      }
      await insertDamageReport(client, {
        pieceNumber: entry.pieceNumber,
        firingId: args.firing.id,
        kind: entry.kind,
        note: entry.note,
        unloadPhotoId: entry.photoId,
        reportedBy: args.actor.name,
      });
      await addHistory(client, entry.pieceNumber, args.actor.name, 'damage reported');
    }

    await queueReadyNotices(client, readyNumbers, rawShelf);

    return toFiring(unloaded, args.kiln, rows, args.now);
  });
}

interface LoadedPiece {
  number: string;
  plan: Plan;
  stage: Stage | null;
}

async function piecesInFiring(firingId: string): Promise<LoadedPiece[]> {
  return query<LoadedPiece>(
    `select p.number, p.plan, p.stage from placements pl
     join pieces p on p.number = pl.piece_number
     where pl.firing_id = $1 order by p.number`,
    [firingId],
  );
}

async function queueReadyNotices(
  client: PoolClient,
  numbers: string[],
  pickupShelf: string,
): Promise<void> {
  if (numbers.length === 0) return;
  const owners = await client.query<OwnerRow>(
    `select p.number, p.owner_kind, p.guest_email, u.email as member_email, t.token
     from pieces p
     left join users u on u.id = p.owner_user_id
     left join tracking_links t on t.piece_number = p.number and t.active
     where p.number = any($1::text[])`,
    [numbers],
  );
  for (const owner of owners.rows) {
    const to = owner.owner_kind === 'member' ? owner.member_email : owner.guest_email;
    if (!to) continue;
    await queueMessage(
      client,
      readyNotice({
        to,
        pieceNumber: owner.number,
        pickupShelf,
        trackingUrl: owner.token ? trackingUrl(owner.token) : null,
      }),
    );
  }
}
