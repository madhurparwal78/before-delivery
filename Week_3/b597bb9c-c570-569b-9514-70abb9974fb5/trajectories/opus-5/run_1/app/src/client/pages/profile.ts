/** Profile: the availability line, read tokens, brand kits and the outbox. */
import { ApiCallError, get, post, put, remove } from '../api.js';
import { clear, el, find, findAll } from '../dom.js';
import { band, loadAllowance, loadStatus, mount, notice, noticesStrip, renderOutages, shared } from '../shell.js';
import type { KitRecord, OutboxItem } from '../../shared/types.js';

interface TokenItem {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  requests_in_window: number;
}

async function renderTokens(): Promise<void> {
  const host = find<HTMLElement>('[data-tokens-list]');
  if (host === null) return;
  const page = await get<{ items: TokenItem[] }>('/api/tokens');
  clear(host);
  if (page.items.length === 0) {
    host.append(el('p', { class: 'empty', text: 'No read tokens yet.' }));
    return;
  }
  for (const token of page.items) {
    host.append(
      el('div', { class: 'row token-row' }, [
        el('span', { text: token.name }),
        el('span', { class: 'muted tabular', 'data-token-window': token.id, text: String(token.requests_in_window) }),
        el('button', { type: 'button', 'data-revoke': token.id, text: `Revoke ${token.name}` }),
      ]),
    );
  }
  for (const button of findAll<HTMLButtonElement>('[data-revoke]', host)) {
    button.addEventListener('click', () => {
      void remove(`/api/tokens/${button.dataset.revoke}`).then(() => {
        notice('Read token revoked.');
        void renderTokens();
      });
    });
  }
}

async function pollTokenWindows(): Promise<void> {
  try {
    const page = await get<{ items: TokenItem[] }>('/api/tokens');
    for (const token of page.items) {
      const node = find<HTMLElement>(`[data-token-window="${token.id}"]`);
      if (node !== null) node.textContent = String(token.requests_in_window);
    }
  } catch {
    /* the profile page keeps its last reading until the next poll */
  }
}

async function renderKits(): Promise<void> {
  const host = find<HTMLElement>('[data-kits-list]');
  if (host === null) return;
  const page = await get<{ items: KitRecord[] }>('/api/kits');
  clear(host);
  for (const kit of page.items) {
    host.append(
      el('div', { class: 'row' }, [
        el('span', { text: kit.name }),
        el('span', { class: 'muted', text: kit.text_colour }),
        el('span', { class: 'muted', text: kit.box_colour }),
        el('span', { class: 'muted tabular', text: String(kit.font_weight) }),
      ]),
    );
  }
}

async function renderOutbox(): Promise<void> {
  const host = find<HTMLElement>('[data-outbox-list]');
  if (host === null) return;
  const page = await get<{ items: OutboxItem[] }>('/api/outbox');
  clear(host);
  if (page.items.length === 0) {
    host.append(el('p', { class: 'empty', text: 'The outbox is empty.' }));
    return;
  }
  for (const message of page.items) {
    host.append(
      el('div', { class: 'row' }, [
        el('span', { text: message.subject }),
        el('span', { class: 'muted', text: message.to }),
        el('span', { class: 'muted', text: message.state }),
      ]),
    );
  }
}

