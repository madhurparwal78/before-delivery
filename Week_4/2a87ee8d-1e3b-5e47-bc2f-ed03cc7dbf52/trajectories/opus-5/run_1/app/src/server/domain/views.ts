import type { WorkshopStatus } from './states.js';

export type ViewerRole = 'facilitator' | 'participant';

export interface StoredNote {
  readonly id: string;
  readonly workshopId: string;
  readonly frameId: string;
  readonly clusterId: string | null;
  readonly clusterIndex: number | null;
  readonly kind: 'text' | 'image';
  readonly text: string | null;
  readonly imageId: string | null;
  readonly x: number;
  readonly y: number;
  readonly revealed: boolean;
  readonly facilitatorOnly: boolean;
  readonly authorKind: ViewerRole;
  readonly authorParticipantId: string | null;
  readonly authorName: string;
  readonly roundNumber: number;
  readonly createdAt: number;
}

export interface StoredFrame {
  readonly id: string;
  readonly workshopId: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: number;
}

export interface StoredCluster {
  readonly id: string;
  readonly workshopId: string;
  readonly frameId: string;
  readonly title: string;
  readonly x: number;
  readonly y: number;
}

export interface StoredConnector {
  readonly id: string;
  readonly workshopId: string;
  readonly fromNoteId: string;
  readonly toNoteId: string;
}

export interface Viewer {
  readonly role: ViewerRole;
  /** Null for the facilitator. */
  readonly participantId: string | null;
}

export function isOwnNote(note: StoredNote, viewer: Viewer): boolean {
  return viewer.role === 'facilitator'
    ? note.authorKind === 'facilitator'
    : note.authorParticipantId !== null && note.authorParticipantId === viewer.participantId;
}

/**
 * Whether the viewer receives the note at all. A note the caller does not receive answers 404.
 * Facilitator-only notes are never sent to participants.
 */
export function receivesNote(note: StoredNote, viewer: Viewer): boolean {
  if (note.facilitatorOnly) return viewer.role === 'facilitator';
  return true;
}

/** Whether the viewer may read the note's text, i.e. the note is not a card back for them. */
function canReadNoteText(note: StoredNote, viewer: Viewer): boolean {
  return note.revealed || isOwnNote(note, viewer);
}

/** A card back is another person's unrevealed note, received without its text. */
export function isCardBack(note: StoredNote, viewer: Viewer): boolean {
  return receivesNote(note, viewer) && !canReadNoteText(note, viewer);
}

export type NoteView = Record<string, unknown>;

/**
 * The one place the per-role note field list lives. The server sends only these keys.
 */
export function projectNote(note: StoredNote, viewer: Viewer): NoteView | null {
  if (!receivesNote(note, viewer)) return null;
  const imageUrl = note.kind === 'image' ? `/api/notes/${note.id}/image` : null;
  const mine = isOwnNote(note, viewer);

  if (!canReadNoteText(note, viewer)) {
    // Someone else's unrevealed note: a card back.
    const back: NoteView = {
      id: note.id,
      frameId: note.frameId,
      x: note.x,
      y: note.y,
      revealed: note.revealed,
      mine,
    };
    if (viewer.role === 'facilitator') back.authorName = note.authorName;
    return back;
  }

  const view: NoteView = {
    id: note.id,
    frameId: note.frameId,
    clusterId: note.clusterId,
    kind: note.kind,
    text: note.kind === 'image' ? null : note.text,
    imageUrl,
    x: note.x,
    y: note.y,
    revealed: note.revealed,
    mine,
  };
  if (viewer.role === 'facilitator') {
    view.authorName = note.authorName;
    view.facilitatorOnly = note.facilitatorOnly;
  } else if (mine) {
    // Participants see author names on their own notes only.
    view.authorName = note.authorName;
  }
  return view;
}

export interface FrameCounts {
  readonly noteCount: number;
  readonly hiddenCount: number;
}

export function projectFrame(frame: StoredFrame, counts: FrameCounts): Record<string, unknown> {
  return {
    id: frame.id,
    title: frame.title,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    position: frame.position,
    noteCount: counts.noteCount,
    hiddenCount: counts.hiddenCount,
  };
}

export interface ClusterCounts {
  readonly noteIds: readonly string[];
  readonly dotTotal: number;
  readonly myDots: number;
}

export function projectCluster(
  cluster: StoredCluster,
  counts: ClusterCounts,
  viewer: Viewer,
  status: WorkshopStatus,
): Record<string, unknown> {
  const base = {
    id: cluster.id,
    frameId: cluster.frameId,
    title: cluster.title,
    x: cluster.x,
    y: cluster.y,
    noteIds: counts.noteIds,
    noteCount: counts.noteIds.length,
  };
  if (viewer.role === 'facilitator') return { ...base, dotTotal: counts.dotTotal };
  // Participants see only their own dots until the workshop closes.
  const revealTotals = status === 'closed' || status === 'archived';
  return revealTotals
    ? { ...base, myDots: counts.myDots, dotTotal: counts.dotTotal }
    : { ...base, myDots: counts.myDots };
}

export function projectConnector(
  connector: StoredConnector,
  visibleNoteIds: ReadonlySet<string>,
): Record<string, unknown> | null {
  // A connector reaches a participant only when both its notes do.
  if (!visibleNoteIds.has(connector.fromNoteId) || !visibleNoteIds.has(connector.toNoteId)) return null;
  return { id: connector.id, fromNoteId: connector.fromNoteId, toNoteId: connector.toNoteId };
}
