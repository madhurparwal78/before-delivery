import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import { AppError, FIELD_MESSAGES } from '../errors.js';
import { newId } from '../ids.js';
import { isCardBack, isOwnNote, receivesNote, type StoredNote, type Viewer } from '../domain/views.js';
import {
  BOARD_WRITE_SHAPES,
  noteFieldGroupsInBody,
  unknownKeyErrors,
  type BoardWriteShape,
} from '../domain/writeKeys.js';
import { assertBeforeDeadline, assertOperationAllowed, type BoardOperation } from './permissions.js';
import { bumpVersion, findNoteById, lockWorkshop, type WorkshopRow } from './repository.js';
import type { Actor } from '../auth/sessions.js';
import { recordActivity } from '../activity.js';
import { queueUnreferencedImage } from '../workshops/trash.js';

const COORDINATE_LIMIT = 100_000;

export function viewerFor(actor: Actor): Viewer {
  return actor.kind === 'facilitator'
    ? { role: 'facilitator', participantId: null }
    : { role: 'participant', participantId: actor.participantId };
}

/** Rejects any key the endpoint does not publish, listing every one. */
function assertAcceptedKeys(shape: BoardWriteShape, body: Record<string, unknown>): void {
  const errors = unknownKeyErrors(shape, body);
  if (Object.keys(errors).length > 0) throw new AppError('validation', { fields: errors });
}

function readNumber(
  body: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
  required: boolean,
): number | null {
  const value = body[key];
  if (value === undefined) {
    if (required) fields[key] = FIELD_MESSAGES.generic;
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT) {
    fields[key] = FIELD_MESSAGES.generic;
    return null;
  }
  return value;
}

function readTitle(body: Record<string, unknown>, fields: Record<string, string>): string | null {
  const value = body.title;
  if (typeof value !== 'string' || value.length < 1 || value.length > 60) {
    fields.title = FIELD_MESSAGES.generic;
    return null;
  }
  return value;
}

/** A card back may never be changed or deleted, by either role, in any state. */
function assertNotCardBack(note: StoredNote, viewer: Viewer): void {
  if (isCardBack(note, viewer)) throw new AppError('forbidden');
}

export function assertReceivesNote(note: StoredNote | null, viewer: Viewer): StoredNote {
  if (note === null || !receivesNote(note, viewer)) throw new AppError('not_found');
  return note;
}

/**
 * Keeps a cluster's order gap-free with each note listed once, placing `note` at `index`
 * (or last when no index is given).
 */
async function reindexCluster(
  client: PoolClient,
  clusterId: string | null,
  movedNoteId: string | null,
  index: number | null,
): Promise<void> {
  if (clusterId === null) return;
  const members = await client.query<{ id: string }>(
    `SELECT id FROM notes WHERE cluster_id = $1 AND facilitator_only = false
      ORDER BY cluster_index NULLS LAST, created_seq`,
    [clusterId],
  );
  const ids = members.rows.map((row) => row.id).filter((id) => id !== movedNoteId);
  if (movedNoteId !== null) {
    const target = index === null || index > ids.length ? ids.length : Math.max(0, index);
    ids.splice(target, 0, movedNoteId);
  }
  for (const [position, id] of ids.entries()) {
    await client.query('UPDATE notes SET cluster_index = $2 WHERE id = $1', [id, position]);
  }
}

