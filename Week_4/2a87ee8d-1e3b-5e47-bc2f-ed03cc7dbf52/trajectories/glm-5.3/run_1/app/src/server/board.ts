/**
 * Board shaping per viewer, counts, ranking and search (DP-11, DP-24, DP-28, DP-60).
 * One place decides which keys each role receives.
 */
import type { PoolClient } from 'pg';
import type { Note, Frame, Cluster, Connector, Dot, Participant, Workshop } from './db.js';

export type Role = 'facilitator' | 'participant';

export interface Viewer {
  role: Role;
  facilitatorId?: string;
  facilitatorName?: string;
  participantId?: string;
  displayName?: string;
}

export interface ShapedNote {
  id: string; frameId: string; clusterId: string | null; kind: string;
  text: string | null; imageUrl: string | null; x: number; y: number;
  revealed: boolean; mine: boolean; authorName?: string; facilitatorOnly?: boolean;
}

export interface ShapedCluster {
  id: string; frameId: string; title: string; x: number; y: number;
  noteIds: string[]; noteCount: number; myDots?: number; dotTotal?: number;
}

export interface ShapedFrame {
  id: string; title: string; x: number; y: number; width: number; height: number;
  position: number; noteCount: number; hiddenCount: number;
}

export interface ShapedParticipant {
  id: string; displayName: string; notesThisRound: number; active: boolean;
}

/** Every viewer receives every non-facilitator-only note: unreadable ones
 * arrive as card backs (no text), which is the viewer's only signal. */
export function noteVisible(note: Note, viewer: Viewer, status: string): boolean {
  if (note.facilitator_only) return viewer.role === 'facilitator';
  return true;
}

export function canSeeText(note: Note, viewer: Viewer): boolean {
  if (note.facilitator_only) return viewer.role === 'facilitator';
  if (note.revealed) return true;
  if (viewer.role === 'facilitator') return note.author_facilitator;
  return note.author_participant_id === viewer.participantId;
}

export function shapeNote(note: Note, viewer: Viewer): ShapedNote {
  const mine = viewer.role === 'facilitator' ? note.author_facilitator : note.author_participant_id === viewer.participantId;
  const readable = canSeeText(note, viewer);
  const base: ShapedNote = {
    id: note.id,
    frameId: note.frame_id,
    clusterId: note.cluster_id,
    kind: note.kind,
    text: readable ? note.text : null,
    imageUrl: readable && note.kind === 'image' ? `/api/notes/${note.id}/image` : null,
    x: note.x,
    y: note.y,
    revealed: note.revealed,
    mine,
  };
  if (readable || viewer.role === 'facilitator') base.authorName = note.author_name;
  if (viewer.role === 'facilitator') base.facilitatorOnly = note.facilitator_only;
  return base;
}

export function clusterNoteIds(notes: Note[], cluster: Cluster): string[] {
  return notes.filter((n) => n.cluster_id === cluster.id)
    .sort((a, b) => a.placement_index - b.placement_index || a.created_at.getTime() - b.created_at.getTime())
    .map((n) => n.id);
}

/** Frame and cluster counts, always computed from the stored notes (DP-24). */
export function frameCounts(notes: Note[]): { noteCount: number; hiddenCount: number } {
  let count = 0;
  let hidden = 0;
  for (const n of notes) {
    if (n.facilitator_only) continue;
    count += 1;
    if (!n.revealed) hidden += 1;
  }
  return { noteCount: count, hiddenCount: hidden };
}

/** Un-cancelled spends per cluster; myDots restricted to a participant. */
export function dotTotals(dots: Dot[]): Map<string, { total: number; mine: number }> {
  const cancelled = new Set(dots.filter((d) => d.kind === 'return').map((d) => d.cancels_id));
  const out = new Map<string, { total: number; mine: number }>();
  for (const d of dots) {
    if (d.kind !== 'spend' || cancelled.has(d.id)) continue;
    const entry = out.get(d.cluster_id) ?? { total: 0, mine: 0 };
    entry.total += 1;
    out.set(d.cluster_id, entry);
  }
  return out;
}

export function dotsRemaining(dots: Dot[], participantId: string, budget: number): number {
  const cancelled = new Set(dots.filter((d) => d.kind === 'return').map((d) => d.cancels_id));
  let spent = 0;
  for (const d of dots) {
    if (d.kind === 'spend' && d.participant_id === participantId && !cancelled.has(d.id)) spent += 1;
  }
  return budget - spent;
}

export function notesThisRound(notes: Note[], participantId: string, roundNumber: number, frameIdsVisible: Set<string>): number {
  let count = 0;
  for (const n of notes) {
    if (n.author_participant_id === participantId && n.round_number === roundNumber && !n.facilitator_only && frameIdsVisible.has(n.frame_id)) count += 1;
  }
  return count;
}

/** The one cluster ranking order (DP-28): dots desc, frame rail position, title. */
export function rankClusters(clusters: Cluster[], frames: Frame[], totals: Map<string, { total: number; mine: number }>): ShapedCluster[] {
  const framePos = new Map(frames.map((f) => [f.id, f.position]));
  const visible = clusters.filter((c) => framePos.has(c.frame_id));
  visible.sort((a, b) => {
    const ta = totals.get(a.id)?.total ?? 0;
    const tb = totals.get(b.id)?.total ?? 0;
    if (ta !== tb) return tb - ta;
    const fa = framePos.get(a.frame_id) ?? 0;
    const fb = framePos.get(b.frame_id) ?? 0;
    if (fa !== fb) return fa - fb;
    return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0;
  });
  return visible.map((c) => ({
    id: c.id, frameId: c.frame_id, title: c.title, x: c.x, y: c.y,
    noteIds: [], noteCount: 0,
    dotTotal: totals.get(c.id)?.total ?? 0,
  }));
}

