import type { Evaluation } from '../../shared/types.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { alertText, announce } from '../lib/live.ts';
import { Emitter } from './emitter.ts';
import type { Store } from './store.ts';

// The Lit path's data: the trial answers, and the server's evaluation of the draft under them. The browser never
// works out the walk, a formula or an insertion; it shows the newest reply and discards any older one.

type TrialValue = string | string[] | Record<string, string>;
interface Evaluated { evaluation: Evaluation; previous: Evaluation | null }

export class Trial {
  readonly evaluated = new Emitter<Evaluated>();
  /** Answers the server refused as not fitting their question; their boxes stay but count as blank. */
  readonly rejected = new Set<string>();
  readonly answers = new Map<string, TrialValue>();
  evaluation: Evaluation | null = null;
  private sent = 0;
  private owed = true;

  constructor(private readonly store: Store) {
    store.drafted.listen(() => { void this.evaluate(); });
  }

  /** A trial answer changed (`null` clears it): the reply is announced. */
  set(key: string, value: TrialValue | null): Promise<void> {
    this.rejected.delete(key);
    if (value === null) this.answers.delete(key);
    else this.answers.set(key, value);
    this.owed = true;
    return this.evaluate();
  }

  async evaluate(): Promise<void> {
    this.forgetRemoved();
    this.sent += 1;
    try {
      const reply = await api<Evaluation>('POST', `/api/forms/${this.store.detail.id}/trial`, { seq: this.sent, answers: Object.fromEntries(this.answers) });
      if (reply.seq <= (this.evaluation?.seq ?? 0)) return;
      const previous = this.evaluation;
      this.evaluation = reply;
      this.evaluated.emit({ evaluation: reply, previous });
      if (this.owed) announce(reply.announce);
      this.owed = false;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      alertText(error.message);
      if (error.items.length === 0) return;
      for (const item of error.items) {
        this.answers.delete(item.key);
        this.rejected.add(item.key);
      }
      await this.evaluate();
    }
  }

  /** Answers to questions another editor removed would be refused. */
  private forgetRemoved(): void {
    const keys = new Set(this.store.questions().map((question) => question.key));
    for (const key of this.answers.keys()) if (!keys.has(key)) this.answers.delete(key);
  }
}
