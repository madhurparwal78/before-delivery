// The room's view of the board: the last server board with the pending optimistic changes laid over it, plus
// the comparisons the reveal wave and its announcements follow from.
import type { Board, Cluster, Frame, Note } from "../types.js";
import { CLUSTER_GAP, CLUSTER_HEADER, NOTE_HEIGHT, NOTE_WIDTH } from "../../shared/layout.js";
import { compareRanked } from "../../shared/ranking.js";
import { noteCount } from "../format.js";

export interface NotePatch {
  x?: number;
  y?: number;
  text?: string;
  frameId?: string;
  clusterId?: string | null;
  index?: number;
  facilitatorOnly?: boolean;
  deleted?: boolean;
}

export interface Pending {
  key: string;
  noteId: string;
  patch: NotePatch;
}

export interface NewNote {
  key: string;
  clientOpId: string;
  body: { frameId: string; kind: "text" | "image"; text?: string; imageId?: string; x: number; y: number; facilitatorOnly?: boolean };
  imageUrl: string | null;
}

interface View {
  frames: (Frame & { counter: string })[];
  clusters: Cluster[];
  notes: (Note & { saving?: boolean })[];
  byId: Map<string, Note & { saving?: boolean }>;
}

export function isCardBack(n: Note): boolean {
  return !n.revealed && !n.mine;
}

/** Only revealed notes that everyone can see may join a cluster. */
export function canCluster(n: Note): boolean {
  return n.revealed && !n.facilitatorOnly;
}

const NEW_NOTE = "new-";

/** A note still being created has a local key until the server answers. */
export function newNoteKey(clientOpId: string): string {
  return `${NEW_NOTE}${clientOpId}`;
}

export function isBeingCreated(n: Note): boolean {
  return n.id.startsWith(NEW_NOTE);
}

export function noteName(n: Note): string {
  if (isCardBack(n)) return n.authorName ? `Hidden note by ${n.authorName}` : "Hidden note";
  if (n.facilitatorOnly) return `Facilitator-only note: ${n.text ?? ""}`;
  if (n.kind === "image") return "Image note";
  if (!n.revealed) return `Your note: ${n.text ?? ""}`;
  return `Note: ${n.text ?? ""}`;
}

export function frameCounter(f: Frame, silent: boolean): string {
  return silent || f.hiddenCount > 0 ? `${f.hiddenCount} hidden` : noteCount(f.noteCount);
}

export function buildView(board: Board, pending: Pending[], creating: NewNote[], preview: Pending | null): View {
  const merged = new Map<string, NotePatch>();
  for (const p of preview ? [...pending, preview] : pending) merged.set(p.noteId, { ...merged.get(p.noteId), ...p.patch });
  const counted = (n: Note) => !n.facilitatorOnly;
  const delta = new Map<string, { notes: number; hidden: number }>();
  const bump = (frameId: string, n: Note, by: number) => {
    if (!counted(n)) return;
    const d = delta.get(frameId) ?? { notes: 0, hidden: 0 };
    d.notes += by;
    if (!n.revealed) d.hidden += by;
    delta.set(frameId, d);
  };

  const notes: (Note & { saving?: boolean })[] = [];
  for (const n of board.notes) {
    const patch = merged.get(n.id);
    if (!patch) {
      notes.push(n);
      continue;
    }
    if (patch.deleted) {
      bump(n.frameId, n, -1);
      continue;
    }
    const next: Note & { saving?: boolean } = { ...n, ...stripPlacement(patch) };
    if ("text" in patch || "facilitatorOnly" in patch) next.saving = true;
    if (patch.facilitatorOnly) next.clusterId = null;
    if (next.frameId !== n.frameId || next.facilitatorOnly !== n.facilitatorOnly) {
      bump(n.frameId, n, -1);
      bump(next.frameId, next, 1);
    }
    notes.push(next);
  }
  for (const c of creating) {
    const n: Note & { saving: boolean } = {
      id: c.key,
      frameId: c.body.frameId,
      clusterId: null,
      kind: c.body.kind,
      text: c.body.text ?? null,
      imageUrl: c.imageUrl,
      x: c.body.x,
      y: c.body.y,
      revealed: board.workshop.status !== "silent_round" || board.viewer.role === "facilitator",
      mine: true,
      facilitatorOnly: c.body.facilitatorOnly ?? false,
      saving: true,
    };
    bump(n.frameId, n, 1);
    notes.push(n);
  }
  const byId = new Map(notes.map((n) => [n.id, n]));

  const clusters = board.clusters.map((c) => ({ ...c, noteIds: c.noteIds.filter((id) => byId.get(id)?.clusterId === c.id) }));
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  for (const [noteId, patch] of merged) {
    const note = byId.get(noteId);
    if (!("clusterId" in patch) || !patch.clusterId || !note || note.facilitatorOnly) continue;
    const target = clusterById.get(patch.clusterId);
    if (!target) continue;
    const ids = target.noteIds.filter((id) => id !== noteId);
    ids.splice(Math.min(patch.index ?? ids.length, ids.length), 0, noteId);
    target.noteIds = ids;
  }
  for (const c of clusters) c.noteCount = c.noteIds.length;

  const silent = board.workshop.status === "silent_round";
  const frames = [...board.frames]
    .sort((a, b) => a.position - b.position)
    .map((f) => {
      const d = delta.get(f.id);
      const frame = d ? { ...f, noteCount: f.noteCount + d.notes, hiddenCount: f.hiddenCount + d.hidden } : f;
      return { ...frame, counter: frameCounter(frame, silent) };
    });
  return { frames, clusters, notes, byId };
}

