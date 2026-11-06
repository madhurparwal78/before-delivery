import { createScene, stillMarkupFor } from './scene.js';

type Json = Record<string, unknown>;

const moneyCache: { currency: 'USD' | 'ARS'; plan: string; dueNow: string; dueAtLaunch: string; total: string }[] = [];

function $(selector: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(selector);
}

function $$(selector: string, root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Json | null; headers: Record<string, string> }> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: Json | null = null;
  try {
    parsed = (await res.json()) as Json;
  } catch {
    parsed = null;
  }
  const headerMap: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerMap[key] = value;
  });
  return { status: res.status, body: parsed, headers: headerMap };
}

function announce(region: Element | null, message: string): void {
  if (region) region.textContent = message;
}

function formatMoney(amount: string, currency: string): string {
  const negative = amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const [whole, cents] = abs.split('.');
  const digits = whole ?? '0';
  if (currency === 'ARS') {
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${negative ? '-' : ''}ARS ${grouped},${cents ?? '00'}`;
  }
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}USD ${grouped}.${cents ?? '00'}`;
}

/** Parse an API amount string to minor units. */
function minorOf(amount: string): number {
  const negative = amount.startsWith('-');
  const abs = negative ? amount.slice(1) : amount;
  const [whole, cents] = abs.split('.');
  return (negative ? -1 : 1) * (Number(whole ?? 0) * 100 + Number(cents ?? 0));
}

// ---------- footer studio clock ----------

function startClock(): void {
  const clock = $('#studio-clock');
  if (!clock) return;
  let base = clock.dataset.clock ?? '';
  let last = base;
  const tick = (): void => {
    if (base !== clock.dataset.clock) {
      base = clock.dataset.clock ?? base;
      last = base;
    }
    const match = /^([0-2]\d):([0-5]\d):([0-5]\d)$/.exec(last);
    if (match) {
      const h = Number(match[1]);
      const m = Number(match[2]);
      const s = Number(match[3]) + 1;
      const next = new Date(Date.UTC(2020, 0, 1, h, m, s));
      const hh = String(next.getUTCHours()).padStart(2, '0');
      const mm = String(next.getUTCMinutes()).padStart(2, '0');
      const ss = String(next.getUTCSeconds()).padStart(2, '0');
      last = `${hh}:${mm}:${ss}`;
      clock.textContent = `Studio time ${last}`;
    }
  };
  window.setInterval(tick, 1000);
}

// ---------- drawers & dialogs ----------

interface DrawerHandle {
  open(): void;
  close(): void;
}

function setupDrawer(drawer: HTMLElement, opener: HTMLElement | null): DrawerHandle {
  const panel = drawer.querySelector('.drawer-panel') as HTMLElement | null;
  let lastFocus: HTMLElement | null = null;
  const focusables = (): HTMLElement[] =>
    panel
      ? Array.from(panel.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'))
      : [];
  const open = (): void => {
    lastFocus = document.activeElement as HTMLElement | null;
    drawer.hidden = false;
    const first = focusables()[0];
    if (first) first.focus();
  };
  const close = (): void => {
    drawer.hidden = true;
    if (lastFocus) lastFocus.focus();
  };
  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab' && panel) {
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
  });
  drawer.addEventListener('mousedown', (event) => {
    if (event.target === drawer) close();
  });
  $$('[data-drawer-close]', drawer).forEach((button) => button.addEventListener('click', close));
  $$('[data-invite-close]', drawer).forEach((button) => button.addEventListener('click', close));
  $$('[data-plan-keep]', drawer).forEach((button) => button.addEventListener('click', close));
  $$('[data-refund-close]', drawer).forEach((button) => button.addEventListener('click', close));
  if (opener) {
    opener.addEventListener('click', (event) => {
      event.preventDefault();
      open();
    });
  }
  return { open, close };
}

// ---------- menu drawer ----------

function setupMenu(): void {
  const drawer = $('[data-drawer]');
  const opener = $('[data-drawer-open]');
  if (drawer && opener) {
    const handle = setupDrawer(drawer, opener);
    opener.setAttribute('aria-expanded', 'false');
    opener.addEventListener('click', () => {
      opener.setAttribute('aria-expanded', String(!drawer.hidden));
      handle.open();
    });
    $$('[data-drawer-close]', drawer).forEach((button) =>
      button.addEventListener('click', () => opener.setAttribute('aria-expanded', 'false')),
    );
  }
}

// ---------- fold-line quote sheet ----------

interface QuoteSheet {
  root: HTMLElement;
  state: 'quoting' | 'ready' | 'outage';
  dueNow: number;
  dueAtLaunch: number;
  total: number;
  mode: 'purchase' | 'change';
}

const sheets: QuoteSheet[] = [];

function initQuoteSheet(root: HTMLElement, mode: 'purchase' | 'change'): QuoteSheet {
  const sheet: QuoteSheet = { root, state: 'ready', dueNow: 0, dueAtLaunch: 0, total: 0, mode };
  sheets.push(sheet);
  root.dataset.state = 'ready';
  return sheet;
}

