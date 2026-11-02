import { api, announceStatus, dollars, el, type Address, type CartView, type Quote, type User } from '../api.js';
import { registerTotals, renderCartUi, shippingPhrase, store } from '../crate.js';

interface CheckoutData {
  addresses: Address[];
}

let checkoutKey: string | null = null;
let checkoutKeyBody: string | null = null;

function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function renderCheckout(): Promise<void> {
  let me: User | null = null;
  try {
    me = (await api<{ user: User }>('/api/me')).user;
  } catch {
    me = null;
  }
  if (!me) {
    window.location.href = `/sign-in?next=${encodeURIComponent('/checkout')}`;
    return;
  }
  await store.loadCart();
  await store.refreshQuote(false);
  let addresses: Address[] = [];
  try {
    addresses = (await api<CheckoutData>('/api/addresses')).addresses;
  } catch {
    addresses = [];
  }
  const main = el('main', { class: 'page' });
  const timer = el('p', { class: 'hold-timer mono', 'data-hold-timer': 'true', role: 'timer', 'aria-label': 'Hold time left' });
  const grid = el('div', { class: 'checkout-grid' });
  const steps = el('div', { 'data-checkout-steps': 'true' });
  const summary = el('aside', { class: 'order-summary paper', 'data-order-summary': 'true' });
  summary.append(el('h2', { text: 'Order summary' }));
  const summaryRegion = el('div', { 'data-order-summary-region': 'true' });
  const summaryStatus = el('p', { role: 'status', 'aria-live': 'polite' });
  summary.append(el('div', { role: 'region', 'aria-label': 'Order summary' }, summaryRegion));
  grid.append(steps, summary);
  summary.append(summaryStatus);
  main.append(timer, grid);
  document.getElementById('app')!.append(main);

  let step = 1;
  let chosenAddress: Address | null = addresses.find((a) => a.is_default) ?? addresses[0] ?? null;
  const renderSummary = (): void => {
    const q = store.quote;
    if (!q) return;
    const region = summary.querySelector('[data-order-summary-region]') as HTMLElement;
    region.textContent = '';
    const table = el('table', { 'aria-label': 'Price breakdown' });
    const tbody = el('tbody');
    tbody.append(
      el('tr', {}, el('td', { text: 'Subtotal' }), el('td', { text: dollars(q.goods_cents) })),
      q.subscribe ? el('tr', {}, el('td', { text: 'Subscribe & save (10%)' }), el('td', { text: `-${dollars(q.discount_cents)}` })) : null,
      el('tr', {}, el('td', { text: 'Deposit' }), el('td', { text: dollars(q.deposit_cents) })),
      el('tr', {}, el('td', { text: 'Shipping' }), el('td', { text: q.shipping_cents === 0 && q.lines.length > 0 ? 'Free' : dollars(q.shipping_cents) })),
      ...q.taxes.map((t) => el('tr', {}, el('td', { text: `${t.name} (${t.rate}%)` }), el('td', { text: dollars(t.cents) }))),
      el('tr', { class: 'total-row' }, el('td', { text: 'Total' }), el('td', { text: dollars(q.total_cents) }))
    );
    table.append(tbody);
    region.append(table);
    const sub = q.subscribe ? 'Subscribed' : 'One-off';
    region.append(el('p', { class: 'muted', text: sub }));
  };
  renderSummary();
  registerTotals(() => ({ update: () => renderSummary() }));
  renderCartUi();

  const errorSummary = el('div', { class: 'error-summary', role: 'alert', 'aria-label': 'Fix these fields', hidden: true });
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'checkout-status' });

  const renderStep = (): void => {
    steps.textContent = '';
    errorSummary.hidden = true;
    if (step === 1) renderAddressStep();
    else if (step === 2) renderReviewStep();
    else renderPaymentStep();
  };

  const goStep = (n: number): void => {
    step = n;
    renderStep();
    const heading = steps.querySelector('h2') as HTMLElement | null;
    heading?.focus();
  };

  const showErrors = (fields: Record<string, string>): void => {
    const list = el('ul', {});
    const labels: Record<string, string> = {
      card_number: 'Card number',
      expiry: 'Expiry (MM/YY)',
      cvc: 'Security code',
      name: 'Full name',
      line1: 'Street address',
      city: 'City',
      postal_code: 'Postal code',
      province: 'Province',
    };
    for (const [field, message] of Object.entries(fields)) {
      const link = el('a', { href: '#', text: `${labels[field] ?? field}: ${message}` });
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const input = steps.querySelector(`[data-field="${field}"]`) as HTMLElement | null;
        input?.focus();
      });
      list.append(el('li', {}, link));
    }
    errorSummary.textContent = '';
    errorSummary.append(el('h2', { text: 'Fix these fields' }), list);
    errorSummary.hidden = false;
    errorSummary.focus?.();
    errorSummary.setAttribute('tabindex', '-1');
    (errorSummary as HTMLElement).focus();
  };

  const renderAddressStep = (): void => {
    const heading = el('h2', { class: 'step-heading', text: 'Step 1 of 3: Address', tabindex: '-1' });
    const form = el('div', {});
    if (addresses.length > 0) {
      const group = el('div', { role: 'radiogroup', 'aria-label': 'Ship to' });
      for (const address of addresses) {
        const label = el('label', {},
          el('input', { type: 'radio', name: 'ship-to', value: address.id, ...(chosenAddress?.id === address.id ? { checked: true } : {}) }),
          ` ${address.name}, ${address.line1}, ${address.city} ${address.province} ${address.postal_code}${address.is_default ? ' (default)' : ''}`);
        group.append(label);
      }
      group.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        chosenAddress = addresses.find((a) => a.id === input.value) ?? chosenAddress;
      });
      form.append(group);
    }
    const addNew = el('button', { class: 'btn btn-ghost', text: 'Add a new address' });
    const newFields = el('div', { hidden: true });
    const fields: [string, string, string][] = [
      ['name', 'Full name', 'text'],
      ['line1', 'Street address', 'text'],
      ['line2', 'Apartment or unit (optional)', 'text'],
      ['city', 'City', 'text'],
      ['postal_code', 'Postal code', 'text'],
    ];
    for (const [name, label, type] of fields) {
      const input = el('input', { type, 'aria-label': label, 'data-field': name, class: 'field-row' });
      newFields.append(el('div', { class: 'field-row' }, el('label', { text: label }), input));
    }
    const province = el('select', { 'aria-label': 'Province', 'data-field': 'province', class: 'field-row' },
      ['AB', 'BC', 'NS', 'ON', 'QC'].map((c) => el('option', { value: c, text: c })));
    newFields.append(el('div', { class: 'field-row' }, el('label', { text: 'Province' }), province));
    const makeDefault = el('input', { type: 'checkbox', id: 'make-default' });
    newFields.append(el('div', { class: 'field-row' }, el('label', { for: 'make-default' }, makeDefault, ' Make this my default address')));
    const save = el('button', { class: 'btn btn-secondary', text: 'Save address' });
    const statusLine = el('p', { 'data-address-status': 'true' });
    save.addEventListener('click', async () => {
      const values: Record<string, string> = {};
      for (const input of newFields.querySelectorAll('[data-field]') as NodeListOf<HTMLInputElement>) {
        values[input.dataset.field!] = input.value;
      }
      const fields: Record<string, string> = {};
      const provinceNames: Record<string, string> = { AB: 'Alberta', BC: 'British Columbia', NS: 'Nova Scotia', ON: 'Ontario', QC: 'Quebec' };
      if ((values.name ?? '').trim().length < 1) fields.name = 'Enter your full name.';
      if ((values.line1 ?? '').trim().length < 1) fields.line1 = 'Enter your street address.';
      if ((values.city ?? '').trim().length < 1) fields.city = 'Enter your city.';
      const postal = (values.postal_code ?? '').toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(postal)) {
        fields.postal_code = `Enter a postal code like A1A 1A1 for ${provinceNames[province.value] ?? 'your province'}.`;
      }
      if (Object.keys(fields).length > 0) {
        showErrors(fields);
        return;
      }
      try {
        const data = await api<{ address: Address }>('/api/addresses', {
          json: {
            name: values.name,
            line1: values.line1,
            line2: values.line2 ?? '',
            city: values.city,
            province: province.value,
            postal_code: postal.slice(0, 3) + ' ' + postal.slice(3),
            is_default: makeDefault.checked,
          },
        });
        addresses.push(data.address);
        chosenAddress = data.address;
        newFields.hidden = true;
        renderStep();
        announceStatus(statusLine, 'Address saved.');
      } catch (e) {
        const err = e as { status?: number; body?: { fields?: Record<string, string> } };
        if (err.body?.fields) showErrors(err.body.fields);
        else announceStatus(statusLine, 'Addresses are unavailable right now.');
      }
    });
    addNew.addEventListener('click', () => {
      newFields.hidden = !newFields.hidden;
    });
    const back = el('button', { class: 'btn btn-ghost', text: 'Back', disabled: true });
    const next = el('button', { class: 'btn btn-primary', text: 'Continue' });
    next.addEventListener('click', () => goStep(2));
    form.append(addNew, newFields, save, statusLine, el('div', { class: 'checkout-actions' }, back, next));
    steps.append(heading, form);
  };

  const renderReviewStep = (): void => {
    const heading = el('h2', { class: 'step-heading', text: 'Step 2 of 3: Review', tabindex: '-1' });
    if (!chosenAddress) {
      steps.append(heading, el('p', { text: 'Pick an address first.' }));
      const back = el('button', { class: 'btn btn-ghost', text: 'Back' });
      back.addEventListener('click', () => goStep(1));
      steps.append(back);
      return;
    }
    steps.append(
      heading,
      el('p', { text: `Shipping to ${chosenAddress.name}, ${chosenAddress.line1}, ${chosenAddress.city} ${chosenAddress.province} ${chosenAddress.postal_code}` }),
      el('p', { class: 'muted', text: store.cart?.subscribe ? 'Subscribing: your box renews automatically.' : 'One-off order.' })
    );
    const back = el('button', { class: 'btn btn-ghost', text: 'Back' });
    const next = el('button', { class: 'btn btn-primary', text: 'Continue' });
    back.addEventListener('click', () => goStep(1));
    next.addEventListener('click', () => {
      checkoutKey = newKey();
      goStep(3);
    });
    steps.append(el('div', { class: 'checkout-actions' }, back, next));
  };

  const renderPaymentStep = (): void => {
    const heading = el('h2', { class: 'step-heading', text: 'Step 3 of 3: Payment', tabindex: '-1' });
    const number = el('input', { 'aria-label': 'Card number', 'data-field': 'card_number', autocomplete: 'cc-number' });
    const expiry = el('input', { 'aria-label': 'Expiry (MM/YY)', 'data-field': 'expiry', placeholder: 'MM/YY' });
    const cvc = el('input', { 'aria-label': 'Security code', 'data-field': 'cvc', placeholder: '123' });
    const fields = el('div', {},
      el('div', { class: 'field-row' }, el('label', { text: 'Card number' }), number),
      el('div', { class: 'field-row' }, el('label', { text: 'Expiry (MM/YY)' }), expiry),
      el('div', { class: 'field-row' }, el('label', { text: 'Security code' }), cvc)
    );
    const total = store.quote?.total_cents ?? 0;
    const pay = el('button', { class: 'btn btn-primary', text: `Pay $${(total / 100).toFixed(2)}` });
    const back = el('button', { class: 'btn btn-ghost', text: 'Back' });
    back.addEventListener('click', () => goStep(2));
    let pending = false;
    let slowTimer = 0;
    const cardBody = (): string =>
      JSON.stringify({
        address_id: chosenAddress?.id,
        subscribe: store.cart?.subscribe ?? false,
        cadence: store.cart?.subscribe ? store.cart.cadence : null,
        card: { number: number.value, expiry_month: expiryValue().m, expiry_year: expiryValue().y, cvc: cvc.value },
      });
    const expiryValue = (): { m: number; y: number } => {
      const match = /^(\d{2})\s*\/?\s*(\d{2})$/.exec(expiry.value.trim());
      if (!match) return { m: 0, y: 0 };
      return { m: Number(match[1]), y: 2000 + Number(match[2]) };
    };
    const submit = async (): Promise<void> => {
      if (pending) return;
      if (!checkoutKey || checkoutKeyBody !== cardBody()) {
        checkoutKey = newKey();
        checkoutKeyBody = cardBody();
      }
      const exp = expiryValue();
      const fieldErrors: Record<string, string> = {};
      const digits = number.value.replace(/\s+/g, '');
      if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) fieldErrors.card_number = 'Enter a valid card number.';
      if (exp.m < 1 || exp.m > 12 || exp.y < 2024) fieldErrors.expiry = 'Enter a future expiry date as MM/YY.';
      if (!/^\d{3}$/.test(cvc.value)) fieldErrors.cvc = 'Enter the 3-digit security code.';
      if (Object.keys(fieldErrors).length > 0) {
        showErrors(fieldErrors);
        return;
      }
      if (store.cart?.hold.status === 'expired') {
        renderExpired();
        return;
      }
      pending = true;
      pay.textContent = 'Paying...';
      announceStatus(status, 'Processing payment. Keep this page open.');
      clearTimeout(slowTimer);
      slowTimer = window.setTimeout(() => {
        announceStatus(status, 'This is taking longer than usual. Press Pay again; you won\u2019t be charged twice.');
        pending = false;
        pay.textContent = `Pay $${(total / 100).toFixed(2)}`;
      }, 20000);
      try {
        const result = await api<{ order: { thank_you_url: string } }>('/api/checkout', {
          method: 'POST',
          headers: { 'Idempotency-Key': checkoutKey },
          json: JSON.parse(checkoutKeyBody!),
        });
        clearTimeout(slowTimer);
        pending = false;
        window.history.pushState({}, '', result.order.thank_you_url);
        const { renderRoute } = await import('../app.js');
        await renderRoute();
      } catch (e) {
        clearTimeout(slowTimer);
        pending = false;
        pay.textContent = `Pay $${(total / 100).toFixed(2)}`;
        const err = e as { status?: number; body?: { error?: string; message?: string; fields?: Record<string, string> } };
        if (err.body?.error === 'card_declined') {
          announceStatus(status, 'Your card was declined. No money was taken.');
        } else if (err.body?.error === 'billing_unavailable') {
          announceStatus(status, 'Payments are paused for a moment. Your crate is still held, so try again shortly.');
        } else if (err.body?.error === 'files_unavailable') {
          announceStatus(status, "Receipts can't be saved right now, so we haven't charged you. Try again shortly.");
        } else if (err.body?.error === 'store_unavailable') {
          announceStatus(status, "The shop can't take orders right now. You haven't been charged.");
        } else if (err.body?.error === 'hold_expired') {
          renderExpired();
        } else if (err.body?.fields) {
          showErrors(err.body.fields);
        } else if (err.body?.message) {
          announceStatus(status, err.body.message);
        } else {
          announceStatus(status, 'Something went wrong. Try again shortly.');
        }
      }
    };
    pay.addEventListener('click', () => void submit());
    const form = el('form', {});
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    form.append(fields, el('div', { class: 'checkout-actions' }, back, pay), status);
    steps.append(heading, form, errorSummary);
  };

  const renderExpired = (): void => {
    steps.textContent = '';
    steps.append(
      el('h2', { class: 'step-heading', text: 'Your hold ended' }),
      el('p', { text: 'Your hold ended and the cans went back on the shelf.' }),
      el('a', { class: 'btn btn-primary', href: '/box', text: 'Back to your crate' })
    );
  };

  renderStep();
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export async function renderThanks(orderNumber: string): Promise<void> {
  const main = el('main', { class: 'page narrow' });
  try {
    const data = await api<{ order: {
      number: string;
      total_cents: number;
      lines: { flavour: string; quantity: number }[];
      deposit_cents: number;
      shipping_cents: number;
      taxes: { name: string; cents: number }[];
      invoice_url: string;
      subscription_id: string | null;
    } }>(`/api/orders/${orderNumber}`);
    const order = data.order;
    let email = '';
    try {
      const me = await api<{ user: User }>('/api/me');
      email = me.user.email;
    } catch {
      email = '';
    }
    main.append(el('h1', { text: `Order ${order.number} is confirmed` }));
    if (email) main.append(el('p', { text: `A receipt is on its way to ${email}.` }));
    const table = el('table', { 'aria-label': 'Price breakdown' });
    const tbody = el('tbody');
    for (const line of order.lines) {
      tbody.append(el('tr', {}, el('td', { text: `${line.quantity} x ${line.flavour}` }), el('td', { text: dollars(line.quantity * 0) })));
    }
    tbody.append(
      el('tr', {}, el('td', { text: 'Deposit' }), el('td', { text: dollars(order.deposit_cents) })),
      el('tr', {}, el('td', { text: 'Shipping' }), el('td', { text: dollars(order.shipping_cents) })),
      ...order.taxes.map((t) => el('tr', {}, el('td', { text: t.name }), el('td', { text: dollars(t.cents) }))),
      el('tr', { class: 'total-row' }, el('td', { text: 'Total' }), el('td', { text: dollars(order.total_cents) }))
    );
    table.append(tbody);
    main.append(table);
    const invoiceLink = el('a', { href: order.invoice_url, text: 'Download invoice (PDF)', class: 'btn btn-secondary' });
    invoiceLink.setAttribute('download', `${order.number}.pdf`);
    main.append(el('p', {}, invoiceLink));
    if (order.subscription_id) {
      main.append(el('p', {}, el('a', { href: `/account/subscriptions/${order.subscription_id}`, text: 'Manage your subscription' })));
    }
  } catch {
    main.textContent = '';
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  document.getElementById('app')!.append(main);
}

export type { CartView, Quote };
void shippingPhrase;
