import { ApiError, api, appConfig, cartAnnounce, escapeHtml, qs, qsa, rupees, showToast } from './core.js';
import { closeDialog, openDialog } from './dialog.js';
import { updateHeaderCounts } from './live.js';

export type CartLine = {
  id: string;
  sku: string;
  product: string;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  available: number;
  badge: string;
};

export type Cart = {
  count: number;
  lines: CartLine[];
  discount: { code: string; kind: string; value: number } | null;
  gift_card: { last4: string; balance: number } | null;
  shipping_method: string;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  notices: string[];
};

let lastRemoved: { sku: string; quantity: number; product: string } | null = null;
let undoTimer = 0;

export function variantLabel(line: CartLine): string {
  return `${line.product} — ${line.colour}, ${line.size}`;
}

function lineMarkup(line: CartLine): string {
  return `
<div role="group" aria-label="${escapeHtml(variantLabel(line))}" class="bag-line" data-line="${escapeHtml(line.id)}">
  <p>${escapeHtml(line.product)}</p>
  <label class="visually-hidden" for="qty-${escapeHtml(line.id)}">Quantity</label>
  <input id="qty-${escapeHtml(line.id)}" type="number" min="1" max="10" step="1" value="${line.quantity}"
         aria-label="Quantity" data-quantity>
  <p>${escapeHtml(rupees(line.line_subtotal))}</p>
  <button type="button" data-remove-line>Remove ${escapeHtml(line.product)}</button>
</div>`;
}

function totalsMarkup(cart: Cart): string {
  const totals = cart.totals;
  return `
  <p><span>Subtotal</span> <span data-total="subtotal">${escapeHtml(rupees(totals.subtotal))}</span></p>
  <p><span>Discount</span> <span data-total="discount">${escapeHtml(
    totals.discount === 0 ? rupees(0) : `-${rupees(totals.discount)}`
  )}</span></p>
  <p><span>Shipping</span> <span data-total="shipping">${escapeHtml(
    totals.shipping === 0 ? 'Free' : rupees(totals.shipping)
  )}</span></p>
  <p><span>Tax</span> <span data-total="tax">${escapeHtml(rupees(totals.tax))}</span></p>
  <p><span>Gift card</span> <span data-total="gift_card">${escapeHtml(
    totals.gift_card === 0 ? rupees(0) : `-${rupees(totals.gift_card)}`
  )}</span></p>
  <p><span>Total</span> <span data-total="total">${escapeHtml(rupees(totals.total))}</span></p>
  ${
    cart.gift_card === null
      ? ''
      : `<p data-gift-remainder>Gift card balance after this order: ${escapeHtml(
          rupees(Math.max(0, cart.gift_card.balance - totals.gift_card))
        )}</p>`
  }`;
}

export function renderCart(cart: Cart): void {
  for (const holder of qsa<HTMLElement>('[data-bag-lines]')) {
    holder.innerHTML =
      cart.lines.length === 0
        ? '<section class="panel colour-panel"><p>Your bag is empty.</p><a href="/collections/all">Browse collections</a></section>'
        : cart.lines.map(lineMarkup).join('');
  }
  for (const holder of qsa<HTMLElement>('[data-bag-totals]')) {
    holder.innerHTML = totalsMarkup(cart);
  }
  for (const holder of qsa<HTMLElement>('[data-code-applied]')) {
    holder.innerHTML = `
      ${
        cart.discount === null
          ? ''
          : `<button type="button" data-remove-code="${escapeHtml(cart.discount.code)}">Remove code ${escapeHtml(
              cart.discount.code
            )}</button>`
      }
      ${cart.gift_card === null ? '' : '<button type="button" data-remove-gift-card>Remove gift card</button>'}`;
  }
  updateHeaderCounts({ cart: cart.count });
  for (const notice of cart.notices) cartAnnounce(notice);
}

export async function refreshCart(): Promise<Cart> {
  const cart = await api<Cart>('/api/cart');
  renderCart(cart);
  return cart;
}

function showUndo(product: string): void {
  const seconds = appConfig().cart_undo_seconds ?? 6;
  for (const holder of qsa<HTMLElement>('[data-bag-undo]')) {
    holder.innerHTML = '<button type="button" data-undo>Undo</button>';
  }
  cartAnnounce(`Removed ${product}. Undo available for ${seconds} seconds.`);
  showToast(`Removed ${product}. Undo available for ${seconds} seconds.`, true);
  window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    for (const holder of qsa<HTMLElement>('[data-bag-undo]')) holder.innerHTML = '';
    lastRemoved = null;
  }, seconds * 1000);
}

export async function addToBag(sku: string, quantity: number, label: string): Promise<void> {
  const cart = await api<Cart>('/api/cart/lines', { method: 'POST', body: { sku, quantity } });
  renderCart(cart);
  cartAnnounce(`Added ${label} to your bag. Bag total ${rupees(cart.totals.total)}.`);
}

