/* Shared UI components: vote controls, post cards, dialogs, menus, the
   masthead and the community rail. */
import { api, announce, copy, displayScore, el, formatUtc, plural, ApiFailure, trapFocus, type Me } from './lib.js';

export type Post = {
  id: number;
  communityName: string;
  author: { username: string } | null;
  title: string | null;
  bodyHtml: string | null;
  images: { id: number; alt: string | null; width: number; height: number; src: string; srcset: string }[];
  spoiler: boolean;
  score: number;
  myVote: number;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  state: 'published' | 'removed' | 'deleted';
  removal: { publicReason: string; at: string } | null;
  locked: boolean;
  lockedUntil: string | null;
  pinned: boolean;
  archived: boolean;
  version: number;
  url: string;
  bodyMd?: string;
};

export type Comment = {
  id: number;
  postId: number;
  parentId: number | null;
  author: { username: string } | null;
  bodyHtml: string | null;
  score: number;
  myVote: number;
  depth: number;
  descendantCount: number;
  createdAt: string;
  editedAt: string | null;
  state: 'published' | 'deleted' | 'removed';
  canEdit: boolean;
  replies: Comment[];
  bodyMd?: string;
};

export type Community = {
  id: number;
  name: string;
  title: string;
  description: string;
  type: 'public' | 'restricted';
  memberCount: number;
  rules: { id: number; title: string; description: string }[];
  showModNames: boolean;
  createdAt: string;
  viewer: { joined: boolean; isModerator: boolean; isOwner: boolean; canPost: boolean };
};

