import { SHOP_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { attachDialogKeys, clear, el, focusableIn, labelledButton, statusRegion } from '../dom.js';
import { type Screen } from '../navigate.js';
import { refreshMe, state } from '../state.js';

interface ShopItem {
  id: string;
  kind: 'cue' | 'cloth';
  name: string;
  currency: 'coins' | 'cash';
  price: number;
  minLevel: number;
  aim: number;
  power: number;
  spin: number;
  time: number;
  owned: boolean;
  equipped: boolean;
}

interface ShopPack {
  id: string;
  name: string;
  cash: number;
  priceUsd: string;
}

interface ShopBody {
  items: ShopItem[];
  packs: ShopPack[];
}

const TABS = ['Cues', 'Cash cues', 'Cloths', 'Cash packs'] as const;
type Tab = (typeof TABS)[number];

export function shopScreen(): Screen {
  const notice = statusRegion('Shop notice', 'notice shop-notice');
  const grid = el('div', { className: 'shop-grid' });
  const tablist = el('div', { className: 'tablist', attrs: { role: 'tablist', 'aria-label': 'Shop sections' } });
  let active: Tab = 'Cues';
  let body: ShopBody | null = null;

  const tabButtons = TABS.map((name) => {
    const tab = el('button', {
      className: 'tab',
      text: name,
      attrs: { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1' },
    });
    tab.addEventListener('click', () => select(name));
    tab.addEventListener('focus', () => select(name));
    tab.addEventListener('keydown', (event) => {
      const index = TABS.indexOf(name);
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        if (next) {
          select(next);
          tabButtons[TABS.indexOf(next)]?.focus();
        }
      }
    });
    tablist.append(tab);
    return tab;
  });

  function select(name: Tab): void {
    if (active !== name) notice.textContent = '';
    active = name;
    tabButtons.forEach((tab, index) => {
      const selected = TABS[index] === name;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    render();
  }

  async function load(): Promise<void> {
    const result = await api<ShopBody>('GET', '/api/shop');
    if (!result.ok) return;
    body = result.data;
    render();
  }

  function itemsFor(tab: Tab): ShopItem[] {
    if (!body) return [];
    if (tab === 'Cues') return body.items.filter((item) => item.kind === 'cue' && item.currency === 'coins');
    if (tab === 'Cash cues') return body.items.filter((item) => item.kind === 'cue' && item.currency === 'cash');
    if (tab === 'Cloths') return body.items.filter((item) => item.kind === 'cloth');
    return [];
  }

  function equippedCue(): ShopItem | undefined {
    return body?.items.find((item) => item.id === state.me?.equippedCueId);
  }

  function statRows(item: ShopItem): HTMLElement[] {
    const rows: [string, string][] = [
      ['Aim', `Aim +${num(item.aim)}%`],
      ['Power', `Power +${num(item.power)}%`],
      ['Spin', `Spin +${num(item.spin)}%`],
      ['Time', `Time +${num(item.time)} s`],
    ];
    return rows.map(([key, text]) => {
      const value = key === 'Aim' ? item.aim : key === 'Power' ? item.power : key === 'Spin' ? item.spin : item.time;
      const bar = el('span', { className: 'stat-bar' });
      bar.style.setProperty('--fill', `${Math.min(100, value * 4)}%`);
      return el('p', { className: 'stat-row', children: [bar, el('span', { className: 'stat-text', text })] });
    });
  }

  function openItem(item: ShopItem, opener: HTMLElement): void {
    const notices: string[] = [];
    const me = state.me;
    const held = item.currency === 'coins' ? me?.coins ?? 0 : me?.cash ?? 0;
    const levelLocked = (me?.level ?? 1) < item.minLevel;
    const short = held < item.price;
    if (levelLocked) notices.push(SHOP_COPY.levelLocked(item.minLevel));
    else if (short) notices.push(SHOP_COPY.shortFunds(item.price - held, item.currency === 'coins' ? 'Coins' : 'Cash'));
    notice.textContent = notices[0] ?? '';

    const dialog = el('div', {
      className: 'dialog shop-dialog',
      attrs: { role: 'dialog', 'aria-label': item.name },
    });
    const backdrop = el('div', { className: 'backdrop', children: [dialog] });

    const close = (): void => {
      detachKeys();
      backdrop.remove();
      if (notices.length > 0) notice.textContent = '';
      const target = document.contains(opener) ? opener : grid.querySelector<HTMLElement>(`[aria-label="${item.name}"]`);
      target?.focus();
    };

    const equipButton = labelledButton('Equip', () => void equip(item), { className: 'button' });
    equipButton.disabled = item.equipped;
    const buyButton = labelledButton(
      `Buy for ${num(item.price)} ${item.currency === 'coins' ? 'Coins' : 'Cash'}`,
      () => void buy(item),
      { className: 'button primary' },
    );
    buyButton.disabled = levelLocked || short;

    const compare = el('div', { className: 'compare', attrs: { role: 'region', 'aria-label': 'Compare' } });
    if (item.kind === 'cue') {
      const current = equippedCue();
      compare.append(...statRows(item), el('p', { className: 'compare-current', text: `Equipped: ${current?.name ?? ''}` }));
      if (current) compare.append(...statRows(current));
    } else {
      compare.hidden = true;
    }

    dialog.append(
      el('h2', { text: item.name }),
      el('p', { className: 'item-state', text: item.equipped ? SHOP_COPY.equippedMark : item.owned ? SHOP_COPY.owned : '' }),
      item.owned ? equipButton : buyButton,
      compare,
      labelledButton('Close', close, { className: 'button quiet' }),
    );

    const detachKeys = attachDialogKeys(dialog, { onEscape: close });

    async function buy(target: ShopItem): Promise<void> {
      buyButton.disabled = true;
      const result = await api<{ coins: number; cash: number }>('POST', `/api/shop/items/${target.id}/buy`);
      if (!result.ok) {
        notice.textContent = result.failure.message;
        buyButton.disabled = false;
        return;
      }
      notice.textContent = SHOP_COPY.bought(target.name);
      await refreshMe();
      await load();
      buyButton.replaceWith(equipButton);
      equipButton.disabled = false;
      equipButton.focus();
    }

    async function equip(target: ShopItem): Promise<void> {
      const result = await api<{ equippedCueId: string }>('POST', `/api/shop/items/${target.id}/equip`);
      if (!result.ok) {
        notice.textContent = result.failure.message;
        return;
      }
      notice.textContent = SHOP_COPY.equipped(target.name);
      equipButton.disabled = true;
      await refreshMe();
      await load();
    }

    document.body.append(backdrop);
    focusableIn(dialog)[0]?.focus();
  }

  function openPackDialog(pack: ShopPack, opener: HTMLElement): void {
    notice.textContent = '';
    const dialog = el('div', { className: 'dialog pay-dialog', attrs: { role: 'dialog', 'aria-label': 'Buy Cash' } });
    const backdrop = el('div', { className: 'backdrop', children: [dialog] });
    let confirming = false;

    const close = (): void => {
      detachKeys();
      backdrop.remove();
      focusPackButton(pack, opener);
    };

    const payButton = labelledButton(`Pay $${pack.priceUsd}`, () => void pay(), { className: 'button primary' });
    const cancelButton = labelledButton('Cancel', close, { className: 'button quiet' });

    async function pay(): Promise<void> {
      confirming = true;
      payButton.disabled = true;
      cancelButton.disabled = true;
      notice.textContent = SHOP_COPY.confirming;
      const key = crypto.randomUUID();
      const result = await api<{ cash: number; receipt: 'sent' | 'delayed' }>(
        'POST',
        `/api/shop/cash-packs/${pack.id}/purchase`,
        undefined,
        { 'Idempotency-Key': key },
      );
      confirming = false;
      detachKeys();
      backdrop.remove();
      focusPackButton(pack, opener);
      if (result.ok) {
        notice.textContent =
          result.data.receipt === 'sent'
            ? SHOP_COPY.cashAdded(pack.cash, state.me?.email ?? '')
            : SHOP_COPY.cashAddedDelayed(pack.cash);
        await refreshMe();
        await load();
        return;
      }
      notice.textContent = result.failure.error === 'payments_unavailable' ? SHOP_COPY.paymentsDown : result.failure.message;
    }

    dialog.append(
      el('h2', { text: pack.name }),
      el('p', { text: `${num(pack.cash)} Cash` }),
      payButton,
      cancelButton,
    );
    const detachKeys = attachDialogKeys(dialog, {
      onEscape: () => {
        if (!confirming) close();
      },
    });
    document.body.append(backdrop);
    payButton.focus();
  }

  function focusPackButton(pack: ShopPack, opener: HTMLElement): void {
    const target = document.contains(opener) ? opener : grid.querySelector<HTMLElement>(`[aria-label="Buy ${pack.name}"]`);
    target?.focus();
  }

  async function resendVerification(): Promise<void> {
    const result = await api<{ status: string }>('POST', '/api/auth/resend-verification');
    notice.textContent = result.ok ? SHOP_COPY.resent(state.me?.email ?? '') : SHOP_COPY.mailDown;
  }

  function render(): void {
    clear(grid);
    if (active === 'Cash packs') {
      const me = state.me;
      if (me?.minor) notice.textContent = SHOP_COPY.underEighteen;
      else if (me && !me.emailVerified) notice.textContent = SHOP_COPY.unverified;
      for (const pack of body?.packs ?? []) {
        const card = el('div', {
          className: 'shop-card',
          children: [
            el('h2', { text: pack.name }),
            el('p', { text: `${num(pack.cash)} Cash` }),
            el('p', { text: `$${pack.priceUsd}` }),
          ],
        });
        if (me && !me.minor && me.emailVerified) {
          const button = labelledButton(`Buy ${pack.name}`, () => openPackDialog(pack, button), { className: 'button primary' });
          card.append(button);
        }
        grid.append(card);
      }
      if (state.me && !state.me.minor && !state.me.emailVerified) {
        grid.append(labelledButton('Resend verification', () => void resendVerification(), { className: 'button' }));
      }
      return;
    }
    for (const item of itemsFor(active)) {
      const button = labelledButton(item.name, () => openItem(item, button), {
        className: 'shop-card',
        children: [el('span', { className: 'card-name', text: item.name })],
      });
      grid.append(
        el('div', {
          className: 'card-wrap',
          children: [
            button,
            el('span', {
              className: 'card-price',
              text: `${num(item.price)} ${item.currency === 'coins' ? 'Coins' : 'Cash'}`,
            }),
            el('span', {
              className: 'card-state',
              text: item.equipped ? SHOP_COPY.equippedMark : item.owned ? SHOP_COPY.owned : '',
            }),
          ],
        }),
      );
    }
  }

  select('Cues');
  void load();

  return {
    element: el('div', {
      className: 'shop',
      children: [
        el('h1', { className: 'screen-heading', text: 'Shop', attrs: { tabindex: '-1' } }),
        tablist,
        notice,
        grid,
      ],
    }),
    update: render,
  };
}