export async function createNote(
  actor: Actor,
  workshop: WorkshopRow,
  body: Record<string, unknown>,
): Promise<string> {
  const viewer = viewerFor(actor);
  // A participant sending facilitatorOnly answers 403 first.
  if (actor.kind === 'participant' && body.facilitatorOnly !== undefined) throw new AppError('forbidden');

  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    assertOperationAllowed(viewer.role, locked.status, 'note.create');
    if (viewer.role === 'participant' && locked.status === 'silent_round') {
      assertBeforeDeadline(locked.roundEndsAtMs, Date.now());
    }
    assertAcceptedKeys('createNote', body);

    const fields: Record<string, string> = {};
    const kind = body.kind === 'image' ? 'image' : body.kind === 'text' ? 'text' : null;
    if (kind === null) fields.kind = FIELD_MESSAGES.generic;
    const x = readNumber(body, 'x', fields, true);
    const y = readNumber(body, 'y', fields, true);

    let text: string | null = null;
    let imageId: string | null = null;
    if (kind === 'text') {
      const raw = body.text;
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed.length < 1 || trimmed.length > 280) fields.text = FIELD_MESSAGES.generic;
      else text = trimmed;
    } else if (kind === 'image') {
      imageId = typeof body.imageId === 'string' ? body.imageId : null;
      if (imageId === null) fields.imageId = FIELD_MESSAGES.imageId;
    }

    const frameId = typeof body.frameId === 'string' ? body.frameId : null;
    if (frameId === null) fields.frameId = FIELD_MESSAGES.generic;
    const facilitatorOnly = body.facilitatorOnly === true;
    if (body.facilitatorOnly !== undefined && typeof body.facilitatorOnly !== 'boolean') {
      fields.facilitatorOnly = FIELD_MESSAGES.generic;
    }
    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    const frame = await client.query(
      `SELECT 1 FROM frames WHERE id = $1 AND workshop_id = $2 AND trashed_at IS NULL AND purged_at IS NULL`,
      [frameId, workshop.id],
    );
    if (frame.rowCount === 0) throw new AppError('validation', { fields: { frameId: FIELD_MESSAGES.generic } });

    if (imageId !== null) {
      // An imageId backs one note only, and only a note created by the actor who uploaded it.
      const claimed = await client.query(
        `UPDATE images SET bound_note_id = $1 WHERE id = $2 AND workshop_id = $3
           AND uploader_key = $4 AND bound_note_id IS NULL`,
        ['pending', imageId, workshop.id, uploaderKey(actor)],
      );
      if (claimed.rowCount === 0) {
        throw new AppError('validation', { fields: { imageId: FIELD_MESSAGES.imageId } });
      }
    }

    // The facilitator's own notes are revealed at once; a participant's are revealed outside
    // a silent round. No unrevealed note ever exists once the workshop is revealed.
    const revealed = actor.kind === 'facilitator' || locked.status !== 'silent_round';
    const noteId = newId('nt');
    await client.query(
      `INSERT INTO notes (id, workshop_id, frame_id, kind, text, image_id, x, y, revealed,
         facilitator_only, author_kind, author_participant_id, author_name, round_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        noteId,
        workshop.id,
        frameId,
        kind,
        text,
        imageId,
        x,
        y,
        revealed,
        facilitatorOnly,
        actor.kind,
        actor.kind === 'participant' ? actor.participantId : null,
        actor.kind === 'facilitator' ? actor.name : actor.displayName,
        locked.roundNumber,
      ],
    );
    if (imageId !== null) {
      await client.query('UPDATE images SET bound_note_id = $1 WHERE id = $2', [noteId, imageId]);
    }
    await bumpVersion(client, workshop.id);
    return noteId;
  });
}

export function uploaderKey(actor: Actor): string {
  return actor.kind === 'facilitator' ? `facilitator:${actor.facilitatorId}` : `participant:${actor.participantId}`;
}

/** The 403 checks for a note change, run before replay and the payment check. */
export function assertMayChangeNote(note: StoredNote, actor: Actor, body: Record<string, unknown>): void {
  const viewer = viewerFor(actor);
  assertNotCardBack(note, viewer);
  if (actor.kind === 'participant' && body.facilitatorOnly !== undefined) throw new AppError('forbidden');
}

export function assertMayDeleteNote(note: StoredNote, actor: Actor): void {
  const viewer = viewerFor(actor);
  assertNotCardBack(note, viewer);
  // A participant deleting someone else's note answers 403.
  if (actor.kind === 'participant' && !isOwnNote(note, viewer)) throw new AppError('forbidden');
}

export async function patchNote(
  actor: Actor,
  workshop: WorkshopRow,
  noteId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const note = assertReceivesNote(await findNoteById(client, noteId), viewer);

    const groups = noteFieldGroupsInBody(body);
    const operations: BoardOperation[] = groups.map((group) => {
      switch (group) {
        case 'position':
          return 'note.editPosition';
        case 'text':
          return 'note.editText';
        case 'placement':
          return 'note.editPlacement';
        case 'facilitatorOnly':
          return 'note.editFacilitatorOnly';
      }
    });
    for (const operation of operations) assertOperationAllowed(viewer.role, locked.status, operation);

    if (viewer.role === 'participant') {
      if (locked.status === 'silent_round') {
        // Until the deadline, and only on their own unrevealed notes.
        assertBeforeDeadline(locked.roundEndsAtMs, Date.now());
        if (note.revealed || !isOwnNote(note, viewer)) {
          throw new AppError('phase_locked', { message: "That isn't available while the workshop is Silent round" });
        }
      }
    }

    assertAcceptedKeys('patchNote', body);
    if (groups.length === 0) throw new AppError('validation', { fields: { body: FIELD_MESSAGES.generic } });

    const fields: Record<string, string> = {};
    let nextText: string | null = null;
    if (groups.includes('text')) {
      const raw = body.text;
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (note.kind === 'image' || trimmed.length < 1 || trimmed.length > 280) {
        fields.text = FIELD_MESSAGES.generic;
      } else nextText = trimmed;
    }

    let position: { x: number; y: number } | null = null;
    if (groups.includes('position')) {
      const raw = body.position;
      if (typeof raw !== 'object' || raw === null) fields.position = FIELD_MESSAGES.generic;
      else {
        const inner = raw as Record<string, unknown>;
        const x = readNumber(inner, 'x', fields, true);
        const y = readNumber(inner, 'y', fields, true);
        if (x !== null && y !== null) position = { x, y };
      }
    }

    let facilitatorOnly: boolean | null = null;
    if (groups.includes('facilitatorOnly')) {
      if (typeof body.facilitatorOnly !== 'boolean') fields.facilitatorOnly = FIELD_MESSAGES.generic;
      else facilitatorOnly = body.facilitatorOnly;
    }

    let placement: { frameId: string; clusterId: string | null; index: number | null } | null = null;
    if (groups.includes('placement')) {
      const raw = body.placement;
      if (typeof raw !== 'object' || raw === null) fields.placement = FIELD_MESSAGES.generic;
      else {
        const inner = raw as Record<string, unknown>;
        const frameId = typeof inner.frameId === 'string' ? inner.frameId : null;
        if (frameId === null) fields['placement.frameId'] = FIELD_MESSAGES.generic;
        const clusterId =
          inner.clusterId === null || inner.clusterId === undefined
            ? null
            : typeof inner.clusterId === 'string'
              ? inner.clusterId
              : undefined;
        if (clusterId === undefined) fields['placement.clusterId'] = FIELD_MESSAGES.generic;
        let index: number | null = null;
        if (inner.index !== undefined) {
          if (!Number.isInteger(inner.index) || (inner.index as number) < 0) {
            fields['placement.index'] = FIELD_MESSAGES.generic;
          } else index = inner.index as number;
        }
        if (frameId !== null && clusterId !== undefined) placement = { frameId, clusterId, index };
      }
    }

    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    if (placement !== null) {
      const frame = await client.query(
        `SELECT 1 FROM frames WHERE id = $1 AND workshop_id = $2 AND trashed_at IS NULL AND purged_at IS NULL`,
        [placement.frameId, workshop.id],
      );
      if (frame.rowCount === 0) {
        throw new AppError('validation', { fields: { 'placement.frameId': FIELD_MESSAGES.generic } });
      }
      if (placement.clusterId !== null) {
        // A note's cluster must be in the note's frame.
        const cluster = await client.query(
          'SELECT 1 FROM clusters WHERE id = $1 AND workshop_id = $2 AND frame_id = $3',
          [placement.clusterId, workshop.id, placement.frameId],
        );
        if (cluster.rowCount === 0) {
          throw new AppError('validation', { fields: { 'placement.clusterId': FIELD_MESSAGES.generic } });
        }
        // An unrevealed or facilitator-only note cannot join a cluster.
        const staysFacilitatorOnly = facilitatorOnly ?? note.facilitatorOnly;
        if (!note.revealed || staysFacilitatorOnly) {
          throw new AppError('validation', { fields: { 'placement.clusterId': FIELD_MESSAGES.generic } });
        }
      }
    }

    const previousClusterId = note.clusterId;
    if (nextText !== null) {
      await client.query('UPDATE notes SET text = $2 WHERE id = $1', [noteId, nextText]);
    }
    if (position !== null) {
      await client.query('UPDATE notes SET x = $2, y = $3 WHERE id = $1', [noteId, position.x, position.y]);
    }
    if (facilitatorOnly !== null) {
      // Turning the flag on removes the note from its cluster; turning it off returns it
      // to its frame, unclustered and revealed.
      await client.query(
        `UPDATE notes SET facilitator_only = $2, cluster_id = NULL, cluster_index = NULL,
                          revealed = CASE WHEN $2 THEN revealed ELSE true END
           WHERE id = $1`,
        [noteId, facilitatorOnly],
      );
      await reindexCluster(client, previousClusterId, null, null);
      await recordActivity(client, {
        facilitatorId: workshop.facilitatorId,
        actor: 'facilitator',
        action: 'note.facilitator_only_changed',
        workshopId: workshop.id,
      });
    }
    if (placement !== null) {
      // Moving a note to another frame clears its cluster.
      const clusterId = placement.frameId === note.frameId ? placement.clusterId : null;
      await client.query('UPDATE notes SET frame_id = $2, cluster_id = $3 WHERE id = $1', [
        noteId,
        placement.frameId,
        clusterId,
      ]);
      if (previousClusterId !== null && previousClusterId !== clusterId) {
        await reindexCluster(client, previousClusterId, null, null);
      }
      await reindexCluster(client, clusterId, clusterId === null ? null : noteId, placement.index);
      if (clusterId === null) {
        await client.query('UPDATE notes SET cluster_index = NULL WHERE id = $1', [noteId]);
      }
    }
    await bumpVersion(client, workshop.id);
  });
}

export async function deleteNote(actor: Actor, workshop: WorkshopRow, noteId: string): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const note = assertReceivesNote(await findNoteById(client, noteId), viewer);
    assertOperationAllowed(viewer.role, locked.status, 'note.delete');
    if (viewer.role === 'participant' && locked.status === 'silent_round') {
      assertBeforeDeadline(locked.roundEndsAtMs, Date.now());
    }
    // Deleting a note removes it from its cluster and removes its connectors.
    await client.query('DELETE FROM notes WHERE id = $1', [noteId]);
    await reindexCluster(client, note.clusterId, null, null);
    if (note.imageId !== null) await queueUnreferencedImage(client, note.imageId);
    await bumpVersion(client, workshop.id);
  });
}

export async function createCluster(
  actor: Actor,
  workshop: WorkshopRow,
  body: Record<string, unknown>,
): Promise<string> {
  const viewer = viewerFor(actor);
  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    assertOperationAllowed(viewer.role, locked.status, 'cluster.create');
    assertAcceptedKeys('createCluster', body);

    const fields: Record<string, string> = {};
    const title = readTitle(body, fields);
    const x = readNumber(body, 'x', fields, true);
    const y = readNumber(body, 'y', fields, true);
    const frameId = typeof body.frameId === 'string' ? body.frameId : null;
    if (frameId === null) fields.frameId = FIELD_MESSAGES.generic;
    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    const frame = await client.query(
      `SELECT 1 FROM frames WHERE id = $1 AND workshop_id = $2 AND trashed_at IS NULL AND purged_at IS NULL`,
      [frameId, workshop.id],
    );
    if (frame.rowCount === 0) throw new AppError('validation', { fields: { frameId: FIELD_MESSAGES.generic } });

    const clusterId = newId('cl');
    await client.query(
      'INSERT INTO clusters (id, workshop_id, frame_id, title, x, y) VALUES ($1,$2,$3,$4,$5,$6)',
      [clusterId, workshop.id, frameId, title, x, y],
    );
    await bumpVersion(client, workshop.id);
    return clusterId;
  });
}

export async function patchCluster(
  actor: Actor,
  workshop: WorkshopRow,
  clusterId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query('SELECT 1 FROM clusters WHERE id = $1 AND workshop_id = $2', [
      clusterId,
      workshop.id,
    ]);
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'cluster.patch');
    assertAcceptedKeys('patchCluster', body);

    const fields: Record<string, string> = {};
    const title = body.title === undefined ? null : readTitle(body, fields);
    const x = readNumber(body, 'x', fields, false);
    const y = readNumber(body, 'y', fields, false);
    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    await client.query(
      `UPDATE clusters SET title = coalesce($2, title), x = coalesce($3, x), y = coalesce($4, y)
        WHERE id = $1`,
      [clusterId, title, x, y],
    );
    await bumpVersion(client, workshop.id);
  });
}

/**
 * Deleting a cluster leaves its notes in the frame, unclustered, and writes, in the same
 * transaction, one return for every uncancelled spend on it.
 */
export async function deleteCluster(actor: Actor, workshop: WorkshopRow, clusterId: string): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query('SELECT 1 FROM clusters WHERE id = $1 AND workshop_id = $2', [
      clusterId,
      workshop.id,
    ]);
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'cluster.delete');

    const uncancelled = await client.query<{ id: string; participant_id: string }>(
      `SELECT spend.id, spend.participant_id FROM dot_entries spend
         LEFT JOIN dot_entries ret ON ret.cancels_entry_id = spend.id
        WHERE spend.cluster_id = $1 AND spend.kind = 'spend' AND ret.id IS NULL`,
      [clusterId],
    );
    for (const spend of uncancelled.rows) {
      await client.query(
        `INSERT INTO dot_entries (id, workshop_id, cluster_id, participant_id, kind, cancels_entry_id)
         VALUES ($1,$2,$3,$4,'return',$5)`,
        [newId('de'), workshop.id, clusterId, spend.participant_id, spend.id],
      );
    }
    await client.query('UPDATE notes SET cluster_id = NULL, cluster_index = NULL WHERE cluster_id = $1', [
      clusterId,
    ]);
    await client.query('DELETE FROM clusters WHERE id = $1', [clusterId]);
    await bumpVersion(client, workshop.id);
  });
}

export async function createConnector(
  actor: Actor,
  workshop: WorkshopRow,
  body: Record<string, unknown>,
): Promise<string> {
  const viewer = viewerFor(actor);
  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    assertOperationAllowed(viewer.role, locked.status, 'connector.create');
    assertAcceptedKeys('createConnector', body);

    const fromNoteId = typeof body.fromNoteId === 'string' ? body.fromNoteId : null;
    const toNoteId = typeof body.toNoteId === 'string' ? body.toNoteId : null;
    if (fromNoteId === null) throw new AppError('validation', { fields: { fromNoteId: FIELD_MESSAGES.generic } });
    if (toNoteId === null || toNoteId === fromNoteId) {
      throw new AppError('validation', { fields: { toNoteId: FIELD_MESSAGES.generic } });
    }

    const from = await findNoteById(client, fromNoteId);
    if (from === null || from.workshopId !== workshop.id || !receivesNote(from, viewer)) {
      throw new AppError('validation', { fields: { fromNoteId: FIELD_MESSAGES.generic } });
    }
    const to = await findNoteById(client, toNoteId);
    if (to === null || to.workshopId !== workshop.id || !receivesNote(to, viewer)) {
      throw new AppError('validation', { fields: { toNoteId: FIELD_MESSAGES.generic } });
    }
    const existing = await client.query(
      `SELECT 1 FROM connectors WHERE workshop_id = $1
         AND ((from_note_id = $2 AND to_note_id = $3) OR (from_note_id = $3 AND to_note_id = $2))`,
      [workshop.id, fromNoteId, toNoteId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AppError('validation', { fields: { toNoteId: FIELD_MESSAGES.generic } });
    }

    const connectorId = newId('cn');
    await client.query(
      'INSERT INTO connectors (id, workshop_id, from_note_id, to_note_id) VALUES ($1,$2,$3,$4)',
      [connectorId, workshop.id, fromNoteId, toNoteId],
    );
    await bumpVersion(client, workshop.id);
    return connectorId;
  });
}

export async function deleteConnector(
  actor: Actor,
  workshop: WorkshopRow,
  connectorId: string,
): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query('SELECT 1 FROM connectors WHERE id = $1 AND workshop_id = $2', [
      connectorId,
      workshop.id,
    ]);
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'connector.delete');
    await client.query('DELETE FROM connectors WHERE id = $1', [connectorId]);
    await bumpVersion(client, workshop.id);
  });
}

export interface DotResult {
  readonly dotId: string | null;
  readonly dotsRemaining: number;
}

/**
 * Spends one dot. The workshop row is locked, so simultaneous spends commit one at a time
 * against the budget and never take anyone past it.
 */
export async function spendDot(actor: Actor, workshop: WorkshopRow, clusterId: string): Promise<DotResult> {
  const viewer = viewerFor(actor);
  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query('SELECT 1 FROM clusters WHERE id = $1 AND workshop_id = $2', [
      clusterId,
      workshop.id,
    ]);
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'dot.spend');
    assertBeforeDeadline(locked.votingEndsAtMs, Date.now());

    const participantId = (actor as { participantId: string }).participantId;
    const budget = locked.dotBudget ?? 0;
    const spent = await countUncancelledSpends(client, workshop.id, participantId);
    if (spent >= budget) throw new AppError('budget_exhausted');

    const dotId = newId('de');
    await client.query(
      `INSERT INTO dot_entries (id, workshop_id, cluster_id, participant_id, kind)
       VALUES ($1,$2,$3,$4,'spend')`,
      [dotId, workshop.id, clusterId, participantId],
    );
    await bumpVersion(client, workshop.id);
    return { dotId, dotsRemaining: budget - spent - 1 };
  });
}

/** A return cancels the participant's most recent uncancelled spend on that cluster. */
export async function returnDot(actor: Actor, workshop: WorkshopRow, clusterId: string): Promise<DotResult> {
  const viewer = viewerFor(actor);
  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query('SELECT 1 FROM clusters WHERE id = $1 AND workshop_id = $2', [
      clusterId,
      workshop.id,
    ]);
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'dot.return');
    assertBeforeDeadline(locked.votingEndsAtMs, Date.now());

    const participantId = (actor as { participantId: string }).participantId;
    const spend = await client.query<{ id: string }>(
      `SELECT spend.id FROM dot_entries spend
         LEFT JOIN dot_entries ret ON ret.cancels_entry_id = spend.id
        WHERE spend.cluster_id = $1 AND spend.participant_id = $2 AND spend.kind = 'spend' AND ret.id IS NULL
        ORDER BY spend.created_seq DESC
        LIMIT 1`,
      [clusterId, participantId],
    );
    const target = spend.rows[0];
    if (!target) throw new AppError('no_dot_to_return');

    // The unique index on `cancels_entry_id` makes concurrent returns cancel a spend once.
    await client.query(
      `INSERT INTO dot_entries (id, workshop_id, cluster_id, participant_id, kind, cancels_entry_id)
       VALUES ($1,$2,$3,$4,'return',$5)`,
      [newId('de'), workshop.id, clusterId, participantId, target.id],
    );
    await bumpVersion(client, workshop.id);
    const budget = locked.dotBudget ?? 0;
    const spent = await countUncancelledSpends(client, workshop.id, participantId);
    return { dotId: null, dotsRemaining: budget - spent };
  });
}

async function countUncancelledSpends(
  client: PoolClient,
  workshopId: string,
  participantId: string,
): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT count(*)::bigint AS total FROM dot_entries spend
       LEFT JOIN dot_entries ret ON ret.cancels_entry_id = spend.id
      WHERE spend.workshop_id = $1 AND spend.participant_id = $2 AND spend.kind = 'spend' AND ret.id IS NULL`,
    [workshopId, participantId],
  );
  return result.rows[0]?.total ?? 0;
}

