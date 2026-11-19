import { config } from '../config.js';
import type { Queryable } from '../db/pool.js';
import { isoTimestamp } from '../domain/schedule.js';
import {
  clusterDotTotal,
  clusterMyDots,
  clusterNoteIds,
  dotsRemaining,
  frameCounts,
  notesThisRound,
  rankClusters,
} from '../domain/counts.js';
import {
  projectCluster,
  projectConnector,
  projectFrame,
  projectNote,
  receivesNote,
  type Viewer,
} from '../domain/views.js';
import type { Actor } from '../auth/sessions.js';
import {
  joinLinkExpiresAtMs,
  loadParticipants,
  type BoardData,
  type ParticipantRow,
  type WorkshopRow,
} from './repository.js';
import { entitlementsFor } from '../domain/plans.js';
import { readMirror } from '../billing/mirror.js';

export function viewerOf(actor: Actor): Viewer {
  return actor.kind === 'facilitator'
    ? { role: 'facilitator', participantId: null }
    : { role: 'participant', participantId: actor.participantId };
}

export interface InviteRecord {
  readonly email: string;
  readonly status: 'sent' | 'queued';
}

async function listInvites(executor: Queryable, workshopId: string): Promise<InviteRecord[]> {
  // One entry per address with its latest status.
  const result = await executor.query<{ email: string; status: 'sent' | 'queued' }>(
    `SELECT DISTINCT ON (email) email, status
       FROM invites WHERE workshop_id = $1
      ORDER BY email, created_seq DESC`,
    [workshopId],
  );
  const order = await executor.query<{ email: string }>(
    `SELECT email, min(created_seq) AS first_seen
       FROM invites WHERE workshop_id = $1
      GROUP BY email ORDER BY first_seen`,
    [workshopId],
  );
  const statuses = new Map(result.rows.map((row) => [row.email, row.status]));
  return order.rows.map((row) => ({ email: row.email, status: statuses.get(row.email) ?? 'queued' }));
}

async function activeJoinUrl(executor: Queryable, workshopId: string): Promise<string | null> {
  const result = await executor.query<{ token: string }>(
    'SELECT token FROM join_links WHERE workshop_id = $1 AND revoked_at IS NULL',
    [workshopId],
  );
  const token = result.rows[0]?.token;
  return token === undefined ? null : `${config.publicBaseUrl}/join/${token}`;
}

export interface RecapRow {
  readonly status: 'queued' | 'complete';
  readonly reason: string | null;
  readonly attempts: number;
  readonly filesStoredAtMs: number | null;
  readonly emailSentAtMs: number | null;
  readonly recapToken: string;
  readonly scale: 1 | 2;
  readonly invoiceId: string | null;
  readonly invoiceNumber: string | null;
  readonly invoiceAmount: string | null;
  readonly invoiceCurrency: string | null;
  readonly recipients: number;
}

