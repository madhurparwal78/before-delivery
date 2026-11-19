import { api } from './api.js';
import { HEADING, NOTICE, heading, mountShell, navigate, showAlert } from './shell.js';
import type { Me } from './types.js';
import { renderHome } from './pages/home.js';
import { renderSignIn, renderSignUp, renderConfirm } from './pages/auth.js';
import { renderSessions } from './pages/sessions.js';
import { renderRoom } from './pages/room.js';
import { renderFriends } from './pages/friends.js';
import { renderInvite } from './pages/invite.js';
import { renderStudio } from './pages/studio.js';
import { renderCommunities, renderCommunity } from './pages/communities.js';
import { renderGathering } from './pages/gathering.js';
import { renderModeration } from './pages/moderation.js';

export interface PersonEventFrame {
  type: string;
  sessionId?: string;
  reason?: string;
  communityId?: string;
}

export interface PageContext {
  me: Me | null;
  main: HTMLElement;
  params: Record<string, string>;
}

export interface Page {
  onPersonEvent?: (event: PersonEventFrame) => void;
}

export type PageRenderer = (ctx: PageContext) => Promise<Page | void>;

interface RouteEntry {
  pattern: RegExp;
  keys: string[];
  render: PageRenderer;
  needsAccount: boolean;
}

const ROUTES: RouteEntry[] = [
  { pattern: /^\/$/, keys: [], render: renderHome, needsAccount: false },
  { pattern: /^\/signin$/, keys: [], render: renderSignIn, needsAccount: false },
  { pattern: /^\/signup$/, keys: [], render: renderSignUp, needsAccount: false },
  { pattern: /^\/confirm\/([^/]+)$/, keys: ['token'], render: renderConfirm, needsAccount: false },
  { pattern: /^\/sessions$/, keys: [], render: renderSessions, needsAccount: true },
  { pattern: /^\/sessions\/([^/]+)$/, keys: ['id'], render: renderRoom, needsAccount: true },
  { pattern: /^\/friends$/, keys: [], render: renderFriends, needsAccount: true },
  { pattern: /^\/invites\/([^/]+)$/, keys: ['token'], render: renderInvite, needsAccount: false },
  { pattern: /^\/studio$/, keys: [], render: renderStudio, needsAccount: true },
  { pattern: /^\/communities$/, keys: [], render: renderCommunities, needsAccount: true },
  { pattern: /^\/communities\/([^/]+)$/, keys: ['id'], render: renderCommunity, needsAccount: true },
  { pattern: /^\/gatherings\/([^/]+)$/, keys: ['id'], render: renderGathering, needsAccount: true },
  { pattern: /^\/moderation$/, keys: [], render: renderModeration, needsAccount: true }
];

let page: Page | void = undefined;

function openPersonSocket(): void {
  let retry: number | null = null;
  const connect = (): void => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/me`);
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as PersonEventFrame;
      if (frame.type === 'warned') showAlert(NOTICE.warned);
      if (frame.type === 'suspended') showAlert(NOTICE.removedByModerator);
      if (frame.type === 'removed-from-community') showAlert(NOTICE.outOfCommunity);
      if (frame.type === 'removed-from-session') {
        showAlert(frame.reason === 'vote' ? NOTICE.removedByVote : NOTICE.removedByModerator);
      }
      if (page !== undefined && page.onPersonEvent !== undefined) page.onPersonEvent(frame);
    });
    socket.addEventListener('close', () => {
      if (retry !== null) window.clearTimeout(retry);
      retry = window.setTimeout(connect, 2000);
    });
  };
  connect();
}

async function boot(): Promise<void> {
  const path = window.location.pathname;
  const meResult = await api.get<Me>('/api/me');
  const me = meResult.ok ? meResult.data : null;
  const match = ROUTES.map((entry) => ({ entry, found: entry.pattern.exec(path) })).find(
    (candidate) => candidate.found !== null
  );
  if (match === undefined || match.found === null) {
    const { main } = mountShell(me);
    heading(main, HEADING.notFound);
    return;
  }
  if (match.entry.needsAccount && me === null) {
    navigate(`/signin?next=${encodeURIComponent(path + window.location.search)}`);
    return;
  }
  const params: Record<string, string> = {};
  match.entry.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match.found?.[index + 1] ?? '');
  });
  const { main } = mountShell(me);
  if (me !== null) openPersonSocket();
  page = await match.entry.render({ me, main, params });
}

void boot();
