import { qs, announce } from './dom.js';
import { session } from './session.js';
import { api } from './api.js';
import { announcer, emailConfirmationRegion, notFoundPage, renderShell } from './chrome.js';
import { renderHome } from './home.js';
import { renderPlay } from './play.js';
import { renderDaily } from './daily.js';
import { renderLeaderboardPage } from './leaderboard.js';
import { renderDuelPage } from './duel.js';
import { renderRoomPage } from './room.js';
import { renderProfilePage } from './profile.js';
import { renderSignIn, renderSignUp, renderVerify, renderResetRequest, renderResetConfirm } from './authpages.js';
import { m25, m26, m46, m50 } from '../shared/messages.js';

// The client router. The server serves the same index for every path; the
// client decides the page from the path.

export class NotFoundError extends Error {
  constructor(sentence: string) {
    super(sentence);
  }
}

export function notFoundPlay(): NotFoundError {
  return new NotFoundError(m25());
}

interface RouteResult {
  body: HTMLElement;
  notFound?: string;
}

type RouteRender = (params: string[]) => Promise<HTMLElement | RouteResult>;

interface Route {
  pattern: RegExp;
  render: RouteRender;
}

const routes: Route[] = [
  { pattern: /^\/$/, render: async () => ({ body: await renderHome() }) },
  { pattern: /^\/play\/([A-Za-z0-9_]+)$/, render: async (p) => ({ body: await renderPlay(p[0]) }) },
  { pattern: /^\/daily$/, render: async () => ({ body: await renderDaily() }) },
  { pattern: /^\/leaderboard$/, render: async () => ({ body: await renderLeaderboardPage(null) }) },
  { pattern: /^\/leaderboard\/(\d{4}-\d{2}-\d{2})$/, render: async (p) => ({ body: await renderLeaderboardPage(p[0]) }) },
  { pattern: /^\/duel$/, render: async () => ({ body: await renderDuelPage() }) },
  { pattern: /^\/duel\/([A-Za-z0-9]{1,8})$/, render: async (p) => ({ body: await renderRoomPage(p[0].toUpperCase()) }) },
  { pattern: /^\/profile$/, render: async () => ({ body: await renderProfilePage() }) },
  { pattern: /^\/signin$/, render: async () => ({ body: renderSignIn() }) },
  { pattern: /^\/signup$/, render: async () => ({ body: renderSignUp() }) },
  { pattern: /^\/verify\/([A-Za-z0-9]+)$/, render: async (p) => ({ body: renderVerify(p[0]) }) },
  { pattern: /^\/reset$/, render: async () => ({ body: renderResetRequest() }) },
  { pattern: /^\/reset\/([A-Za-z0-9]+)$/, render: async (p) => ({ body: renderResetConfirm(p[0]) }) },
];

function appendAnnouncer(): void {
  if (!document.getElementById('announcer')) {
    document.body.append(announcer());
  }
}

async function route(): Promise<void> {
  const pathname = decodeURIComponent(window.location.pathname);

  for (const entry of routes) {
    const match = entry.pattern.exec(pathname);
    if (!match) continue;
    await session.load();
    if (session.needsRedirect(pathname)) {
      window.location.href = `/signin?return=${encodeURIComponent(pathname)}`;
      return;
    }
    try {
      const result = await entry.render(match.slice(1));
      const body = 'body' in result ? result.body : result;
      const sentence = 'notFound' in result && result.notFound !== undefined ? result.notFound : null;
      if (sentence) {
        renderShell({ h1: '', path: pathname }, notFoundPage(sentence), true);
      } else {
        renderShell({ h1: '', path: pathname }, body, true);
      }
      appendUnverifiedRegion();
    } catch (err) {
      // A play page for an unknown or another player's game shows the
      // not-found page with M25; anything else unexpected shows M26.
      const sentence = err instanceof NotFoundError ? err.message : m26();
      renderShell({ h1: '', path: pathname }, notFoundPage(sentence), true);
    }
    appendAnnouncer();
    return;
  }

  renderShell({ h1: '', path: pathname }, notFoundPage(m26()), true);
  appendAnnouncer();
}

// Every page shows an unverified player the Email confirmation region with
// M44 and a Send again button.
function appendUnverifiedRegion(): void {
  if (!session.player || session.player.verified) return;
  if (document.getElementById('unverified-region')) return;
  const region = emailConfirmationRegion(async () => {
    const btn = document.querySelector('#unverified-region button');
    if (btn) btn.setAttribute('aria-disabled', 'true');
    try {
      await api.post('/api/auth/verify/resend');
      announce(m46());
      if (btn) btn.setAttribute('aria-disabled', 'false');
    } catch {
      if (btn) btn.setAttribute('aria-disabled', 'false');
      announce(m50());
    }
  });
  if (!region) return;
  region.id = 'unverified-region';
  const main = document.querySelector('main');
  main?.prepend(region);
}

function go(): void {
  void route();
}

window.addEventListener('popstate', go);
go();

void qs;