function sheetPanels(sheet: QuoteSheet): { left: HTMLElement | null; right: HTMLElement | null; total: HTMLElement | null[] } {
  if (sheet.mode === 'purchase') {
    return {
      left: $('[data-due-now]', sheet.root),
      right: $('[data-due-launch]', sheet.root),
      total: $$('[data-quote-total]', sheet.root),
    };
  }
  return {
    left: $('[data-credit]', sheet.root),
    right: $('[data-charge]', sheet.root),
    total: $$('[data-quote-total]', sheet.root),
  };
}

function renderSheetMoney(sheet: QuoteSheet, minor: number, currency: string, element: HTMLElement | null): void {
  if (!element) return;
  const whole = Math.trunc(Math.abs(minor) / 100).toString();
  const cents = String(Math.abs(minor) % 100).padStart(2, '0');
  const signed = minor < 0 ? `-${whole}.${cents}` : `${whole}.${cents}`;
  element.textContent = formatMoney(signed, currency);
}

function setSheetState(sheet: QuoteSheet, state: QuoteSheet['state']): void {
  sheet.state = state;
  sheet.root.dataset.state = state;
  const label = $('[data-quote-label]', sheet.root);
  const table = $('[data-quote-table]', sheet.root);
  const folding = $('.quote-sheet', sheet.root);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced && table && folding) {
    table.hidden = state !== 'ready';
    folding.style.display = state === 'ready' ? '' : 'none';
  }
  if (label) {
    if (state === 'quoting') label.textContent = 'Quoting…';
    else if (sheet.mode === 'purchase') label.textContent = 'Due now and due at launch';
    else label.textContent = 'Credit and new plan charge';
  }
}

function setSheetValues(sheet: QuoteSheet, leftMinor: number, rightMinor: number, currency: string): void {
  const { left, right, total } = sheetPanels(sheet);
  sheet.dueNow = leftMinor;
  sheet.dueAtLaunch = rightMinor;
  sheet.total = leftMinor + rightMinor;
  const sum = leftMinor + rightMinor;
  const share = sum === 0 ? 40 : Math.round((Math.abs(leftMinor) / Math.abs(sum)) * 1000) / 10;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  sheet.root.dataset.crease = String(share.toFixed(1));
  if (reduced) {
    sheet.root.dataset.tilt = '0';
    renderSheetMoney(sheet, leftMinor, currency, left);
    renderSheetMoney(sheet, rightMinor, currency, right);
    total.forEach((el) => renderSheetMoney(sheet, sum, currency, el));
    if (sheet.mode === 'change') {
      $$('[data-credit]', sheet.root).forEach((el) => renderSheetMoney(sheet, leftMinor, currency, el));
      $$('[data-charge]', sheet.root).forEach((el) => renderSheetMoney(sheet, rightMinor, currency, el));
      $$('[data-quote-total]', sheet.root).forEach((el) => renderSheetMoney(sheet, sum, currency, el));
    }
    return;
  }
  countTo(left, sheet.dueNow === 0 ? 0 : leftMinor, currency);
  countTo(right, sheet.dueAtLaunch === 0 ? 0 : rightMinor, currency);
  total.forEach((el) => countTo(el, sum, currency));
  const tiltPanels = $$('.quote-panel', sheet.root);
  sheet.root.dataset.tilt = '18';
  tiltPanels.forEach((panel) => {
    panel.style.transform = 'perspective(600px) rotateX(18deg)';
  });
}

function countTo(element: HTMLElement | null, targetMinor: number, currency: string): void {
  if (!element) return;
  const start = Number(element.dataset.minor ?? '0');
  const startTime = performance.now();
  const duration = 670;
  const step = (now: number): void => {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 2);
    const value = Math.round(start + (targetMinor - start) * eased);
    element.dataset.minor = String(value);
    const whole = Math.trunc(Math.abs(value) / 100).toString();
    const cents = String(Math.abs(value) % 100).padStart(2, '0');
    const signed = value < 0 ? `-${whole}.${cents}` : `${whole}.${cents}`;
    element.textContent = formatMoney(signed, currency);
    if (t < 1) requestAnimationFrame(step);
    else element.dataset.minor = String(targetMinor);
  };
  requestAnimationFrame(step);
}

// ---------- pricing page ----------

interface PricingState {
  currency: 'USD' | 'ARS';
  plan: 'launch-page' | 'studio-site' | 'care';
  tier: 'care-lite' | 'care-plus';
  quoteToken: number;
}

