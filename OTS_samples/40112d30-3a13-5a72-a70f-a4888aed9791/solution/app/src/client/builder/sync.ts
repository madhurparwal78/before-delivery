import type { Change, ErrorItem, FormDetail, Person, ServerFrame } from '../../shared/types.ts';
import { applyChange } from '../../shared/draft.ts';
import { M52, M54, M85 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { alertText, announce } from '../lib/live.ts';
import { connect, type Live } from '../lib/socket.ts';
import { controlNameOf } from './control-names.ts';
import { Emitter } from './emitter.ts';
import type { Store } from './store.ts';

// Live editing: every change goes to the server, which numbers it; every open builder replays the changes in
// that order. While Valkey is down (or the socket is gone) changes wait here until `Save changes`.

export interface Refusal { code: string; message: string; items: ErrorItem[] }
type Outcome = { ok: true } | { ok: false; refusal: Refusal };

type Frame<K extends ServerFrame['type']> = Extract<ServerFrame, { type: K }>;
interface Waiting { change: Change; resolve: (outcome: Outcome) => void }

const vanished: Refusal = { code: 'NOT_FOUND', message: M85, items: [] };

export class Sync {
  readonly presence = new Emitter<Person[]>();
  readonly status = new Emitter();
  readonly notice = new Emitter<string>();
  /** Everyone with this form open, including the person themself (empty while Valkey is down). */
  editors: Person[] = [];
  private socket: Live | null = null;
  private open = false;
  private joinedLive = false;
  private lastRef = 0;
  private readonly replies = new Map<number, Waiting>();
  private readonly applied: { seq: number; release: () => void }[] = [];
  private pending: Change[] = [];
  private frames: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: Store) {}

  get live(): boolean {
    return this.open && this.joinedLive;
  }

  /** Connects and waits until the server has said whether live editing is on. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.socket = connect(
        { type: 'join', form: this.store.detail.id, view: 'builder' },
        (frame) => { void this.enqueue(() => this.take(frame)).finally(() => { if (frame.type === 'joined') resolve(); }); },
        () => { this.closed(); resolve(); },
      );
    });
  }

  send(change: Change): Promise<Outcome> {
    if (!this.live) return Promise.resolve(this.queue(change));
    return new Promise((resolve) => {
      this.lastRef += 1;
      this.replies.set(this.lastRef, { change, resolve });
      this.socket?.send({ type: 'change', change, ref: this.lastRef });
    });
  }

  /** `Save changes`: the changes made while live editing was paused, in order. Resolves true when all were kept. */
  save(): Promise<boolean> {
    return this.enqueue(() => this.persist());
  }

  /** Frames and saves are handled one after the other, in the order they arrived. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.frames.then(job);
    this.frames = result.catch(() => undefined);
    return result;
  }

  private async take(frame: ServerFrame): Promise<void> {
    switch (frame.type) {
      case 'joined': return this.joined(frame);
      case 'applied': return this.replay(frame);
      case 'ack': return this.acknowledged(frame);
      case 'refused': return this.refused(frame);
      case 'presence': return this.hear(frame.editors);
      case 'form_state': return this.store.updateState({ state: frame.state, closed_reason: frame.closed_reason });
      case 'summary':
      case 'moved':
        return undefined;
    }
  }

  private hear(editors: Person[]): void {
    this.editors = editors;
    this.presence.emit(editors);
  }

  /** Every refusal goes to the alert; a change that names a question another editor removed also shows in the notice. */
  report(refusal: Refusal): void {
    if (refusal.code === 'NOT_FOUND') this.notice.emit(refusal.message);
    alertText(refusal.message);
  }

  private async joined(frame: Frame<'joined'>): Promise<void> {
    this.open = true;
    this.joinedLive = frame.live;
    if (frame.rev !== this.store.rev) await this.reload();
    this.status.emit();
  }

  private closed(): void {
    this.open = false;
    for (const waiting of this.replies.values()) waiting.resolve(this.queue(waiting.change));
    this.replies.clear();
    this.status.emit();
  }

  private async replay(frame: Frame<'applied'>): Promise<void> {
    const { store } = this;
    if (frame.seq <= store.rev) return;
    const next = frame.seq === store.rev + 1 ? applyChange(store.draft, frame.change) : null;
    if (!next) return this.reload();
    store.replaceDraft(next, frame.seq);
    this.release();
    if (frame.conflict_with === store.me.id && frame.change.op === 'set') {
      const text = M52(frame.by.name, controlNameOf(frame.change), frame.change.key);
      announce(text);
      this.notice.emit(text);
    }
  }

  private acknowledged(frame: Frame<'ack'>): void {
    const waiting = this.replies.get(frame.ref);
    if (!waiting) return;
    this.replies.delete(frame.ref);
    this.whenReplayed(frame.seq, () => waiting.resolve({ ok: true }));
  }

  private refused(frame: Frame<'refused'>): void {
    const waiting = frame.ref === undefined ? undefined : this.replies.get(frame.ref);
    if (frame.ref === undefined || !waiting) return;
    this.replies.delete(frame.ref);
    waiting.resolve({ ok: false, refusal: { code: frame.error.code, message: frame.error.message, items: frame.error.items ?? [] } });
  }

  /** Runs once the draft has reached revision `seq`, so a reply never races the change it confirms. */
  private whenReplayed(seq: number, release: () => void): void {
    if (this.store.rev >= seq) release();
    else this.applied.push({ seq, release });
  }

  private release(): void {
    const due = this.applied.filter((entry) => entry.seq <= this.store.rev);
    this.applied.splice(0, this.applied.length, ...this.applied.filter((entry) => entry.seq > this.store.rev));
    for (const entry of due) entry.release();
  }

  private queue(change: Change): Outcome {
    const next = applyChange(this.store.draft, change);
    if (!next) return { ok: false, refusal: vanished };
    this.pending.push(change);
    this.store.replaceDraft(next, this.store.rev);
    this.status.emit();
    return { ok: true };
  }

  private async persist(): Promise<boolean> {
    let kept = true;
    while (kept && this.pending.length > 0) {
      try {
        await api('POST', `/api/forms/${this.store.detail.id}/changes`, { changes: [this.pending[0]] });
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        alertText(error.message);
        kept = false;
      }
      this.pending.shift();
    }
    await this.reload();
    this.status.emit();
    if (kept) announce(M54);
    return kept;
  }

  /** Fetches the form again and puts the changes still waiting for `Save changes` back on top of it. */
  private async reload(): Promise<void> {
    const detail = await api<FormDetail>('GET', `/api/forms/${this.store.detail.id}`);
    this.store.replaceDetail(detail);
    const draft = this.pending.reduce((def, change) => applyChange(def, change) ?? def, detail.draft);
    this.store.replaceDraft(draft, detail.rev);
    this.release();
  }
}
