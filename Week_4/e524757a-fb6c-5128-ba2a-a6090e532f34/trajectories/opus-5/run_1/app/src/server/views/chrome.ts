import { filmText } from '../../shared/copy.js';
import type { PlayerRow } from '../domain/players.js';
import { escape } from './html.js';

export function header(player: PlayerRow | null, film: number): string {
  const account = player
    ? `<div class="account">
<button type="button" class="account-button" id="account-button" aria-haspopup="menu" aria-expanded="false"><span>Account</span><span class="account-name" aria-hidden="true">${escape(player.name)}</span></button>
<div class="account-menu" id="account-menu" role="menu" aria-label="Account" hidden>
<a role="menuitem" href="/hall">Your hall</a>
<button type="button" role="menuitem" id="sign-out">Sign out</button>
<p class="account-film">${escape(filmText(film))}</p>
</div>
</div>`
    : '<a href="/signin">Sign in</a>';
  return `<header class="site-header">
<a class="wordmark" href="/">Hushfoot</a>
<nav class="site-nav" aria-label="Site">
<a href="/#islands">Islands</a>
<a href="/text-world">Text world</a>
${account}
<a class="action" href="/play">Start walking</a>
</nav>
</header>`;
}

export function statusRegion(name: string, id: string): string {
  return `<div class="status-band" role="status" aria-live="polite" aria-label="${escape(name)}" id="${escape(id)}"></div>`;
}

export function logRegion(name: string, id: string): string {
  return `<div class="feed" role="log" aria-live="polite" aria-label="${escape(name)}" id="${escape(id)}"></div>`;
}

export function figure(name: string, text: string, extra = ''): string {
  return `<span class="figure" data-figure="${escape(name)}" aria-hidden="true"${extra ? ` ${extra}` : ''}>${escape(text)}</span>`;
}