export async function renderProfile(): Promise<void> {
  await Promise.all([loadAllowance(), loadStatus()]);
  try {
    shared.projects = (await get<{ items: never[] }>('/api/projects')).items;
  } catch {
    shared.projects = [];
  }
  const owner = shared.session?.is_owner === true;
  if (!owner) {
    mount(
      band(),
      noticesStrip(),
      el('main', { class: 'sheet-area profile' }, [
        el('p', { text: shared.session?.person.name ?? '' }),
        el('p', { class: 'muted', text: shared.session?.person.email ?? '' }),
      ]),
    );
    return;
  }
  const profile = await get<{ name: string; availability: string }>('/api/profile');
  shared.availability = profile.availability;
  const availability = el('input', { type: 'text', id: 'availability', 'aria-label': 'Availability', value: profile.availability });
  const tokenName = el('input', { type: 'text', id: 'token-name', 'aria-label': 'Token name' });
  const kitName = el('input', { type: 'text', id: 'kit-name', 'aria-label': 'Kit name' });
  const textColour = el('input', { type: 'text', id: 'text-colour', 'aria-label': 'Text colour', value: 'ffffff' });
  const boxColour = el('input', { type: 'text', id: 'box-colour', 'aria-label': 'Box colour', value: '000000' });
  const weight = el('select', { id: 'kit-weight', 'aria-label': 'Weight' }, [
    el('option', { value: '400', text: '400' }),
    el('option', { value: '600', text: '600' }),
  ]);

  const main = el('main', { class: 'sheet-area profile' }, [
    el('section', { class: 'panel' }, [
      el('p', { class: 'panel-title', text: 'Availability' }),
      el('div', { class: 'field' }, [el('label', { for: 'availability', text: 'Availability' }), availability]),
      el('button', { type: 'button', 'data-save-availability': '', text: 'Save availability' }),
    ]),
    el('section', { class: 'panel', role: 'region', 'aria-label': 'Read tokens' }, [
      el('p', { class: 'panel-title', text: 'Read tokens' }),
      el('p', { class: 'api-base mono', text: '/api/v1' }),
      el('div', { class: 'field' }, [el('label', { for: 'token-name', text: 'Token name' }), tokenName]),
      el('button', { type: 'button', 'data-new-token': '', text: 'New read token' }),
      el('p', { class: 'token-shown mono', 'data-token-shown': '' }),
      el('div', { 'data-tokens-list': '' }),
    ]),
    el('section', { class: 'panel', role: 'region', 'aria-label': 'Brand kits' }, [
      el('p', { class: 'panel-title', text: 'Brand kits' }),
      el('div', { class: 'field' }, [el('label', { for: 'kit-name', text: 'Kit name' }), kitName]),
      el('div', { class: 'field' }, [el('label', { for: 'text-colour', text: 'Text colour' }), textColour]),
      el('div', { class: 'field' }, [el('label', { for: 'box-colour', text: 'Box colour' }), boxColour]),
      el('div', { class: 'field' }, [el('label', { for: 'kit-weight', text: 'Weight' }), weight]),
      el('button', { type: 'button', 'data-save-kit': '', text: 'Save kit' }),
      el('div', { 'data-kits-list': '' }),
    ]),
    el('section', { class: 'panel', role: 'region', 'aria-label': 'Outbox' }, [
      el('p', { class: 'panel-title', text: 'Outbox' }),
      el('div', { 'data-outbox-list': '' }),
    ]),
  ]);
  mount(band(), noticesStrip(), main);
  renderOutages();
  await Promise.all([renderTokens(), renderKits(), renderOutbox()]);
  window.setInterval(() => void pollTokenWindows(), 1000);

  find<HTMLButtonElement>('[data-save-availability]', main)?.addEventListener('click', () => {
    void put('/api/profile', { availability: availability.value })
      .then(() => notice('Availability saved.'))
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  find<HTMLButtonElement>('[data-new-token]', main)?.addEventListener('click', () => {
    notice('Making token…');
    void post<{ token: string }>('/api/tokens', { name: tokenName.value })
      .then((created) => {
        const shown = find<HTMLElement>('[data-token-shown]', main);
        if (shown !== null) shown.textContent = created.token;
        notice('Copy this token now; it will not be shown again.');
        void renderTokens();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  find<HTMLButtonElement>('[data-save-kit]', main)?.addEventListener('click', () => {
    void post('/api/kits', {
      name: kitName.value,
      text_colour: textColour.value,
      box_colour: boxColour.value,
      font_weight: Number(weight.value),
    })
      .then(() => {
        notice('Brand kit saved.');
        void renderKits();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
}
