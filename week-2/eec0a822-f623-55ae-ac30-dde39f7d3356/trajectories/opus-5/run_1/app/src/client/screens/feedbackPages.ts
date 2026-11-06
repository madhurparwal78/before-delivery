import { el } from '../lib/dom.js';
import { publicPage } from '../lib/chrome.js';
import { link } from '../lib/router.js';
import { PAGES } from '../../shared/copy.js';

export async function notFoundScreen(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const page = publicPage(host, PAGES.notFound.heading);
  page.main.append(
    el('p', { class: 'page-copy' }, PAGES.notFound.body),
    link('Sign in', '/sign-in', { class: 'button' }),
  );
}

export async function goneScreen(host: HTMLElement, workspaceSlug: string): Promise<void> {
  host.replaceChildren();
  const page = publicPage(host, PAGES.gone.heading);
  page.main.append(
    el('p', { class: 'page-copy' }, PAGES.gone.body),
    link('Browse the fleet', `/fleet/${workspaceSlug}`, { class: 'button' }),
  );
}

export async function endedScreen(host: HTMLElement): Promise<void> {
  host.replaceChildren();
  const page = publicPage(host, PAGES.ended.heading);
  page.main.append(el('p', { class: 'page-copy' }, PAGES.ended.body));
}
