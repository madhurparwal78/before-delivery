// The persistent shell: top bar, storage banner and the sign-out action.
import { get, post } from './api.js';
import { append, h, replace } from './dom.js';
import { discardDraft, session } from './session.js';
import { hooks } from './hooks.js';

const BANNER_COPY = 'Negative storage is unreachable. Uploads and new readings are paused; your notes, alignments and pinned readings are still here.';

export function renderTopbar(variant) {
  const bar = document.getElementById('topbar');
  const signedIn = Boolean(session.account);
  const path = location.pathname;
  const link = (href, label) => h('li', {}, h('a', { href, 'aria-current': path === href ? 'page' : null }, label));
  const left = h('div', { class: 'left' },
    h('a', { class: 'wordmark', href: signedIn ? '/archive' : '/' }, 'Edgeprint'),
    h('nav', { 'aria-label': 'Main' }, h('ul', {}, link('/archive', 'Archive'), link('/curves', 'Curves'), link('/log', 'Log'))));
  const right = h('div', { class: 'right' });
  if (variant === 'landing') {
    append(right, h('a', { class: 'button primary', href: signedIn ? '/archive' : '/signin' }, 'Open archive'));
  }
  if (signedIn) append(right, h('button', { type: 'button', onclick: signOut }, 'Sign out'));
  replace(bar, left, right);
}

async function signOut() {
  await post('/api/auth/signout', undefined, { keep401: true });
  session.account = null;
  discardDraft();
  hooks.navigate('/');
}

export async function refreshBanner() {
  const holder = document.getElementById('banner');
  if (!session.account) {
    holder.replaceChildren();
    return;
  }
  const response = await get('/api/storage', { keep401: true });
  if (response.data?.storage === 'unavailable') {
    replace(holder, h('div', { class: 'banner', role: 'alert' }, h('p', {}, BANNER_COPY),
      h('button', { type: 'button', class: 'primary', onclick: refreshBanner }, 'Check again')));
  } else {
    holder.replaceChildren();
  }
}
