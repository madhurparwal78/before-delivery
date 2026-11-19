import { SERVICE_BANNERS } from '../../shared/copy.js';
import type { StatusDto } from '../../shared/types.js';
import { get, onOutage } from '../api.js';
import { el } from '../dom.js';

const STATUS_POLL_MS = 15_000;

function header(): HTMLElement {
  return el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'site-header-inner' },
      el('a', { href: '/', class: 'wordmark', 'aria-label': 'Dotgain' }, 'Dotgain'),
      el(
        'nav',
        { class: 'site-nav', 'aria-label': 'Main' },
        el('a', { href: '/' }, 'Campaigns'),
        el('a', { href: '/pledges' }, 'My pledges'),
        el('a', { href: '/studio' }, 'Studio'),
      ),
    ),
  );
}

let notice: HTMLElement | null = null;

function renderNotice(status: StatusDto): void {
  if (notice === null) return;
  const banners = (
    [
      ['payments', status.payments],
      ['email', status.email],
      ['storage', status.storage],
      ['documents', status.documents],
    ] as const
  )
    .filter(([, state]) => state === 'down')
    .map(([name]) => el('p', { class: 'banner', 'data-service': name }, SERVICE_BANNERS[name]));
  notice.replaceChildren(...banners);
}

async function pollStatus(): Promise<void> {
  try {
    renderNotice(await get<StatusDto>('/api/status'));
  } catch {
    // The status endpoint is the only source of banner state; a failed read changes nothing.
  }
}

export interface Shell {
  readonly main: HTMLElement;
}

export function mountShell(root: HTMLElement): Shell {
  notice = el('div', { role: 'region', 'aria-label': 'Service notice', class: 'service-notice' });
  const main = el('main', { class: 'site-main', id: 'main' });
  root.replaceChildren(header(), notice, main);

  void pollStatus();
  window.setInterval(() => void pollStatus(), STATUS_POLL_MS);
  onOutage(() => void pollStatus());

  return { main };
}
