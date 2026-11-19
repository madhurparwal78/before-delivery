/* Profile, settings and the two-factor setup page. */
import { api, announce, copy, el, type Me } from '../lib.js';
import { postCard, type Post } from '../ui.js';
import { formatTime } from './community.js';

export async function renderProfilePage(frame: HTMLElement, me: Me | null, path: string): Promise<void> {
  const username = decodeURIComponent(path.split('/')[2] ?? '');
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);
  let user: { username: string; createdAt: string };
  try {
    user = await api<{ username: string; createdAt: string }>(`/api/users/${encodeURIComponent(username)}`);
  } catch {
    feedCol.append(el('p', { class: 'empty' }, 'No such member.'));
    return;
  }
  feedCol.append(el('header', { class: 'post-head' },
    el('h1', {}, `u/${user.username}`),
    el('p', { class: 'card-byline' }, el('span', { class: 'num' }, `Joined ${formatTime(user.createdAt)}`)),
  ));
  const list = el('div', { class: 'card-list' });
  feedCol.append(list);
  const posts = await api<{ items: Post[] }>(`/api/users/${encodeURIComponent(user.username)}/posts`);
  if (posts.items.length === 0) {
    list.append(el('p', { class: 'empty' }, 'No posts yet.'));
    return;
  }
  for (const p of posts.items) {
    list.append(postCard(p, me).root);
  }
}

export async function renderSettingsPage(frame: HTMLElement, me: Me | null): Promise<void> {
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);
  if (me === null) {
    feedCol.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' to see your settings.'));
    return;
  }
  feedCol.append(el('header', { class: 'post-head' }, el('h1', {}, 'Settings')));
  const panel = el('section', { class: 'panel' });
  panel.append(
    el('p', {}, el('strong', {}, 'Username'), ` ${me.username}`),
    el('p', { class: 'card-byline' }, copy.usernameNote),
    el('p', {}, me.totpEnabled ? 'Two-factor authentication is on.' : 'Two-factor authentication is off.'),
    el('a', { class: 'btn', href: '/settings/2fa' }, 'Two-factor settings'),
  );
  feedCol.append(panel);
}

export async function renderTwoFactorPage(frame: HTMLElement, me: Me | null, search: string): Promise<void> {
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);
  const params = new URLSearchParams(search);
  const next = params.get('next') ?? '/';

  if (me === null) {
    feedCol.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' first.'));
    return;
  }

  const host = el('section', { class: 'panel' });
  feedCol.append(host);

  if (me.totpEnabled) {
    host.append(el('h1', {}, 'Two-factor authentication is on'), el('a', { class: 'btn primary', href: next }, 'Back'));
    return;
  }

  host.append(el('h1', {}, 'Set up two-factor authentication'));
  const setup = await api<{ secret: string; otpauthUri: string }>('/api/me/totp/setup', { method: 'POST' });
  const secretEl = el('code', { class: 'num', id: 'totp-secret' }, setup.secret.toUpperCase());
  const code = el('input', { class: 'input', type: 'text', inputmode: 'numeric', maxlength: '6', 'aria-label': 'Authentication code' });
  const errEl = el('span', {});
  const btn = el('button', { class: 'btn primary', type: 'button' }, 'Turn on two-factor authentication');
  btn.addEventListener('click', () => {
    void (async () => {
      try {
        await api('/api/me/totp/enable', { method: 'POST', body: JSON.stringify({ code: code.value.trim() }) });
        announce('Two-factor authentication is on');
        window.location.href = next === '' ? '/' : next;
      } catch (e) {
        if (e instanceof Error && 'fields' in e) {
          errEl.replaceChildren(el('span', { class: 'field-error' }, "That code didn't match"));
          code.setAttribute('aria-invalid', 'true');
          code.focus();
        }
      }
    })();
  });
  host.append(
    el('p', {}, 'Enter this secret in your authenticator app:'),
    el('p', {}, secretEl),
    el('p', { class: 'card-byline' }, 'RFC 6238, SHA-1, 6 digits, 30-second step.'),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Authentication code'), code, errEl),
    el('div', { class: 'dialog-actions' }, btn),
  );
}
