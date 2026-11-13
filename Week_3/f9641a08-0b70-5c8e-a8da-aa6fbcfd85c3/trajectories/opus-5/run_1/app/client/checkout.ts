import { ApiError, announce, api, escapeHtml, newIdempotencyKey, qs, qsa, rupees } from './core.js';

type Checkout = {
  id: string;
  step: string;
  contact: { email: string | null; phone: string | null };
  delivery: Record<string, unknown> | null;
  shipping_method: string;
  gift: boolean;
  gift_message: string;
  lines: Array<{ sku: string; product: string; colour: string; size: string; quantity: number; line_subtotal: number }>;
  totals: { subtotal: number; discount: number; shipping: number; tax: number; gift_card: number; total: number };
  gift_card: { last4: string; balance: number } | null;
  hold: { status: string; expires_at: string | null; seconds_left: number };
  server_time: string;
};

const STEPS = ['contact', 'delivery', 'shipping', 'payment'];
const STEP_LABELS: Record<string, string> = {
  contact: 'Contact',
  delivery: 'Delivery',
  shipping: 'Shipping',
  payment: 'Payment'
};

let checkout: Checkout | null = null;
let paymentKey = newIdempotencyKey();
let secondsLeft = 0;
let timerHandle = 0;
let warned = false;

function checkoutId(): string {
  return document.body.dataset.checkout ?? '';
}

