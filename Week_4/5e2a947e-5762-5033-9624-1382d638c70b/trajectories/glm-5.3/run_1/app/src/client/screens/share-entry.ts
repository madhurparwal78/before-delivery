import { el, openDialog } from '../lib/dom.js';
import { api, errorOf, toast } from '../lib/api.js';

/**
 * The share link entry: dialog "Join map" that cannot be dismissed
 * with Escape, and the expired and turned-off pages.
 */

export async function renderShareEntry(root: HTMLElement, code: string): Promise<void> {
  root.replaceChildren();
  const info = await api<{ map_id: string; map_title: string; role: string }>(`/api/share/${code}`);
  if (!info.ok) {
    const err = errorOf(info);
    const page = el('main', { class: 'auth-form' });
    if (err.code === 'link_expired') page.appendChild(el('h1', {}, 'This link has expired.'));
    else if (err.code === 'link_revoked') page.appendChild(el('h1', {}, "This link was turned off by the map's owner."));
    else page.appendChild(el('h1', {}, "We couldn't find that map."));
    root.appendChild(page);
    return;
  }
  const data = info.body as { map_id: string; map_title: string; role: string };
  openDialog({
    label: 'Join map',
    dismissible: false,
    build(body, close) {
      body.appendChild(el('h2', {}, `Join ${data.map_title}`));
      const label = el('label', { for: 'your-name' }, 'Your name');
      const field = el('input', { id: 'your-name', 'aria-label': 'Your name' }) as HTMLInputElement;
      const join = el('button', { class: 'primary', 'aria-label': 'Join' }, 'Join');
      join.addEventListener('click', async () => {
        const name = field.value.trim();
        if (name === '') return;
        const out = await api<{ map_id: string }>(`/api/share/${code}/join`, 'POST', { display_name: name });
        if (out.ok) {
          close();
          location.href = `/m/${(out.body as { map_id: string }).map_id}`;
        } else {
          toast(errorOf(out).message);
        }
      });
      body.append(label, field, join);
    },
  });
}

export function renderRemoved(root: HTMLElement): void {
  root.replaceChildren();
  const page = el('main', { class: 'auth-form' });
  page.appendChild(el('h1', {}, 'You no longer have access to this map.'));
  page.appendChild(el('a', { href: '/maps' }, 'Your maps'));
  root.appendChild(page);
}

export function renderNotFound(root: HTMLElement): void {
  root.replaceChildren();
  const page = el('main', { class: 'auth-form' });
  page.appendChild(el('h1', {}, "We couldn't find that page."));
  const home = el('a', { href: '/' }, 'Sprigmap');
  page.appendChild(home);
  root.appendChild(page);
}