export type ModLogEntry = {
  id: number;
  action: string;
  target: { type: 'post' | 'comment' | 'user'; id: string };
  publicReason: string | null;
  at: string;
  moderator: { username: string } | null;
  privateNote?: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  remove_post: 'Removed post',
  restore_post: 'Restored post',
  remove_comment: 'Removed comment',
  lock: 'Locked thread',
  unlock: 'Unlocked thread',
  pin: 'Pinned post',
  unpin: 'Unpinned post',
  add_moderator: 'Added moderator',
  remove_moderator: 'Removed moderator',
  approve_poster: 'Approved poster',
  unapprove_poster: 'Removed approved poster',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/* --- Vote buttons (cards, post page, comments) --- */

type VoteHooks = { getVote: () => number; setVote: (v: number, score: number) => void };

export function voteControls(targetType: 'post' | 'comment', targetId: number, opts: { compact?: boolean } = {}): { wrap: HTMLElement; update: (score: number, myVote: number) => void } {
  const scoreEl = el('span', { class: opts.compact === true ? 'score-inline' : 'score', id: `score-${targetType}-${targetId}`, 'aria-live': 'false' });
  const up = el('button', { class: 'vote-btn up', 'aria-label': 'Upvote', 'aria-pressed': 'false' });
  const down = el('button', { class: 'vote-btn down', 'aria-label': 'Downvote', 'aria-pressed': 'false' });
  up.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 L20 14 H15 V20 H9 V14 H4 Z"/></svg>';
  down.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20 L4 10 H9 V4 H15 V10 H20 Z"/></svg>';
  let state = { score: 0, myVote: 0 };

  const apply = (score: number, myVote: number): void => {
    state = { score, myVote };
    rollScore(scoreEl, score);
    up.setAttribute('aria-pressed', myVote === 1 ? 'true' : 'false');
    down.setAttribute('aria-pressed', myVote === -1 ? 'true' : 'false');
  };

  const send = async (value: number): Promise<void> => {
    const prev = { ...state };
    apply(prev.score + (value - prev.myVote), value);
    try {
      const res = await api<{ score: number; myVote: number }>(`/api/${targetType === 'post' ? 'posts' : 'comments'}/${targetId}/vote`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      apply(res.score, res.myVote);
      const n = displayScore(res.score);
      announce(value === 1 ? copy.upvoted(n) : value === -1 ? copy.downvoted(n) : copy.voteRemoved(n));
    } catch (err) {
      apply(prev.score, prev.myVote);
      if (err instanceof ApiFailure) {
        if (err.code === 'RATE_LIMITED') announce(copy.voteSlowDown(err.retryAfter ?? 1));
        else if (err.code === 'EMAIL_UNVERIFIED') announce(copy.voteVerify);
        else if (err.code === 'UNAUTHENTICATED') announce(copy.voteSignIn);
        else if (err.code === 'ARCHIVED') announce(copy.voteArchive);
        else announce(copy.voteNoSave, true);
      } else {
        announce(copy.voteNoSave, true);
      }
    }
  };

  up.addEventListener('click', () => void send(state.myVote === 1 ? 0 : 1));
  down.addEventListener('click', () => void send(state.myVote === -1 ? 0 : -1));

  const wrap = el('div', { class: 'vote-col' }, scoreEl, up, down);
  return { wrap, update: apply };
}

export function rollScore(node: HTMLElement, score: number): void {
  const target = displayScore(score);
  if (node.textContent === target) return;
  node.classList.remove('score-anim');
  // Re-trigger the roll animation.
  void node.offsetWidth;
  node.classList.add('score-anim');
  node.textContent = target;
}

/* --- Post card --- */

export type CardEvents = {
  onRemoved?: (id: number) => void;
  onModeratorActions?: (post: Post) => void;
};

export function postCard(post: Post, me: Me | null, events: CardEvents = {}): { root: HTMLElement; update: (p: Post) => void } {
  const votes = voteControls('post', post.id);
  const titleLink = el('a', { href: post.url }, post.title ?? '');
  const commentsEl = el('a', { href: post.url, class: 'linklike', id: `comments-post-${post.id}` }, plural(post.commentCount, 'comment', 'comments'));
  const scoreInMeta = el('span', { class: 'num', id: `score-meta-post-${post.id}` });

  const root = el('article', { id: `post-${post.id}`, class: 'post-card', tabindex: '0' },
    votes.wrap,
    el('div', { class: 'card-main' },
      el('h3', { class: 'card-title' }, titleLink),
      el('p', { class: 'card-byline' },
        el('span', {}, `c/${post.communityName}`),
        el('span', { class: 'sep' }, '·'),
        post.author !== null ? el('span', {}, post.author.username) : el('span', {}, '[deleted by author]'),
        el('span', { class: 'sep' }, '·'),
        el('span', { class: 'num' }, formatUtc(post.createdAt))),
      el('div', { class: 'card-meta' }, commentsEl, scoreInMeta),
    ),
  );

  const cardKeydown = (e: KeyboardEvent): void => {
    if (isTyping(e)) return;
    if (e.key === 'a') { (votes.wrap.querySelector('.vote-btn.up') as HTMLButtonElement).click(); }
    else if (e.key === 'z') { (votes.wrap.querySelector('.vote-btn.down') as HTMLButtonElement).click(); }
    else if (e.key === 'Enter') { window.location.href = post.url; }
    else if (e.key === 'j') focusCard(root, 1);
    else if (e.key === 'k') focusCard(root, -1);
  };
  root.addEventListener('keydown', cardKeydown);

  const apply = (p: Post): void => {
    votes.update(p.score, p.myVote);
    scoreInMeta.textContent = displayScore(p.score);
    commentsEl.textContent = plural(p.commentCount, 'comment', 'comments');
    titleLink.textContent = p.title ?? '';
  };
  apply(post);
  return { root, update: apply };
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (t === null) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export function focusCard(current: HTMLElement, delta: number): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('article[id^="post-"]'));
  const idx = cards.indexOf(current);
  const next = cards[idx + delta];
  if (next !== undefined) next.focus();
}

/* --- Sort tabs --- */

export function sortTabs(current: 'hot' | 'new' | 'top', label: string, onPick: (sort: 'hot' | 'new' | 'top') => void, name: 'Hot' | 'New' | 'Top' = 'Hot'): HTMLElement {
  const tabs = ['hot', 'new', 'top'] as const;
  const wrap = el('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  for (const s of tabs) {
    const btn = el('button', { class: 'tab', role: 'tab', 'aria-selected': s === current ? 'true' : 'false', type: 'button', tabindex: s === current ? '0' : '-1' }, s === 'hot' ? 'Hot' : s === 'new' ? 'New' : 'Top');
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = tabs.indexOf(s);
      const nextTab = e.key === 'ArrowRight' ? tabs[(i + 1) % 3] : tabs[(i + 2) % 3];
      onPick(nextTab);
    });
    btn.addEventListener('click', () => onPick(s));
    wrap.append(btn);
  }
  return wrap;
}

/* --- Dialog --- */

export function openDialog(opts: { title: string; fields?: () => HTMLElement[]; actions?: (close: () => void) => HTMLElement[]; onCancel?: () => void }): { close: () => void; dialog: HTMLElement } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = el('div', { class: 'overlay' });
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
  dialog.append(el('h2', {}, opts.title));
  for (const field of opts.fields?.() ?? []) dialog.append(field);
  const close = (): void => {
    overlay.remove();
    releaseTrap();
    opener?.focus();
    opts.onCancel?.();
  };
  const actionsEl = el('div', { class: 'dialog-actions' }, ...(opts.actions?.(close) ?? []));
  dialog.append(actionsEl);
  overlay.append(dialog);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  const releaseTrap = trapFocus(dialog, opener);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.removeEventListener('keydown', onKey, true);
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  const first = dialog.querySelector<HTMLElement>('input, button, [href], select, textarea');
  if (first !== null) window.setTimeout(() => first.focus(), 30);
  return { close, dialog };
}

