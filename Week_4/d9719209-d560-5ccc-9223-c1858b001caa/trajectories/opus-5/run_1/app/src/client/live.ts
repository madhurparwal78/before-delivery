import { copy } from '../shared/copy.js';
import { alertAnnounce, qs } from './dom.js';

export interface LiveHandlers {
  score(data: { targetType: 'post' | 'comment'; targetId: string; postId: string; score: number }): void;
  comments(data: { postId: string; commentCount: number }): void;
  comment(data: { postId: string; parentId: string | null; comment: Record<string, unknown> }): void;
  postState(data: {
    postId: string;
    communityName: string;
    state: string;
    publicReason: string | null;
    locked: boolean;
    lockedUntil: string | null;
    pinned: boolean;
    version: number;
  }): void;
  membership(data: { communityName: string; memberCount: number }): void;
  account(data: { kind: string; communityName: string | null }): void;
  resync(): void;
}

const RECONNECT_MS = 10000;

let source: EventSource | null = null;
let paused = false;
let lastEventId: string | null = null;

function setIndicator(live: boolean): void {
  const indicator = qs('#live-indicator');
  if (indicator) indicator.textContent = live ? copy.live.on : copy.live.paused;
}

/** The stream carries only what the page shows; a dropped stream resumes from the last event id. */
export function startLive(topics: string[], handlers: LiveHandlers): void {
  if (topics.length === 0) return;

  const connect = () => {
    const query = new URLSearchParams({ topics: topics.join(',') });
    if (lastEventId !== null) query.set('lastEventId', lastEventId);
    source = new EventSource(`/api/stream?${query.toString()}`);

    source.addEventListener('open', () => {
      paused = false;
      setIndicator(true);
    });

    const bind = <T>(name: string, handle: (data: T) => void) => {
      source?.addEventListener(name, (event) => {
        const message = event as MessageEvent<string>;
        if (message.lastEventId !== '') lastEventId = message.lastEventId;
        handle(JSON.parse(message.data) as T);
      });
    };

    bind('score', handlers.score);
    bind('comments', handlers.comments);
    bind('comment', handlers.comment);
    bind('post-state', handlers.postState);
    bind('membership', handlers.membership);
    bind('account', handlers.account);
    source.addEventListener('resync', () => handlers.resync());

    source.addEventListener('error', () => {
      source?.close();
      source = null;
      if (!paused) {
        paused = true;
        setIndicator(false);
        alertAnnounce(copy.live.paused);
      }
      window.setTimeout(connect, RECONNECT_MS);
    });
  };

  connect();
}
