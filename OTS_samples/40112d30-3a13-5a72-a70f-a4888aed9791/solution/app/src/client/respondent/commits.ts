import type { AnswerValue, Evaluation } from '../../shared/types.ts';
import { api } from '../lib/api.ts';
import type { Run } from './run.ts';

interface CommitHooks {
  /** A reply newer than every reply applied so far. */
  apply(evaluation: Evaluation): void;
  refuse(error: unknown): void;
}

interface Commits {
  send(changes: Record<string, AnswerValue | null>): void;
  /** Commits nothing new but tells the server which page the respondent is on, and returns its evaluation. */
  moveTo(page: string): Promise<Evaluation>;
  /** Registers work (an upload) that Back, Next, Submit and Save must wait for. */
  track(work: Promise<unknown>): void;
  settled(): Promise<void>;
}

interface Unconfirmed { value: AnswerValue | null; seq: number }

/**
 * Commits are concurrent: each carries a rising number and does not wait for the reply to the one before.
 * Every commit repeats the changes whose replies have not arrived, so an older request the server drops as
 * out of order never loses an answer.
 */
export function createCommits(run: Run, hooks: CommitHooks): Commits {
  let seq = run.evaluation.seq;
  let applied = seq;
  const unconfirmed = new Map<string, Unconfirmed>();
  const pending = new Set<Promise<unknown>>();

  function track(work: Promise<unknown>): void {
    pending.add(work);
    const done = (): void => { pending.delete(work); };
    work.then(done, done);
  }

  async function request(): Promise<Evaluation> {
    seq += 1;
    const mine = seq;
    const answers = Object.fromEntries([...unconfirmed].map(([key, change]) => [key, change.value]));
    const reply = await api<{ evaluation: Evaluation }>('POST', `/api/responses/${run.id}/answers`, { seq: mine, page: run.page, answers });
    for (const [key, change] of unconfirmed) if (change.seq <= mine) unconfirmed.delete(key);
    return reply.evaluation;
  }

  function remember(changes: Record<string, AnswerValue | null>): void {
    for (const [key, value] of Object.entries(changes)) {
      unconfirmed.set(key, { value, seq: seq + 1 });
      if (value === null) delete run.answers[key];
      else run.answers[key] = value;
    }
  }

  return {
    send(changes) {
      remember(changes);
      const work = request().then((evaluation) => {
        if (evaluation.seq <= applied) return;
        applied = evaluation.seq;
        hooks.apply(evaluation);
      }).catch(hooks.refuse);
      track(work);
    },
    async moveTo(page) {
      run.page = page;
      const work = request();
      track(work);
      const evaluation = await work;
      applied = Math.max(applied, evaluation.seq);
      return evaluation;
    },
    track,
    async settled() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
