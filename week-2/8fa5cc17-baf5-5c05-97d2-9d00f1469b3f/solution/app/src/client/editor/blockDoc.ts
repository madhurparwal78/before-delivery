// One text block's edit state in this tab: the confirmed base version, the save in flight and the
// typing not yet sent, rebased over incoming ops with the same transform as the server.
import { composeOps, transformPair, type Op } from '../../shared/ot.ts';
import { applyOpsToBody, editText } from '../../shared/richtext.ts';

/** Typing not yet sent, split where an undo step ends so each step commits on its own. */
export interface Chunk { ops: Op[]; step: number }
/** A save in flight: ops, or (after a paste) a full replacement body. */
export interface InFlight { ops: Op[]; editId: string; step: number; base: number; body?: string }

export type Incoming =
  | { kind: 'applied'; ops: Op[] }   // local text changed by these ops (caret moves through them)
  | { kind: 'kept' }                 // a conflict case or a full replacement over unsaved typing: draft kept
  | { kind: 'replaced' }             // no unsaved typing: the text was replaced
  | { kind: 'confirmed'; step: number | null } // the commit of this tab's own save (its undo step, when first confirmed now)
  | { kind: 'stale' };               // an event for a version this tab has not reached: refetch

let editSeq = 0;
const newEditId = (): string => `e${Date.now().toString(36)}${(editSeq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class BlockDoc {
  /** last confirmed version and its body */
  version: number;
  serverBody: string;
  /** the text on screen: server body with the in-flight save and unsent typing applied */
  body: string;
  inflight: InFlight | null = null;
  unsent: Chunk[] = [];
  /** a pasted body waiting to be saved as a full replacement */
  replacement: string | null = null;
  /** set after a 409: incoming changes no longer touch the draft until the conflict is resolved */
  conflict: { body: string; version: number } | null = null;
  private confirmedIds = new Set<string>();

  constructor(body: string, version: number) {
    this.version = version;
    this.serverBody = body;
    this.body = body;
  }

  get text(): string {
    return editText(this.body);
  }

  get dirty(): boolean {
    return this.inflight !== null || this.unsent.length > 0 || this.replacement !== null;
  }

  /** A paste: the whole filtered body is saved as a full replacement on the confirmed version. */
  replaceLocal(body: string): void {
    this.body = body;
    this.unsent = [];
    this.replacement = body;
  }

  /** Records typing made on screen; `step` groups it for undo. */
  local(ops: Op[], step: number): void {
    this.body = applyOpsToBody(this.body, ops);
    const last = this.unsent[this.unsent.length - 1];
    if (last && last.step === step) last.ops = composeOps(last.ops, ops);
    else this.unsent.push({ ops, step });
  }

  /** The next save to send, or null while one is in flight or nothing waits. */
  takeSave(): InFlight | null {
    if (this.inflight) return null;
    if (this.replacement !== null) {
      this.inflight = { ops: [], editId: newEditId(), step: 0, base: this.version, body: this.replacement };
      this.replacement = null;
      return this.inflight;
    }
    if (!this.unsent.length) return null;
    const chunk = this.unsent.shift() as Chunk;
    this.inflight = { ops: chunk.ops, editId: newEditId(), step: chunk.step, base: this.version };
    return this.inflight;
  }

  /** The answer to this tab's own save (200), or its `block.saved` commit, whichever comes first. */
  acknowledge(editId: string, version: number, body: string): number | null {
    if (this.confirmedIds.has(editId) || this.inflight?.editId !== editId) return null;
    const step = this.inflight.step;
    this.confirmedIds.add(editId);
    this.inflight = null;
    this.version = version;
    this.serverBody = body;
    this.body = this.unsent.reduce((b, c) => applyOpsToBody(b, c.ops), body);
    return step;
  }

  /** A save refused with 409: the draft stays, the conflict panel takes over. */
  refuse(current: { body: string; version: number }): void {
    this.inflight = null;
    this.conflict = current;
  }

  /** Puts a failed (network) save back in front of the unsent typing so it is sent again. */
  requeue(): void {
    if (!this.inflight) return;
    if (this.inflight.body !== undefined) this.replacement = this.inflight.body;
    else this.unsent.unshift({ ops: this.inflight.ops, step: this.inflight.step });
    this.inflight = null;
  }

  /** An incoming `block.saved` for this block. */
  incoming(ops: Op[] | null, baseVersion: number, editId: string | null, block: { body: string; version: number }): Incoming {
    if (editId && this.inflight?.editId === editId) return { kind: 'confirmed', step: this.acknowledge(editId, block.version, block.body) };
    if (editId && this.confirmedIds.has(editId)) return { kind: 'confirmed', step: null };
    if (block.version <= this.version) return { kind: 'kept' };
    if (this.conflict) {
      this.conflict = { body: block.body, version: block.version };
      return { kind: 'kept' };
    }
    if (ops === null) {
      if (this.dirty) return { kind: 'kept' };
      this.version = block.version;
      this.serverBody = block.body;
      this.body = block.body;
      return { kind: 'replaced' };
    }
    if (baseVersion !== this.version) return this.dirty ? { kind: 'kept' } : { kind: 'stale' };
    let remote = ops;
    const rebasedInflight = this.inflight ? transformPair(remote, this.inflight.ops) : null;
    if (this.inflight) {
      if (!rebasedInflight) return { kind: 'kept' };
      remote = rebasedInflight.committed;
    }
    const rebasedUnsent: Chunk[] = [];
    for (const chunk of this.unsent) {
      const t = transformPair(remote, chunk.ops);
      if (!t) return { kind: 'kept' };
      rebasedUnsent.push({ ops: t.incoming, step: chunk.step });
      remote = t.committed;
    }
    if (this.inflight && rebasedInflight) this.inflight = { ...this.inflight, ops: rebasedInflight.incoming };
    this.unsent = rebasedUnsent;
    this.version = block.version;
    this.serverBody = block.body;
    this.body = applyOpsToBody(this.body, remote);
    return { kind: 'applied', ops: remote };
  }

  /** Resolves a conflict with the server's text and version as the new base. */
  resolve(body: string, version: number): void {
    this.conflict = null;
    this.inflight = null;
    this.unsent = [];
    this.replacement = null;
    this.version = version;
    this.serverBody = body;
    this.body = body;
  }
}
