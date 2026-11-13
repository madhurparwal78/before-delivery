import { h, type Child } from './dom.js';
import { get } from './api.js';
import type { Person } from './api.js';
import { startSocket, stopSocket, socketOpen, onSocketOpen, onEvent, countdownTo, latestServerTime } from './socket.js';
import { ensureStatusRegion, announce } from './status.js';

export interface Session {
  person: Person;
  server_time: string;
  server_date: string;
}

let session: Session | null = null;

export function currentSession(): Session | null {
  return session;
}

export function setSession(s: Session | null): void {
  session = s;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const me = await get<Session & { person: Person }>('/api/me');
    session = { person: me.person, server_time: me.server_time, server_date: me.server_date };
    return session;
  } catch {
    session = null;
    return null;
  }
}

// ---------- navigation ----------

export interface PageCtx {
  person: Person;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type PageRenderer = (root: HTMLElement, ctx: PageCtx) => Promise<void>;

const routes: Array<{ pattern: RegExp; keys: string[]; render: PageRenderer; roles?: string[] }> = [];

export function page(
  pattern: string,
  rolesOrRender: string[] | undefined | PageRenderer,
  renderOrRoles?: PageRenderer | string[],
): void {
  let render: PageRenderer;
  let roles: string[] | undefined;
  if (typeof rolesOrRender === 'function') {
    render = rolesOrRender;
    roles = renderOrRoles as string[] | undefined;
  } else {
    roles = rolesOrRender;
    render = renderOrRoles as PageRenderer;
  }
  const keys: string[] = [];
  const rx = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '/?$',
  );
  routes.push({ pattern: rx, keys, render, roles });
}

function match(path: string): { render: PageRenderer; params: Record<string, string>; roles?: string[] } | null {
  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      return { render: r.render, params, roles: r.roles };
    }
  }
  return null;
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState({}, '', to);
  else history.pushState({}, '', to);
  void render();
}

export function replaceAddress(to: string): void {
  history.replaceState({}, '', to);
}

let rootEl: HTMLElement | null = null;

export function serverNow(): string {
  const fromSocket = latestServerTime();
  return fromSocket ?? session?.server_time ?? new Date().toISOString();
}

export async function render(): Promise<void> {
  if (!rootEl) return;
  const path = location.pathname;
  rootEl.replaceChildren();
  ensureStatusRegion();

  const sess = session ?? (await loadSession());

  if (!sess) {
    // A signed-out visit to any path except / shows the sign-in page.
    if (path !== '/') history.replaceState({}, '', '/');
    await renderSignIn(rootEl);
    return;
  }

  const m = match(path);
  const notFoundPage = () => { renderNotFound(rootEl!); return Promise.resolve(); };

  if (!m) {
    await notFoundPage();
    return;
  }
  if (m.roles && !m.roles.includes(sess.person.role)) {
    await notFoundPage();
    return;
  }
  startSocket();
  try {
    await m.render(rootEl!, { person: sess.person, params: m.params, query: new URLSearchParams(location.search) });
    const contentNow = document.getElementById('content');
    if (contentNow instanceof HTMLElement) applyLiveEnabled(contentNow, socketOpen());
  } catch (e) {
    const err = e as { status?: number; code?: string; message?: string };
    if (err.status === 404 || err.code === 'not_found') {
      await notFoundPage();
      return;
    }
    if (err.status === 401) {
      session = null;
      history.replaceState({}, '', '/');
      await renderSignIn(rootEl);
      return;
    }
    rootEl.replaceChildren(
      h('section', { class: 'band black', role: 'alert' }, 'Something went wrong on our side. Your register has not changed.'),
    );
  }
}

// ---------- shared chrome ----------

