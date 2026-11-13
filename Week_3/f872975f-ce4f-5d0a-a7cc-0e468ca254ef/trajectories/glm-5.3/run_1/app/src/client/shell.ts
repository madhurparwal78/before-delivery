import { api, type SessionUser } from './api.js';

export interface ShellState {
  user: SessionUser | null;
  services: { billing: 'up' | 'down'; storage: 'up' | 'down' };
}

const roleLinks: Record<string, Array<{ href: string; label: string }>> = {
  maker: [{ href: '/account', label: 'Account' }],
  owner: [
    { href: '/owner', label: 'Owner' },
    { href: '/yard', label: 'Yard' },
    { href: '/account', label: 'Account' },
  ],
  hand: [{ href: '/yard', label: 'Yard' }],
};

export function renderTopBar(state: ShellState): string {
  const links = state.user ? (roleLinks[state.user.role] ?? []) : [];
  return `<header class="topbar">
    <a class="wordmark" href="/">Kerfwell</a>
    ${state.user ? `<span class="who">${escapeHtml(state.user.name)} · ${roleLabel(state.user.role)}</span>` : ''}
    <nav>
      ${links.map((link) => `<a href="${link.href}">${link.label}</a>`).join('')}
      ${state.user ? `<button id="sign-out" class="btn linklike">Sign out</button>` : `<a href="/sign-in" style="min-height:44px;display:inline-flex;align-items:center">Sign in</a>`}
    </nav>
  </header>
  <div class="status-notice" id="service-notice" role="status" aria-label="Service notice"></div>`;
}

export function roleLabel(role: string): string {
  if (role === 'owner') return 'owner';
  if (role === 'hand') return 'yard hand';
  return 'maker';
}

export function bannerHtml(state: ShellState, page: 'rack' | 'board' | 'account' | 'yard' | 'ticket' | 'owner'): string {
  const parts: string[] = [];
  if (state.services.billing === 'down' && ['rack', 'board', 'account'].includes(page)) {
    parts.push(`<div class="banner" data-banner="billing">Billing is offline. You can browse and plan cuts, but holds and purchases are paused.</div>`);
  }
  if (state.services.storage === 'down' && ['yard', 'ticket'].includes(page)) {
    parts.push(`<div class="banner" data-banner="storage">Photo storage is offline. Tag boards now and add photos when it's back.</div>`);
  }
  return parts.join('');
}

export function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function signOutNow(): Promise<void> {
  try {
    await api.signOut();
  } catch {
    // session already gone server side
  }
  window.location.href = '/';
}

export function wireSignOut(): void {
  const button = document.getElementById('sign-out');
  if (button) button.addEventListener('click', () => void signOutNow());
}

export function wireServicePolling(_page: 'rack' | 'board' | 'account' | 'yard' | 'ticket' | 'owner', onUpdate: () => void): void {
  window.setInterval(() => {
    void api.services().then(() => onUpdate()).catch(() => undefined);
  }, 8000);
}
