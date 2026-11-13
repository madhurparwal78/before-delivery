import { api } from '../api';
import { el, announce, copy } from '../ui';
import { renderBand, owner } from '../main';
import type { OutboxItem, Kit } from '../../shared/types';

/** Profile: availability, read tokens, brand kits and the outbox. */
export async function renderProfile(root: HTMLElement): Promise<HTMLElement> {
  const main = el('main', null);
  main.append(renderBand(root), noticesStrip());
  const holder = el('div', { class: 'panel' });
  if (!owner()) {
    const session = await api.session();
    holder.append(el('p', { text: session.person.name }), el('p', { class: 'muted', text: session.person.email }));
    const signOut = el('button', { class: 'btn', text: 'Sign out' });
    signOut.addEventListener('click', async () => {
      await api.signOut();
      window.location.href = '/sign-in';
    });
    holder.append(signOut);
    main.append(holder);
    return main;
  }

  const availability = el('input', { type: 'text', 'aria-label': 'Availability' });
  const saveAvailability = el('button', { class: 'btn', text: 'Save availability' });
  const profile = await api.profile();
  availability.value = profile.availability;
  holder.append(el('label', { class: 'field' }, el('span', { text: 'Availability' }), availability), saveAvailability);
  saveAvailability.addEventListener('click', () => {
    void (async () => {
      await api.saveProfile(availability.value);
      announce('Notices', 'Saved.');
    })();
  });

  // Read tokens
  const tokensRegion = el('section', { role: 'region', 'aria-label': 'Read tokens' });
  tokensRegion.append(el('h3', { text: 'Read tokens' }));
  const tokenName = el('input', { type: 'text', 'aria-label': 'Token name' });
  const newToken = el('button', { class: 'btn', text: 'New read token' });
  const tokenList = el('ul', { class: 'list' });
  tokensRegion.append(el('label', { class: 'field' }, el('span', { text: 'Token name' }), tokenName), newToken, tokenList);
  holder.append(tokensRegion);

  // Brand kits
  const kitsRegion = el('section', { role: 'region', 'aria-label': 'Brand kits' });
  kitsRegion.append(el('h3', { text: 'Brand kits' }));
  const kitName = el('input', { type: 'text', 'aria-label': 'Kit name' });
  const textColour = el('input', { type: 'text', 'aria-label': 'Text colour' });
  const boxColour = el('input', { type: 'text', 'aria-label': 'Box colour' });
  const weight = el('select', { 'aria-label': 'Weight' });
  weight.append(el('option', { value: '400', text: '400' }), el('option', { value: '600', text: '600' }));
  const saveKit = el('button', { class: 'btn', text: 'Save kit' });
  const kitList = el('ul', { class: 'list' });
  kitsRegion.append(
    el('label', { class: 'field' }, el('span', { text: 'Kit name' }), kitName),
    el('label', { class: 'field' }, el('span', { text: 'Text colour' }), textColour),
    el('label', { class: 'field' }, el('span', { text: 'Box colour' }), boxColour),
    el('label', { class: 'field' }, el('span', { text: 'Weight' }), weight),
    saveKit, kitList,
  );
  holder.append(kitsRegion);

  // Outbox
  const outboxRegion = el('section', { role: 'region', 'aria-label': 'Outbox' });
  outboxRegion.append(el('h3', { text: 'Outbox' }));
  const outboxList = el('ul', { class: 'list' });
  outboxRegion.append(outboxList);
  holder.append(outboxRegion);
  main.append(holder);

  async function refreshTokens(): Promise<void> {
    const { items } = await api.tokens();
    tokenList.textContent = '';
    if (items.length === 0) tokenList.append(el('li', { class: 'muted', text: 'No read tokens yet.' }));
    for (const token of items) {
      const li = el('li');
      const window = el('span', { 'data-token-window': token.id, text: '0' });
      const revoke = el('button', { class: 'btn', text: `Revoke ${token.name}` });
      revoke.addEventListener('click', () => {
        void (async () => {
          await api.revokeToken(token.id);
          await refreshTokens();
        })();
      });
      li.append(el('span', { text: `${token.name} ` }), window, revoke);
      tokenList.append(li);
    }
  }

  async function refreshKits(): Promise<void> {
    const { items } = await api.kits();
    kitList.textContent = '';
    for (const kit of items as Kit[]) {
      kitList.append(el('li', { text: `${kit.name} · text ${kit.text_colour} · box ${kit.box_colour} · weight ${kit.font_weight}` }));
    }
  }

  async function refreshOutbox(): Promise<void> {
    const { items } = await api.outbox();
    outboxList.textContent = '';
    if (items.length === 0) outboxList.append(el('li', { class: 'muted', text: 'The outbox is empty.' }));
    for (const item of items as OutboxItem[]) {
      outboxList.append(el('li', { text: `${item.subject} → ${item.to} ${item.state}` }));
    }
  }

  newToken.addEventListener('click', () => {
    void (async () => {
      announce('Notices', copy.makingToken());
      const token = await api.newToken(tokenName.value);
      announce('Notices', copy.tokenMade());
      const mono = el('code', { text: token.token, style: 'font-family: Sometype Mono, monospace;' });
      tokenList.prepend(el('li', null, mono));
      await refreshTokens();
    })();
  });

  saveKit.addEventListener('click', () => {
    void (async () => {
      try {
        await api.saveKit(kitName.value, textColour.value, boxColour.value, Number(weight.value));
        await refreshKits();
      } catch {
        announce('Notices', 'Check the highlighted fields.');
      }
    })();
  });

  await Promise.all([refreshTokens(), refreshKits(), refreshOutbox()]);
  return main;
}

function noticesStrip(): HTMLElement {
  return el('div', { role: 'status', 'aria-label': 'Notices', id: 'status-notices', class: 'notices' });
}
