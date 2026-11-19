import { copy } from '../shared/copy.js';
import { scoreDisplay } from '../shared/format.js';
import { request } from './api.js';
import { alertAnnounce, announce, on, qs, qsa, setPressed } from './dom.js';
import { rollScore } from './motion.js';
import { isSignedIn } from './state.js';

interface VoteGroup {
  up: HTMLElement;
  down: HTMLElement;
  score: HTMLElement;
}

function groupFor(button: HTMLElement): VoteGroup | null {
  const container = button.closest('.votes');
  if (!container) return null;
  const up = qs<HTMLElement>('[data-vote="up"]', container);
  const down = qs<HTMLElement>('[data-vote="down"]', container);
  const score = qs<HTMLElement>('.score', container);
  return up && down && score ? { up, down, score } : null;
}

function currentValue(group: VoteGroup): number {
  if (group.up.getAttribute('aria-pressed') === 'true') return 1;
  if (group.down.getAttribute('aria-pressed') === 'true') return -1;
  return 0;
}

function paint(group: VoteGroup, value: number, score: number): void {
  setPressed(group.up, value === 1);
  setPressed(group.down, value === -1);
  rollScore(group.score, scoreDisplay(score));
}

/** Every surface that shows this target's score follows the server's value. */
export function applyScore(targetType: string, targetId: string, score: number): void {
  for (const element of qsa<HTMLElement>(`#score-${targetType}-${targetId}`)) rollScore(element, scoreDisplay(score));
}

async function send(button: HTMLElement, direction: 1 | -1): Promise<void> {
  const group = groupFor(button);
  if (!group) return;
  if (!isSignedIn()) {
    announce(copy.vote.signedOut);
    return;
  }

  const targetType = button.dataset.targetType === 'comment' ? 'comment' : 'post';
  const targetId = button.dataset.targetId ?? '';
  const previousValue = currentValue(group);
  const previousScore = Number(group.score.dataset.score ?? NaN);
  const baseScore = Number.isNaN(previousScore)
    ? Number(group.score.textContent?.replace(/[^\d-]/g, '') ?? 0)
    : previousScore;
  const nextValue = previousValue === direction ? 0 : direction;
  const optimistic = baseScore - previousValue + nextValue;

  group.score.dataset.score = String(optimistic);
  paint(group, nextValue, optimistic);

  const result = await request<{ score: number; myVote: number }>(
    `/api/${targetType === 'comment' ? 'comments' : 'posts'}/${targetId}/vote`,
    { method: 'PUT', body: { value: nextValue } },
  );

  if (result.ok && result.data) {
    group.score.dataset.score = String(result.data.score);
    paint(group, result.data.myVote, result.data.score);
    applyScore(targetType, targetId, result.data.score);
    const message =
      result.data.myVote === 1
        ? copy.vote.upvoted(result.data.score)
        : result.data.myVote === -1
          ? copy.vote.downvoted(result.data.score)
          : copy.vote.removed(result.data.score);
    announce(message);
    return;
  }

  group.score.dataset.score = String(baseScore);
  paint(group, previousValue, baseScore);
  const error = result.error;
  if (error?.code === 'RATE_LIMITED') {
    announce(copy.vote.rateLimited(error.retryAfter ?? 1));
    return;
  }
  if (error?.code === 'EMAIL_UNVERIFIED') {
    announce(copy.vote.unverified);
    return;
  }
  if (error?.code === 'UNAUTHENTICATED') {
    announce(copy.vote.signedOut);
    return;
  }
  if (error?.code === 'ARCHIVED') {
    announce(copy.vote.archived);
    return;
  }
  alertAnnounce(copy.vote.failed);
}

export function initVotes(root: ParentNode = document): void {
  on(root as EventTarget, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-vote]');
    if (!button) return;
    void send(button, button.dataset.vote === 'down' ? -1 : 1);
  });
}

/** `a` and `z` act on the focused card, as long as focus is not in a text field. */
export function voteByKey(card: HTMLElement, key: string): boolean {
  const button = qs<HTMLElement>(key === 'a' ? '[data-vote="up"]' : '[data-vote="down"]', card);
  if (!button) return false;
  void send(button, key === 'a' ? 1 : -1);
  return true;
}