export async function findRecap(executor: Queryable, workshopId: string): Promise<RecapRow | null> {
  const result = await executor.query<{
    status: 'queued' | 'complete';
    reason: string | null;
    attempts: number;
    files_stored_at: Date | null;
    email_sent_at: Date | null;
    recap_token: string;
    scale: number;
    invoice_id: string | null;
    invoice_number: string | null;
    invoice_amount: string | null;
    invoice_currency: string | null;
    recipients: number;
  }>(
    `SELECT r.status, r.reason, r.attempts, r.files_stored_at, r.email_sent_at, r.recap_token, r.scale,
            r.invoice_id, r.invoice_number, r.invoice_amount, r.invoice_currency,
            (SELECT count(*)::bigint FROM recap_emails e WHERE e.workshop_id = r.workshop_id) AS recipients
       FROM recaps r WHERE r.workshop_id = $1`,
    [workshopId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    status: row.status,
    reason: row.reason,
    attempts: row.attempts,
    filesStoredAtMs: row.files_stored_at?.getTime() ?? null,
    emailSentAtMs: row.email_sent_at?.getTime() ?? null,
    recapToken: row.recap_token,
    scale: row.scale === 2 ? 2 : 1,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    invoiceAmount: row.invoice_amount,
    invoiceCurrency: row.invoice_currency,
    recipients: Number(row.recipients),
  };
}

export function recapObject(recap: RecapRow): Record<string, unknown> {
  return {
    status: recap.status,
    reason: recap.reason,
    attempts: recap.attempts,
    filesStoredAt: recap.filesStoredAtMs === null ? null : isoTimestamp(recap.filesStoredAtMs),
    emailSentAt: recap.emailSentAtMs === null ? null : isoTimestamp(recap.emailSentAtMs),
    recipients: recap.recipients,
    recapUrl: `${config.publicBaseUrl}/recap/${recap.recapToken}`,
    scale: recap.scale,
    invoice:
      recap.invoiceId === null
        ? null
        : {
            id: recap.invoiceId,
            number: recap.invoiceNumber,
            amount: recap.invoiceAmount,
            currency: recap.invoiceCurrency,
          },
  };
}

function roundObject(workshop: WorkshopRow): Record<string, unknown> | null {
  if (workshop.roundEndsAtMs === null) return null;
  return { number: workshop.roundNumber, endsAt: isoTimestamp(workshop.roundEndsAtMs) };
}

function votingObject(workshop: WorkshopRow): Record<string, unknown> | null {
  if (workshop.votingEndsAtMs === null || workshop.dotBudget === null) return null;
  return { dotBudget: workshop.dotBudget, endsAt: isoTimestamp(workshop.votingEndsAtMs) };
}

/** The facilitator workshop object, with exactly the published keys. */
export async function facilitatorWorkshopObject(
  executor: Queryable,
  workshop: WorkshopRow,
  nowMs: number,
): Promise<Record<string, unknown>> {
  const [invites, joinUrl, recap, mirror, participants] = await Promise.all([
    listInvites(executor, workshop.id),
    activeJoinUrl(executor, workshop.id),
    findRecap(executor, workshop.id),
    readMirror(executor, workshop.facilitatorId),
    loadParticipants(executor, workshop, nowMs),
  ]);
  const entitlements = entitlementsFor(mirror.plan);
  return {
    id: workshop.id,
    title: workshop.title,
    template: workshop.template,
    status: workshop.status,
    scheduledStart: workshop.scheduledStart,
    scheduledEnd: workshop.scheduledEnd,
    timeZone: workshop.timeZone,
    sponsorEmail: workshop.sponsorEmail,
    fee: { amount: workshop.fee, currency: 'EUR' },
    invites,
    joinUrl,
    joinLinkExpiresAt: isoTimestamp(joinLinkExpiresAtMs(workshop)),
    participantCount: participants.filter((participant) => participant.active).length,
    participantCap: entitlements.participantsPerWorkshop,
    roundsUsed: workshop.roundsUsed,
    round: roundObject(workshop),
    voting: votingObject(workshop),
    version: workshop.version,
    recap: recap === null ? null : recapObject(recap),
  };
}

/** A participant receives only these workshop keys: no emails, tokens, fee or billing data. */
function participantWorkshopObject(workshop: WorkshopRow): Record<string, unknown> {
  return {
    id: workshop.id,
    title: workshop.title,
    status: workshop.status,
    round: roundObject(workshop),
    voting: votingObject(workshop),
    version: workshop.version,
  };
}

export interface BoardResponseOptions {
  readonly workshop: WorkshopRow;
  readonly actor: Actor;
  readonly board: BoardData;
  readonly nowMs: number;
}

/** Builds the per-caller board response, sending only the keys listed for the caller's role. */
export async function boardResponse(
  executor: Queryable,
  options: BoardResponseOptions,
): Promise<Record<string, unknown>> {
  const { workshop, actor, board, nowMs } = options;
  const viewer = viewerOf(actor);

  const visibleNotes = board.notes.filter((note) => receivesNote(note, viewer));
  const visibleNoteIds = new Set(visibleNotes.map((note) => note.id));

  const frames = board.frames.map((frame) => projectFrame(frame, frameCounts(frame.id, board.notes)));
  const clusters = board.clusters.map((cluster) =>
    projectCluster(
      cluster,
      {
        noteIds: clusterNoteIds(cluster.id, board.notes),
        dotTotal: clusterDotTotal(cluster.id, board.ledger),
        myDots: clusterMyDots(cluster.id, viewer.participantId, board.ledger),
      },
      viewer,
      workshop.status,
    ),
  );
  const notes = visibleNotes
    .map((note) => projectNote(note, viewer))
    .filter((note): note is Record<string, unknown> => note !== null);
  const connectors = board.connectors
    .map((connector) => projectConnector(connector, visibleNoteIds))
    .filter((connector): connector is Record<string, unknown> => connector !== null);

  const response: Record<string, unknown> = {
    serverTime: isoTimestamp(nowMs),
    frames,
    clusters,
    notes,
    connectors,
  };

  if (actor.kind === 'facilitator') {
    response.workshop = await facilitatorWorkshopObject(executor, workshop, nowMs);
    response.viewer = { role: 'facilitator', name: actor.name };
    const participants = await loadParticipants(executor, workshop, nowMs);
    response.participants = participants.map((participant: ParticipantRow) => ({
      id: participant.id,
      displayName: participant.displayName,
      notesThisRound: notesThisRound(participant.id, workshop.roundNumber, board.notes),
      active: participant.active,
    }));
  } else {
    response.workshop = participantWorkshopObject(workshop);
    const inVoting = workshop.status === 'voting' || workshop.status === 'closed' || workshop.status === 'archived';
    response.viewer = {
      role: 'participant',
      participantId: actor.participantId,
      displayName: actor.displayName,
      dotsRemaining:
        inVoting && workshop.dotBudget !== null
          ? dotsRemaining(workshop.dotBudget, actor.participantId, board.ledger)
          : null,
    };
  }
  return response;
}

export interface RankedCluster {
  readonly clusterId: string;
  readonly frameTitle: string;
  readonly title: string;
  readonly dotTotal: number;
  readonly noteTexts: readonly string[];
}

/**
 * The cluster ranking used by the vote totals list, the recap API, the recap page, the PDF
 * cover page and the recap email. Only clusters in frames that are not in trash appear.
 */
export function rankedClusters(board: BoardData): RankedCluster[] {
  const framesById = new Map(board.frames.map((frame) => [frame.id, frame]));
  const rankable = board.clusters.flatMap((cluster) => {
    const frame = framesById.get(cluster.frameId);
    if (!frame) return [];
    return [{ cluster, frame, dotTotal: clusterDotTotal(cluster.id, board.ledger) }];
  });
  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  return rankClusters(rankable).map((entry) => ({
    clusterId: entry.cluster.id,
    frameTitle: entry.frame.title,
    title: entry.cluster.title,
    dotTotal: entry.dotTotal,
    noteTexts: clusterNoteIds(entry.cluster.id, board.notes).flatMap((noteId) => {
      const note = notesById.get(noteId);
      if (!note) return [];
      return [note.kind === 'image' ? '[image]' : (note.text ?? '')];
    }),
  }));
}