async function setupPricing(): Promise<void> {
  const region = $('[data-pricing]');
  if (!region) return;
  const state: PricingState = { currency: 'USD', plan: 'studio-site', tier: 'care-lite', quoteToken: 0 };
  const sheetRoot = $('[data-quote-sheet]', region);
  const sheet = sheetRoot ? initQuoteSheet(sheetRoot, 'purchase') : null;
  const statusRegion = $('[data-quote-status]', region);
  const pricesData = JSON.parse(($('.plan-cards[data-prices]') as HTMLElement | undefined)?.dataset.prices ?? '{}') as Record<string, Record<string, { total: string; dueNow: string; dueAtLaunch: string }>>;

  const requestQuote = async (): Promise<void> => {
    const token = ++state.quoteToken;
    if (sheet) {
      setSheetState(sheet, 'quoting');
      const label = $('[data-quote-label]', sheet.root);
      if (label) label.textContent = 'Quoting…';
    }
    announce(statusRegion, 'Quoting…');
    const planParam = state.plan === 'care' ? state.tier : state.plan;
    const res = await api('POST', '/api/quotes', { plan: planParam, currency: state.currency });
    if (token !== state.quoteToken) return;
    if (res.status !== 200 || !res.body) {
      if (sheet) {
        setSheetState(sheet, 'outage');
        const label = $('[data-quote-label]', sheet.root);
        if (label) label.textContent = 'Live pricing is offline. Try again in a moment.';
      }
      announce(statusRegion, 'Live pricing is offline. Try again in a moment.');
      return;
    }
    const quote = res.body;
    if (sheet) {
      setSheetState(sheet, 'ready');
      setSheetValues(sheet, minorOf(String(quote.dueNow)), minorOf(String(quote.dueAtLaunch)), state.currency);
    }
    announce(
      statusRegion,
      `Due now ${formatMoney(String(quote.dueNow), state.currency)}, due at launch ${formatMoney(String(quote.dueAtLaunch), state.currency)}, total ${formatMoney(String(quote.total), state.currency)}.`,
    );
    updatePayButton(String(quote.dueNow));
  };

  const updatePayButton = (dueNow: string): void => {
    const button = $('[data-pay]', region) ?? $('[data-start-checkout]', region);
    if (button && button.hasAttribute('data-start-checkout')) {
      // nothing to relabel on the home page
    }
    moneyCache.length = 0;
    moneyCache.push({ currency: state.currency, plan: planParam(), dueNow, dueAtLaunch: '0.00', total: String(dueNow) });
  };

  const planParam = (): string => (state.plan === 'care' ? state.tier : state.plan);

  const updatePlanCards = (): void => {
    const currency = state.currency;
    for (const [plan, figures] of Object.entries(pricesData[currency] ?? {})) {
      if (!figures) continue;
      const el = $(`[data-plan-price="${plan}"]`);
      if (el) {
        el.textContent = plan.startsWith('care') ? `${formatMoney(figures.total, currency)} / month` : formatMoney(figures.total, currency);
      }
    }
  };

  $$('[data-currency-group] input[type="radio"]', region).forEach((radio) => {
    radio.addEventListener('change', () => {
      const input = radio as HTMLInputElement;
      if (input.checked) {
        state.currency = input.value === 'ARS' ? 'ARS' : 'USD';
        updatePlanCards();
        void requestQuote();
      }
    });
  });

  region.addEventListener('keydown', (event) => {
    if (event.key === 'c' || event.key === 'C') {
      const target = event.target as HTMLElement;
      if (target.closest('[data-pricing]')) {
        event.preventDefault();
        const other = state.currency === 'USD' ? 'ARS' : 'USD';
        const radio = $(`[data-currency-group] input[value="${other}"]`, region) as HTMLInputElement | null;
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  });

  $$('[data-tier-group] input[type="radio"]', region).forEach((radio) => {
    radio.addEventListener('change', () => {
      const input = radio as HTMLInputElement;
      if (input.checked && state.plan === 'care') {
        state.tier = input.value === 'care-plus' ? 'care-plus' : 'care-lite';
        void requestQuote();
      }
    });
  });

  $$('[data-choose]', region).forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.choose;
      state.plan = (value === 'care' || value === 'launch-page' || value === 'studio-site') ? value : state.plan;
      if (value === 'care') {
        const checked = $('[data-tier-group] input:checked]', region) as HTMLInputElement | null;
        state.tier = checked?.value === 'care-plus' ? 'care-plus' : 'care-lite';
      }
      $$('[data-choose]', region).forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      void requestQuote();
    });
  });

  const startCheckout = $('[data-start-checkout]', region);
  if (startCheckout) {
    startCheckout.addEventListener('click', async () => {
      const res = await api('POST', '/api/orders', { plan: planParam(), currency: state.currency });
      if (res.status === 201 && res.body && typeof res.body.id === 'string') {
        window.location.href = `/checkout/${res.body.id}`;
      }
    });
  }

  updatePlanCards();
  await requestQuote();
}

// ---------- checkout ----------

let payIntentKey: string | null = null;