export function navLinks(person: Person): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [{ label: 'Portal', href: '/' }];
  if (person.role === 'option_holder' || person.role === 'leaver') {
    links.push({ label: 'Exercise', href: '/exercise' }, { label: 'Documents', href: '/documents' }, { label: 'Cap table', href: '/cap-table' });
  } else if (person.role === 'investor') {
    links.push({ label: 'Tender', href: '/tenders' }, { label: 'Documents', href: '/documents' }, { label: 'Cap table', href: '/cap-table' });
  } else if (person.role === 'board_member') {
    links.push({ label: 'Board queue', href: '/board' }, { label: 'Cap table', href: '/cap-table' });
  } else {
    links.push(
      { label: 'Cap table', href: '/cap-table' },
      { label: 'Ledger', href: '/admin/ledger' },
      { label: 'Grants', href: '/admin/grants' },
      { label: 'Valuations', href: '/admin/valuations' },
      { label: 'Tenders', href: '/admin/tenders' },
      { label: 'Round scenario', href: '/admin/scenario' },
      { label: 'People', href: '/admin/people' },
      { label: 'Documents', href: '/documents' },
    );
  }
  return links;
}

/** Buttons that send a change are disabled while the socket is closed (DP-62). */
function applyLiveEnabled(content: HTMLElement, open: boolean): void {
  const buttons = content.querySelectorAll<HTMLButtonElement>('button');
  for (const b of buttons) {
    // Navigation, sign-out and close stay usable.
    const text = (b.textContent ?? '').trim();
    const exempt = text === 'Sign out' || text === 'Close' || b.closest('nav') !== null;
    if (exempt) continue;
    b.disabled = !open;
  }
  const selects = content.querySelectorAll<HTMLSelectElement>('select[aria-label^="Role for"]');
  for (const s of selects) s.disabled = !open;
}

export function shell(person: Person, ...content: Child[]): HTMLElement {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Register' });
  for (const link of navLinks(person)) {
    const active = link.href === '/' ? location.pathname === '/' : location.pathname.startsWith(link.href);
    const a = h('a', { href: link.href, ...(active ? { 'aria-current': 'page' } : {}) }, link.label);
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      navigate(link.href);
    });
    nav.appendChild(a);
  }
  const signOut = h('button', { class: 'secondary signout' }, 'Sign out');
  signOut.addEventListener('click', async () => {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    stopSocket();
    session = null;
    history.replaceState({}, '', '/');
    await render();
  });
  nav.appendChild(signOut);

  const reconnecting = h('div', { class: 'reconnecting', style: { display: 'none' }, role: 'status' }, 'Reconnecting to the register.');

  const workbench = h('div', { class: 'workbench' },
    h('aside', { class: 'left-zone' },
      h('div', { class: 'name', id: 'person-name' }, person.first_name),
      h('div', { class: 'side-note', id: 'left-note' }),
    ),
    h('main', { class: 'content', id: 'content' }, ...content),
  );

  const wrap = h('div', {},
    reconnecting,
    nav,
    workbench,
  );

  const contentEl = workbench.querySelector<HTMLElement>('#content');
  onSocketOpen((open) => {
    reconnecting.style.display = open ? 'none' : 'block';
    if (contentEl) applyLiveEnabled(contentEl, open);
    if (open) announce('Register updates');
  });

  return wrap;
}

export function content(): HTMLElement {
  return document.getElementById('content')!;
}

// ---------- sign-in ----------

