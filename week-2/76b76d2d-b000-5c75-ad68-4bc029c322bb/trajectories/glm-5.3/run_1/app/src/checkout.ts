import { api, formatAmount, fareLabel, type Locale, type ErrorShape } from './common';

interface QuoteView {
  lines: { fare: string; quantity: number; unit_cents: number; subtotal_cents: number; gst_cents: number; qst_cents: number }[];
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
  credit_applied_cents: number;
  pay_now_cents: number;
  stepup_required: boolean;
}

interface HoldView {
  id: string;
  screening_id: string;
  seats: string[];
  group: boolean;
  state: string;
  expires_at: string;
  server_time: string;
}

const locale: Locale = document.documentElement.lang === 'fr' ? 'fr' : 'en';
const L = locale === 'fr';

const fareOrder = ['regular', 'reduced', 'member', 'member-guest', 'group'];

function setupCheckout(): void {
  const root = document.querySelector<HTMLElement>('.checkout-layout');
  if (!root) return;
  const holdId = root.dataset.holdId ?? '';
  const fareSection = document.getElementById('fare-section');
  const payerSection = document.getElementById('payer-section');
  const payerList = document.getElementById('payer-list');
  const summaryBody = document.getElementById('price-summary-body');
  const payButton = document.getElementById('pay-button') as HTMLButtonElement | null;
  const releaseButton = document.getElementById('release-seats');
  const verifyButton = document.getElementById('verify-code');
  const upliftSwitch = document.getElementById('uplift-switch') as HTMLInputElement | null;
  const upliftOptions = document.getElementById('uplift-options');
  const upliftOther = document.getElementById('uplift-other') as HTMLInputElement | null;
  const timer = document.getElementById('hold-timer');

  let hold: HoldView | null = null;
  let quote: QuoteView | null = null;
  let expiresAt: Date | null = null;
  let serverOffsetMs = 0;
  let fares: Record<string, string> = {};
  let idempotencyKey = newKey();

  function newKey(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function seatSort(seats: string[]): string[] {
    return [...seats].sort((a, b) => {
      if (a[0] !== b[0]) return a.charCodeAt(0) - b.charCodeAt(0);
      return Number(a.slice(1)) - Number(b.slice(1));
    });
  }

  function renderSummary(q: QuoteView): void {
    if (!summaryBody) return;
    const rows: [string, number][] = [
      [L ? 'Entrée' : 'Admission', q.admission_cents],
      [L ? 'TPS (5 %)' : 'GST (5%)', q.gst_cents],
      [L ? 'TVQ (9,975 %)' : 'QST (9.975%)', q.qst_cents],
    ];
    if (q.uplift_cents > 0) {
      rows.push([L ? 'Contribution de soutien (non taxable)' : 'Supporter uplift (not taxed)', q.uplift_cents]);
    }
    if (q.credit_applied_cents > 0) {
      rows.push([L ? 'Crédit appliqué' : 'Credit applied', q.credit_applied_cents]);
    }
    rows.push([L ? 'Total' : 'Total', q.total_cents]);
    rows.push([L ? 'À payer maintenant' : 'Pay now', q.pay_now_cents]);
    summaryBody.innerHTML = rows.map(([label, cents]) =>
      `<tr><th scope="row">${label}</th><td class="mono">${formatAmount(cents, locale)}</td></tr>`).join('');
  }

  function updatePayButton(): void {
    if (!payButton) return;
    const cardholder = (document.getElementById('cardholder-name') as HTMLInputElement | null)?.value.trim() ?? '';
    const guestName = (document.getElementById('guest-name') as HTMLInputElement | null)?.value?.trim() ?? '';
    const guestEmail = (document.getElementById('guest-email') as HTMLInputElement | null)?.value?.trim() ?? '';
    const hasSession = !document.getElementById('guest-name');
    const q = quote;
    const expired = expiresAt !== null && Date.now() >= expiresAt.getTime();
    const payNow = q?.pay_now_cents ?? 0;
    const groupOk = !hold?.group || (hold?.group && payerSum() === hold.seats.length);
    const disabled =
      expired ||
      (q?.stepup_required ?? false) ||
      (payNow > 0 && cardholder === '') ||
      (!hasSession && (guestName === '' || guestEmail === '')) ||
      document.body.classList.contains('billing-down') ||
      !groupOk ||
      !q;
    payButton.disabled = disabled;
    payButton.textContent = payNow === 0
      ? (L ? 'Confirmer la réservation' : 'Confirm booking')
      : `${L ? 'Payer' : 'Pay'} ${formatAmount(payNow, locale)}`;
    if (verifyButton) {
      verifyButton.hidden = !(q?.stepup_required ?? false);
    }
  }

  function payerSum(): number {
    if (!payerList) return 0;
    const inputs = Array.from(payerList.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    return inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  }

  function currentUpliftCents(): number {
    if (!upliftSwitch || !upliftSwitch.checked) return 0;
    const selected = document.querySelector<HTMLInputElement>('input[name="uplift"]:checked');
    if (!selected) return 0;
    if (selected.value === 'other') {
      const raw = upliftOther?.value.trim() ?? '';
      const dollars = Number(raw.replace(',', '.'));
      if (!Number.isFinite(dollars)) return -1;
      return Math.round(dollars * 100);
    }
    return Number(selected.value);
  }

  async function refreshQuote(): Promise<void> {
    const uplift = currentUpliftCents();
    if (uplift === -1) {
      renderSummary(quote as QuoteView);
      return;
    }
    const body = hold?.group
      ? { uplift_cents: uplift }
      : { fares, uplift_cents: uplift };
    const data = await api<{ quote: QuoteView }>(`/api/holds/${holdId}/quote`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    quote = data.quote;
    renderSummary(quote);
    updatePayButton();
  }

  function renderFares(): void {
    if (!fareSection || !hold || hold.group) return;
    fareSection.innerHTML = seatSort(hold.seats).map(seat => `
      <div class="fare-row" data-seat="${seat}">
        <button type="button" class="fare-button" id="fare-button-${seat}" aria-haspopup="listbox" aria-expanded="false">
          ${L ? `Tarif pour la place ${seat}` : `Fare for seat ${seat}`}: <span class="fare-current">${fareLabel(fares[seat] ?? 'regular', locale)}</span>
        </button>
        <div class="fare-listbox" role="listbox" aria-label="${L ? 'Tarif' : 'Fare'}" hidden data-seat="${seat}">
          ${fareOrder.map(f => `<div role="option" aria-selected="${(fares[seat] ?? 'regular') === f}" data-fare="${f}" tabindex="-1">${fareLabel(f, locale)}</div>`).join('')}
        </div>
      </div>`).join('');
    for (const button of Array.from(fareSection.querySelectorAll<HTMLButtonElement>('.fare-button'))) {
      button.addEventListener('click', () => openFareMenu(button));
    }
  }

  function openFareMenu(button: HTMLButtonElement): void {
    const row = button.closest('.fare-row') as HTMLElement;
    const listbox = row.querySelector('.fare-listbox') as HTMLElement;
    const options = Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[];
    listbox.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const selected = options.find(o => o.getAttribute('aria-selected') === 'true') ?? options[0];
    selected?.focus();

    const close = (focusButton: boolean) => {
      listbox.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
      document.removeEventListener('click', onDoc);
    };
    const onDoc = (e: MouseEvent) => {
      if (!listbox.contains(e.target as Node) && e.target !== button) {
        close(false);
      }
    };
    document.addEventListener('click', onDoc);
    const choose = (optionEl: HTMLElement): void => {
      const seat = row.dataset.seat ?? '';
      const fare = optionEl.dataset.fare ?? 'regular';
      fares[seat] = fare;
      for (const o of options) {
        o.setAttribute('aria-selected', o === optionEl ? 'true' : 'false');
      }
      close(true);
      renderFares();
      void refreshQuote();
    };
    listbox.onkeydown = (e: KeyboardEvent) => {
      const index = options.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        options[Math.min(index + 1, options.length - 1)]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        options[Math.max(index - 1, 0)]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(options[index]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    };
    for (const option of options) {
      option.addEventListener('click', () => choose(option));
    }
  }

  function renderPayers(): void {
    if (!payerList || !hold) return;
    const payers = Array.from(payerList.querySelectorAll('.payer-row'));
    if (payers.length === 0) {
      addPayer();
      addPayer();
    }
  }

  function addPayer(): void {
    if (!payerList) return;
    const n = payerList.querySelectorAll('.payer-row').length + 1;
    const div = document.createElement('div');
    div.className = 'payer-row';
    div.innerHTML = `
      <label>${L ? `Nom du payeur ${n}` : `Payer name ${n}`} <input type="text" class="payer-name"></label>
      <label>${L ? `Places pour le payeur ${n}` : `Seats for payer ${n}`} <input type="number" class="payer-seats" min="1" value="1"></label>
      <button type="button" class="remove-payer">${L ? `Retirer le payeur ${n}` : `Remove payer ${n}`}</button>`;
    payerList.appendChild(div);
    div.querySelector('.remove-payer')?.addEventListener('click', () => {
      div.remove();
      updatePayButton();
    });
    div.querySelector('input[type="number"]')?.addEventListener('input', updatePayButton);
  }

  async function loadHold(): Promise<void> {
    const data = await api<{ hold: HoldView }>(`/api/holds/${holdId}`);
    hold = data.hold;
    expiresAt = new Date(hold.expires_at);
    serverOffsetMs = new Date(hold.server_time).getTime() - Date.now();
    for (const seat of hold.seats) {
      fares[seat] = hold.group ? 'group' : 'regular';
    }
    if (hold.group) {
      renderPayers();
      if (payerSection) payerSection.hidden = false;
    } else {
      renderFares();
    }
    await refreshQuote();
  }

  function tick(): void {
    if (!timer || !expiresAt) return;
    const serverNow = Date.now() + serverOffsetMs;
    const remainingMs = expiresAt.getTime() - serverNow;
    const seconds = Math.max(0, Math.floor(remainingMs / 1000));
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (seconds <= 0) {
      updatePayButton();
      const errorLine = document.getElementById('checkout-error');
      if (errorLine && !errorLine.textContent) {
        errorLine.innerHTML = `${L ? 'Votre réservation temporaire a expiré et les places sont remises en vente. Choisissez de nouveau vos places.' : 'Your seat hold has expired and the seats are back on sale. Choose your seats again.'} <a href="/${locale}/screenings/${hold?.id ?? ''}" id="choose-again">${L ? 'Choisir de nouveau vos places' : 'Choose seats again'}</a>`;
      }
    }
  }

  setInterval(tick, 1000);
  tick();

  upliftSwitch?.addEventListener('change', () => {
    if (upliftOptions) upliftOptions.hidden = !upliftSwitch.checked;
    if (upliftSwitch.checked) {
      const preset = document.querySelector<HTMLInputElement>('input[name="uplift"][value="500"]');
      if (preset) preset.checked = true;
    }
    void refreshQuote();
  });
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="uplift"]'))) {
    radio.addEventListener('change', () => void refreshQuote());
  }
  upliftOther?.addEventListener('input', () => void refreshQuote());
  document.getElementById('add-payer')?.addEventListener('click', () => {
    if (payerList && payerList.querySelectorAll('.payer-row').length < 6) {
      addPayer();
      updatePayButton();
    }
  });
  for (const id of ['cardholder-name', 'guest-name', 'guest-email', 'booking-note']) {
    document.getElementById(id)?.addEventListener('input', updatePayButton);
  }

  releaseButton?.addEventListener('click', async () => {
    releaseButton.setAttribute('disabled', 'disabled');
    try {
      await api(`/api/holds/${holdId}`, { method: 'DELETE' });
      const status = document.getElementById('checkout-status');
      if (status) status.textContent = L ? 'Places libérées.' : 'Seats released.';
      window.location.href = `/${locale}/screenings/${hold?.screening_id ?? ''}`;
    } catch (err) {
      releaseButton.removeAttribute('disabled');
      const e = err as Error & { payload?: ErrorShape };
      const line = document.getElementById('checkout-error');
      if (line) line.textContent = e.payload?.error?.message ?? e.message;
    }
  });

  // Step-up.
  verifyButton?.addEventListener('click', async () => {
    const dialog = document.getElementById('stepup-dialog') as HTMLElement | null;
    if (!dialog) return;
    dialog.hidden = false;
    const codeInput = document.getElementById('stepup-code') as HTMLInputElement | null;
    codeInput?.focus();
    const start = document.getElementById('stepup-start');
    if (start && !start.dataset.challenge) {
      const data = await api<{ challenge: { id: string; masked_email: string } }>('/api/stepup/start', {
        method: 'POST',
        body: JSON.stringify({ purpose: 'checkout' }),
      });
      start.dataset.challenge = data.challenge.id;
      const status = document.getElementById('checkout-status');
      if (status) status.textContent = L
        ? `Nous avons envoyé un code à 6 chiffres à ${data.challenge.masked_email}.`
        : `We sent a 6-digit code to ${data.challenge.masked_email}.`;
    }
  });

  document.getElementById('stepup-verify')?.addEventListener('click', async () => {
    const start = document.getElementById('stepup-start');
    const code = (document.getElementById('stepup-code') as HTMLInputElement | null)?.value ?? '';
    const challengeId = start?.dataset.challenge ?? '';
    try {
      await api('/api/stepup/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      const status = document.getElementById('checkout-status');
      if (status) status.textContent = L ? 'Vérifié.' : 'Verified.';
      const dialog = document.getElementById('stepup-dialog');
      if (dialog) dialog.hidden = true;
      await refreshQuote();
      payButton?.focus();
    } catch (err) {
      const e = err as Error & { payload?: ErrorShape };
      const line = document.getElementById('checkout-error');
      if (line) line.textContent = e.payload?.error?.message ?? e.message;
    }
  });

  document.getElementById('stepup-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('stepup-dialog');
    if (dialog) dialog.hidden = true;
    verifyButton?.focus();
  });

  document.getElementById('stepup-resend')?.addEventListener('click', async () => {
    const start = document.getElementById('stepup-start');
    const challengeId = start?.dataset.challenge ?? '';
    try {
      const data = await api<{ challenge: { id: string } }>('/api/stepup/resend', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      if (start) start.dataset.challenge = data.challenge.id;
      const status = document.getElementById('checkout-status');
      if (status) status.textContent = L ? 'Code renvoyé.' : 'Code resent.';
    } catch (err) {
      const e = err as Error & { payload?: ErrorShape };
      const line = document.getElementById('checkout-error');
      if (line) line.textContent = e.payload?.error?.message ?? e.message;
    }
  });

  payButton?.addEventListener('click', async () => {
    if (!quote || !hold) return;
    payButton.setAttribute('disabled', 'disabled');
    payButton.textContent = L ? 'Paiement en cours…' : 'Processing payment…';
    const status = document.getElementById('checkout-status');
    if (status) status.textContent = L ? 'Paiement en cours…' : 'Processing payment…';
    const guest = document.getElementById('guest-name')
      ? {
          name: (document.getElementById('guest-name') as HTMLInputElement).value.trim(),
          email: (document.getElementById('guest-email') as HTMLInputElement).value.trim(),
          phone: (document.getElementById('guest-phone') as HTMLInputElement).value.trim(),
        }
      : null;
    const split = hold.group && payerList
      ? Array.from(payerList.querySelectorAll('.payer-row')).map(row => ({
          name: (row.querySelector('.payer-name') as HTMLInputElement).value.trim(),
          seats: Number((row.querySelector('.payer-seats') as HTMLInputElement).value) || 0,
        }))
      : null;
    const body = {
      hold_id: holdId,
      fares: hold.group ? undefined : fares,
      uplift_cents: currentUpliftCents(),
      cardholder_name: (document.getElementById('cardholder-name') as HTMLInputElement).value.trim(),
      note: (document.getElementById('booking-note') as HTMLInputElement).value.trim(),
      guest,
      split,
    };
    try {
      const data = await api<{ booking: { ref: string }; guest_link: string | null }>('/api/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body),
      });
      const target = data.guest_link ?? `/${locale}/account/bookings/${data.booking.ref}?confirmed=1`;
      window.location.href = target;
    } catch (err) {
      const e = err as Error & { payload?: ErrorShape };
      const line = document.getElementById('checkout-error');
      if (line) line.textContent = e.payload?.error?.message ?? e.message;
      if (status) status.textContent = '';
      payButton.removeAttribute('disabled');
      updatePayButton();
    }
  });

  void loadHold();
}

setupCheckout();
export {};