export interface BoardState {
  workshop: Workshop;
  frames: Frame[];
  clusters: Cluster[];
  notes: Note[];
  connectors: Connector[];
  dots: Dot[];
  participants: Participant[];
}

/** Load a full board state for internal use. */
export async function loadBoard(c: PoolClient, workshopId: string): Promise<BoardState | null> {
  const workshop = (await c.query('select * from workshops where id = $1', [workshopId])).rows[0] as Workshop | undefined;
  if (!workshop) return null;
  const frames = (await c.query('select * from frames where workshop_id = $1 order by position', [workshopId])).rows as unknown as Frame[];
  const clusters = (await c.query('select * from clusters where workshop_id = $1 order by created_at', [workshopId])).rows as unknown as Cluster[];
  const notes = (await c.query('select * from notes where workshop_id = $1 and deleted = false order by created_at, id', [workshopId])).rows as unknown as Note[];
  const connectors = (await c.query('select * from connectors where workshop_id = $1 order by created_at', [workshopId])).rows as unknown as Connector[];
  const dots = (await c.query('select * from dot_ledger where workshop_id = $1 order by created_at, id', [workshopId])).rows as unknown as Dot[];
  const participants = (await c.query('select * from participants where workshop_id = $1 order by created_at', [workshopId])).rows as unknown as Participant[];
  return { workshop, frames, clusters, notes, connectors, dots, participants };
}

/** The board response for one viewer (DP-11). */
export function shapeBoard(state: BoardState, viewer: Viewer, opts: { dotsRemainingValue: number | null }): Record<string, unknown> {
  const { workshop, frames, clusters, notes, connectors, dots } = state;
  const visibleFrames = frames.filter((f) => f.trashed_at === null);
  const visibleFrameIds = new Set(visibleFrames.map((f) => f.id));
  const totals = dotTotals(dots);
  const seenNotes = notes.filter((n) => visibleFrameIds.has(n.frame_id) && noteVisible(n, viewer, workshop.status));
  const shapedNotes = seenNotes.map((n) => shapeNote(n, viewer));
  const noteById = new Map(seenNotes.map((n) => [n.id, n]));
  const seenNoteIds = new Set(seenNotes.map((n) => n.id));
  const visibleClusters = clusters.filter((c) => visibleFrameIds.has(c.frame_id));
  const shapedClusters: ShapedCluster[] = visibleClusters.map((cl) => {
    const ids = clusterNoteIds(seenNotes.filter((n) => n.cluster_id === cl.id), cl);
    const out: ShapedCluster = {
      id: cl.id, frameId: cl.frame_id, title: cl.title, x: cl.x, y: cl.y,
      noteIds: ids, noteCount: ids.length,
    };
    if (viewer.role === 'participant') {
      out.myDots = totals.get(cl.id)?.mine ?? 0;
      if (workshop.status === 'closed' || workshop.status === 'archived') out.dotTotal = totals.get(cl.id)?.total ?? 0;
    } else {
      out.dotTotal = totals.get(cl.id)?.total ?? 0;
    }
    return out;
  });
  const shapedFrames: ShapedFrame[] = visibleFrames.map((f) => {
    const counts = frameCounts(notes.filter((n) => n.frame_id === f.id));
    return {
      id: f.id, title: f.title, x: f.x, y: f.y, width: f.width, height: f.height,
      position: f.position, noteCount: counts.noteCount, hiddenCount: counts.hiddenCount,
    };
  });
  const shapedConnectors = connectors.filter((cn) => seenNoteIds.has(cn.from_note_id) && seenNoteIds.has(cn.to_note_id))
    .map((cn) => ({ id: cn.id, fromNoteId: cn.from_note_id, toNoteId: cn.to_note_id }));

  const workshopForParticipant = {
    id: workshop.id, title: workshop.title, status: workshop.status,
    round: workshop.round_ends_at ? { number: workshop.round_number, endsAt: workshop.round_ends_at.toISOString() } : null,
    voting: workshop.voting_ends_at ? { dotBudget: workshop.dot_budget, endsAt: workshop.voting_ends_at.toISOString() } : null,
    version: workshop.version,
  };
  const viewerOut = viewer.role === 'facilitator'
    ? { role: 'facilitator', name: viewer.facilitatorName ?? '' }
    : { role: 'participant', participantId: viewer.participantId, displayName: viewer.displayName, dotsRemaining: opts.dotsRemainingValue };
  const out: Record<string, unknown> = {
    workshop: viewer.role === 'facilitator' ? null : workshopForParticipant,
    viewer: viewerOut,
    frames: shapedFrames,
    clusters: shapedClusters,
    notes: shapedNotes,
    connectors: shapedConnectors,
  };
  if (viewer.role === 'facilitator') {
    out.workshop = null; // replaced by the facilitator workshop object at the call site
  }
  void noteById;
  return out;
}
