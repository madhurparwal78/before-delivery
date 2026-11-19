import { useCallback, useEffect, useRef, useState } from 'react';
import { displayScore } from '../shared/format.js';
import { ApiError, api } from './api.js';
import { announce } from './announce.js';
import { prefersReducedMotion } from './data.js';
import { useLive } from './live.js';
import { useSession } from './session.js';
import { VoteArrow } from './ui.js';

type Vote = -1 | 0 | 1;
type Kind = 'post' | 'comment';

interface Standing { score: number; myVote: Vote }

/** The score digits roll up or down by one line; instant under reduced motion. */
export function useRoll(value: number): React.RefObject<HTMLSpanElement | null> {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (before === value || prefersReducedMotion() || !node.current) return;
    const from = value > before ? '0.9em' : '-0.9em';
    node.current.animate(
      [{ transform: `translateY(${from})`, opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [value]);
  return node;
}

export function Score({ id, score, className }: { id: string; score: number; className?: string }): React.JSX.Element {
  const node = useRoll(score);
  return <span id={id} ref={node} className={`num score${className ? ` ${className}` : ''}`}>{displayScore(score)}</span>;
}

function refusal(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED') return `Slow down — try again in ${error.retryAfter ?? 1} s`;
    if (error.code === 'EMAIL_UNVERIFIED') return 'Verify your email to vote';
    if (error.code === 'ARCHIVED') return 'This thread is archived. Voting and replies are closed.';
  }
  return "Vote didn't save";
}

interface VoteControlProps { kind: Kind; id: string; score: number; myVote: Vote; label?: string }

/** Up and down arrows with the score between them: optimistic, rolled back on refusal, kept in step by live score events. */
export function VoteControl({ kind, id, score, myVote, label }: VoteControlProps): React.JSX.Element {
  const { user } = useSession();
  const [view, setView] = useState<Standing>({ score, myVote });
  const confirmed = useRef<Standing>({ score, myVote });
  const pending = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const current = useRef(view);
  current.current = view;

  useEffect(() => {
    if (pending.current > 0) return;
    confirmed.current = { score, myVote };
    setView({ score, myVote });
  }, [score, myVote]);

  useLive([], (event, data) => {
    if (event !== 'score') return;
    const payload = data as { targetType: Kind; targetId: string; score: number };
    if (payload.targetType !== kind || payload.targetId !== id) return;
    confirmed.current = { ...confirmed.current, score: payload.score };
    if (pending.current === 0) setView((v) => ({ ...v, score: payload.score }));
  });

  const press = useCallback((value: 1 | -1) => {
    if (!user) {
      announce('Sign in to vote');
      return;
    }
    const next: Vote = current.current.myVote === value ? 0 : value;
    const optimistic = { score: current.current.score + next - current.current.myVote, myVote: next };
    current.current = optimistic;
    setView(optimistic);
    pending.current++;
    const path = `/api/${kind === 'post' ? 'posts' : 'comments'}/${id}/vote`;
    chain.current = chain.current.then(async () => {
      try {
        const result = await api<Standing>('PUT', path, { value: next });
        confirmed.current = result;
        pending.current--;
        if (pending.current === 0) {
          current.current = result;
          setView(result);
        }
        const shown = displayScore(result.score);
        announce(next === 1 ? `Upvoted. Score ${shown}` : next === -1 ? `Downvoted. Score ${shown}` : `Vote removed. Score ${shown}`);
      } catch (error) {
        pending.current--;
        if (pending.current === 0) {
          current.current = confirmed.current;
          setView(confirmed.current);
        }
        announce(refusal(error));
      }
    });
  }, [user, kind, id]);

  return (
    <div className="vote" role="group" aria-label={label ?? 'Vote'}>
      <button
        type="button" className="vote-btn vote-up" aria-label="Upvote" aria-pressed={view.myVote === 1} data-vote="up"
        onClick={() => press(1)}
      >
        <VoteArrow direction="up" filled={view.myVote === 1} />
      </button>
      <Score id={`score-${kind}-${id}`} score={view.score} />
      <button
        type="button" className="vote-btn vote-down" aria-label="Downvote" aria-pressed={view.myVote === -1} data-vote="down"
        onClick={() => press(-1)}
      >
        <VoteArrow direction="down" filled={view.myVote === -1} />
      </button>
    </div>
  );
}

const TEXT_FIELD = 'input, textarea, select, [contenteditable="true"]';

/** `a` upvotes and `z` downvotes the card that holds focus (not while typing). */
export function voteKeys(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if ((event.target as HTMLElement).closest(TEXT_FIELD)) return;
  const which = event.key === 'a' ? 'up' : event.key === 'z' ? 'down' : null;
  if (!which) return;
  event.preventDefault();
  event.currentTarget.querySelector<HTMLButtonElement>(`[data-vote="${which}"]`)?.click();
}