function showStep(step: string): void {
  for (const section of qsa<HTMLElement>('main [data-step]')) {
    section.hidden = section.dataset.step !== step;
  }
  for (const item of qsa<HTMLElement>('[data-step-item]')) {
    if (item.dataset.stepItem === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  }
  const index = STEPS.indexOf(step) + 1;
  announce('checkout-updates', `Step ${index} of 4: ${STEP_LABELS[step]}`);
  const params = new URLSearchParams(window.location.search);
  params.set('step', step);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  document.body.dataset.checkoutStep = step;
}

function renderTotals(state: Checkout): void {
  const totals = state.totals;
  const holder = qs<HTMLElement>('[data-bag-totals]');
  if (holder !== null) {
    holder.innerHTML = `
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
    state.gift_card === null
      ? ''
      : `<p data-gift-remainder>Gift card balance after this order: ${escapeHtml(
          rupees(Math.max(0, state.gift_card.balance - totals.gift_card))
        )}</p>`
  }`;
  }
  const pay = qs<HTMLButtonElement>('[data-pay]');
  if (pay !== null) pay.textContent = `Pay ${rupees(totals.total)}`;
  const cardFields = qs<HTMLElement>('[data-card-fields]');
  if (cardFields !== null) cardFields.hidden = totals.total === 0;
}

function clearErrors(): void {
  for (const node of qsa<HTMLElement>('[data-error-for]')) node.textContent = '';
  const summary = qs<HTMLElement>('[data-error-summary]');
  if (summary !== null) {
    summary.hidden = true;
    const list = qs<HTMLElement>('[data-error-list]', summary);
    if (list !== null) list.innerHTML = '';
  }
}

function showErrors(fields: Record<string, string>): void {
  clearErrors();
  const summary = qs<HTMLElement>('[data-error-summary]');
  const list = summary === null ? null : qs<HTMLElement>('[data-error-list]', summary);
  const entries = Object.entries(fields);
  if (summary !== null && list !== null && entries.length > 0) {
    list.innerHTML = entries
      .map(([key, copy]) => `<li><a href="#" data-error-link="${escapeHtml(key)}">${escapeHtml(copy)}</a></li>`)
      .join('');
    summary.hidden = false;
  }
  let first: HTMLElement | null = null;
  for (const [key, copy] of entries) {
    const holder = qs<HTMLElement>(`[data-error-for="${key}"]`);
    if (holder !== null) {
      holder.textContent = copy;
      const field = holder.previousElementSibling as HTMLElement | null;
      if (first === null && field !== null) first = field;
    }
  }
  if (first !== null) first.focus();
  else summary?.focus();
}

function updateTimer(): void {
  const timer = qs<HTMLElement>('[data-hold-timer]');
  if (timer === null) return;
  if (secondsLeft <= 0) {
    timer.textContent = '';
    return;
  }
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');
  timer.textContent = `Held for ${minutes}:${seconds}`;
  if (secondsLeft <= 60 && !warned) {
    warned = true;
    announce('checkout-updates', 'One minute left on your hold.');
  }
}

function startTimer(): void {
  window.clearInterval(timerHandle);
  timerHandle = window.setInterval(() => {
    if (secondsLeft > 0) {
      secondsLeft -= 1;
      updateTimer();
      if (secondsLeft === 0) void load();
    }
  }, 1000);
}

async function load(): Promise<void> {
  try {
    const state = await api<Checkout>(`/api/checkout/${checkoutId()}`);
    checkout = state;
    renderTotals(state);
    secondsLeft = state.hold.seconds_left;
    if (state.hold.status !== 'active') warned = false;
    updateTimer();
    const email = qs<HTMLInputElement>('#checkout-email');
    if (email !== null && email.value === '' && state.contact.email !== null) email.value = state.contact.email;
    const phone = qs<HTMLInputElement>('#checkout-phone');
    if (phone !== null && phone.value === '' && state.contact.phone !== null) phone.value = state.contact.phone;
  } catch {
    // The page keeps its rendered state.
  }
}

function selectedAddressId(): string {
  return qs<HTMLElement>('[data-address-group] [role="radio"][aria-checked="true"]')?.dataset.addressId ?? 'new';
}

function stepPayload(step: string): Record<string, unknown> {
  if (step === 'contact') {
    return {
      step,
      email: qs<HTMLInputElement>('#checkout-email')?.value ?? '',
      phone: qs<HTMLInputElement>('#checkout-phone')?.value ?? ''
    };
  }
  if (step === 'delivery') {
    const addressId = selectedAddressId();
    if (addressId !== 'new') return { step, address_id: addressId };
    return {
      step,
      address: {
        name: qs<HTMLInputElement>('#address-name')?.value ?? '',
        line1: qs<HTMLInputElement>('#address-line1')?.value ?? '',
        line2: qs<HTMLInputElement>('#address-line2')?.value ?? '',
        city: qs<HTMLInputElement>('#address-city')?.value ?? '',
        state: qs<HTMLSelectElement>('#address-state')?.value ?? '',
        postcode: qs<HTMLInputElement>('#address-postcode')?.value ?? '',
        phone: qs<HTMLInputElement>('#address-phone')?.value ?? ''
      }
    };
  }
  if (step === 'shipping') {
    const method = qs<HTMLElement>('[data-shipping-group] [role="radio"][aria-checked="true"]')?.dataset.method ?? '';
    return {
      step,
      method,
      gift: qs<HTMLInputElement>('[data-gift]')?.checked ?? false,
      gift_message: qs<HTMLTextAreaElement>('[data-gift-message]')?.value ?? ''
    };
  }
  return { step };
}

async function continueStep(step: string, button: HTMLButtonElement): Promise<void> {
  clearErrors();
  button.disabled = true;
  const original = button.textContent ?? 'Continue';
  button.textContent = 'Checking';
  try {
    const state = await api<Checkout>(`/api/checkout/${checkoutId()}`, {
      method: 'PATCH',
      body: stepPayload(step)
    });
    checkout = state;
    renderTotals(state);
    showStep(state.step);
    qs<HTMLElement>(`[data-step="${state.step}"] h2`)?.focus();
  } catch (error) {
    if (error instanceof ApiError && error.body.fields !== undefined) showErrors(error.body.fields);
    else if (error instanceof ApiError) announce('checkout-updates', error.body.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function pay(button: HTMLButtonElement): Promise<void> {
  clearErrors();
  const alert = qs<HTMLElement>('[data-payment-alert]');
  if (alert !== null) {
    alert.hidden = true;
    alert.textContent = '';
  }
  button.disabled = true;
  const original = button.textContent ?? 'Pay';
  button.textContent = 'Paying';
  try {
    await api(`/api/checkout/${checkoutId()}/reserve`, { method: 'POST' });
    await load();
    const total = checkout?.totals.total ?? 0;
    const body: Record<string, unknown> = { checkout_id: checkoutId() };
    if (total > 0) {
      body.card = {
        number: qs<HTMLInputElement>('#card-number')?.value ?? '',
        expiry: qs<HTMLInputElement>('#card-expiry')?.value ?? '',
        cvc: qs<HTMLInputElement>('#card-cvc')?.value ?? ''
      };
    }
    const order = await api<{ number: string }>('/api/orders', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': paymentKey }
    });
    window.location.href = `/orders/${order.number}?placed=1`;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.body.fields !== undefined) {
        showErrors(error.body.fields);
      } else if (alert !== null) {
        alert.hidden = false;
        alert.textContent = error.body.message;
        alert.setAttribute('tabindex', '-1');
        alert.focus();
      }
      await load();
    }
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function setupCheckout(): void {
  if (checkoutId() === '') return;
  void load();
  startTimer();
  showStep(document.body.dataset.checkoutStep ?? 'contact');

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load();
  });
  window.setInterval(() => {
    if (!document.hidden) void load();
  }, 30000);

  for (const input of qsa<HTMLInputElement>('#card-number, #card-expiry, #card-cvc')) {
    input.addEventListener('input', () => {
      paymentKey = newIdempotencyKey();
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const continueButton = target.closest<HTMLButtonElement>('[data-continue]');
    if (continueButton !== null) {
      event.preventDefault();
      void continueStep(continueButton.dataset.continue ?? '', continueButton);
      return;
    }

    const backButton = target.closest<HTMLButtonElement>('[data-back]');
    if (backButton !== null) {
      event.preventDefault();
      const step = backButton.dataset.back ?? 'contact';
      void api<Checkout>(`/api/checkout/${checkoutId()}`, { method: 'PATCH', body: { step, go: true } }).then(
        (state) => {
          checkout = state;
          showStep(state.step);
        }
      );
      return;
    }

    const payButton = target.closest<HTMLButtonElement>('[data-pay]');
    if (payButton !== null) {
      event.preventDefault();
      if (!payButton.disabled) void pay(payButton);
      return;
    }

    const addressRadio = target.closest<HTMLElement>('[data-address-group] [role="radio"]');
    if (addressRadio !== null) {
      event.preventDefault();
      for (const radio of qsa<HTMLElement>('[data-address-group] [role="radio"]')) {
        const on = radio === addressRadio;
        radio.setAttribute('aria-checked', on ? 'true' : 'false');
        radio.setAttribute('tabindex', on ? '0' : '-1');
      }
      const holder = qs<HTMLElement>('[data-new-address]');
      if (holder !== null) holder.hidden = addressRadio.dataset.addressId !== 'new';
      return;
    }

    const methodRadio = target.closest<HTMLElement>('[data-shipping-group] [role="radio"]');
    if (methodRadio !== null) {
      event.preventDefault();
      for (const radio of qsa<HTMLElement>('[data-shipping-group] [role="radio"]')) {
        const on = radio === methodRadio;
        radio.setAttribute('aria-checked', on ? 'true' : 'false');
        radio.setAttribute('tabindex', on ? '0' : '-1');
      }
    }
  });
}