export function alertdialog(opts: { title: string; message: string; confirm: () => Promise<void> | void; confirmLabel: string }): void {
  openDialog({
    title: opts.title,
    fields: () => [el('p', {}, opts.message)],
    actions: (close) => {
      const ok = el('button', { class: 'btn primary', type: 'button' }, opts.confirmLabel);
      ok.addEventListener('click', () => { void (async () => { await opts.confirm(); close(); })(); });
      const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', close);
      return [cancel, ok];
    },
  });
}

/* --- Menu button --- */

export function menuButton(label: string, items: { label: string; onPick: () => void; show?: boolean }[]): HTMLButtonElement {
  const btn = el('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, label);
  let menu: HTMLElement | null = null;
  const closeMenu = (): void => {
    menu?.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  };
  const openMenu = (): void => {
    if (menu !== null) return;
    menu = el('div', { class: 'menu', role: 'menu' });
    for (const item of items) {
      if (item.show === false) continue;
      const mi = el('button', { class: 'menu-item', role: 'menuitem', type: 'button' }, item.label);
      mi.addEventListener('click', () => { closeMenu(); item.onPick(); });
      menu?.append(mi);
    }
    btn.after(menu as Node);
    btn.setAttribute('aria-expanded', 'true');
    (menu?.firstElementChild as HTMLElement | null)?.focus();
  };
  btn.addEventListener('click', () => { if (menu === null) openMenu(); else closeMenu(); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); }
  });
  document.addEventListener('click', (e) => {
    if (menu !== null && !menu.contains(e.target as Node) && e.target !== btn) closeMenu();
  });
  const menuKeys = (e: KeyboardEvent): void => {
    if (menu === null) return;
    const focusables = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const current = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(current + 1) % focusables.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(current - 1 + focusables.length) % focusables.length]?.focus(); }
  };
  document.addEventListener('keydown', menuKeys);
  return btn;
}

/* --- Masthead --- */

export function masthead(me: Me | null, live: { paused: boolean }): { root: HTMLElement; indicator: HTMLElement; update: (me: Me | null) => void } {
  const indicator = el('span', { class: 'live-indicator', id: 'live-indicator' });
  const setIndicator = (paused: boolean): void => {
    indicator.className = `live-indicator${paused ? ' paused' : ''}`;
    indicator.replaceChildren(
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      document.createTextNode(paused ? copy.livePausedLabel : copy.live),
    );
  };
  setIndicator(live.paused);

  const links = el('div', { class: 'masthead-links' });
  const drawerBtn = el('button', { class: 'btn drawer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'community-drawer' }, 'Communities');

  const root = el('header', { class: 'masthead' },
    drawerBtn,
    el('a', { class: 'wordmark', href: '/' }, 'Moothall'),
    el('span', { class: 'masthead-spacer' }),
    indicator,
    links,
  );

  const update = (account: Me | null): void => {
    links.replaceChildren();
    if (account === null) {
      links.append(
        el('a', { class: 'linklike', href: '/login' }, 'Sign in'),
        el('a', { class: 'linklike', href: '/signup' }, 'Create account'),
        el('a', { class: 'linklike', href: '/communities' }, 'Communities'),
      );
    } else {
      const out = el('button', { class: 'btn quiet', type: 'button' }, 'Sign out');
      out.addEventListener('click', () => { void api('/api/auth/logout', { method: 'POST' }).then(() => navigate('/')); });
      links.append(el('a', { class: 'linklike', href: '/communities/new' }, 'Create community'));
      if (account.role === 'admin') links.append(el('a', { class: 'linklike', href: '/admin/reports' }, 'Admin'));
      links.append(out);
    }
  };
  update(me);

  return { root, indicator, update };
}

export function navigate(path: string): void {
  window.location.href = path;
}

/* --- Community rail / drawer --- */

export function rail(communities: { name: string; title: string }[], asDrawer: boolean): HTMLElement {
  const nav = el('nav', { 'aria-label': 'Communities' });
  const list = el('div', {});
  if (!asDrawer) list.className = 'rail';
  list.append(el('p', { class: 'rail-title' }, 'Your communities'));
  for (const c of communities) {
    list.append(el('a', { href: `/c/${c.name}` }, `c/${c.name}`));
  }
  if (communities.length === 0) list.append(el('p', {}, 'You have not joined any communities yet.'));
  nav.append(list);
  return nav;
}
