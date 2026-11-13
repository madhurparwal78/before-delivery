// Squallglass SPA: navigation shell, feedback regions and view mounting.
import { api, ApiError, Account } from './api.js';
import type { Ticket } from './api.js';

export type Screen =
  | 'account'
  | 'tutorial'
  | 'campaign'
  | 'loadout'
  | 'defence'
  | 'result'
  | 'editor'
  | 'community'
  | 'leaderboard'
  | 'replay'
  | 'rules';

export interface AppState {
  screen: Screen;
  account: Account | null;
  selectedEncounterId: string | null;
  selectedLevelId: string | null;
  selectedChallengeDigest: string | null;
  ticket: Ticket | null;
  statusMessage: string;
  errorMessage: string;
  stale: boolean;
}

export const state: AppState = {
  screen: 'account',
  account: null,
  selectedEncounterId: null,
  selectedLevelId: null,
  selectedChallengeDigest: null,
  ticket: null,
  statusMessage: '',
  errorMessage: '',
  stale: false,
};

// ---------- Feedback regions ----------

export function announceStatus(message: string): void {
  state.statusMessage = message;
  const region = document.getElementById('harbour-status');
  if (region) region.textContent = message;
}

export function announceError(message: string): void {
  state.errorMessage = message;
  const region = document.getElementById('harbour-error');
  if (region) {
    region.textContent = message;
    region.classList.add('harbour-error-visible');
  }
}

export function clearError(): void {
  state.errorMessage = '';
  const region = document.getElementById('harbour-error');
  if (region) {
    region.textContent = '';
    region.classList.remove('harbour-error-visible');
  }
}

export function handleApiError(e: unknown): void {
  if (e instanceof ApiError) {
    const fieldEntries = Object.entries(e.fields ?? {});
    if (fieldEntries.length > 0) {
      const parts = fieldEntries.map(([path, message]) => `${path}: ${message}`);
      announceError(parts.join(' '));
    } else {
      announceError(e.message);
    }
    if (e.code === 'DATABASE_UNAVAILABLE' || e.code === 'EVIDENCE_UNAVAILABLE' || e.code === 'DISCOVERY_UNAVAILABLE') {
      markStale();
    }
    return;
  }
  announceError('The harbour is unreachable. Try again.');
}

export function markStale(): void {
  state.stale = true;
  document.body.classList.add('stale');
  const marker = document.getElementById('stale-marker');
  if (marker) marker.textContent = 'Stale';
}

export function clearStale(): void {
  state.stale = false;
  document.body.classList.remove('stale');
  const marker = document.getElementById('stale-marker');
  if (marker) marker.textContent = '';
}

export function disabledWhilePending(button: HTMLButtonElement): () => void {
  button.disabled = true;
  return () => {
    button.disabled = false;
  };
}

// ---------- Navigation ----------

export function navigate(screen: Screen): void {
  state.screen = screen;
  render();
  const main = document.getElementById('main');
  const heading = main?.querySelector('h1');
  if (heading instanceof HTMLElement) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

// ---------- Root shell ----------

export function bootstrap(): void {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `
    <header class="harbour-header">
      <h1 class="product-name">Squallglass</h1>
      <p id="stale-marker" class="stale-marker"></p>
    </header>
    <nav aria-label="Harbour navigation" class="harbour-nav" id="harbour-navigation">
      <button data-screen="account">Account</button>
      <button data-screen="tutorial">Tutorial</button>
      <button data-screen="campaign">Campaign</button>
      <button data-screen="editor">Editor</button>
      <button data-screen="community">Community</button>
      <button data-screen="rules">Rules</button>
    </nav>
    <p id="harbour-status" role="status" aria-live="polite" class="visually-hidden"></p>
    <div id="harbour-error" role="alert" aria-live="assertive" class="harbour-error"></div>
    <main id="main"></main>
    <footer class="harbour-footer">
      <p>Bellwake Games — Orrel Sound harbour. All persons, businesses and places are invented.</p>
    </footer>
  `;
  const nav = document.getElementById('harbour-navigation');
  nav?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest('button[data-screen]');
    if (!button) return;
    const screen = button.getAttribute('data-screen') as Screen;
    // Local navigation has no fabricated pending state.
    navigate(screen);
  });
  api<{ account: Account }>('GET', '/api/session')
    .then(({ data }) => {
      state.account = data.account;
      state.screen = 'campaign';
      render();
    })
    .catch(() => {
      state.account = null;
      render();
    });
  setInterval(() => {
    if (state.screen === 'community') {
      import('./views/community.js').then((m) => m.refreshSeasonSummary()).catch(() => undefined);
    }
  }, 30000);
}

