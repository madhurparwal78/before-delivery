import {
  OpError, applyFrame, cloneProposal, proposalFromStyles, transformFrame, type Change, type ProposalState, type Span,
} from "../../shared/model.js";
import type { Card, Comment, EditMode, Op, Person, Snapshot, Suggestion } from "../../shared/types.js";

interface PendingFrame { mode: EditMode; ops: Op[]; sent: boolean }

let tmpSeq = 0;
const tmpId = (): string => `pending-${++tmpSeq}`;
export const isPending = (id: string): boolean => id.startsWith("pending-");

/**
 * The client half of the server-ordered merge (Document model and merge). `confirmed` is the
 * server's document at `revision`; `pending` frames are local edits not yet acknowledged, always
 * transformed past every server change that arrived after them, exactly as the server does.
 */
export class ProposalSync {
  confirmed: ProposalState;
  revision: number;
  view: ProposalState;
  pending: PendingFrame[] = [];
  people = new Map<string, Person>();
  comments = new Map<string, Comment>();
  private placeholders: string[] = [];

  constructor(snap: Snapshot, private me: Person) {
    this.confirmed = proposalFromStyles(snap.text, snap.blocks.map((b) => b.style));
    this.confirmed.marks = snap.marks;
    this.confirmed.spans = snap.suggestions.map(spanOf);
    this.revision = snap.revision;
    for (const p of snap.people) this.people.set(p.personId, p);
    for (const s of snap.suggestions) this.people.set(s.author.personId, s.author);
    for (const c of snap.comments) this.addComment(c);
    this.people.set(me.personId, me);
    this.view = this.confirmed;
    this.recompute();
  }

  private addComment(c: Comment): void {
    this.comments.set(c.id, c);
    this.people.set(c.author.personId, c.author);
    if (!this.confirmed.anchors.some((a) => a.id === c.id)) this.confirmed.anchors.push({ id: c.id, range: c.anchor });
  }

  /** Recompute the view: confirmed plus every pending frame, with placeholder ids. */
  recompute(): void {
    const view = cloneProposal(this.confirmed);
    for (const f of this.pending) {
      try { applyFrame(view, f.ops, { authorId: this.me.personId, mode: f.mode, newId: tmpId, now: "" }); } catch { /* refused locally: the server answers */ }
    }
    this.view = view;
  }

  /** Try a local edit against the view; returns the view change list, or null when refused. */
  local(mode: EditMode, ops: Op[]): Change[] | null {
    const probe = cloneProposal(this.view);
    let changes: Change[];
    try {
      changes = applyFrame(probe, ops, { authorId: this.me.personId, mode, newId: tmpId, now: "" }).changes;
    } catch (e) {
      if (e instanceof OpError) return null;
      throw e;
    }
    const last = this.pending[this.pending.length - 1];
    if (last && !last.sent && last.mode === mode) last.ops.push(...ops);
    else this.pending.push({ mode, ops: [...ops], sent: false });
    this.recompute();
    return changes;
  }

  /** The next frame to send, if none is in flight. */
  takeFrame(): PendingFrame | null {
    const f = this.pending[0];
    if (!f || f.sent) return null;
    if (!f.ops.length) { this.pending.shift(); return this.takeFrame(); }
    f.sent = true;
    return f;
  }

  /** Our in-flight frame was accepted at `revision`. */
  acked(revision: number): void {
    const f = this.pending.shift();
    if (f) {
      const res = applyFrame(this.confirmed, f.ops, { authorId: this.me.personId, mode: f.mode, newId: tmpId, now: "" });
      this.placeholders.push(...res.created.map((s) => s.id));
    }
    this.revision = revision;
    this.recompute();
  }

  /** Our in-flight frame was refused: the screen goes back to the server's text. */
  refused(): void {
    this.pending = [];
    this.recompute();
  }

  /** A server op frame (every other screen's change, or a decision / replace all); returns the view's change list. */
  remote(revision: number, authorId: string, mode: EditMode, ops: Op[]): Change[] {
    const res = applyFrame(this.confirmed, ops, { authorId, mode, newId: tmpId, now: "" });
    this.placeholders.push(...res.created.map((s) => s.id));
    this.revision = revision;
    let carried = res.changes;
    for (const f of this.pending) {
      const t = transformFrame(f.ops, f.mode, carried);
      f.ops = t.ops;
      carried = t.carried;
    }
    this.pending = this.pending.filter((f) => f.sent || f.ops.length);
    this.recompute();
    return carried;
  }

  /** card_added / card_changed. Returns true when it was a new card on this screen. */
  card(card: Card, added: boolean): boolean {
    this.people.set(card.author.personId, card.author);
    if ("kind" in card) {
      const known = this.confirmed.spans.find((s) => s.id === card.id);
      if (known) { Object.assign(known, spanOf(card)); this.recompute(); return false; }
      while (this.placeholders.length) {
        const tmp = this.placeholders.shift() as string;
        const s = this.confirmed.spans.find((x) => x.id === tmp);
        if (s) { Object.assign(s, spanOf(card)); this.recompute(); return true; }
      }
      if (added) this.confirmed.spans.push(spanOf(card));
      this.recompute();
      return added;
    }
    const isNew = !this.comments.has(card.id);
    this.addComment(card);
    if (card.anchor === null) {
      const a = this.confirmed.anchors.find((x) => x.id === card.id);
      if (a) a.range = null;
    }
    this.recompute();
    return isNew;
  }

  closed(cardId: string): Span | undefined {
    const s = this.confirmed.spans.find((x) => x.id === cardId);
    this.confirmed.spans = this.confirmed.spans.filter((x) => x.id !== cardId);
    this.recompute();
    return s;
  }

  get idle(): boolean { return this.pending.length === 0; }

  author(id: string): Person {
    return this.people.get(id) ?? { personId: id, displayName: "Someone", colour: "#5A5248" };
  }
}

function spanOf(s: Suggestion): Span {
  return { id: s.id, kind: s.kind, authorId: s.author.personId, inserted: s.inserted, deleted: s.deleted, contentDeleted: s.contentDeleted, createdAt: s.createdAt };
}
