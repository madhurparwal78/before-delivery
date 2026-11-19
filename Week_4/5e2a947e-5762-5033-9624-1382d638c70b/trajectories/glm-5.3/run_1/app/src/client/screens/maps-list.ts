import { el } from '../lib/dom.js';
import { api, errorOf, toast } from '../lib/api.js';
import { checkSession } from './home.js';
import type { MapPayload, RecoveredEntry } from '../../shared/types.js';
import { EditorStore } from '../lib/store.js';

/**
 * The auth screens, the map list and the new map dialog.
 */

export function renderAuth(root: HTMLElement, mode: 'signup' | 'signin'): void {
  root.replaceChildren();
  const topbar = el('header', { class: 'topbar' });
  topbar.append(el('a', { class: 'brand', href: '/' }, 'Sprigmap'));
  root.appendChild(topbar);
  const form = el('form', { class: 'auth-form' });
  form.appendChild(el('h1', {}, mode === 'signup' ? 'Create your account' : 'Sign in'));
  const formError = el('div', { class: 'form-error', role: 'alert' });
  const userLabel = el('label', { for: 'username' }, 'Username');
  const userField = el('input', { id: 'username', name: 'username', autocomplete: 'username', 'aria-label': 'Username' }) as HTMLInputElement;
  const userError = el('div', { class: 'field-error', id: 'username-error' });
  const passLabel = el('label', { for: 'password' }, 'Password');
  const passField = el('input', { id: 'password', name: 'password', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', 'aria-label': 'Password' }) as HTMLInputElement;
  const passError = el('div', { class: 'field-error', id: 'password-error' });
  const submit = el('button', { class: 'primary', type: 'submit', 'aria-label': mode === 'signup' ? 'Create account' : 'Sign in' }, mode === 'signup' ? 'Create account' : 'Sign in');
  form.append(formError, userLabel, userField, userError, passLabel, passField, passError, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    userError.textContent = '';
    passError.textContent = '';
    const out = await api<{ user: { username: string } }>(`/api/auth/${mode === 'signup' ? 'signup' : 'login'}`, 'POST', {
      username: userField.value, password: passField.value,
    });
    if (out.ok) {
      location.href = '/maps';
      return;
    }
    const err = errorOf(out);
    if (err.fields?.username) userError.textContent = err.fields.username;
    if (err.fields?.password) passError.textContent = err.fields.password;
    if (err.code === 'username_taken') userError.textContent = 'That username is taken.';
    if (err.code === 'bad_credentials') formError.textContent = 'Wrong username or password.';
    if (err.code === 'rate_limited') formError.textContent = 'Too many sign-in attempts. Try again in a minute.';
    if (Object.keys(err.fields ?? {}).length === 0 && err.code === 'invalid') {
      formError.textContent = err.message;
    }
  });
  root.appendChild(form);
}

interface MapListEntry { id: string; title: string; role: string; updated_at: string; revision: number; topic_count: number }

export async function renderMaps(root: HTMLElement): Promise<void> {
  const me = await checkSession();
  if (!me) { location.href = '/signin'; return; }
  root.replaceChildren();
  const topbar = el('header', { class: 'topbar' });
  topbar.append(
    el('a', { class: 'brand', href: '/' }, 'Sprigmap'),
    el('nav', {}).appendChild(el('a', { href: '/maps' }, 'Your maps')).parentNode!,
  );
  const inbox = el('button', { class: 'secondary', 'aria-label': 'Inbox (0)' }, 'Inbox (0)');
  topbar.appendChild(inbox);
  root.appendChild(topbar);

  const page = el('main', { class: 'maps-page' });
  const header = el('div', { class: 'maps-header' });
  header.appendChild(el('h1', {}, 'Your maps'));
  const newBtn = el('button', { class: 'primary', 'aria-label': 'New map' }, 'New map');
  header.appendChild(newBtn);
  page.appendChild(header);

  const list = await api<{ maps: MapListEntry[] }>('/api/maps');
  const maps = list.ok ? (list.body as { maps: MapListEntry[] }).maps : [];
  if (maps.length === 0) {
    page.appendChild(el('p', { class: 'empty-list' }, 'You have no maps yet. Start one from a central idea.'));
  } else {
    const recent = el('section', { class: 'recent-trio', role: 'region', 'aria-label': 'Recent maps' });
    for (const m of maps.slice(0, 3)) recent.appendChild(mapCard(m, true));
    page.appendChild(recent);
    const grid = el('div', { class: 'map-grid', role: 'list', 'aria-label': 'All maps' });
    for (const m of maps) grid.appendChild(mapCard(m, false));
    page.appendChild(grid);
  }
  root.appendChild(page);

  newBtn.addEventListener('click', () => {
    const { openDialog } = (require as never) ?? {};
    void openNewMapDialog(root, newBtn);
  });
  void toast;
}

function mapCard(m: MapListEntry, isRecent: boolean): HTMLElement {
  const card = el('div', { class: 'map-card', role: isRecent ? 'group' : 'listitem' });
  const mini = el('div', { class: 'mini' });
  void loadMini(mini, m.id);
  const link = el('a', { class: 'map-title', href: `/m/${m.id}`, 'aria-label': m.title }, m.title);
  card.append(mini, link, el('div', { class: 'meta' }, `${m.topic_count} topics`));
  return card;
}

async function loadMini(mini: HTMLElement, mapId: string): Promise<void> {
  const out = await api<MapPayload>(`/api/maps/${mapId}`);
  if (!out.ok) return;
  const payload = out.body as MapPayload;
  const store = new EditorStore(payload, null);
  const layout = store.layout();
  const svgns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '-620 -220 1240 440');
  for (const t of payload.topics) {
    const box = layout.boxes.get(t.id);
    if (!box) continue;
    const g = document.createElementNS(svgns, 'g');
    g.setAttribute('transform', `translate(${box.x - box.w / 2} ${box.y - box.h / 2})`);
    const rect = document.createElementNS(svgns, 'rect');
    rect.setAttribute('width', String(box.w));
    rect.setAttribute('height', String(box.h));
    rect.setAttribute('rx', '12');
    rect.setAttribute('fill', t.parent_id === null && !t.floating ? '#2b4ef2' : '#ffffff');
    rect.setAttribute('stroke', t.parent_id === null && !t.floating ? '#2b4ef2' : '#2b4ef2');
    rect.setAttribute('stroke-width', '3');
    const text = document.createElementNS(svgns, 'text');
    text.setAttribute('x', String(box.w / 2));
    text.setAttribute('y', String(box.h / 2 + 5));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '13');
    text.setAttribute('fill', t.parent_id === null && !t.floating ? '#ffffff' : '#241b33');
    text.textContent = t.title;
    g.append(rect, text);
    svg.appendChild(g);
  }
  mini.appendChild(svg);
}

