import { api, ApiFailure } from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { refreshMe } from '../store.js';
import { coinTheme, strikerShape, boardTheme } from '../board.js';
import { KIND_TABS } from '../../shared/catalogue.js';
import type { ItemKind } from '../../shared/catalogue.js';
import { svg } from '../dom.js';
import { topbar } from './shell.js';

interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
  owned: boolean;
  equipped: boolean;
}

interface ShopBody {
  chalk: number;
  items: ShopItem[];
}

function swatch(item: ShopItem): SVGElement {
  if (item.kind === 'striker') {
    const { group } = strikerShape(item.id);
    group.setAttribute('transform', 'translate(50 50) scale(1.6)');
    return svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [group]);
  }
  if (item.kind === 'board') {
    const theme = boardTheme(item.id);
    return svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [
      svg('rect', { width: 100, height: 100, fill: theme.frame }),
      svg('rect', { x: 10, y: 10, width: 80, height: 80, fill: theme.ply, stroke: theme.line, 'stroke-width': 2 }),
      svg('circle', { cx: 50, cy: 50, r: 18, fill: 'none', stroke: theme.line, 'stroke-width': 2 }),
    ]);
  }
  const theme = coinTheme(item.id);
  return svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [
    svg('circle', { cx: 32, cy: 50, r: 18, fill: theme.white, stroke: theme.edge, 'stroke-width': 2 }),
    svg('circle', { cx: 68, cy: 50, r: 18, fill: theme.black, stroke: theme.edge, 'stroke-width': 2 }),
    svg('circle', { cx: 50, cy: 26, r: 12, fill: theme.queen, stroke: theme.edge, 'stroke-width': 2 }),
  ]);
}

export async function renderShop(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  let shop: ShopBody = { chalk: 0, items: [] };
  try {
    shop = await api.get<ShopBody>('/api/shop');
  } catch {
    shop = { chalk: 0, items: [] };
  }

  const keys = new Map<string, string>();
  const chalkLabel = el('span', { id: 'shop-chalk', class: 'num', text: `${shop.chalk} chalk` });
  const alert = el('div', { role: 'alert', class: 'inline-error' });
  const panels = new Map<ItemKind, HTMLElement>();
  const tabs: HTMLElement[] = [];
  let active: ItemKind = 'striker';

  function idempotencyKey(itemId: string): string {
    let key = keys.get(itemId);
    if (key === undefined) {
      key = `buy-${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      keys.set(itemId, key);
    }
    return key;
  }

  function paint(): void {
    for (const [kind, panel] of panels) {
      clear(panel);
      const tiles = el('div', { class: 'tiles' });
      for (const item of shop.items.filter((entry) => entry.kind === kind)) {
        tiles.append(tile(item));
      }
      panel.append(tiles);
    }
    chalkLabel.textContent = `${shop.chalk} chalk`;
    const balance = document.getElementById('chalk-balance');
    if (balance !== null) balance.textContent = `${shop.chalk} chalk`;
  }

  function tile(item: ShopItem): HTMLElement {
    const article = el('article', { 'aria-label': item.name, class: 'tile' }, [
      swatch(item),
      el('h2', { text: item.name, style: 'font-size: var(--step-1)' }),
      el('p', { class: 'num', text: `${item.price} chalk` }),
    ]);

    if (item.equipped) {
      article.append(el('button', { type: 'button', text: 'Equipped', 'aria-pressed': 'true', disabled: true }));
      return article;
    }
    if (item.owned) {
      const equip = el('button', { type: 'button', text: `Equip ${item.name}` });
      equip.addEventListener('click', () => {
        void (async () => {
          equip.disabled = true;
          try {
            await api.post('/api/shop/equip', { itemId: item.id });
            shop = await api.get<ShopBody>('/api/shop');
            paint();
          } catch {
            equip.disabled = false;
          }
        })();
      });
      article.append(equip);
      return article;
    }

    const short = shop.chalk < item.price;
    const shortfall = `Need ${item.price - shop.chalk} more`;
    const buy = el('button', {
      type: 'button',
      text: short ? shortfall : `Buy ${item.name}`,
      'aria-label': short ? `Buy ${item.name} ${shortfall}` : null,
      disabled: short,
      'data-locked': short ? 'true' : null,
      'data-needs-online': 'true',
    });
    buy.addEventListener('click', () => {
      void (async () => {
        clear(alert);
        buy.disabled = true;
        try {
          const result = await api.post<{ chalk: number }>('/api/shop/purchase', {
            itemId: item.id,
            idempotencyKey: idempotencyKey(item.id),
          });
          keys.delete(item.id);
          shop = await api.get<ShopBody>('/api/shop');
          shop.chalk = result.chalk;
          paint();
        } catch (failure) {
          buy.disabled = false;
          if (failure instanceof ApiFailure && failure.code !== 'ALREADY_OWNED') {
            alert.append(icon('circle-alert'), el('span', { text: 'Purchase failed. No chalk was taken.' }));
          }
        }
      })();
    });
    article.append(buy);
    return article;
  }

  function selectTab(kind: ItemKind, focus: boolean): void {
    active = kind;
    KIND_TABS.forEach((entry, index) => {
      const tab = tabs[index];
      const selected = entry.kind === kind;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      const panel = panels.get(entry.kind);
      if (panel !== undefined) panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }

  const tablist = el('div', { role: 'tablist', 'aria-label': 'Item kinds', class: 'tabs' });
  for (const entry of KIND_TABS) {
    const panel = el('div', { role: 'tabpanel', id: `panel-${entry.kind}`, 'aria-label': entry.label, tabindex: '0' });
    panels.set(entry.kind, panel);
    const tab = el('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${entry.kind}`,
      'aria-controls': `panel-${entry.kind}`,
      'aria-selected': 'false',
      tabindex: '-1',
      text: entry.label,
    });
    tab.addEventListener('click', () => selectTab(entry.kind, false));
    tabs.push(tab);
    tablist.append(tab);
  }

  tablist.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = KIND_TABS.findIndex((entry) => entry.kind === active);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    selectTab(KIND_TABS[(index + step + KIND_TABS.length) % KIND_TABS.length].kind, true);
  });

  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: 'Shop', style: 'font-size: var(--step-4)' }),
        el('p', {}, [chalkLabel]),
        alert,
        tablist,
        ...panels.values(),
      ]),
    ]),
  );
  paint();
  selectTab('striker', false);
}