async function applyCode(input: HTMLInputElement): Promise<void> {
  const code = input.value.trim();
  const errorHolder = qs<HTMLElement>('[data-code-error]', input.closest('form') ?? document);
  if (errorHolder !== null) errorHolder.textContent = '';
  try {
    const cart = await api<Cart>('/api/cart/codes', { method: 'POST', body: { code } });
    renderCart(cart);
    if (cart.gift_card !== null && code.toUpperCase().startsWith('RHGC-')) {
      cartAnnounce(
        `Gift card ending ${cart.gift_card.last4} applied. Balance ${rupees(cart.gift_card.balance)}.`
      );
    } else {
      cartAnnounce(`Code ${code.toUpperCase()} applied.`);
    }
  } catch (error) {
    if (error instanceof ApiError && errorHolder !== null) {
      errorHolder.textContent = error.body.fields?.code ?? error.body.message;
      errorHolder.setAttribute('role', 'alert');
    }
  } finally {
    input.focus();
  }
}

export function setupBag(): void {
  const bagButton = qs<HTMLElement>('[data-bag-open]');
  if (bagButton !== null) {
    bagButton.addEventListener('click', () => {
      const drawer = qs<HTMLElement>('[data-dialog="bag"]');
      if (drawer === null) {
        qs<HTMLElement>('[data-bag-lines]')?.scrollIntoView();
        return;
      }
      void refreshCart().finally(() => openDialog('bag', bagButton));
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const quickAdd = target.closest<HTMLElement>('[data-quick-add]');
    if (quickAdd !== null) {
      event.preventDefault();
      void quickAddFromCard(quickAdd);
      return;
    }

    const remove = target.closest<HTMLElement>('[data-remove-line]');
    if (remove !== null) {
      event.preventDefault();
      const group = remove.closest<HTMLElement>('[data-line]');
      if (group === null) return;
      void removeLine(group.dataset.line ?? '');
      return;
    }

    const undo = target.closest<HTMLElement>('[data-undo]');
    if (undo !== null) {
      event.preventDefault();
      void undoRemove();
      return;
    }

    const removeCode = target.closest<HTMLElement>('[data-remove-code]');
    if (removeCode !== null) {
      event.preventDefault();
      void api<Cart>('/api/cart/discount', { method: 'DELETE' }).then(renderCart);
      return;
    }

    const removeGift = target.closest<HTMLElement>('[data-remove-gift-card]');
    if (removeGift !== null) {
      event.preventDefault();
      void api<Cart>('/api/cart/gift-card', { method: 'DELETE' }).then(renderCart);
      return;
    }

    const checkOut = target.closest<HTMLAnchorElement>('[data-check-out]');
    if (checkOut !== null) {
      event.preventDefault();
      void startCheckout();
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLElement | null;
    if (form === null || !form.matches('[data-code-form]')) return;
    event.preventDefault();
    const input = qs<HTMLInputElement>('[data-code-input]', form);
    if (input !== null) void applyCode(input);
  });

  document.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null || !target.matches('[data-quantity]')) return;
    const group = target.closest<HTMLElement>('[data-line]');
    if (group === null) return;
    const quantity = Number((target as HTMLInputElement).value);
    void api<Cart>(`/api/cart/lines/${group.dataset.line}`, { method: 'PATCH', body: { quantity } })
      .then((cart) => {
        renderCart(cart);
        cartAnnounce(`Quantity updated to ${quantity}.`);
      })
      .catch(() => undefined);
  });
}

async function quickAddFromCard(button: HTMLElement): Promise<void> {
  const card = button.closest<HTMLElement>('[data-card]');
  if (card === null) return;
  const slug = card.dataset.card ?? '';
  const colour = qs<HTMLElement>('[role="radio"][aria-checked="true"]', card)?.dataset.colour ?? '';
  button.setAttribute('disabled', '');
  const original = button.textContent ?? '';
  button.textContent = 'Adding';
  try {
    const product = await api<{
      name: string;
      variants: Array<{ sku: string; colour_slug: string; colour: string; size: string }>;
    }>(`/api/products/${slug}`);
    const variant =
      product.variants.find((item) => item.colour_slug === colour) ?? product.variants[0];
    await addToBag(variant.sku, 1, `${product.name} — ${variant.colour}, ${variant.size}`);
  } catch (error) {
    if (error instanceof ApiError) cartAnnounce(error.body.message);
  } finally {
    button.removeAttribute('disabled');
    button.textContent = original;
  }
}

async function removeLine(lineId: string): Promise<void> {
  const before = await api<Cart>('/api/cart');
  const line = before.lines.find((item) => item.id === lineId);
  const cart = await api<Cart>(`/api/cart/lines/${lineId}`, { method: 'DELETE' });
  renderCart(cart);
  if (line === undefined) return;
  lastRemoved = { sku: line.sku, quantity: line.quantity, product: line.product };
  showUndo(line.product);
}

async function undoRemove(): Promise<void> {
  if (lastRemoved === null) return;
  const removed = lastRemoved;
  const cart = await api<Cart>('/api/cart/lines', {
    method: 'POST',
    body: { sku: removed.sku, quantity: removed.quantity }
  });
  renderCart(cart);
  cartAnnounce(`Restored ${removed.product}.`);
  for (const holder of qsa<HTMLElement>('[data-bag-undo]')) holder.innerHTML = '';
  lastRemoved = null;
}

async function startCheckout(): Promise<void> {
  try {
    const checkout = await api<{ id: string }>('/api/checkout', { method: 'POST' });
    closeDialog('bag');
    window.location.href = `/checkout/${checkout.id}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      window.location.href = '/sign-in?next=/bag/checkout';
      return;
    }
    if (error instanceof ApiError) cartAnnounce(error.body.message);
  }
}
