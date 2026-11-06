/**
 * The published character model for notes. A note is a sequence of characters; each one
 * remembers the revision that inserted it and every revision that deleted it, and no
 * character ever leaves the sequence.
 */

export type NoteChar = {
  c: string;
  ins: number;
  del: number[];
};

export type NoteRevisionKind = 'create' | 'edit' | 'undo' | 'redo';

export type NoteRevision = {
  rev: number;
  kind: NoteRevisionKind;
  personId: string;
  memberId: string;
  authorName: string;
  authorRole: string;
  active: boolean;
  /** For an undo or a redo, the edit revision it toggles. */
  target: number | null;
  body: string;
  visible: number[];
  createdAt: string;
};

export type NoteDoc = {
  chars: NoteChar[];
  revisions: NoteRevision[];
  /** Per person, the edit revision they most recently undid and have not redone. */
  undone: Record<string, number>;
};

export type NoteAuthor = {
  personId: string;
  memberId: string;
  name: string;
  role: string;
};

function codePoints(text: string): string[] {
  return Array.from(text);
}

function isActive(doc: NoteDoc, rev: number): boolean {
  const revision = doc.revisions.find((r) => r.rev === rev);
  return revision ? revision.active : false;
}

function visibleIndices(doc: NoteDoc): number[] {
  const out: number[] = [];
  for (let i = 0; i < doc.chars.length; i++) {
    const ch = doc.chars[i];
    if (!isActive(doc, ch.ins)) continue;
    if (ch.del.some((rev) => isActive(doc, rev))) continue;
    out.push(i);
  }
  return out;
}

export function bodyOf(doc: NoteDoc): string {
  return visibleIndices(doc)
    .map((i) => doc.chars[i].c)
    .join('');
}

export function currentRev(doc: NoteDoc): number {
  return doc.revisions[doc.revisions.length - 1].rev;
}

export function visibleAt(doc: NoteDoc, rev: number): number[] {
  const revision = doc.revisions.find((r) => r.rev === rev);
  return revision ? revision.visible : [];
}

export function lengthAt(doc: NoteDoc, rev: number): number {
  return visibleAt(doc, rev).length;
}

function record(doc: NoteDoc, revision: Omit<NoteRevision, 'body' | 'visible'>): void {
  const entry: NoteRevision = { ...revision, visible: [], body: '' };
  doc.revisions.push(entry);
  entry.visible = visibleIndices(doc);
  entry.body = entry.visible.map((i) => doc.chars[i].c).join('');
}

export function createNote(body: string, author: NoteAuthor, createdAt: string): NoteDoc {
  const doc: NoteDoc = { chars: [], revisions: [], undone: {} };
  doc.chars = codePoints(body).map((c) => ({ c, ins: 0, del: [] }));
  doc.revisions.push({
    rev: 0,
    kind: 'create',
    personId: author.personId,
    memberId: author.memberId,
    authorName: author.name,
    authorRole: author.role,
    active: true,
    target: null,
    body,
    visible: doc.chars.map((_, i) => i),
    createdAt,
  });
  return doc;
}

export type EditRequest = {
  baseRev: number;
  pos: number;
  del: number;
  insert: string;
};

export type EditProblem = 'base_rev' | 'pos' | 'delete' | 'empty' | 'body_length';

export function checkEdit(doc: NoteDoc, edit: EditRequest): EditProblem | null {
  if (!Number.isInteger(edit.baseRev) || edit.baseRev < 0 || edit.baseRev > currentRev(doc)) {
    return 'base_rev';
  }
  if (!Number.isInteger(edit.pos) || edit.pos < 0) return 'pos';
  if (!Number.isInteger(edit.del) || edit.del < 0) return 'delete';
  const length = lengthAt(doc, edit.baseRev);
  if (edit.pos + edit.del > length) return 'pos';
  if (edit.del === 0 && edit.insert.length === 0) return 'delete';
  return null;
}

