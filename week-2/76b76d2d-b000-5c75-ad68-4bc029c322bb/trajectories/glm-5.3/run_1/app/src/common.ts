/**
 * The shared browser layer: status polling, notices, language switch,
 * and the helpers every page script uses.
 */

export type Locale = 'en' | 'fr';

export interface StatusShape {
  billing: 'up' | 'down';
  mail: 'up' | 'down';
  checked_at: string;
}

export interface ErrorShape {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

let dismissedState = '';

export async function fetchStatus(): Promise<StatusShape> {
  const res = await fetch('/api/status', { headers: { 'X-Halide-Locale': document.documentElement.lang === 'fr' ? 'fr' : 'en' } });
  return (await res.json()) as StatusShape;
}

export function statusKey(s: StatusShape): string {
  return `${s.billing}:${s.mail}`;
}

export function renderNotice(slot: HTMLElement | null, status: StatusShape): void {
  if (!slot) return;
  const key = statusKey(status);
  const l = document.documentElement.lang === 'fr' ? 'fr' : 'en';
  const show = key !== 'up:up' && key !== dismissedState;
  if (!show) {
    slot.innerHTML = '';
    return;
  }
  const billing = status.billing === 'down';
  const mail = status.mail === 'down';
  const billingText = l === 'en'
    ? 'Billing is temporarily unavailable. You can browse the programme, but booking, membership changes and refunds are paused.'
    : "La facturation est temporairement indisponible. Vous pouvez consulter le programme, mais les réservations, les changements d'adhésion et les remboursements sont suspendus.";
  const mailText = l === 'en'
    ? 'Email delivery is delayed. Confirmations will be sent automatically when it recovers.'
    : "L'envoi des courriels est retardé. Les confirmations seront envoyées automatiquement à son rétablissement.";
  const dismissLabel = l === 'en' ? 'Dismiss notice' : "Fermer l'avis";
  const label = l === 'en' ? 'Service notice' : 'Avis de service';
  const paragraphs = [
    billing ? `<p>${billingText}</p>` : '',
    mail ? `<p>${mailText}</p>` : '',
  ].filter(Boolean).join('');
  slot.innerHTML = `<div id="service-notice" role="alert" aria-label="${label}" class="service-notice">
    ${paragraphs}
    <button type="button" id="dismiss-notice">${dismissLabel}</button>
  </div>`;
  const button = slot.querySelector('#dismiss-notice');
  button?.addEventListener('click', () => {
    dismissedState = key;
    slot.innerHTML = '';
    const heading = document.getElementById('main-heading');
    if (heading) heading.focus();
  });
}

export function startStatusPolling(onBillingDown: (down: boolean) => void): void {
  const slot = document.getElementById('service-notice-slot');
  let lastKey = '';
  const tick = async () => {
    try {
      const status = await fetchStatus();
      renderNotice(slot, status);
      const key = statusKey(status);
      if (key !== lastKey) {
        onBillingDown(status.billing === 'down');
        lastKey = key;
      }
    } catch {
      // keep serving
    }
  };
  void tick();
  setInterval(tick, 5000);
}

export async function api<T = unknown>(path: string, init?: RequestInit & { locale?: Locale }): Promise<T> {
  const locale = init?.locale ?? (document.documentElement.lang === 'fr' ? 'fr' : 'en');
  const headers: Record<string, string> = { 'X-Halide-Locale': locale };
  if (init?.body && typeof init.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & Partial<ErrorShape>) : ({} as T & Partial<ErrorShape>);
  if (!res.ok) {
    const err = new Error((data as Partial<ErrorShape>).error?.message ?? 'error') as Error & { payload?: ErrorShape; status?: number };
    err.payload = (data as Partial<ErrorShape>) as ErrorShape;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function formatAmount(cents: number, locale: Locale): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  if (locale === 'fr') {
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
    return `${sign}${grouped},${frac} $`;
  }
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${frac}`;
}

export function fareLabel(fare: string, locale: Locale): string {
  const map: Record<string, Record<Locale, string>> = {
    regular: { en: 'Regular', fr: 'Ordinaire' },
    reduced: { en: 'Reduced (student, 65+)', fr: 'Réduit (étudiant, 65 ans et plus)' },
    member: { en: 'Member', fr: 'Membre' },
    'member-guest': { en: 'Member guest', fr: 'Invité de membre' },
    group: { en: 'Group', fr: 'Groupe' },
  };
  return map[fare]?.[locale] ?? fare;
}

export function statusLine(): HTMLElement | null {
  return document.getElementById('form-status') ?? document.getElementById('checkout-status') ?? document.getElementById('booking-status');
}

export function errorLine(): HTMLElement | null {
  return document.getElementById('form-error') ?? document.getElementById('checkout-error') ?? document.getElementById('booking-error');
}

export async function withPending(button: HTMLElement, action: () => Promise<void>): Promise<void> {
  const original = button.textContent ?? '';
  button.setAttribute('disabled', 'disabled');
  button.textContent = document.documentElement.lang === 'fr' ? 'En cours…' : 'Working…';
  const line = statusLine();
  if (line) line.textContent = document.documentElement.lang === 'fr' ? 'En cours…' : 'Working…';
  try {
    await action();
  } finally {
    button.removeAttribute('disabled');
    button.textContent = original;
  }
}

export function showError(err: Error & { payload?: ErrorShape }): void {
  const line = errorLine();
  if (line && err.payload?.error?.message) {
    line.textContent = err.payload.error.message;
  } else if (line) {
    line.textContent = err.message;
  }
}

export function announce(text: string): void {
  const line = statusLine();
  if (line) line.textContent = text;
}
