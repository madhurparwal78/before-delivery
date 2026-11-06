import { post } from '../api.js';
import { el, formatCents, svgIcon } from '../dom.js';
import { openCartDrawer } from '../shell.js';
import { cachedCart, loadCart, loadCatalog, setCart } from '../store.js';
import { field, openDialog, sectionReveal } from '../ui.js';
import type { AccessoryItem, Cart, ComponentItem } from '../types.js';

const BOARD_FACTS: Record<string, { eyebrow: string; description: string; material: string; battery: string; rideTime: string }> = {
  Drift: {
    eyebrow: 'First flights',
    description: 'A forgiving deck and a broad wing for your very first lift-off.',
    material: 'Glass-wrapped EPS core',
    battery: '1.8 kWh pack',
    rideTime: 'Up to 70 min',
  },
  Crest: {
    eyebrow: 'Longest range',
    description: 'The long-range tourer: a bigger pack and a swept wing for open water.',
    material: 'Carbon sandwich hull',
    battery: '2.2 kWh pack',
    rideTime: 'Up to 80 min',
  },
  Swift: {
    eyebrow: 'Lightest carry',
    description: 'The lightest board in the workshop, built for quick turns and a one-arm carry.',
    material: 'Full carbon shell',
    battery: '1.0 kWh pack',
    rideTime: 'Up to 35 min',
  },
};

function outOfStockBadge(): HTMLElement {
  return el('span', { class: 'badge' }, 'Out of Stock');
}

function fitsLine(fits: string[]): HTMLElement {
  const order = ['Drift', 'Crest', 'Swift'];
  const sorted = order.filter((board) => fits.includes(board));
  return el('p', { class: 'caption' }, `Fits: ${sorted.join(', ')}`);
}

interface SellableItem {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
  fits?: string[];
}

function quantityInCart(cart: Cart | null, sku: string): number {
  return cart?.lines.filter((line) => line.type === 'accessory' && line.sku === sku).reduce((sum, line) => sum + line.quantity, 0) ?? 0;
}

function openProductDialog(item: SellableItem, opener: HTMLElement): void {
  const inCart = quantityInCart(cachedCart(), item.sku);
  const quantity = field('Quantity', 'text', { type: 'number', min: '1', max: '5', value: '1', helper: `(${inCart} in cart)` });
  const add = el('button', { class: 'btn', type: 'button', disabled: !item.in_stock }, 'Add to cart');
  const alert = el('div', { class: 'alert-region', role: 'alert' });

  const dialog = openDialog({
    title: item.name,
    opener,
    content: [
      alert,
      el('p', {}, `Price ${formatCents(item.price_cents)}`),
      item.fits ? fitsLine(item.fits) : null,
      item.in_stock ? null : outOfStockBadge(),
      quantity.wrapper,
      add,
    ],
  });

  add.addEventListener('click', async () => {
    alert.textContent = '';
    quantity.setError(null);
    add.disabled = true;
    add.textContent = 'Adding...';
    const result = await post<Cart>('/api/cart/lines', {
      type: 'accessory',
      sku: item.sku,
      quantity: Number(quantity.control.value),
    });
    add.disabled = false;
    add.textContent = 'Add to cart';
    if (!result.ok) {
      const body = result.body as unknown as { message: string; fields?: Record<string, string> };
      alert.textContent = body.message;
      return;
    }
    setCart(result.body);
    dialog.close();
    openCartDrawer(item.name, opener);
  });
}

function productCard(item: SellableItem): HTMLElement {
  const card = el('button', { class: 'card card-button stack', type: 'button' }, [
    el('h3', {}, item.name),
    el('p', { style: 'margin:0' }, `Price ${formatCents(item.price_cents)}`),
    item.as_low_as_cents === null
      ? null
      : el('p', { class: 'financing-line', 'data-monthly-cents': item.as_low_as_cents }, `As low as ${formatCents(item.as_low_as_cents)}/mo`),
    item.fits ? fitsLine(item.fits) : null,
    item.in_stock ? null : outOfStockBadge(),
  ]);
  card.addEventListener('click', () => openProductDialog(item, card));
  return card;
}

