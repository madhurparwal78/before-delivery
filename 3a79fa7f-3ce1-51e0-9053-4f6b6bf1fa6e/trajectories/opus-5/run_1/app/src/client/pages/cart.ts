import { del, errorBody, patch, post } from '../api.js';
import { clear, el, formatCents, svgIcon } from '../dom.js';
import { loadCart, setCart } from '../store.js';
import { announce, financingLine } from '../ui.js';
import type { Cart, CartLine } from '../types.js';

const BUILD_LINE_CAP = 2;
const ACCESSORY_LINE_CAP = 5;

function capFor(line: CartLine): number {
  return line.type === 'build' ? BUILD_LINE_CAP : ACCESSORY_LINE_CAP;
}

export async function renderCart(main: HTMLElement): Promise<void> {
  const linesColumn = el('div', {});
  const totalsColumn = el('aside', { class: 'card' });
  const codeAlert = el('div', { class: 'alert-region', role: 'alert' });
  const page = el('section', { class: 'band wrap' }, [
    el('h1', {}, 'Your cart'),
    el('div', { class: 'cart-layout' }, [linesColumn, totalsColumn]),
  ]);
  main.replaceChildren(page);

  const paint = (cart: Cart): void => {
    clear(linesColumn);
    clear(totalsColumn);

    if (cart.lines.length === 0) {
      linesColumn.append(
        el('p', { style: 'font-weight:600' }, 'Your cart is empty'),
        el('a', { href: '/boards', class: 'btn btn-secondary' }, 'Continue shopping'),
      );
    }

    for (const line of cart.lines) {
      const limitNote = el('p', { class: 'caption', hidden: true });
      const quantityInput = el('input', {
        type: 'number',
        min: '0',
        value: String(line.quantity),
        'aria-label': `Quantity for ${line.name}`,
      });
      const decrease = el('button', { type: 'button', 'aria-label': `Decrease ${line.name}` }, svgIcon('minus'));
      const increase = el('button', { type: 'button', 'aria-label': `Increase ${line.name}` }, svgIcon('plus'));
      const remove = el('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': `Remove ${line.name}` }, 'Remove');

      const cap = capFor(line);
      if (line.quantity >= cap) {
        increase.disabled = true;
        limitNote.textContent = `Limit ${cap} per order.`;
        limitNote.hidden = false;
      }

      const setQuantity = async (quantity: number): Promise<void> => {
        for (const control of [decrease, increase, quantityInput, remove]) control.disabled = true;
        const result = await patch<Cart>(`/api/cart/lines/${line.id}`, { quantity });
        if (!result.ok) {
          for (const control of [decrease, increase, quantityInput, remove]) control.disabled = false;
          limitNote.textContent = errorBody(result).message;
          limitNote.hidden = false;
          return;
        }
        setCart(result.body);
        announce(`Cart has ${result.body.item_count} items.`);
        paint(result.body);
      };

      decrease.addEventListener('click', () => void setQuantity(line.quantity - 1));
      increase.addEventListener('click', () => void setQuantity(line.quantity + 1));
      quantityInput.addEventListener('change', () => void setQuantity(Number(quantityInput.value)));
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        const result = await del<Cart>(`/api/cart/lines/${line.id}`);
        if (!result.ok) {
          remove.disabled = false;
          return;
        }
        setCart(result.body);
        announce(`Cart has ${result.body.item_count} items.`);
        paint(result.body);
      });

      linesColumn.appendChild(
        el('div', { class: 'line-row stack' }, [
          el('h2', { style: 'font-size:1.1rem;margin:0' }, line.name),
          line.type === 'build' && line.code ? el('a', { href: `/build/${line.code}` }, 'Edit this build') : null,
          el('p', { class: 'caption', style: 'margin:0' }, `Unit price ${formatCents(line.unit_cents)}`),
          el('div', { class: 'row' }, [
            el('div', { class: 'stepper' }, [decrease, quantityInput, increase]),
            el('span', { style: 'font-weight:600' }, formatCents(line.line_cents)),
            remove,
          ]),
          limitNote,
        ]),
      );
    }

    const codeInput = el('input', { type: 'text', 'aria-label': 'Discount code' });
    const codeError = el('p', { class: 'field-error', hidden: true });
    const apply = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Apply');
    apply.addEventListener('click', async () => {
      codeError.hidden = true;
      apply.disabled = true;
      apply.textContent = 'Applying...';
      const result = await post<Cart>('/api/cart/codes', { code: codeInput.value });
      apply.disabled = false;
      apply.textContent = 'Apply';
      if (!result.ok) {
        const body = errorBody(result);
        codeError.textContent = body.fields?.code ?? body.message;
        codeError.hidden = false;
        return;
      }
      setCart(result.body);
      announce(`Code ${codeInput.value.trim().toUpperCase()} applied.`);
      paint(result.body);
    });

    const financed = cart.subtotal_cents - cart.codes.reduce((sum, code) => sum + code.amount_cents, 0);

    const checkOut = el('button', { class: 'btn', type: 'button' }, 'Check out');
    checkOut.addEventListener('click', () => window.location.assign('/checkout'));
    const share = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Share your cart');
    share.addEventListener('click', async () => {
      const result = await post<{ token: string }>('/api/cart/share');
      if (!result.ok) return;
      const address = `${window.location.origin}/cart/shared/${result.body.token}`;
      try {
        await navigator.clipboard.writeText(address);
      } catch {
        /* the link is still shown in the announcement */
      }
      announce('Cart link copied.');
    });

    totalsColumn.append(
      codeAlert,
      el('h2', { style: 'font-size:1.2rem' }, 'Summary'),
      el('div', { class: 'field' }, [
        el('label', { for: 'discount-code' }, 'Discount code'),
        el('div', { class: 'row' }, [codeInput, apply]),
        codeError,
      ]),
      el(
        'div',
        { class: 'stack' },
        cart.codes.map((code) => {
          const removeCode = el('button', { class: 'btn btn-secondary btn-small', type: 'button', 'aria-label': `Remove code ${code.code}` }, `Remove ${code.code}`);
          removeCode.addEventListener('click', async () => {
            const result = await del<Cart>(`/api/cart/codes/${encodeURIComponent(code.code)}`);
            if (!result.ok) return;
            setCart(result.body);
            paint(result.body);
          });
          return el('div', { class: 'row' }, [el('span', {}, `${code.code}: -${formatCents(code.amount_cents)}`), removeCode]);
        }),
      ),
      el('div', { class: 'totals-row' }, [el('span', {}, 'Subtotal'), el('span', {}, formatCents(cart.subtotal_cents))]),
      ...cart.codes.map((code) => el('div', { class: 'totals-row' }, [el('span', {}, code.code), el('span', {}, `-${formatCents(code.amount_cents)}`)])),
      el('div', { class: 'totals-row' }, [el('span', {}, 'Shipping'), el('span', {}, 'Calculated at checkout')]),
      el('div', { class: 'totals-row grand' }, [el('span', {}, 'Total before shipping and tax'), el('span', {}, formatCents(financed))]),
      financingLine(cart.financing) ?? el('span', {}),
      el('div', { class: 'row', style: 'margin-top:1rem' }, [checkOut, share]),
    );
    codeInput.id = 'discount-code';
  };

  paint(await loadCart(true));
}