export async function createFrame(
  actor: Actor,
  workshop: WorkshopRow,
  body: Record<string, unknown>,
): Promise<string> {
  const viewer = viewerFor(actor);
  return withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    assertOperationAllowed(viewer.role, locked.status, 'frame.create');
    assertAcceptedKeys('createFrame', body);

    const fields: Record<string, string> = {};
    const title = readTitle(body, fields);
    const x = readNumber(body, 'x', fields, true);
    const y = readNumber(body, 'y', fields, true);
    const width = readNumber(body, 'width', fields, true);
    const height = readNumber(body, 'height', fields, true);
    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    const last = await client.query<{ next: number }>(
      'SELECT coalesce(max(position), -1) + 1 AS next FROM frames WHERE workshop_id = $1',
      [workshop.id],
    );
    const frameId = newId('fr');
    await client.query(
      `INSERT INTO frames (id, workshop_id, title, x, y, width, height, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [frameId, workshop.id, title, x, y, width, height, last.rows[0]?.next ?? 0],
    );
    await bumpVersion(client, workshop.id);
    return frameId;
  });
}

export async function patchFrame(
  actor: Actor,
  workshop: WorkshopRow,
  frameId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const viewer = viewerFor(actor);
  await withTransaction(async (client) => {
    const locked = await lockWorkshop(client, workshop.id);
    const found = await client.query(
      `SELECT 1 FROM frames WHERE id = $1 AND workshop_id = $2 AND trashed_at IS NULL AND purged_at IS NULL`,
      [frameId, workshop.id],
    );
    if (found.rowCount === 0) throw new AppError('not_found');
    assertOperationAllowed(viewer.role, locked.status, 'frame.patch');
    assertAcceptedKeys('patchFrame', body);

    const fields: Record<string, string> = {};
    const title = body.title === undefined ? null : readTitle(body, fields);
    const x = readNumber(body, 'x', fields, false);
    const y = readNumber(body, 'y', fields, false);
    const width = readNumber(body, 'width', fields, false);
    const height = readNumber(body, 'height', fields, false);
    if (Object.keys(fields).length > 0) throw new AppError('validation', { fields });

    await client.query(
      `UPDATE frames SET title = coalesce($2, title), x = coalesce($3, x), y = coalesce($4, y),
         width = coalesce($5, width), height = coalesce($6, height)
        WHERE id = $1`,
      [frameId, title, x, y, width, height],
    );
    await bumpVersion(client, workshop.id);
  });
}