/** Applies one edit by the published three steps. The caller has already run checkEdit. */
export function applyEdit(
  doc: NoteDoc,
  edit: EditRequest,
  author: NoteAuthor,
  createdAt: string,
): void {
  const rev = currentRev(doc) + 1;
  const base = visibleAt(doc, edit.baseRev);

  for (let k = 0; k < edit.del; k++) {
    const index = base[edit.pos + k];
    const ch = doc.chars[index];
    if (!ch.del.includes(rev)) ch.del.push(rev);
  }

  const inserted = codePoints(edit.insert);
  if (inserted.length > 0) {
    const leftIndex = edit.pos === 0 ? -1 : base[edit.pos - 1];
    const rightIndex = edit.pos + edit.del === base.length ? doc.chars.length : base[edit.pos + edit.del];
    let target = rightIndex;
    const editorId = author.memberId.toLowerCase();
    for (let i = leftIndex + 1; i < rightIndex; i++) {
      const ch = doc.chars[i];
      if (ch.ins <= edit.baseRev) continue;
      const owner = doc.revisions.find((r) => r.rev === ch.ins);
      if (owner && owner.memberId.toLowerCase() > editorId) {
        target = i;
        break;
      }
    }
    const fresh: NoteChar[] = inserted.map((c) => ({ c, ins: rev, del: [] }));
    doc.chars.splice(target, 0, ...fresh);
  }

  record(doc, {
    rev,
    kind: 'edit',
    personId: author.personId,
    memberId: author.memberId,
    authorName: author.name,
    authorRole: author.role,
    active: true,
    target: null,
    createdAt,
  });
  delete doc.undone[author.personId];
}

export function resultingLength(doc: NoteDoc, edit: EditRequest): number {
  const base = visibleAt(doc, edit.baseRev);
  const deleted = new Set<number>();
  for (let k = 0; k < edit.del; k++) deleted.add(base[edit.pos + k]);
  let length = 0;
  for (const index of visibleIndices(doc)) {
    if (!deleted.has(index)) length++;
  }
  return length + codePoints(edit.insert).length;
}

export function undoTarget(doc: NoteDoc, personId: string): number | null {
  let best: number | null = null;
  for (const revision of doc.revisions) {
    if (revision.kind !== 'edit') continue;
    if (revision.personId !== personId) continue;
    if (!revision.active) continue;
    if (best === null || revision.rev > best) best = revision.rev;
  }
  return best;
}

export function applyUndo(doc: NoteDoc, author: NoteAuthor, createdAt: string): void {
  const target = undoTarget(doc, author.personId)!;
  doc.revisions.find((r) => r.rev === target)!.active = false;
  const rev = currentRev(doc) + 1;
  record(doc, {
    rev,
    kind: 'undo',
    personId: author.personId,
    memberId: author.memberId,
    authorName: author.name,
    authorRole: author.role,
    active: true,
    target,
    createdAt,
  });
  doc.undone[author.personId] = target;
}

export function redoTarget(doc: NoteDoc, personId: string): number | null {
  const target = doc.undone[personId];
  if (target === undefined) return null;
  const revision = doc.revisions.find((r) => r.rev === target);
  return revision && !revision.active ? target : null;
}

export function applyRedo(doc: NoteDoc, author: NoteAuthor, createdAt: string): void {
  const target = redoTarget(doc, author.personId)!;
  doc.revisions.find((r) => r.rev === target)!.active = true;
  const rev = currentRev(doc) + 1;
  record(doc, {
    rev,
    kind: 'redo',
    personId: author.personId,
    memberId: author.memberId,
    authorName: author.name,
    authorRole: author.role,
    active: true,
    target,
    createdAt,
  });
  delete doc.undone[author.personId];
}

/** The one edit the page derives from a before and after text, in code points. */
export function diffEdit(before: string, after: string): { pos: number; del: number; insert: string } {
  const a = codePoints(before);
  const b = codePoints(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  ) {
    end++;
  }
  return {
    pos: start,
    del: a.length - start - end,
    insert: b.slice(start, b.length - end).join(''),
  };
}