interface SharedLine {
  type: 'build' | 'accessory';
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
}

export async function renderSharedCart(main: HTMLElement): Promise<void> {
  const token = window.location.pathname.split('/').pop() ?? '';
  const response = await fetch(`/api/cart/shared/${encodeURIComponent(token)}`, { credentials: 'same-origin' });
  if (!response.ok) {
    main.replaceChildren(
      el('section', { class: 'band wrap stack' }, [
        el('h1', {}, 'Shared cart'),
        el('p', {}, 'This shared cart has expired or does not exist.'),
        el('a', { href: '/boards' }, 'Continue shopping'),
      ]),
    );
    return;
  }
  const snapshot = (await response.json()) as { lines: SharedLine[]; expires_at: string };
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const addAll = el('button', { class: 'btn', type: 'button' }, 'Add all to my cart');
  addAll.addEventListener('click', async () => {
    alert.textContent = '';
    addAll.disabled = true;
    const imported = await post<Cart>(`/api/cart/shared/${encodeURIComponent(token)}/import`);
    addAll.disabled = false;
    if (!imported.ok) {
      alert.textContent = errorBody(imported).message;
      return;
    }
    setCart(imported.body);
    announce(`Cart has ${imported.body.item_count} items.`);
    window.location.assign('/cart');
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'A shared cart'),
      alert,
      el(
        'ul',
        { class: 'stack', style: 'list-style:none;padding:0' },
        snapshot.lines.map((line) => el('li', {}, `${line.name} x ${line.quantity} — ${formatCents(line.unit_cents)}`)),
      ),
      addAll,
    ]),
  );
}
