// The published note character model. Every character remembers the revision that
// inserted it and the revisions that deleted it, and never leaves the sequence. Undo
// and redo toggle whether an edit revision is active. The state is plain JSON.

type RevisionKind = "create" | "edit" | "undo" | "redo";

export interface NoteRevision {
  rev: number;
  kind: RevisionKind;
  /** The member id of whoever made the revision. */
  author: string;
  /** For undo and redo, the edit revision it toggles; otherwise null. */
  target: number | null;
}

/** A character entry: [code point, inserting rev, deleting revs]. */
export type NoteChar = [string, number, number[]];

export interface NoteState {
  chars: NoteChar[];
  revisions: NoteRevision[];
}

interface NoteEdit {
  base: number;
  pos: number;
  del: number;
  insert: string;
  author: string;
}

type EditField = "base_rev" | "pos" | "delete" | "insert" | "body";

type EditOutcome = { ok: true; state: NoteState } | { ok: false; field: EditField; message: string };

type Toggle = { ok: true; state: NoteState } | { ok: false };

/** A note body holds 1 to this many code points. */
export const NOTE_MAX = 2000;

/** Length in Unicode code points. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** A new note whose creating revision 0 inserts the body. */
export function createNote(body: string, author: string): NoteState {
  return {
    chars: [...body].map((c): NoteChar => [c, 0, []]),
    revisions: [{ rev: 0, kind: "create", author, target: null }],
  };
}

/** The latest revision number. */
export function currentRev(s: NoteState): number {
  return s.revisions.length - 1;
}

/** Which revisions are active just after revision r. */
function activeAt(s: NoteState, r: number): (rev: number) => boolean {
  const undone = new Set<number>();
  for (const { rev, kind, target } of s.revisions) {
    if (rev > r || target === null) continue;
    if (kind === "undo") undone.add(target);
    else if (kind === "redo") undone.delete(target);
  }
  return (rev) => rev <= r && !undone.has(rev);
}

/** Indices into the sequence of the characters visible just after revision r. */
function visibleAt(s: NoteState, r: number): number[] {
  const active = activeAt(s, r);
  const visible: number[] = [];
  s.chars.forEach(([, ins, dels], i) => {
    if (active(ins) && !dels.some(active)) visible.push(i);
  });
  return visible;
}

/** The body just after revision rev. */
function bodyAt(s: NoteState, rev: number): string {
  return visibleAt(s, rev)
    .map((i) => (s.chars[i] as NoteChar)[0])
    .join("");
}

/** The current body. */
export function body(s: NoteState): string {
  return bodyAt(s, currentRev(s));
}

const refuseEdit = (field: EditField, message: string): EditOutcome => ({ ok: false, field, message });

/** Applies an edit by the published three-step merge rule. */
export function applyEdit(s: NoteState, edit: NoteEdit): EditOutcome {
  const { base, pos, del, insert, author } = edit;
  const rev = currentRev(s) + 1;
  if (!Number.isInteger(base) || base < 0 || base >= rev) return refuseEdit("base_rev", "That revision doesn't exist on this note.");
  if (!Number.isInteger(pos) || pos < 0) return refuseEdit("pos", "Position must be a whole number, 0 or more.");
  if (!Number.isInteger(del) || del < 0) return refuseEdit("delete", "Delete must be a whole number, 0 or more.");
  const visible = visibleAt(s, base);
  if (pos > visible.length) return refuseEdit("pos", "Position is past the end of the text at that revision.");
  if (pos + del > visible.length) return refuseEdit("delete", "That deletes past the end of the text at that revision.");
  if (del === 0 && insert === "") return refuseEdit("insert", "An edit must delete or insert something.");

  const chars = s.chars.map(([c, ins, dels]): NoteChar => [c, ins, [...dels]]);
  for (const i of visible.slice(pos, pos + del)) (chars[i] as NoteChar)[2].push(rev);

  const left = pos === 0 ? -1 : (visible[pos - 1] as number);
  const right = pos + del === visible.length ? chars.length : (visible[pos + del] as number);
  const editor = author.toLowerCase();
  let at = right;
  for (let i = left + 1; i < right; i++) {
    const ins = (chars[i] as NoteChar)[1];
    if (ins > base && (s.revisions[ins] as NoteRevision).author.toLowerCase() > editor) {
      at = i;
      break;
    }
  }
  chars.splice(at, 0, ...[...insert].map((c): NoteChar => [c, rev, []]));

  const next: NoteState = { chars, revisions: [...s.revisions, { rev, kind: "edit", author, target: null }] };
  const length = codePointLength(body(next));
  if (length < 1 || length > NOTE_MAX) return refuseEdit("body", `A note must be 1 to ${NOTE_MAX} characters.`);
  return { ok: true, state: next };
}

function append(s: NoteState, kind: "undo" | "redo", author: string, target: number): NoteState {
  return { chars: s.chars, revisions: [...s.revisions, { rev: currentRev(s) + 1, kind, author, target }] };
}

/** Makes the caller's most recent active edit inactive. */
export function undo(s: NoteState, author: string): Toggle {
  const active = activeAt(s, currentRev(s));
  const target = s.revisions.findLast((r) => r.kind === "edit" && r.author === author && active(r.rev));
  return target ? { ok: true, state: append(s, "undo", author, target.rev) } : { ok: false };
}

/** Re-activates the edit the caller most recently undid, if still inactive and no newer edit of theirs exists. */
export function redo(s: NoteState, author: string): Toggle {
  const last = s.revisions.findLast((r) => r.kind === "undo" && r.author === author);
  if (!last || last.target === null) return { ok: false };
  const editedSince = s.revisions.some((r) => r.kind === "edit" && r.author === author && r.rev > last.rev);
  if (editedSince || activeAt(s, currentRev(s))(last.target)) return { ok: false };
  return { ok: true, state: append(s, "redo", author, last.target) };
}

/** Every revision with the body just after it. */
export function history(s: NoteState): { rev: number; kind: RevisionKind; author: string; body: string }[] {
  return s.revisions.map(({ rev, kind, author }) => ({ rev, kind, author, body: bodyAt(s, rev) }));
}
