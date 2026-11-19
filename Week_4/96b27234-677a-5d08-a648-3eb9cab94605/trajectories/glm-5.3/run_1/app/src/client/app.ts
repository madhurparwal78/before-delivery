// Shared client helpers: API calls, common page shell, and small utilities.
export interface Me {
  personId: string;
  displayName: string;
  email: string;
  siteRole: string;
  timeZone: string;
  avatarId: string | null;
  hideAbove: string | null;
  worldId: string;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? 'Not found.'), { status: res.status, body });
  return body as T;
}

export async function me(): Promise<Me | null> {
  try {
    return await api<Me>('/api/me');
  } catch {
    return null;
  }
}

export function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== '') node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setStatus(name: string, text: string | null): HTMLElement {
  let region = document.querySelector(`[role="status"][aria-label="${name}"]`) as HTMLElement | null;
  if (!region) {
    region = el('div', { role: 'status', 'aria-label': name, class: 'status-region panel' });
    document.querySelector('main')?.prepend(region);
  }
  region.textContent = text ?? '';
  return region;
}

export function alertRegion(): HTMLElement {
  let region = document.querySelector('[role="alert"]') as HTMLElement | null;
  if (!region) {
    region = el('div', { role: 'alert', class: 'status-region panel danger' });
    document.querySelector('main')?.prepend(region);
  }
  return region;
}

export function navigation(m: Me | null): HTMLElement {
  const nav = el('nav', { class: 'main', 'aria-label': 'Main' });
  const links: { href: string; label: string }[] = [
    { href: '/sessions', label: 'Sessions' },
    { href: '/friends', label: 'Friends' },
    { href: '/studio', label: 'Studio' },
    { href: '/communities', label: 'Communities' },
  ];
  if (m?.siteRole === 'moderator') links.push({ href: '/moderation', label: 'Moderation' });
  for (const l of links) {
    const a = el('a', { href: l.href }, l.label);
    if (location.pathname === l.href) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  nav.append(el('span', { class: 'spacer' }));
  if (m) {
    const button = el('button', {}, 'Sign out');
    button.addEventListener('click', async () => {
      await api('/api/signout', { method: 'POST' });
      location.href = '/';
    });
    nav.append(button);
  }
  return nav;
}

export function heading(text: string): HTMLElement {
  return el('h1', {}, text);
}

export const NOT_FOUND_HEADING = 'Page not found.';

export function pageNotFound(): void {
  document.title = 'Page not found - Hearthtile';
  const main = document.querySelector('main') as HTMLElement;
  main.textContent = '';
  main.append(heading(NOT_FOUND_HEADING));
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusMainHeading(): void {
  const h = document.querySelector('main h1') as HTMLElement | null;
  if (h) {
    h.setAttribute('tabindex', '-1');
    h.focus();
  }
}
