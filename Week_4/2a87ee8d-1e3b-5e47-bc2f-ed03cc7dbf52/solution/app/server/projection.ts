// What each viewer receives. The per-role key lists and the counts are decided here and nowhere else.
import { config } from "./config.js";
import type { Db } from "./db.js";
import { ACTIVE_SESSION_SQL, linkExpiresAt, type Actor } from "./auth.js";
import { dotTotal, dotsRemaining, loadLedger, type LedgerEntry } from "./dots.js";
import { entitlementsOf } from "./billing.js";
import type { WorkshopRow } from "./store.js";
import { centsToAmount } from "../shared/money.js";
import { compareRanked } from "../shared/ranking.js";

export interface FrameRow {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
}

export interface ClusterRow {
  id: string;
  frame_id: string;
  title: string;
  x: number;
  y: number;
}

export interface NoteRow {
  id: string;
  workshop_id: string;
  frame_id: string;
  cluster_id: string | null;
  cluster_index: number | null;
  kind: "text" | "image";
  text: string | null;
  image_id: string | null;
  x: number;
  y: number;
  revealed: boolean;
  facilitator_only: boolean;
  author_participant_id: string | null;
  round: number;
  created_at: Date;
  author_name: string;
}

export interface ConnectorRow {
  id: string;
  from_note: string;
  to_note: string;
}

export interface BoardState {
  frames: FrameRow[];
  clusters: ClusterRow[];
  notes: NoteRow[];
  connectors: ConnectorRow[];
  ledger: LedgerEntry[];
}

/** Everything on the board that is not in trash. */
export async function loadBoard(t: Db, workshop: WorkshopRow): Promise<BoardState> {
  const [frames, clusters, notes, connectors, ledger] = await Promise.all([
    t.rows<FrameRow>("SELECT id, title, x, y, width, height, position FROM frames WHERE workshop_id = $1 AND trash_id IS NULL ORDER BY position", [
      workshop.id,
    ]),
    t.rows<ClusterRow>(
      `SELECT c.id, c.frame_id, c.title, c.x, c.y FROM clusters c JOIN frames f ON f.id = c.frame_id AND f.trash_id IS NULL
       WHERE c.workshop_id = $1 ORDER BY c.seq`,
      [workshop.id],
    ),
    t.rows<NoteRow>(
      `SELECT n.id, n.workshop_id, n.frame_id, n.cluster_id, n.cluster_index, n.kind, n.text, n.image_id, n.x, n.y, n.revealed, n.facilitator_only,
              n.author_participant_id, n.round, n.created_at, coalesce(p.display_name, $2) AS author_name
       FROM notes n JOIN frames f ON f.id = n.frame_id AND f.trash_id IS NULL LEFT JOIN participants p ON p.id = n.author_participant_id
       WHERE n.workshop_id = $1 ORDER BY n.seq`,
      [workshop.id, workshop.facilitator_name],
    ),
    t.rows<ConnectorRow>(
      `SELECT c.id, c.from_note, c.to_note FROM connectors c
       JOIN notes a ON a.id = c.from_note JOIN frames fa ON fa.id = a.frame_id AND fa.trash_id IS NULL
       JOIN notes b ON b.id = c.to_note JOIN frames fb ON fb.id = b.frame_id AND fb.trash_id IS NULL
       WHERE c.workshop_id = $1 ORDER BY c.seq`,
      [workshop.id],
    ),
    loadLedger(t, workshop.id),
  ]);
  return { frames, clusters, notes, connectors, ledger };
}

/** A cluster's members in order. */
export function clusterNoteIds(state: BoardState, clusterId: string): string[] {
  return state.notes
    .filter((n) => n.cluster_id === clusterId)
    .sort((a, b) => (a.cluster_index ?? 0) - (b.cluster_index ?? 0))
    .map((n) => n.id);
}

/** Frame counts: non-facilitator-only notes, and how many of them are unrevealed. */
function frameCounts(state: BoardState, frameId: string): { noteCount: number; hiddenCount: number } {
  const counted = state.notes.filter((n) => n.frame_id === frameId && !n.facilitator_only);
  return { noteCount: counted.length, hiddenCount: counted.filter((n) => !n.revealed).length };
}

function notesThisRound(state: BoardState, participantId: string, round: number): number {
  return state.notes.filter((n) => n.author_participant_id === participantId && n.round === round).length;
}