async function setupCheckout(): Promise<void> {
  const form = $('[data-payment-form]');
  const acceptForm = $('[data-form="accept"]');
  const statusRegion = $('[data-checkout-status]');
  const banner = $('[data-checkout-banner]');
  if (!form) return;
  const orderState = ($('meta[name="order-state"]') as HTMLMetaElement | undefined)?.content ?? '';
  const orderId = form.querySelector('[data-pay]')?.getAttribute('data-order') ?? '';

  const cardFields = ['[name="cardNumber"]', '[name="expiry"]', '[name="cvc"]'];
  cardFields.forEach((selector) => {
    const field = $(selector, form);
    field?.addEventListener('input', () => {
      payIntentKey = null;
    });
  });

  const ensureIntentKey = (): string => {
    if (!payIntentKey) {
      payIntentKey = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    }
    return payIntentKey;
  };

  if (acceptForm) {
    acceptForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fields = acceptForm.elements as unknown as Record<string, HTMLInputElement>;
      const body: Record<string, unknown> = { acceptTerms: fields['acceptTerms']?.checked ?? false };
      if ($('[name="businessName"]', acceptForm)) {
        body.businessName = fields['businessName'].value;
        body.name = fields['name'].value;
        body.email = fields['email'].value;
        body.password = fields['password'].value;
      }
      announce(statusRegion, 'Accepting your quote…');
      const res = await api('POST', `/api/orders/${orderId}/accept`, body);
      if (res.status === 200) {
        announce(statusRegion, `Quote accepted. Price locked at ${'the accepted total'}.`);
        form.removeAttribute('disabled');
        const first = $('[name="cardNumber"]', form) as HTMLElement | null;
        first?.focus();
        window.location.reload();
        return;
      }
      if (res.status === 409 && res.body?.error === 'quote_stale') {
        announce(statusRegion, 'Prices changed since your quote. Review the new total before accepting.');
        window.location.reload();
        return;
      }
      const fields1 = res.body?.fields as Record<string, string> | undefined;
      if (fields1) {
        for (const [key, message] of Object.entries(fields1)) {
          const input = $(`[name="${key}"]`, acceptForm);
          if (input) {
            input.setCustomValidity(message);
            input.reportValidity();
          }
        }
        announce(statusRegion, Object.values(fields1)[0] ?? 'Check the form fields.');
      } else {
        announce(statusRegion, 'We could not accept the quote. Try again in a moment.');
      }
    });
  }

  const payButton = $('[data-pay]', form) as HTMLButtonElement | null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!payButton || payButton.disabled) return;
    const amount = payButton.dataset.due ?? '';
    void amount;
    payButton.disabled = true;
    announce(statusRegion, 'Processing payment…');
    const body = {
      card: {
        number: ($('[name="cardNumber"]', form) as HTMLInputElement).value,
        expiry: ($('[name="expiry"]', form) as HTMLInputElement).value,
        cvc: ($('[name="cvc"]', form) as HTMLInputElement).value,
      },
    };
    const key = ensureIntentKey();
    try {
      const res = await api('POST', `/api/orders/${orderId}/pay`, body, { 'Idempotency-Key': key });
      if (res.status === 201 && res.body) {
        const receiptUrl = res.body.receiptUrl;
        window.location.href = typeof receiptUrl === 'string' ? receiptUrl : `/orders/${orderId}/receipt`;
        return;
      }
      payButton.disabled = false;
      if (res.body?.error === 'card_declined') {
        announce(statusRegion, 'Your card was declined. Nothing was charged.');
        return;
      }
      if (res.body?.error === 'billing_unavailable') {
        if (banner) {
          banner.innerHTML = '<p>We can\'t reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.</p>';
        }
        announce(statusRegion, "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.");
        payIntentKey = null;
        return;
      }
      if (res.body?.error === 'storage_unavailable') {
        if (banner) {
          banner.innerHTML = "<p>We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes.</p>";
        }
        announce(statusRegion, "We couldn't open your project folder, so the payment was cancelled and nothing was charged. Try again in a few minutes.");
        payIntentKey = null;
        return;
      }
      const fields = res.body?.fields as Record<string, string> | undefined;
      if (fields) {
        const mapped: Record<string, string> = { 'card.number': 'cardNumber', 'card.expiry': 'expiry', 'card.cvc': 'cvc' };
        for (const [key, message] of Object.entries(fields)) {
          const input = $(`[name="${mapped[key] ?? key}"]`, form);
          if (input) {
            input.setCustomValidity(message);
            input.reportValidity();
          }
        }
        announce(statusRegion, Object.values(fields)[0] ?? 'Check the card details.');
        return;
      }
      announce(statusRegion, 'Something went wrong. Try again in a moment.');
    } catch {
      payButton.disabled = false;
      announce(statusRegion, 'We could not reach the ledger. Try again in a moment.');
    }
  });
  void orderState;
}

// ---------- sign-in ----------

async function setupSignIn(): Promise<void> {
  const form = $('[data-sign-in-form]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = ($('[name="email"]', form) as HTMLInputElement).value;
    const password = ($('[name="password"]', form) as HTMLInputElement).value;
    const res = await api('POST', '/api/session', { email, password });
    const alertRegion = $('[data-sign-in-error]', form);
    if (res.status === 200) {
      const next = ($('meta[name="next"]') as HTMLMetaElement | undefined)?.content ?? '';
      window.location.href = next && next.startsWith('/') ? next : portalHome();
      return;
    }
    if (alertRegion) alertRegion.textContent = 'Email or password is incorrect.';
  });
}

function portalHome(): string {
  return '/portal';
}

async function setupSignOut(): Promise<void> {
  $$('[data-sign-out]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api('DELETE', '/api/session');
      window.location.href = '/';
    }),
  );
}

// ---------- invite ----------

