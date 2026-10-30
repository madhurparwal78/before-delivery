import { errorBody, get, post } from '../api.js';
import { clear, el, formatCalendarDate, formatCents, formatRatePcm } from '../dom.js';
import { loadCart, loadMe, setCart } from '../store.js';
import { announce, applyFieldErrors, field, financingLine, reducedMotion, type FieldHandle } from '../ui.js';
import type { Breakdown, Me, Order, TradeIn } from '../types.js';

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'AU', name: 'Australia' },
];

const CANADIAN_POSTAL = /^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ] ?[0-9][ABCEGHJKLMNPRSTVWXYZ][0-9]$/i;
const PHONE_SHAPE = /^\+[1-9][0-9]{7,14}$/;

function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function renderCheckout(main: HTMLElement): Promise<void> {
  const me: Me | null = await loadMe();
  if (!me || me.user.role !== 'customer') {
    window.location.replace('/login?next=/checkout');
    return;
  }

  const cart = await loadCart(true);
  const mine = await get<{ trade_ins: TradeIn[] }>('/api/trade-ins/mine');
  const acceptedTradeIn = mine.ok ? mine.body.trade_ins.find((row) => row.status === 'accepted') : undefined;
  const hasCrestBuild = cart.lines.some((line) => line.type === 'build' && line.name.startsWith('Crest'));
  const hasBuildLine = cart.lines.some((line) => line.type === 'build');
  const demoCredit = me.demo_credit && !me.demo_credit.used ? me.demo_credit : null;

  const key = idempotencyKey();

  const fullName = field('Full name', 'text', { autocomplete: 'name' });
  const address = field('Address', 'text', { autocomplete: 'street-address' });
  const city = field('City', 'text', { autocomplete: 'address-level2' });
  const postalCode = field('Postal code', 'text', { autocomplete: 'postal-code' });
  const country = field('Country', 'select', {
    options: [{ value: '', label: 'Choose a country' }, ...COUNTRIES.map((item) => ({ value: item.code, label: item.name }))],
  });
  const phone = field('Phone', 'text', { type: 'tel', autocomplete: 'tel', helper: 'International format, like +14155550100' });

  const handles: Record<string, FieldHandle> = {
    'address.name': fullName,
    'address.line1': address,
    'address.city': city,
    'address.postal_code': postalCode,
    'address.phone': phone,
  };

  const tradeInBox = el('input', { type: 'checkbox', id: 'use-trade-in' });
  const demoBox = el('input', { type: 'checkbox', id: 'use-demo-credit' });
  const tradeInRow = el('div', { class: 'row', hidden: !(acceptedTradeIn && hasCrestBuild) }, [
    tradeInBox,
    el('label', { for: 'use-trade-in' }, 'Use trade-in credit'),
  ]);
  const demoRow = el('div', { class: 'row', hidden: !(demoCredit && hasBuildLine) }, [
    demoBox,
    el('label', { for: 'use-demo-credit' }, 'Use demo credit'),
  ]);

  const progressFill = el('div', { class: 'progress-fill' });
  const progress = el(
    'div',
    {
      class: 'progress-shell',
      role: 'progressbar',
      'aria-label': 'Checkout progress',
      'aria-valuemin': '0',
      'aria-valuemax': '3',
      'aria-valuenow': '0',
    },
    [
      el('div', { class: 'progress-track' }, progressFill),
      el('div', { class: 'progress-steps' }, [el('span', {}, 'Address'), el('span', {}, 'Country'), el('span', {}, 'Place order')]),
    ],
  );

  const summary = el('aside', { class: 'card checkout-summary' });
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const placeOrder = el('button', { class: 'btn', type: 'button' }, 'Place order');

  const form = el('form', { novalidate: true }, [
    alert,
    fullName.wrapper,
    address.wrapper,
    city.wrapper,
    postalCode.wrapper,
    country.wrapper,
    phone.wrapper,
    tradeInRow,
    demoRow,
  ]);

  main.replaceChildren(
    el('section', { class: 'band wrap' }, [
      el('h1', {}, 'Checkout'),
      progress,
      el('div', { class: 'checkout-layout' }, [form, summary]),
      el('div', { style: 'margin-top:1.25rem' }, placeOrder),
    ]),
  );

  let quote: Breakdown | null = null;
  let quoteToken = 0;
  let placing = false;
  let placed = false;

  const addressComplete = (): boolean =>
    fullName.control.value.length >= 2 &&
    fullName.control.value.length <= 80 &&
    address.control.value.length >= 3 &&
    address.control.value.length <= 120 &&
    city.control.value.length >= 2 &&
    city.control.value.length <= 60 &&
    postalCode.control.value.length >= 2 &&
    postalCode.control.value.length <= 12 &&
    PHONE_SHAPE.test(phone.control.value);

  const countryComplete = (): boolean => quote !== null;

  const updateProgress = (): void => {
    const steps = (addressComplete() ? 1 : 0) + (countryComplete() ? 1 : 0) + (placing || placed ? 1 : 0);
    progress.setAttribute('aria-valuenow', String(steps));
    const percentage = (steps / 3) * 100;
    if (reducedMotion()) {
      progressFill.style.transition = 'none';
      progressFill.style.width = `${percentage}%`;
      requestAnimationFrame(() => {
        progressFill.style.transition = '';
      });
    } else progressFill.style.width = `${percentage}%`;
  };

  const placeholderRow = (label: string, text: string): HTMLElement =>
    el('div', { class: 'totals-row' }, [el('span', {}, label), el('span', {}, text)]);

  const paintSummary = (): void => {
    clear(summary);
    summary.appendChild(el('h2', { style: 'font-size:1.2rem' }, 'Order summary'));
    for (const line of cart.lines) {
      summary.appendChild(
        el('div', { class: 'totals-row' }, [el('span', {}, `${line.name} x ${line.quantity}`), el('span', {}, formatCents(line.line_cents))]),
      );
    }

    const chosen = country.control.value;
    const waiting = chosen === '' ? 'Choose a country' : 'Enter your postal code';
    if (!quote) {
      summary.append(
        placeholderRow('Shipping', waiting),
        placeholderRow('Tax', waiting),
        placeholderRow('Total', waiting),
        placeholderRow('Delivery', waiting),
        placeholderRow('Financing', waiting),
      );
      return;
    }

    const discounts = quote.discounts.reduce((sum, item) => sum + item.amount_cents, 0);
    const credits = quote.credits.reduce((sum, item) => sum + item.amount_cents, 0);
    summary.append(
      el('div', { class: 'totals-row' }, [el('span', {}, 'Discounts'), el('span', {}, `-${formatCents(discounts)}`)]),
      el('div', { class: 'totals-row' }, [el('span', {}, 'Credits'), el('span', {}, `-${formatCents(credits)}`)]),
      el('div', { class: 'totals-row' }, [
        el('span', {}, 'Shipping'),
        el('span', {}, quote.shipping_cents === 0 ? 'Free' : formatCents(quote.shipping_cents)),
      ]),
    );
    if (quote.dangerous_goods_cents !== 0) {
      summary.appendChild(
        el('div', { class: 'totals-row' }, [
          el('span', {}, 'Dangerous goods handling'),
          el('span', {}, `${formatCents(quote.dangerous_goods_cents)} (${quote.packed_batteries} packed with a board, ${quote.standalone_batteries} shipped alone)`),
        ]),
      );
    }
    for (const tax of quote.taxes) {
      summary.appendChild(
        el('div', { class: 'totals-row' }, [
          el('span', {}, `${tax.name} (${formatRatePcm(tax.rate_pcm)})`),
          el('span', {}, formatCents(tax.amount_cents)),
        ]),
      );
    }
    summary.append(
      el('div', { class: 'totals-row' }, [el('span', {}, 'Tax'), el('span', {}, formatCents(quote.tax_cents))]),
      el('div', { class: 'totals-row grand' }, [el('span', {}, 'Total'), el('span', {}, formatCents(quote.total_cents))]),
      el('div', { class: 'totals-row' }, [
        el('span', {}, 'Delivery'),
        el('span', {}, `Ships ${formatCalendarDate(quote.ships_on)}, arrives ${formatCalendarDate(quote.arrives_on)}`),
      ]),
      financingLine(quote.financing) ?? el('span', {}),
    );
  };

  const requote = async (): Promise<void> => {
    const chosen = country.control.value;
    postalCode.setError(null);
    if (chosen === '') {
      quote = null;
      paintSummary();
      updateProgress();
      return;
    }
    if (chosen === 'CA' && !CANADIAN_POSTAL.test(postalCode.control.value.trim())) {
      quote = null;
      postalCode.setError('Enter a valid Canadian postal code.');
      paintSummary();
      updateProgress();
      return;
    }
    const mineToken = ++quoteToken;
    const result = await post<Breakdown>('/api/checkout/quote', {
      country: chosen,
      postal_code: postalCode.control.value.trim(),
      use_trade_in: tradeInBox.checked,
      use_demo_credit: demoBox.checked,
    });
    if (mineToken !== quoteToken) return;
    if (!result.ok) {
      quote = null;
      const body = errorBody(result);
      if (body.fields?.postal_code) postalCode.setError(body.fields.postal_code);
      else alert.textContent = body.message;
      paintSummary();
      updateProgress();
      return;
    }
    alert.textContent = '';
    quote = result.body;
    paintSummary();
    updateProgress();
    announce(`Total ${formatCents(result.body.total_cents)}.`);
  };

  country.control.addEventListener('change', () => void requote());
  postalCode.control.addEventListener('input', () => {
    updateProgress();
    if (country.control.value === 'CA') void requote();
  });
  for (const handle of [fullName, address, city, phone]) {
    handle.control.addEventListener('input', () => updateProgress());
  }
  tradeInBox.addEventListener('change', () => void requote());
  demoBox.addEventListener('change', () => void requote());

  const attempt = async (): Promise<void> => {
    const result = await post<Order>(
      '/api/orders',
      {
        country: country.control.value,
        address: {
          name: fullName.control.value,
          line1: address.control.value,
          city: city.control.value,
          postal_code: postalCode.control.value.trim(),
          phone: phone.control.value,
        },
        use_trade_in: tradeInBox.checked,
        use_demo_credit: demoBox.checked,
      },
      { 'Idempotency-Key': key },
    );

    if (result.ok) {
      placed = true;
      updateProgress();
      window.sessionStorage.setItem('tf-order-banner', `Order ${result.body.number} placed.`);
      window.location.assign(`/account/orders/${result.body.number}`);
      return;
    }

    const body = errorBody(result);
    if (body.error === 'idempotency_in_progress') {
      announce('Still placing your order.');
      window.setTimeout(() => void attempt(), 1000);
      return;
    }

    placing = false;
    placeOrder.disabled = false;
    placeOrder.textContent = 'Place order';
    updateProgress();

    if (body.error === 'out_of_stock') {
      const sku = body.message.split(' ')[0] ?? '';
      const line = cart.lines.find((item) => item.sku === sku);
      const refreshed = await loadCart(true);
      setCart(refreshed);
      cart.lines = refreshed.lines;
      window.sessionStorage.setItem(
        'tf-order-banner',
        `Sorry, ${line?.name ?? sku} just sold out. Your cart has been updated.`,
      );
      alert.textContent = `Sorry, ${line?.name ?? sku} just sold out. Your cart has been updated.`;
      paintSummary();
      return;
    }

    applyFieldErrors(handles, body.fields);
    if (!body.fields || Object.keys(body.fields).length === 0) alert.textContent = body.message;
    else if (!Object.keys(body.fields).some((name) => name in handles)) alert.textContent = body.message;
  };

  placeOrder.addEventListener('click', () => {
    if (placing) return;
    placing = true;
    placeOrder.disabled = true;
    placeOrder.textContent = 'Placing order...';
    alert.textContent = '';
    announce('Placing your order.');
    updateProgress();
    void attempt();
  });

  paintSummary();
  updateProgress();
}