async function renderSignIn(root: HTMLElement): Promise<void> {
  const masthead = await get<{ company: string; fully_diluted_total: number }>('/api/masthead');
  const photos = ['/assets/photos/robot-arms.png', '/assets/photos/workbench.png', '/assets/photos/hands-desk.png', '/assets/photos/parts-tray.png'];

  const error = h('p', { class: 'field-error', style: { display: 'none' } });
  const email = h('input', { type: 'email', id: 'email', autocomplete: 'username' });
  const emailLabel = h('label', { for: 'email' }, 'Email');
  const password = h('input', { type: 'password', id: 'password', autocomplete: 'current-password' });
  const passwordLabel = h('label', { for: 'password' }, 'Password');
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in');

  const form = h('form', { class: 'narrow', 'aria-label': 'Sign in' },
    h('div', {}, emailLabel, email),
    h('div', {}, passwordLabel, password),
    error,
    submit,
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.style.display = 'none';
    submit.textContent = 'Signing in';
    try {
      await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: (email as HTMLInputElement).value, password: (password as HTMLInputElement).value }),
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json();
          throw Object.assign(new Error(body.error.message), { code: body.error.code, status: res.status });
        }
        return res.json();
      });
      session = await loadSession();
      submit.textContent = 'Sign in';
      history.replaceState({}, '', '/');
      startSocket();
      await render();
      const heading = document.getElementById('person-name');
      if (heading instanceof HTMLElement) heading.focus();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      submit.textContent = 'Sign in';
      error.textContent = err.message ?? "That email and password don't match a Tidecraft register account.";
      error.style.display = 'block';
      if (err.code === 'access_removed') {
        announce('Your access to the Tidecraft register has ended.', 'signin-removed');
      }
    }
  });

  const title = h('h1', { class: 'signin-title' },
    h('span', { class: 'line' }, 'Your shares,'),
    h('span', { class: 'line' }, 'on the record.'),
  );

  const blackTile = h('div', { class: 'tile black' },
    h('div', { class: 'figure num' }, masthead.fully_diluted_total.toLocaleString('en-US')),
    h('div', { class: 'caption' }, 'shares, fully diluted'),
  );

  const mosaic = h('div', { class: 'mosaic', 'aria-label': 'Masthead' },
    h('div', { class: 'tile' }, h('img', { src: photos[0], alt: 'Robot arms on the Tidecraft work floor' })),
    h('div', { class: 'tile' }, h('img', { src: photos[1], alt: 'A workbench with tools' })),
    blackTile,
    h('div', { class: 'tile red' }),
    h('div', { class: 'tile' }, h('img', { src: photos[2], alt: 'Hands working at a desk' })),
    h('div', { class: 'tile' }, h('img', { src: photos[3], alt: 'A tray of parts' })),
    h('div', { class: 'tile grey' }),
  );

  const page = h('div', { class: 'signin' },
    mosaic,
    h('div', { class: 'signin-hero' }, title),
    h('p', { class: 'standfirst' }, 'Tidecraft Robotics keeps its register here. Sign in to see what you own, what vests next and every deadline that applies to you.'),
    form,
  );

  root.appendChild(page);
  email.focus();

  // Title reveal, once per page session; skipped under reduced motion.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && !sessionStorage.getItem('title-revealed')) {
    title.classList.add('reveal');
    sessionStorage.setItem('title-revealed', '1');
  }

  // The navigation is not present when signed out.
  window.addEventListener('popstate', () => void render());
}

// ---------- not-found ----------

function renderNotFound(root: HTMLElement): void {
  root.replaceChildren(
    h('section', { class: 'band black full-bleed', role: 'region' },
      h('h1', {}, 'Not on your register'),
      h('p', {}, "This record isn't on your register."),
    ),
  );
}

// ---------- boot ----------

export function boot(root: HTMLElement): void {
  rootEl = root;
  window.addEventListener('popstate', () => void render());
  import('./format.js').then((m) => m.setServerNowRef(serverNow));
  void render();

  onEvent((ev) => {
    if (ev.type === 'clock') {
      const data = ev.data as { server_time: string } | null;
      if (data?.server_time) {
        import('./socket.js').then((m) => m.setServerTime(data.server_time));
      }
    }
  });
}

export function fmtCountdown(target: string | null): string {
  return countdownTo(target, serverNow());
}

export function personRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    founder_admin: 'Founder admin',
    board_member: 'Board member',
    option_holder: 'Option holder',
    leaver: 'Leaver',
    investor: 'Investor',
  };
  return labels[role] ?? role;
}

export { socketOpen, onSocketOpen, announce };