export function rankClusters(state: BoardState) {
  const position = new Map(state.frames.map((f) => [f.id, f.position]));
  return state.clusters
    .map((c) => ({ cluster: c, dots: dotTotal(state.ledger, c.id), framePosition: position.get(c.frame_id) ?? 0, title: c.title }))
    .sort(compareRanked);
}

export function frameView(state: BoardState, f: FrameRow) {
  return { id: f.id, title: f.title, x: f.x, y: f.y, width: f.width, height: f.height, position: f.position, ...frameCounts(state, f.id) };
}

function isMine(viewer: Actor, n: NoteRow): boolean {
  return viewer.kind === "facilitator" ? n.author_participant_id === null : n.author_participant_id === viewer.id;
}

/** Whether a note reaches this viewer at all. */
export function sentTo(viewer: Actor, n: NoteRow): boolean {
  return viewer.kind === "facilitator" || !n.facilitator_only;
}

/** Whether the viewer may read the note (it is not a card back for them). */
export function readableBy(viewer: Actor, n: NoteRow): boolean {
  return sentTo(viewer, n) && (n.revealed || isMine(viewer, n));
}

function imageUrl(n: { id: string; kind: string }): string | null {
  return n.kind === "image" ? `/api/notes/${n.id}/image` : null;
}

export function noteView(viewer: Actor, n: NoteRow) {
  const mine = isMine(viewer, n);
  const base = { id: n.id, frameId: n.frame_id, x: n.x, y: n.y, revealed: n.revealed, mine };
  if (!readableBy(viewer, n)) return viewer.kind === "facilitator" ? { ...base, authorName: n.author_name } : base;
  const full = { ...base, clusterId: n.cluster_id, kind: n.kind, text: n.text, imageUrl: imageUrl(n) };
  if (viewer.kind === "facilitator") return { ...full, authorName: n.author_name, facilitatorOnly: n.facilitator_only };
  return mine ? { ...full, authorName: n.author_name } : full;
}

export function clusterView(viewer: Actor, state: BoardState, c: ClusterRow, status: WorkshopRow["status"]) {
  const noteIds = clusterNoteIds(state, c.id);
  const base = { id: c.id, frameId: c.frame_id, title: c.title, x: c.x, y: c.y, noteIds, noteCount: noteIds.length };
  if (viewer.kind === "facilitator") return { ...base, dotTotal: dotTotal(state.ledger, c.id) };
  const mine = { ...base, myDots: dotTotal(state.ledger, c.id, viewer.id) };
  return status === "closed" || status === "archived" ? { ...mine, dotTotal: dotTotal(state.ledger, c.id) } : mine;
}

function roundView(w: WorkshopRow) {
  return w.round_number > 0 ? { number: w.round_number, endsAt: w.round_ends_at?.toISOString() ?? null } : null;
}

function votingView(w: WorkshopRow) {
  return w.dot_budget !== null ? { dotBudget: w.dot_budget, endsAt: w.voting_ends_at?.toISOString() ?? null } : null;
}

export interface RecapRow {
  workshop_id: string;
  token: string;
  status: "queued" | "complete";
  reason: string | null;
  attempts: number;
  files_stored_at: Date | null;
  email_sent_at: Date | null;
  scale: number;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_amount_cents: number | null;
}

export function recapInvoice(r: RecapRow) {
  return r.invoice_number !== null && r.invoice_amount_cents !== null
    ? { number: r.invoice_number, amount: centsToAmount(r.invoice_amount_cents), currency: "EUR" }
    : null;
}

export async function recipientsOf(t: Db, workshop: { id: string; sponsor_email: string }): Promise<string[]> {
  const invited = await t.rows<{ email: string }>("SELECT DISTINCT email FROM invites WHERE workshop_id = $1", [workshop.id]);
  return [...new Set([workshop.sponsor_email.toLowerCase(), ...invited.map((i) => i.email)])];
}

export async function recapObject(t: Db, w: WorkshopRow) {
  const r = await t.one<RecapRow>("SELECT * FROM recaps WHERE workshop_id = $1", [w.id]);
  if (!r) return null;
  const invoice = recapInvoice(r);
  return {
    status: r.status,
    reason: r.reason,
    attempts: r.attempts,
    filesStoredAt: r.files_stored_at?.toISOString() ?? null,
    emailSentAt: r.email_sent_at?.toISOString() ?? null,
    recipients: (await recipientsOf(t, w)).length,
    recapUrl: `${config.publicBaseUrl}/recap/${r.token}`,
    scale: r.scale,
    invoice: invoice && r.invoice_id ? { id: r.invoice_id, ...invoice } : null,
  };
}