export async function renderBoards(main: HTMLElement): Promise<void> {
  const catalog = await loadCatalog();
  await loadCart();
  const bands: HTMLElement[] = [];

  for (const board of ['Drift', 'Crest', 'Swift']) {
    const facts = BOARD_FACTS[board]!;
    const sizes = catalog.boards.filter((item) => item.name.startsWith(`${board} `));
    const lowest = Math.min(...sizes.map((item) => item.price_cents));
    const cheapest = sizes.find((item) => item.price_cents === lowest);
    const firstSku = sizes[0]?.sku ?? '';
    const band = el('section', { class: 'band wrap', id: board.toLowerCase() }, [
      el('p', { class: 'eyebrow' }, facts.eyebrow),
      el('h2', {}, board),
      el('p', {}, facts.description),
      el('div', { class: 'grid grid-2' }, [
        el('div', {}, [
          el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Material'), el('span', {}, facts.material)]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Battery'), el('span', {}, facts.battery)]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'Ride time'), el('span', {}, facts.rideTime)]),
          el('div', { class: 'spec-row' }, [el('span', { class: 'caption' }, 'From'), el('span', {}, formatCents(lowest))]),
          cheapest?.as_low_as_cents == null
            ? null
            : el('p', { class: 'financing-line', 'data-monthly-cents': cheapest.as_low_as_cents },
                `As low as ${formatCents(cheapest.as_low_as_cents)}/mo`),
        ]),
        el(
          'ul',
          { class: 'stack', style: 'list-style:none;padding:0;margin:0' },
          sizes.map((size) =>
            el('li', { class: 'row' }, [
              el('span', { style: 'font-weight:600' }, `${size.name}`),
              el('span', { class: 'muted' }, `Finish ${size.finish}`),
              el('span', {}, formatCents(size.price_cents)),
              size.in_stock ? null : outOfStockBadge(),
            ]),
          ),
        ),
      ]),
      el('div', { class: 'row' }, [
        el('a', { href: `/build?board=${firstSku}`, class: 'btn', 'aria-label': `Build yours, ${board}` }, ['Build yours', svgIcon('arrow')]),
        el('a', { href: '/locations', class: 'btn btn-secondary', 'aria-label': `Find a demo, ${board}` }, 'Find a demo'),
      ]),
    ]);
    bands.push(band);
  }

  const rows: [string, (board: string) => string][] = [
    ['Eyebrow', (board) => BOARD_FACTS[board]!.eyebrow],
    ['Material', (board) => BOARD_FACTS[board]!.material],
    ['Battery', (board) => BOARD_FACTS[board]!.battery],
    ['Ride time', (board) => BOARD_FACTS[board]!.rideTime],
    ['Sizes', (board) => catalog.boards.filter((item) => item.name.startsWith(`${board} `)).map((item) => item.size).join(', ')],
    ['From', (board) => formatCents(Math.min(...catalog.boards.filter((item) => item.name.startsWith(`${board} `)).map((item) => item.price_cents)))],
  ];

  const table = el('section', { class: 'band band-surface' }, [
    el('div', { class: 'wrap' }, [
      el('h2', {}, 'Compare all boards'),
      el('div', { class: 'table-scroll' }, el('table', {}, [
        el('thead', {}, el('tr', {}, [el('th', { scope: 'col' }, 'Specification'), ...['Drift', 'Crest', 'Swift'].map((board) => el('th', { scope: 'col' }, board))])),
        el('tbody', {}, rows.map(([label, value]) =>
          el('tr', {}, [el('th', { scope: 'row' }, label), ...['Drift', 'Crest', 'Swift'].map((board) => el('td', {}, value(board)))]),
        )),
      ])),
    ]),
  ]);

  main.replaceChildren(el('section', { class: 'band wrap' }, [el('h1', {}, 'The Tern Foils lineup'), el('p', {}, 'Three boards, one snap-fit parts system.')]), ...bands, table);
  for (const band of bands) sectionReveal(band);
  if (window.location.hash) {
    const anchor = document.getElementById(window.location.hash.slice(1));
    anchor?.scrollIntoView();
  }
}

export async function renderFoilBoards(main: HTMLElement): Promise<void> {
  const catalog = await loadCatalog();
  await loadCart();
  const boards = catalog.accessories.filter((item: AccessoryItem) => item.sku.startsWith('SFB-'));
  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Foil boards'),
      el('p', {}, 'Unpowered boards for prone, wing and towed riding.'),
      el('div', { class: 'grid grid-3' }, boards.map((item) => productCard(item))),
    ]),
  );
}

export async function renderParts(main: HTMLElement): Promise<void> {
  const catalog = await loadCatalog();
  await loadCart();
  const masts = catalog.components.filter((item: ComponentItem) => item.slot === 'mast');
  const wings = catalog.components.filter((item: ComponentItem) => item.slot === 'wing');
  const others = catalog.components.filter((item: ComponentItem) => item.slot !== 'mast' && item.slot !== 'wing');

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Parts'),
      el('p', {}, 'Every SnapFit part in the system, sold on its own.'),
      el('h2', {}, 'Masts'),
      el('div', { class: 'grid grid-3' }, masts.map((item) => productCard(item))),
    ]),
    el('section', { class: 'band band-surface', id: 'wings' }, [
      el('div', { class: 'wrap stack' }, [
        el('h2', {}, 'Wings'),
        el('div', { class: 'grid grid-2' }, wings.map((item) => productCard(item))),
      ]),
    ]),
    el('section', { class: 'band wrap stack' }, [
      el('h2', {}, 'Drives, packs and controllers'),
      el('div', { class: 'grid grid-3' }, others.map((item) => productCard(item))),
    ]),
    el('section', { class: 'band band-surface', id: 'accessories' }, [
      el('div', { class: 'wrap stack' }, [
        el('h2', {}, 'Accessories'),
        el('div', { class: 'grid grid-3' }, catalog.accessories.filter((item) => item.sku.startsWith('ACC-')).map((item) => productCard(item))),
      ]),
    ]),
  );
  if (window.location.hash === '#wings') document.getElementById('wings')?.scrollIntoView();
}