async function openNewMapDialog(root: HTMLElement, opener: HTMLElement): Promise<void> {
  const { openDialog } = await import('../lib/dom.js');
  openDialog({
    label: 'New map',
    opener,
    build(body, close) {
      body.appendChild(el('h2', {}, 'New map'));
      const label = el('label', { for: 'central-idea' }, 'Central idea');
      const field = el('input', { id: 'central-idea', 'aria-label': 'Central idea' }) as HTMLInputElement;
      const groupLabel = el('label', {}, 'Start from');
      const group = el('div', { role: 'radiogroup', 'aria-label': 'Start from' });
      const options: [string, string][] = [['blank', 'Blank'], ['street-fair', 'Street fair'], ['exam-revision', 'Exam revision'], ['house-move', 'House move']];
      let chosen = 'blank';
      const radios: HTMLInputElement[] = [];
      for (const [value, text] of options) {
        const line = el('div', { class: 'radio-line' });
        const radio = el('input', { type: 'radio', name: 'template', id: `tpl-${value}`, ...(value === 'blank' ? { checked: '' } : {}) }) as HTMLInputElement;
        radio.addEventListener('change', () => { chosen = value; });
        radios.push(radio);
        line.append(radio, el('label', { for: `tpl-${value}` }, text));
        group.appendChild(line);
      }
      const create = el('button', { class: 'primary', 'aria-label': 'Create map' }, 'Create map');
      create.addEventListener('click', async () => {
        const title = field.value.trim();
        if (title === '') return;
        const template = chosen === 'blank' ? null : chosen;
        const out = await api<{ map: { id: string } }>('/api/maps', 'POST', { title, template });
        if (out.ok) {
          close();
          location.href = `/m/${(out.body as { map: { id: string } }).map.id}`;
        } else {
          toast(errorOf(out).message);
        }
      });
      body.append(label, field, groupLabel, group, create);
      void root;
      void radios;
    },
  });
}

export type { RecoveredEntry };