export function render(): void {
  const main = document.getElementById('main');
  if (!main) return;
  document.querySelectorAll('#harbour-navigation button').forEach((button) => {
    const screen = (button as HTMLElement).dataset.screen;
    button.classList.toggle('active', screen === state.screen);
  });
  switch (state.screen) {
    case 'account':
      renderAccount(main);
      break;
    case 'tutorial':
      renderTutorial(main);
      break;
    case 'campaign':
      renderCampaign(main);
      break;
    case 'loadout':
      renderLoadout(main);
      break;
    case 'defence':
      renderDefence(main);
      break;
    case 'result':
      renderResult(main);
      break;
    case 'editor':
      renderEditor(main);
      break;
    case 'community':
      renderCommunity(main);
      break;
    case 'leaderboard':
      renderLeaderboard(main);
      break;
    case 'replay':
      renderReplay(main);
      break;
    case 'rules':
      renderRules(main);
      break;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// ---------- Account view ----------

function renderAccount(main: HTMLElement): void {
  main.innerHTML = `
    <h1>Account</h1>
    <section aria-label="Current player" id="current-player" class="panel">
      ${
        state.account
          ? `<p>Signed in as <strong>${escapeHtml(state.account.playerName)}</strong> (${escapeHtml(state.account.email)}).</p>
             <button id="sign-out">Sign out</button>`
          : `<p>You are signed out.</p>`
      }
    </section>
    <section aria-label="Create account" class="panel">
      <h2 class="section-heading">Create your harbour account</h2>
      <form id="create-account-form" novalidate>
        <div class="field">
          <label for="account-email">Email</label>
          <input id="account-email" name="email" type="email" autocomplete="email" required>
          <p class="field-error" id="err-account-email"></p>
        </div>
        <div class="field">
          <label for="account-player-name">Player name</label>
          <input id="account-player-name" name="playerName" type="text" autocomplete="nickname" required>
          <p class="field-error" id="err-account-player-name"></p>
        </div>
        <div class="field">
          <label for="account-password">Password</label>
          <input id="account-password" name="password" type="password" autocomplete="new-password" required>
          <p class="field-error" id="err-account-password"></p>
        </div>
        <button type="submit" id="create-account">Create account</button>
      </form>
    </section>
    <section aria-label="Sign in" class="panel">
      <h2 class="section-heading">Sign in</h2>
      <form id="sign-in-form" novalidate>
        <div class="field">
          <label for="sign-in-email">Email</label>
          <input id="sign-in-email" name="email" type="email" autocomplete="email" required>
          <p class="field-error" id="err-sign-in-email"></p>
        </div>
        <div class="field">
          <label for="sign-in-password">Password</label>
          <input id="sign-in-password" name="password" type="password" autocomplete="current-password" required>
          <p class="field-error" id="err-sign-in-password"></p>
        </div>
        <button type="submit" id="sign-in">Sign in</button>
      </form>
    </section>
  `;
  document.getElementById('create-account-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const form = event.currentTarget as HTMLFormElement;
    const button = document.getElementById('create-account') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Creating your harbour account…');
    const email = (form.querySelector('#account-email') as HTMLInputElement).value;
    const playerName = (form.querySelector('#account-player-name') as HTMLInputElement).value;
    const password = (form.querySelector('#account-password') as HTMLInputElement).value;
    try {
      const { data } = await api<{ account: Account }>('POST', '/api/accounts', { email, password, playerName });
      state.account = data.account;
      announceStatus("Account ready – your harbour's open.");
      navigate('campaign');
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });
  document.getElementById('sign-in-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    const form = event.currentTarget as HTMLFormElement;
    const button = document.getElementById('sign-in') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Signing in…');
    const email = (form.querySelector('#sign-in-email') as HTMLInputElement).value;
    const password = (form.querySelector('#sign-in-password') as HTMLInputElement).value;
    try {
      const { data } = await api<{ account: Account }>('POST', '/api/session', { email, password });
      state.account = data.account;
      announceStatus('Welcome back.');
      navigate('campaign');
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });
  document.getElementById('sign-out')?.addEventListener('click', async () => {
    const button = document.getElementById('sign-out') as HTMLButtonElement;
    const restore = disabledWhilePending(button);
    announceStatus('Signing out…');
    try {
      await api('DELETE', '/api/session');
      state.account = null;
      announceStatus('Signed out.');
      render();
    } catch (e) {
      handleApiError(e);
      restore();
    }
  });
}

// Views live in separate modules to keep each screen reviewable.
import { renderTutorial } from './views/tutorial.js';
import { renderCampaign, renderLoadout } from './views/campaign.js';
import { renderDefence, defenceRuntime } from './views/defence.js';
import { renderResult } from './views/result.js';
import { renderEditor } from './views/editor.js';
import { renderCommunity, refreshSeasonSummary } from './views/community.js';
import { renderLeaderboard } from './views/leaderboard.js';
import { renderReplay } from './views/replay.js';
import { renderRules } from './views/rules.js';

export {
  renderTutorial,
  renderCampaign,
  renderLoadout,
  renderDefence,
  renderResult,
  renderEditor,
  renderCommunity,
  renderLeaderboard,
  renderReplay,
  renderRules,
  refreshSeasonSummary,
  defenceRuntime,
};
