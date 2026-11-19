import { announce, el, on } from '../lib/dom.js';
import { LatestOnly, get, put } from '../lib/api.js';
import { COPY, amount, kilometres, wholeNumber } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf } from '../lib/focus.js';
import { setFigure } from '../lib/motion.js';
import { reorderInPlace } from '../lib/flip.js';
import { AREAS, areaAt } from '../lib/areas.js';
import { loadTabState, saveTabState } from '../lib/state.js';
import type { Availability, Cart, Product } from '../lib/types.js';
import type { Screen } from '../router.js';

type Saved = { quantity: string; focusId: string | null };

export function productScreen(params: Record<string, string>): Screen {
  const sku = params['sku'] as string;
  const life = makeLife();
  const ranking = new LatestOnly();
  let cart: Cart | null = null;
  let adding = false;
  let fromDevice = false;

  const cartUpdates = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Cart updates' });
  const shopRanking = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Shop ranking' });

  const title = el('h1', { class: 'screen-title' }, sku);
  const price = el('p', { class: 'product-price-line' });
  const cartTotal = el('span', { class: 'figure cart-total' });

  const quantity = el('input', {
    type: 'number',
    class: 'text-box quantity-box',
    min: '1',
    max: '999',
    step: '1',
    value: '1',
    'aria-label': 'Quantity',
    'aria-describedby': 'quantity-error',
    'data-focus-id': 'quantity',
  });
  const quantityError = el('p', { class: 'field-error', id: 'quantity-error' });
  const addToCart = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'add-to-cart' },
    'Add to cart',
  );

  const areaSelect = el('select', {
    class: 'text-box',
    'aria-label': 'Your area',
    'data-focus-id': 'your-area',
  });
  areaSelect.appendChild(el('option', { value: '' }, 'Choose an area'));
  for (const area of AREAS) areaSelect.appendChild(el('option', { value: area.name }, area.name));

  const useLocation = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'use-my-location' },
    'Use my location',
  );

  const shopList = el('ul', {
    class: 'ranked-shops',
    'aria-label': 'Shops with this item',
    'data-phase': 'settled',
  });

  const itemColumn = el('div', { class: 'product-item' }, [
    title,
    price,
    el('label', { class: 'field' }, [el('span', {}, 'Quantity'), quantity]),
    quantityError,
    addToCart,
    el('p', { class: 'cart-total-line' }, [el('span', {}, 'Cart total: '), cartTotal]),
    cartUpdates,
  ]);

  const sideColumn = el('div', { class: 'product-side' }, [
    el('div', { class: 'area-choice' }, [
      el('label', { class: 'field' }, [el('span', {}, 'Your area'), areaSelect]),
      useLocation,
    ]),
    shopRanking,
    shopList,
  ]);

  const node = el('section', { class: 'product-screen' }, [itemColumn, sideColumn]);

  const itemNodes = new Map<string, HTMLLIElement>();
  const distanceFigures = new Map<string, HTMLElement>();
  const availableFigures = new Map<string, HTMLElement>();

  function remember(): void {
    saveTabState<Saved>(`product.${sku}`, {
      quantity: quantity.value,
      focusId: focusIdOf(document.activeElement),
    });
  }
  life.listen(node, 'focusin', remember);
  on(quantity, 'input', remember);

  function paintCartTotal(next: Cart): void {
    setFigure(cartTotal, 'cart-total', next.total_cents, amount);
  }

  function paintShops(answer: Availability): void {
    const wanted = new Set(answer.shops.map((shop) => shop.store_id));
    for (const [storeId, item] of itemNodes) {
      if (!wanted.has(storeId)) {
        item.remove();
        itemNodes.delete(storeId);
        distanceFigures.delete(storeId);
        availableFigures.delete(storeId);
      }
    }

    const ordered: HTMLElement[] = [];
    answer.shops.forEach((shop, index) => {
      let item = itemNodes.get(shop.store_id);
      if (!item) {
        const distance = el('span', { class: 'figure' });
        const available = el('span', { class: 'figure' });
        const collect = el('button', {
          type: 'button',
          class: 'block-button',
          'data-focus-id': `collect-${shop.store_id}`,
        });
        on(collect, 'click', () => void chooseShop(shop.store_id, collect));
        item = el(
          'li',
          { class: 'ranked-shop', 'data-store-id': shop.store_id },
          [
            el('span', { class: 'shop-name' }, shop.name),
            el('span', { class: 'shop-city' }, shop.city),
            el('span', { class: 'shop-distance' }, [distance, el('span', {}, ' km')]),
            el('span', { class: 'shop-available' }, [available, el('span', {}, ' available')]),
            collect,
          ],
        ) as HTMLLIElement;
        itemNodes.set(shop.store_id, item);
        distanceFigures.set(shop.store_id, distance);
        availableFigures.set(shop.store_id, available);
        shopList.appendChild(item);
      }
      item.dataset['rank'] = String(index + 1);
      setFigure(distanceFigures.get(shop.store_id)!, 'distance', shop.distance_km, kilometres);
      setFigure(availableFigures.get(shop.store_id)!, 'shop-available', shop.available, wholeNumber);
      const collect = item.querySelector('button') as HTMLButtonElement;
      collect.textContent = `Collect from ${shop.name}`;
      collect.setAttribute('aria-label', `Collect from ${shop.name}`);
      collect.setAttribute(
        'aria-pressed',
        cart?.store_id === shop.store_id ? 'true' : 'false',
      );
      ordered.push(item);
    });

    reorderInPlace(shopList, ordered);
  }

  async function loadShops(): Promise<void> {
    const point = cart?.area;
    if (!point) return;
    announce(shopRanking, COPY.rankingShops);
    try {
      await ranking.run(
        () => get<Availability>(`/api/products/${sku}/availability?lat=${point.lat}&lon=${point.lon}`),
        (answer) => {
          paintShops(answer);
          const area = areaAt(point);
          announce(
            shopRanking,
            fromDevice || !area
              ? `${answer.shops.length} shops ranked from your location.`
              : `${answer.shops.length} shops ranked from ${area.name}.`,
          );
        },
      );
    } catch {
      announce(shopRanking, COPY.somethingWrong);
    }
  }

  async function saveArea(lat: number, lon: number, device: boolean): Promise<void> {
    fromDevice = device;
    try {
      cart = await put<Cart>('/api/cart/area', { lat, lon });
      paintCartTotal(cart);
      await loadShops();
    } catch {
      announce(shopRanking, COPY.somethingWrong);
    }
  }

  on(areaSelect, 'change', () => {
    const area = AREAS.find((candidate) => candidate.name === areaSelect.value);
    if (!area) return;
    void saveArea(area.lat, area.lon, false);
  });

  on(useLocation, 'click', () => {
    announce(shopRanking, COPY.rankingShops);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        areaSelect.value = '';
        void saveArea(position.coords.latitude, position.coords.longitude, true);
      },
      () => announce(shopRanking, COPY.somethingWrong),
    );
  });

  async function chooseShop(storeId: string, control: HTMLElement): Promise<void> {
    try {
      cart = await put<Cart>('/api/cart/store', { store_id: storeId });
      paintCartTotal(cart);
      announce(cartUpdates, `Cart total ${amount(cart.total_cents)}.`);
      for (const [id, item] of itemNodes) {
        const collect = item.querySelector('button') as HTMLButtonElement;
        collect.setAttribute('aria-pressed', id === storeId ? 'true' : 'false');
      }
      control.focus();
    } catch {
      announce(cartUpdates, COPY.somethingWrong);
    }
  }

  on(addToCart, 'click', () => {
    const typed = Number(quantity.value);
    if (!Number.isInteger(typed) || typed < 1 || typed > 999) {
      quantityError.textContent = COPY.quantityRange;
      quantity.setAttribute('aria-invalid', 'true');
      return;
    }
    quantityError.textContent = '';
    quantity.removeAttribute('aria-invalid');
    if (adding) return;
    adding = true;
    const already = cart?.lines.find((line) => line.sku === sku)?.quantity ?? 0;
    void put<Cart>(`/api/cart/lines/${sku}`, { quantity: already + typed })
      .then((answer) => {
        cart = answer;
        paintCartTotal(answer);
        announce(cartUpdates, `Cart total ${amount(answer.total_cents)}.`);
        addToCart.focus();
      })
      .catch(() => announce(cartUpdates, COPY.somethingWrong))
      .finally(() => {
        adding = false;
      });
  });

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => {
      const saved = loadTabState<Saved>(`product.${sku}`);
      if (saved) quantity.value = saved.quantity;

      void Promise.all([get<Product>(`/api/products/${sku}`), get<Cart>('/api/cart')]).then(
        ([product, loadedCart]) => {
          title.textContent = product.name;
          price.textContent = amount(Math.round(product.unit_price_milli / 10));
          cart = loadedCart;
          paintCartTotal(loadedCart);
          const area = areaAt(loadedCart.area);
          areaSelect.value = area ? area.name : '';
          fromDevice = loadedCart.area !== null && area === null;
          if (loadedCart.area) void loadShops();
          if (saved) focusByName(node, saved.focusId);
        },
      );
    },
  };
}