async function setupInvite(): Promise<void> {
  const form = $('[data-invite-form]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = form.dataset.token ?? '';
    const name = ($('[name="name"]', form) as HTMLInputElement).value;
    const password = ($('[name="password"]', form) as HTMLInputElement).value;
    const res = await api('POST', `/api/invites/${token}/accept`, { name, password });
    if (res.status === 201 && res.body && typeof res.body.projectId === 'string') {
      window.location.href = `/portal/projects/${res.body.projectId}`;
      return;
    }
    const alertRegion = $('[data-invite-error]', form);
    if (alertRegion) {
      const fields = res.body?.fields as Record<string, string> | undefined;
      alertRegion.textContent = fields ? Object.values(fields)[0]! : 'We could not accept the invite.';
    }
  });
}

// ---------- project page: uploads & downloads ----------

async function setupProject(): Promise<void> {
  const statusRegion = $('[data-upload-status]');

  $$('[data-upload]').forEach((input) => {
    input.addEventListener('change', async () => {
      const fileInput = input as HTMLInputElement;
      const file = fileInput.files?.[0];
      if (!file) return;
      const kind = fileInput.dataset.upload === 'asset' ? 'assets' : 'deliverables';
      const projectId = fileInput.dataset.project ?? '';
      announce(statusRegion, `Uploading ${file.name}: 0%`);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/${projectId}/${kind}`);
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          const announced = percent >= 100 ? 100 : percent >= 75 ? 75 : percent >= 50 ? 50 : percent >= 25 ? 25 : 0;
          announce(statusRegion, `Uploading ${file.name}: ${announced}%`);
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status === 201) {
          announce(statusRegion, `Uploaded ${file.name}.`);
          window.location.reload();
        } else {
          let message = 'File storage is unavailable. Your file was not uploaded. Try again in a minute.';
          try {
            const parsed = JSON.parse(xhr.responseText) as Json;
            if (parsed.error === 'unsupported_file_type') message = `${file.name} is not an accepted file type.`;
            else if (parsed.error === 'file_too_large') message = `${file.name} is larger than 10 MB.`;
            else if (parsed.error === 'invalid_file_name') message = "That file name can't be stored. Rename the file and try again.";
            else if (parsed.error === 'project_closed') message = 'This project is closed.';
          } catch {
            // default outage copy
          }
          announce(statusRegion, message);
        }
      });
      xhr.addEventListener('error', () => {
        announce(statusRegion, 'File storage is unavailable. Your file was not uploaded. Try again in a minute.');
      });
      const data = new FormData();
      data.append('file', file);
      xhr.send(data);
    });
  });

  $$('[data-download]').forEach((button) =>
    button.addEventListener('click', async () => {
      const fileId = button.dataset.download ?? '';
      const res = await api('POST', `/api/files/${fileId}/links`, {});
      if (res.status === 201 && res.body && typeof res.body.url === 'string') {
        window.location.href = res.body.url;
        return;
      }
      announce(statusRegion, 'This download link expired. Press Download again.');
    }),
  );

  $$('[data-invoice-download]').forEach((button) =>
    button.addEventListener('click', async () => {
      const invoiceId = button.dataset.invoiceDownload ?? '';
      const res = await api('POST', `/api/invoices/${invoiceId}/links`, {});
      if (res.status === 201 && res.body && typeof res.body.url === 'string') {
        window.location.href = res.body.url;
        return;
      }
      if (res.body?.error === 'pdf_pending') {
        announce(statusRegion, 'The PDF for this invoice is not ready yet. Try again in a moment.');
        return;
      }
      announce(statusRegion, 'This download link expired. Press Download again.');
    }),
  );
}

// ---------- invite teammate ----------

async function setupInviteTeammate(): Promise<void> {
  const opener = $('[data-invite-open]');
  const drawer = $('[data-invite-dialog]');
  if (!opener || !drawer) return;
  const handle = setupDrawer(drawer, opener);
  const statusRegion = $('[data-invite-status]');
  const send = $('[data-invite-send]', drawer);
  send?.addEventListener('click', async () => {
    const email = ($('[data-invite-email]', drawer) as HTMLInputElement | null)?.value ?? '';
    const projectId = send.dataset.project ?? '';
    announce(statusRegion, 'Sending invite…');
    const res = await api('POST', `/api/projects/${projectId}/invites`, { email });
    if (res.status === 201) {
      announce(statusRegion, `Invite sent to ${email}.`);
      window.setTimeout(() => {
        handle.close();
        window.location.reload();
      }, 900);
      return;
    }
    const fields = res.body?.fields as Record<string, string> | undefined;
    announce(statusRegion, fields?.email ?? 'We could not send the invite.');
  });
}

// ---------- plan page ----------

async function setupPlanPage(): Promise<void> {
  const page = $('body.portal');
  if (!page || !document.querySelector('[data-plan-actions]')) return;
  const statusRegion = $('[data-plan-status]');

  const refresh = async (): Promise<void> => {
    const res = await api('GET', '/api/plan');
    if (res.status === 503 || res.status === 404) {
      const outage = $('[data-plan-outage]');
      if (outage) outage.hidden = false;
      const actions = $('[data-plan-actions]');
      if (actions) actions.style.display = 'none';
      return;
    }
  };
  window.setInterval(() => {
    void refresh();
  }, 15_000);

  const changeDialog = $('[data-plan-change-dialog]');
  const cancelDialog = $('[data-cancel-dialog]');
  let currentPreview: Json | null = null;

  $$('[data-plan-change]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!changeDialog) return;
      currentPreview = null;
      const sheetRoot = $('[data-quote-sheet]', changeDialog);
      const sheet = sheetRoot ? initQuoteSheet(sheetRoot, 'change') : null;
      const confirmButton = $('[data-plan-confirm]', changeDialog) as HTMLButtonElement | null;
      if (confirmButton) confirmButton.disabled = true;
      changeDialog.hidden = false;
      if (sheet) setSheetState(sheet, 'quoting');
      announce(statusRegion, 'Working out your proration…');
      const tier = button.dataset.planChange === 'lite' ? 'lite' : 'plus';
      const res = await api('POST', '/api/plan/previews', { tier });
      if (res.status !== 201 || !res.body) {
        if (sheet) {
          setSheetState(sheet, 'outage');
          const label = $('[data-quote-label]', sheet.root);
          if (label) label.textContent = 'Billing is unreachable, so we can\'t change your plan right now.';
        }
        announce(statusRegion, 'Billing is unreachable, so we can\'t change your plan right now.');
        return;
      }
      currentPreview = res.body;
      if (sheet) {
        setSheetState(sheet, 'ready');
        setSheetValues(sheet, minorOf(String(res.body.credit)), minorOf(String(res.body.charge)), String(res.body.currency));
      }
      announce(
        statusRegion,
        `Credit ${formatMoney(String(res.body.credit), String(res.body.currency))}, new plan charge ${formatMoney(String(res.body.charge), String(res.body.currency))}, total ${formatMoney(String(res.body.total), String(res.body.currency))}.`,
      );
      if (confirmButton) confirmButton.disabled = false;
      const first = changeDialog.querySelector('button') as HTMLElement | null;
      first?.focus();
    }),
  );

  $$('[data-plan-confirm]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (!currentPreview) return;
      const previewId = String(currentPreview.previewId);
      announce(statusRegion, 'Confirming with billing…');
      const res = await api('POST', '/api/plan/changes', { previewId }, { 'Idempotency-Key': `change-${previewId}` });
      if (res.status === 200) {
        announce(statusRegion, `Your plan is now ${res.body?.plan ? String((res.body.plan as Json).planName) : 'changed'}.`);
        window.setTimeout(() => window.location.reload(), 700);
        return;
      }
      if (res.body?.error === 'preview_expired') {
        announce(statusRegion, 'This preview expired. Open the change again for fresh figures.');
        return;
      }
      if (res.body?.error === 'preview_stale') {
        announce(statusRegion, 'Billing moved on since your preview. Review the updated figures.');
        return;
      }
      if (res.body?.error === 'card_declined') {
        announce(statusRegion, 'Your card was declined. Nothing was charged.');
        return;
      }
      if (res.status === 503) {
        announce(statusRegion, 'Billing is unreachable, so we can\'t change your plan right now.');
        return;
      }
      announce(statusRegion, 'We could not change your plan.');
    }),
  );

  $$('[data-plan-pause]').forEach((button) =>
    button.addEventListener('click', async () => {
      announce(statusRegion, 'Confirming with billing…');
      const res = await api('POST', '/api/plan/pause', {}, { 'Idempotency-Key': `pause-${Date.now()}` });
      if (res.status === 200 && res.body) {
        const pauseOn = (res.body.plan as Json | undefined)?.pauseOn;
        announce(statusRegion, `Your plan pauses on ${String(pauseOn ?? '')}.`);
        window.setTimeout(() => window.location.reload(), 800);
        return;
      }
      announce(statusRegion, res.status === 503 ? 'Billing is unreachable, so we can\'t change your plan right now.' : 'We could not pause your plan.');
    }),
  );

  $$('[data-plan-resume]').forEach((button) =>
    button.addEventListener('click', async () => {
      announce(statusRegion, 'Confirming with billing…');
      const res = await api('POST', '/api/plan/resume', {}, { 'Idempotency-Key': `resume-${Date.now()}` });
      if (res.status === 200) {
        announce(statusRegion, 'Your plan is active again.');
        window.setTimeout(() => window.location.reload(), 800);
        return;
      }
      if (res.body?.error === 'card_declined') {
        announce(statusRegion, 'Your card was declined. Nothing was charged.');
        return;
      }
      announce(statusRegion, res.status === 503 ? 'Billing is unreachable, so we can\'t change your plan right now.' : 'We could not resume your plan.');
    }),
  );

  $$('[data-plan-cancel]').forEach((button) =>
    button.addEventListener('click', () => {
      if (cancelDialog) cancelDialog.hidden = false;
      const first = cancelDialog?.querySelector('button') as HTMLElement | null;
      first?.focus();
    }),
  );

  $$('[data-plan-cancel-confirm]').forEach((button) =>
    button.addEventListener('click', async () => {
      announce(statusRegion, 'Confirming with billing…');
      const res = await api('POST', '/api/plan/cancel', {}, { 'Idempotency-Key': `cancel-${Date.now()}` });
      if (res.status === 200 && res.body) {
        const endsOn = (res.body.plan as Json | undefined)?.endsOn;
        announce(statusRegion, `Your plan ends on ${String(endsOn ?? '')}.`);
        window.setTimeout(() => window.location.reload(), 800);
        return;
      }
      announce(statusRegion, res.status === 503 ? 'Billing is unreachable, so we can\'t change your plan right now.' : 'We could not cancel your plan.');
    }),
  );

  const updateCardForm = $('[data-update-card]');
  updateCardForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    announce(statusRegion, 'Processing payment…');
    const res = await api(
      'POST',
      '/api/plan/card',
      {
        card: {
          number: ($('[name="cardNumber"]', updateCardForm) as HTMLInputElement).value,
          expiry: ($('[name="expiry"]', updateCardForm) as HTMLInputElement).value,
          cvc: ($('[name="cvc"]', updateCardForm) as HTMLInputElement).value,
        },
      },
      { 'Idempotency-Key': `card-${Date.now()}` },
    );
    if (res.status === 200) {
      announce(statusRegion, 'Payment received. Your plan is active.');
      window.setTimeout(() => window.location.reload(), 800);
      return;
    }
    if (res.body?.error === 'card_declined') {
      announce(statusRegion, 'Your card was declined. Nothing was charged.');
      return;
    }
    announce(statusRegion, res.status === 503 ? "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes." : 'We could not update your card.');
  });
}

// ---------- studio console ----------

async function setupStudio(): Promise<void> {
  const page = $('body.studio');
  if (!page) return;

  $$('[data-transition]').forEach((button) =>
    button.addEventListener('click', async () => {
      const orderId = button.dataset.transition ?? '';
      const to = button.dataset.to ?? '';
      const res = await api('POST', `/api/studio/orders/${orderId}/transitions`, { to });
      if (res.status === 200) {
        window.location.reload();
      }
    }),
  );

  $$('[data-assign-contractor]').forEach((select) =>
    select.addEventListener('change', async () => {
      const selectEl = select as HTMLSelectElement;
      const contractorId = selectEl.value;
      const projectId = selectEl.dataset.project ?? '';
      if (!contractorId || !projectId) return;
      await api('POST', `/api/studio/projects/${projectId}/assignments`, { contractorId });
      window.location.reload();
    }),
  );

  const refundDialog = $('[data-refund-dialog]');
  const refundOpeners = $$('[data-refund-open]');
  let refundOrderId = '';
  if (refundDialog) {
    const handle = setupDrawer(refundDialog, null);
    const statusRegion = $('[data-refund-status]', refundDialog);
    refundOpeners.forEach((button) =>
      button.addEventListener('click', async () => {
        refundOrderId = button.dataset.refundOpen ?? '';
        handle.open();
        const res = await api('GET', `/api/studio/orders/${refundOrderId}`);
        if (res.status === 200 && res.body) {
          const payments = (res.body.payments ?? []) as Json[];
          const deposit = payments.find((p) => p.kind === 'deposit');
          const refunded = $('[data-refunded-so-far]', refundDialog);
          const left = $('[data-refund-left]', refundDialog);
          if (refunded && deposit) refunded.textContent = `Refunded so far ${formatMoney(String(deposit.refunded), String(res.body.currency))}`;
          if (left && deposit) left.textContent = `Left on this payment ${formatMoney(String(deposit.remaining), String(res.body.currency))}`;
        }
      }),
    );
    $$('[data-refund-issue]', refundDialog).forEach((button) =>
      button.addEventListener('click', async () => {
        const payment = ($('input[name="refund-payment"]:checked', refundDialog) as HTMLInputElement | null)?.value ?? 'deposit';
        const amount = ($('[data-refund-amount]', refundDialog) as HTMLInputElement | null)?.value ?? '';
        const reason = ($('[data-refund-reason]', refundDialog) as HTMLInputElement | null)?.value ?? '';
        announce(statusRegion, 'Issuing refund…');
        const res = await api(
          'POST',
          `/api/studio/orders/${refundOrderId}/refunds`,
          { payment, amount, reason },
          { 'Idempotency-Key': `refund-${Date.now()}` },
        );
        if (res.status === 201 && res.body) {
          const paymentBody = res.body.payment as Json;
          announce(statusRegion, `Refunded ${formatMoney(String((res.body.refund as Json).amount), String((res.body.refund as Json).currency))}. ${formatMoney(String(paymentBody.remaining), String((res.body.refund as Json).currency))} left on this payment.`);
          window.setTimeout(() => window.location.reload(), 900);
          return;
        }
        if (res.body?.error === 'refund_over_cap') {
          announce(statusRegion, String((res.body.fields as Json).amount ?? 'That is more than the amount left on this payment.'));
          return;
        }
        announce(statusRegion, "We can't reach billing right now. Nothing was charged, and your details are still here. Try Pay again in a few minutes.");
      }),
    );
  }

  const priceForm = $('[data-price-form]');
  priceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const plan = ($('[name="plan"]', priceForm) as HTMLSelectElement).value;
    const amount = ($('[name="amount"]', priceForm) as HTMLInputElement).value;
    const effectiveAt = ($('[name="effectiveAt"]', priceForm) as HTMLInputElement).value || undefined;
    const res = await api('POST', '/api/studio/prices', { plan, currency: 'ARS', amount, effectiveAt });
    if (res.status === 201) {
      await loadPriceRows();
    }
  });

  async function loadPriceRows(): Promise<void> {
    const rows = $('[data-price-rows]');
    if (!rows) return;
    const res = await api('GET', '/api/studio/prices');
    if (res.status !== 200 || !res.body) return;
    const prices = (res.body.prices ?? []) as Json[];
    rows.innerHTML = prices
      .map(
        (price) =>
          `<tr><td>${String(price.plan)}</td><td>${String(price.currency)}</td><td class="mono">${escapeHtml(formatMoney(String(price.amount), String(price.currency)))}</td><td class="mono">${escapeHtml(String(price.effectiveAt))}</td></tr>`,
      )
      .join('');
  }
  await loadPriceRows();

  $$('[data-entry-publish]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api('POST', `/api/studio/entries/${button.dataset.entryPublish}/publish`, {});
      window.location.reload();
    }),
  );
  $$('[data-entry-withdraw]').forEach((button) =>
    button.addEventListener('click', async () => {
      await api('POST', `/api/studio/entries/${button.dataset.entryWithdraw}/withdraw`, {});
      window.location.reload();
    }),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- case study focus ----------

function setupCaseStudyFocus(): void {
  const backLink = $('[data-back-to-work]');
  if (!backLink) return;
  const slug = new URLSearchParams(window.location.search).get('card');
  backLink.addEventListener('click', () => {
    const card = slug ? $(`[data-card="${slug}"]`) : null;
    if (card) {
      window.location.hash = '';
      window.addEventListener('unload', () => undefined, { once: true });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.location.href = '/#work';
    }
  });
}

function setupDeckFocus(): void {
  const deck = $('[data-deck]');
  if (!deck) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $$('a[data-card]', deck).forEach((link) => {
    link.addEventListener('click', (event) => {
      window.sessionStorage.setItem('lastCaseCard', link.dataset.card ?? '');
      if (reduced) return;
      const card = link.closest('.card') as HTMLElement | null;
      if (!card) return;
      event.preventDefault();
      card.style.transition = 'transform 670ms cubic-bezier(0.25, 0.9, 0.3, 1)';
      card.style.transform = 'scale(1.6) translateY(6vh)';
      card.style.zIndex = '20';
      card.style.position = 'relative';
      window.setTimeout(() => {
        window.location.href = link.getAttribute('href') ?? '/#work';
      }, 640);
    });
  });
}

function restoreDeckFocus(): void {
  if (window.location.hash === '#work' || window.location.hash === '') {
    const slug = window.sessionStorage.getItem('lastCaseCard');
    if (slug) {
      const card = $(`[data-card="${slug}"]`);
      if (card && window.location.hash === '#work') {
        card.focus();
      }
    }
  }
}

// ---------- 3D stage ----------

function setupScene(): void {
  const isPublic = !document.body.classList.contains('no-scene');
  if (!isPublic) return;
  const container = document.createElement('div');
  container.className = 'scene-stage';
  container.dataset.sceneSection = 'hero';
  container.dataset.sceneMode = 'webgl';
  container.dataset.sceneTurn = '0';
  document.body.prepend(container);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sections = $$('[data-section-id]');
  const currentSection = (): string => {
    for (const section of sections) {
      const rect = section.getBoundingClientRect();
      if (rect.top <= window.innerHeight / 2 && rect.bottom >= window.innerHeight / 2) {
        return section.dataset.sectionId ?? 'hero';
      }
    }
    return 'hero';
  };

  try {
    if (reduced) {
      container.dataset.sceneMode = 'webgl';
      const handle = createScene(container, { cardCount: 4 });
      let last = '';
      const onScroll = (): void => {
        const id = currentSection();
        if (id !== last) {
          last = id;
          container.dataset.sceneSection = id;
          handle.update(sectionFraction(id), id);
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      return;
    }
    const handle = createScene(container, { cardCount: 4 });
    let last = '';
    const onScroll = (): void => {
      const id = currentSection();
      if (id !== last) {
        last = id;
        container.dataset.sceneSection = id;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return;
  } catch {
    // fall through to the still drawings
  }

  container.dataset.sceneMode = 'still';
  container.innerHTML = `<div class="scene-still">${stillMarkupFor('hero')}</div>`;
  window.addEventListener('scroll', () => {
    const id = currentSection();
    container.dataset.sceneSection = id;
    container.innerHTML = `<div class="scene-still">${stillMarkupFor(id)}</div>`;
  });
}

function sectionFraction(id: string): number {
  const order = ['hero', 'work', 'process', 'pricing', 'contact'];
  const index = order.indexOf(id);
  return (index + 0.5) / order.length;
}

// ---------- boot ----------

async function boot(): Promise<void> {
  startClock();
  setupMenu();
  setupScene();
  setupDeckFocus();
  restoreDeckFocus();
  setupCaseStudyFocus();
  await setupPricing();
  await setupCheckout();
  await setupSignIn();
  await setupSignOut();
  await setupInvite();
  await setupProject();
  await setupInviteTeammate();
  await setupPlanPage();
  await setupStudio();
}

void boot();
