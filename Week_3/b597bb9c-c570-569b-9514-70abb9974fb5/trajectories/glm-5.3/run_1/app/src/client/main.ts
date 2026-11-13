import { api, ApiError } from './api';
import { el, findStatus, announce, reducedMotion } from './ui';
import { renderSignIn } from './pages/sign-in';
import { renderProjectList } from './pages/project-list';
import { renderLibrary } from './pages/library';
import { renderProfile } from './pages/profile';
import { renderProject } from './pages/project';
import { renderReview } from './pages/review';

import type { Person } from '../shared/types';

/** The one client entry: routing and the shared band. */
let currentPerson: Person | null = null;
let isOwner = false;

export function person(): Person | null {
  return currentPerson;
}

export function owner(): boolean {
  return isOwner;
}

async function boot(): Promise<void> {
  try {
    const session = await api.session();
    currentPerson = session.person;
    isOwner = session.is_owner;
  } catch {
    currentPerson = null;
  }
  window.addEventListener('popstate', () => {
    void route();
  });
  await route();
}

export async function route(): Promise<void> {
  const path = window.location.pathname;
  const root = document.getElementById('root')!;
  root.textContent = '';
  if (path === '/sign-in') {
    root.append(renderSignIn(root));
    return;
  }
  if (path.startsWith('/review/')) {
    const token = path.slice('/review/'.length);
    root.append(await renderReview(token, root));
    return;
  }
  if (currentPerson === null) {
    window.history.replaceState(null, '', '/sign-in');
    await route();
    return;
  }
  if (path === '/' || path === '') {
    root.append(await renderProjectList(root));
    return;
  }
  if (path === '/library') {
    if (!isOwner && !isEditor()) {
      root.append(notAllowed());
      return;
    }
    root.append(await renderLibrary(root));
    return;
  }
  if (path === '/profile') {
    root.append(await renderProfile(root));
    return;
  }
  if (path.startsWith('/projects/')) {
    const id = path.split('/')[2] ?? '';
    root.append(await renderProject(id, root));
    return;
  }
  root.append(notFound());
}

function isEditor(): boolean {
  return false; // set by the project list when it loads
}

let editorVisible = false;
export function setEditorVisible(value: boolean): void {
  editorVisible = value;
}

function notFound(): HTMLElement {
  const main = el('main', null);
  const band = el('div', { class: 'band no-hero' });
  band.append(el('p', { text: 'Nothing here. It may have been removed or you may not have access.' }));
  main.append(band);
  return main;
}

function notAllowed(): HTMLElement {
  const main = el('main', null);
  const band = el('div', { class: 'band no-hero' });
  band.append(el('p', { text: 'Your role on this project cannot do that.' }));
  main.append(band);
  return main;
}

/** The band: brand, allowance, availability, nav. */
export function renderBand(root: HTMLElement, options?: { reviewTitle?: string }): HTMLElement {
  const band = el('header', { class: 'band' });
  const brand = el('a', { href: '/', class: 'brand', text: 'Gatecut' });
  band.append(brand);
  const nav = el('nav', { 'aria-label': 'Sections' });
  const links: HTMLElement[] = [el('a', { href: '/', text: 'Projects' })];
  if (options?.reviewTitle === undefined) {
    if (isOwner || editorVisible) links.push(el('a', { href: '/library', text: 'Library' }));
    links.push(el('a', { href: '/profile', text: 'Profile' }));
    const signOut = el('button', { class: 'link', text: 'Sign out' });
    signOut.addEventListener('click', async () => {
      await api.signOut();
      currentPerson = null;
      window.location.href = '/sign-in';
    });
    links.push(signOut);
  }
  for (const link of links) nav.append(link);
  const allowance = el('span', { 'data-allowance': '' });
  band.append(allowance, nav);
  void root;
  void api.allowance().then((a) => {
    allowance.textContent = a.text;
  });
  return band;
}

export function handleApiError(err: unknown, noticeLabel = 'Notices'): void {
  if (err instanceof ApiError) {
    announce(noticeLabel, err.body.message ?? 'Check the highlighted fields.');
    return;
  }
  announce(noticeLabel, 'That value is not allowed here.');
}

void reducedMotion;

void boot();
