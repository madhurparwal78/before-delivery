/** The note character model. A note is a sequence of characters; each remembers
 *  the revision that inserted it and the revisions that deleted it. Characters
 *  never leave the sequence. A revision is active unless it has been undone and
 *  not redone. The body is the characters whose inserting revision is active and
 *  that no active revision deletes. Positions and lengths count Unicode code
 *  points, never UTF-16 units. */

export type CharState = { ch: string; ins: number; del: number[] };
export type EditSpec = { pos: number; delete: number; insert: string };
export type RevisionKind = "create" | "edit" | "undo" | "redo";

export type RevisionMeta = {
  rev: number;
  kind: RevisionKind;
  authorMemberId: string;
  /** For undo and redo: the edit revision it targets. */
  target: number | null;
};

/** A revision is inactive when an undo targets it and no later redo does, judged
 *  among the revisions up to `uptoRev` (the history at that moment). */
function isUndoneAt(revisions: RevisionMeta[], uptoRev: number, target: number): boolean {
  let undoneBy = -1;
  for (const r of revisions) {
    if (r.rev > uptoRev) break;
    if (r.kind === "undo" && r.target === target) undoneBy = r.rev;
  }
  if (undoneBy === -1) return false;
  for (const r of revisions) {
    if (r.rev > uptoRev) break;
    if (r.kind === "redo" && r.target === target && r.rev > undoneBy) return false;
  }
  return true;
}

export function revisionActiveAt(revisions: RevisionMeta[], uptoRev: number, rev: number): boolean {
  if (rev > uptoRev) return false;
  if (rev === 0) return true;
  return !isUndoneAt(revisions, uptoRev, rev);
}

export function visibleBodyAt(chars: CharState[], revisions: RevisionMeta[], uptoRev: number): string {
  let out = "";
  for (const c of chars) {
    if (revisionActiveAt(revisions, uptoRev, c.ins) && !c.del.some((r) => revisionActiveAt(revisions, uptoRev, r))) out += c.ch;
  }
  return out;
}

/** The sequence indexes of the characters visible at revision `base`, in order. */
function visibleIndexesAt(chars: CharState[], revisions: RevisionMeta[], base: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (revisionActiveAt(revisions, base, c.ins) && !c.del.some((r) => revisionActiveAt(revisions, base, r))) out.push(i);
  }
  return out;
}

function authorOfInsert(chars: CharState[], idx: number, revisions: RevisionMeta[]): string | null {
  const meta = revisions.find((r) => r.rev === chars[idx].ins);
  return meta === undefined ? null : meta.authorMemberId;
}

/** Applies one edit on top of the history at `base`, marking the delete on the
 *  characters the base text names and placing the insert by the published rule:
 *  among the characters between the boundaries, before the first one inserted
 *  after base whose author's member id sorts after the editor's, else before the
 *  right boundary or at the end of the note. */
export function applyEdit(
  chars: CharState[],
  revisions: RevisionMeta[],
  base: number,
  edit: EditSpec,
  editorMemberId: string,
  editRev: number,
): CharState[] {
  const out: CharState[] = chars.map((c) => ({ ch: c.ch, ins: c.ins, del: [...c.del] }));
  const visibleIdx = visibleIndexesAt(out, revisions, base);

  for (let k = 0; k < edit.delete; k++) {
    const idx = visibleIdx[edit.pos + k];
    if (idx !== undefined) out[idx].del.push(editRev);
  }

  if (edit.insert.length === 0) return out;

  const leftIdx = edit.pos === 0 ? -1 : visibleIdx[edit.pos - 1];
  const rightIdx = edit.pos + edit.delete >= visibleIdx.length ? out.length : visibleIdx[edit.pos + edit.delete];
  const lo = leftIdx + 1;
  const hi = rightIdx;
  let insertAt = hi;
  for (let i = lo; i < hi; i++) {
    if (out[i].ins > base) {
      const author = authorOfInsert(out, i, revisions);
      if (author !== null && author.toLowerCase() > editorMemberId.toLowerCase()) {
        insertAt = i;
        break;
      }
    }
  }
  const newChars: CharState[] = [...edit.insert].map((ch) => ({ ch, ins: editRev, del: [] }));
  out.splice(insertAt, 0, ...newChars);
  return out;
}

/** The caller's most recent edit revision that is still active now. */
export function latestActiveOwnEdit(revisions: RevisionMeta[], memberId: string, topRev: number): number | null {
  let best: number | null = null;
  for (const r of revisions) {
    if (r.rev > topRev) break;
    if (r.kind !== "edit" || r.authorMemberId !== memberId) continue;
    if (isUndoneAt(revisions, topRev, r.rev)) continue;
    if (best === null || r.rev > best) best = r.rev;
  }
  return best;
}

/** The caller's most recently undone edit that is still inactive, with the rev
 *  of its undo, for redo. Null when there is nothing to redo. */
export function latestRedoableEdit(revisions: RevisionMeta[], memberId: string, topRev: number): { target: number; undoRev: number } | null {
  let best: { target: number; undoRev: number } | null = null;
  for (const r of revisions) {
    if (r.rev > topRev) break;
    if (r.kind !== "undo" || r.authorMemberId !== memberId) continue;
    if (!isUndoneAt(revisions, topRev, r.target ?? -1)) continue;
    const hasLaterOwnEdit = revisions.some((o) => o.rev > r.rev && o.rev <= topRev && o.kind === "edit" && o.authorMemberId === memberId);
    if (hasLaterOwnEdit) continue;
    if (best === null || r.rev > best.undoRev) best = { target: r.target ?? -1, undoRev: r.rev };
  }
  return best;
}

/** Characters inserted into a brand-new note by its creating revision. */
export function charsForBody(body: string): CharState[] {
  return [...body].map((ch) => ({ ch, ins: 0, del: [] }));
}