function stripPlacement(patch: NotePatch): Partial<Note> {
  const out: Partial<Note> = {};
  if (patch.x !== undefined) out.x = patch.x;
  if (patch.y !== undefined) out.y = patch.y;
  if (patch.text !== undefined) out.text = patch.text;
  if (patch.frameId !== undefined) out.frameId = patch.frameId;
  if (patch.clusterId !== undefined) out.clusterId = patch.clusterId;
  if (patch.facilitatorOnly !== undefined) out.facilitatorOnly = patch.facilitatorOnly;
  return out;
}

/** The note's top-left in frame coordinates: its own spot, or its row in its cluster. */
export function notePlace(n: Note, view: View): { x: number; y: number } {
  const cluster = n.clusterId ? view.clusters.find((c) => c.id === n.clusterId) : undefined;
  if (!cluster) return { x: n.x, y: n.y };
  const row = cluster.noteIds.indexOf(n.id);
  return { x: cluster.x + 12, y: cluster.y + CLUSTER_HEADER + row * (NOTE_HEIGHT + CLUSTER_GAP) };
}

export function clusterHeight(c: Cluster): number {
  return CLUSTER_HEADER + c.noteIds.length * (NOTE_HEIGHT + CLUSTER_GAP) + 12;
}

export const CLUSTER_WIDTH = NOTE_WIDTH + 24;

/** The first free sticky slot in a frame, scanning rows from the top-left below the frame heading. */
export function freeSpot(frame: Frame, view: View): { x: number; y: number } {
  const taken = view.notes
    .filter((n) => n.frameId === frame.id)
    .map((n) => notePlace(n, view))
    .concat(view.clusters.filter((c) => c.frameId === frame.id).map((c) => ({ x: c.x, y: c.y })));
  for (let y = 64; y + NOTE_HEIGHT <= frame.height; y += NOTE_HEIGHT + 16) {
    for (let x = 24; x + NOTE_WIDTH <= frame.width; x += NOTE_WIDTH + 16) {
      if (!taken.some((t) => Math.abs(t.x - x) < NOTE_WIDTH && Math.abs(t.y - y) < NOTE_HEIGHT)) return { x, y };
    }
  }
  return { x: 24 + ((taken.length * 23) % (frame.width - NOTE_WIDTH - 24)), y: 64 + ((taken.length * 17) % (frame.height - NOTE_HEIGHT - 64)) };
}

export function ranked(board: Board): { cluster: Cluster; frame: Frame }[] {
  const frames = new Map(board.frames.map((f) => [f.id, f]));
  return board.clusters
    .flatMap((cluster) => {
      const frame = frames.get(cluster.frameId);
      return frame ? [{ cluster, frame, dots: cluster.dotTotal ?? 0, framePosition: frame.position, title: cluster.title }] : [];
    })
    .sort(compareRanked);
}

/** The wave rule: last render in a silent round, new render past it or in a later round. */
export function waveFires(prev: Board | null, next: Board): boolean {
  if (!prev || prev.workshop.status !== "silent_round") return false;
  return next.workshop.status !== "silent_round" || (next.workshop.round?.number ?? 0) > (prev.workshop.round?.number ?? 0);
}

/** The cards that were card backs last render and can now be read, per frame. */
export function flippedCards(prev: Board, next: Board): Map<string, string[]> {
  const backs = new Set(prev.notes.filter(isCardBack).map((n) => n.id));
  const out = new Map<string, string[]>();
  for (const n of next.notes) {
    if (!backs.has(n.id) || isCardBack(n)) continue;
    out.set(n.frameId, [...(out.get(n.frameId) ?? []), n.id]);
  }
  return out;
}

/** Frames announced by a reveal, in rail order, with their new note totals. */
export function revealAnnouncements(prev: Board, next: Board): { frameId: string; text: string }[] {
  const mineHidden = new Set(prev.notes.filter((n) => n.mine && !n.revealed).map((n) => n.frameId));
  const before = new Map(prev.frames.map((f) => [f.id, f]));
  return [...next.frames]
    .sort((a, b) => a.position - b.position)
    .filter((f) => (before.get(f.id)?.hiddenCount ?? 0) > 0 || mineHidden.has(f.id))
    .map((f) => ({ frameId: f.id, text: `Round revealed: ${noteCount(f.noteCount)} in ${f.title} frame` }));
}

export function boardBounds(frames: Frame[]): { x: number; y: number; width: number; height: number } {
  if (!frames.length) return { x: 0, y: 0, width: 800, height: 600 };
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  return { x, y, width: Math.max(...frames.map((f) => f.x + f.width)) - x, height: Math.max(...frames.map((f) => f.y + f.height)) - y };
}