export async function facilitatorWorkshop(t: Db, w: WorkshopRow) {
  const [link, invites, people, entitlements, recap] = await Promise.all([
    t.one<{ token: string }>("SELECT token FROM join_links WHERE workshop_id = $1 AND revoked_at IS NULL", [w.id]),
    t.rows<{ email: string; status: "sent" | "queued" }>(
      `SELECT DISTINCT ON (email) email, status, seq FROM invites WHERE workshop_id = $1 ORDER BY email, seq DESC`,
      [w.id],
    ),
    t.one<{ n: number }>(
      `SELECT count(*) AS n FROM participants p JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id
       WHERE p.workshop_id = $1 AND ${ACTIVE_SESSION_SQL}`,
      [w.id],
    ),
    entitlementsOf(t, w.facilitator_id),
    recapObject(t, w),
  ]);
  const firstSeen = await t.rows<{ email: string }>("SELECT email FROM invites WHERE workshop_id = $1 GROUP BY email ORDER BY min(seq)", [w.id]);
  const latest = new Map(invites.map((i) => [i.email, i.status]));
  return {
    id: w.id,
    title: w.title,
    template: w.template,
    status: w.status,
    scheduledStart: w.scheduled_start,
    scheduledEnd: w.scheduled_end,
    timeZone: w.time_zone,
    sponsorEmail: w.sponsor_email,
    fee: { amount: centsToAmount(w.fee_cents), currency: "EUR" },
    invites: firstSeen.map((i) => ({ email: i.email, status: latest.get(i.email) ?? "queued" })),
    joinUrl: link ? `${config.publicBaseUrl}/join/${link.token}` : null,
    joinLinkExpiresAt: linkExpiresAt(w.end_at).toISOString(),
    participantCount: people?.n ?? 0,
    participantCap: entitlements.participantsPerWorkshop,
    roundsUsed: w.round_number,
    round: roundView(w),
    voting: votingView(w),
    version: w.version,
    recap,
  };
}

export async function boardView(t: Db, viewer: Actor, w: WorkshopRow) {
  const state = await loadBoard(t, w);
  const notes = state.notes.filter((n) => sentTo(viewer, n));
  const sent = new Set(notes.map((n) => n.id));
  const common = {
    serverTime: new Date().toISOString(),
    frames: state.frames.map((f) => frameView(state, f)),
    clusters: state.clusters.map((c) => clusterView(viewer, state, c, w.status)),
    notes: notes.map((n) => noteView(viewer, n)),
    connectors: state.connectors
      .filter((c) => sent.has(c.from_note) && sent.has(c.to_note))
      .map((c) => ({ id: c.id, fromNoteId: c.from_note, toNoteId: c.to_note })),
  };
  if (viewer.kind === "participant") {
    const counting = w.status === "voting" || w.status === "closed";
    return {
      ...common,
      workshop: { id: w.id, title: w.title, status: w.status, round: roundView(w), voting: votingView(w), version: w.version },
      viewer: {
        role: "participant",
        participantId: viewer.id,
        displayName: viewer.displayName,
        dotsRemaining: counting && w.dot_budget !== null ? dotsRemaining(w.dot_budget, state.ledger, viewer.id) : null,
      },
    };
  }
  const people = await t.rows<{ id: string; display_name: string; active: boolean }>(
    `SELECT p.id, p.display_name, ${ACTIVE_SESSION_SQL} AS active FROM participants p
     JOIN join_links l ON l.id = p.link_id JOIN workshops w ON w.id = p.workshop_id WHERE p.workshop_id = $1 ORDER BY p.created_at`,
    [w.id],
  );
  return {
    ...common,
    workshop: await facilitatorWorkshop(t, w),
    viewer: { role: "facilitator", name: viewer.name },
    participants: people.map((p) => ({
      id: p.id,
      displayName: p.display_name,
      notesThisRound: notesThisRound(state, p.id, w.round_number),
      active: p.active,
    })),
  };
}
