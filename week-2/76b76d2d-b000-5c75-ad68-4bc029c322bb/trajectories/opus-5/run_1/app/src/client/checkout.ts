import { UPLIFT_PRESETS, type Fare } from '../shared/domain.ts';
import { ApiCallError, call, newIdempotencyKey } from './api.ts';
import { billingDown } from './chrome.ts';
import { clearFeedback, showFailure, showStatus, type Regions } from './feedback.ts';
import { locale, setI18n, tr } from './i18n.ts';
import { initStepup } from './stepup.ts';
import { initOptionMenu } from './widgets.ts';

const regions: Regions = { status: 'checkout-status', error: 'checkout-error' };

type CheckoutData = {
  hold_id: string;
  screening_id: string;
  group: boolean;
  seats: string[];
  expires_at: string;
  server_time: string;
  signed_in: boolean;
};

type Quote = {
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  credit_applied_cents: number;
  total_cents: number;
  pay_now_cents: number;
  stepup_required: boolean;
};

export function initCheckout(data: CheckoutData): void {
  const payButton = document.getElementById('pay-button') as HTMLButtonElement | null;
  const releaseButton = document.getElementById('release-seats') as HTMLButtonElement | null;
  const trigger = document.getElementById('stepup-trigger') as HTMLButtonElement | null;
  const timer = document.getElementById('hold-timer');
  const summary = document.getElementById('price-summary');
  if (payButton === null || summary === null) return;

  const fares: Record<string, Fare> = {};
  for (const opener of document.querySelectorAll<HTMLElement>('.fare-opener')) {
    fares[opener.getAttribute('data-seat') ?? ''] = (opener.getAttribute('data-fare') ?? 'regular') as Fare;
  }
  let upliftCents = 0;
  let expired = false;
  let quote: Quote = {
    admission_cents: 0,
    gst_cents: 0,
    qst_cents: 0,
    uplift_cents: 0,
    credit_applied_cents: 0,
    total_cents: 0,
    pay_now_cents: readSummary('row_pay_now'),
    stepup_required: trigger !== null && !trigger.hidden,
  };
  const idempotencyKey = newIdempotencyKey();
  const offsetMs = new Date(data.server_time).getTime() - Date.now();

  function readSummary(key: string): number {
    const cell = summary?.querySelector(`[data-i18n="${key}"]`)?.parentElement?.querySelector('td');
    const args = cell?.getAttribute('data-i18n-args');
    if (args === null || args === undefined) return 0;
    return Number((JSON.parse(args) as { amount_cents: number }).amount_cents);
  }

  const payerRows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.payer-row'));

  const payerSeatsTotal = (): number =>
    payerRows().reduce((sum, row) => {
      const input = row.querySelector<HTMLInputElement>('input[type="number"]');
      return sum + Number(input?.value ?? '0');
    }, 0);

  const syncPay = (): void => {
    const cardholder = (document.getElementById('cardholder-name') as HTMLInputElement | null)?.value.trim() ?? '';
    const guestName = (document.getElementById('guest-name') as HTMLInputElement | null)?.value.trim() ?? '';
    const guestEmail = (document.getElementById('guest-email') as HTMLInputElement | null)?.value.trim() ?? '';
    let disabled = false;
    if (expired) disabled = true;
    if (quote.stepup_required) disabled = true;
    if (quote.pay_now_cents > 0 && cardholder === '') disabled = true;
    if (!data.signed_in && (guestName === '' || guestEmail === '')) disabled = true;
    if (billingDown()) disabled = true;
    if (data.group && payerSeatsTotal() !== data.seats.length) disabled = true;
    payButton.disabled = disabled;
    if (quote.pay_now_cents === 0) setI18n(payButton, 'pay_confirm');
    else setI18n(payButton, 'pay_amount', { amount_cents: quote.pay_now_cents });
    if (trigger !== null) trigger.hidden = !quote.stepup_required;
  };

  const renderSummary = (next: Quote): void => {
    quote = next;
    const rows: Array<[string, number, boolean]> = [
      ['row_admission', next.admission_cents, true],
      ['row_gst', next.gst_cents, true],
      ['row_qst', next.qst_cents, true],
      ['row_uplift', next.uplift_cents, next.uplift_cents > 0],
      ['row_credit', next.credit_applied_cents, next.credit_applied_cents > 0],
      ['row_total', next.total_cents, true],
      ['row_pay_now', next.pay_now_cents, true],
    ];
    const body = summary.querySelector('tbody');
    if (body === null) return;
    body.textContent = '';
    for (const [key, cents, show] of rows) {
      if (!show) continue;
      const tr_ = document.createElement('tr');
      const th = document.createElement('th');
      th.setAttribute('scope', 'row');
      setI18n(th, key);
      const td = document.createElement('td');
      td.className = 'mono';
      setI18n(td, 'money_plain', { amount_cents: cents });
      tr_.append(th, td);
      body.append(tr_);
    }
    syncPay();
  };

  const refreshQuote = async (): Promise<void> => {
    const result = await call<{ quote: Quote }>('POST', `/api/holds/${data.hold_id}/quote`, {
      fares: data.group ? undefined : fares,
      uplift_cents: upliftCents,
    });
    renderSummary(result.quote);
  };

  for (const opener of document.querySelectorAll<HTMLElement>('.fare-opener')) {
    const seat = opener.getAttribute('data-seat') ?? '';
    const list = document.querySelector<HTMLElement>(`[role="listbox"][data-for="${seat}"]`);
    if (list === null) continue;
    initOptionMenu(
      opener,
      list,
      (value, option) => {
        fares[seat] = value as Fare;
        opener.setAttribute('data-fare', value);
        for (const other of list.querySelectorAll('[role="option"]')) {
          other.setAttribute('aria-selected', other === option ? 'true' : 'false');
        }
        opener.setAttribute('data-i18n-args', JSON.stringify({ seat, fare: `@fare_${value}` }));
        opener.setAttribute('aria-label', tr('fare_button', { seat, fare: `@fare_${value}` }));
        const label = opener.querySelector('.fare-label');
        if (label !== null) setI18n(label, `fare_${value}`);
        void refreshQuote().catch((error: unknown) => showFailure(regions, error));
      },
      'data-fare',
    );
  }

  const upliftSwitch = document.getElementById('uplift-switch');
  const upliftAmounts = document.getElementById('uplift-amounts');
  const otherField = document.getElementById('uplift-other-amount') as HTMLInputElement | null;
  const presets = Array.from(document.querySelectorAll<HTMLElement>('.uplift-preset'));

  const setUplift = (cents: number): void => {
    upliftCents = cents;
    for (const preset of presets) {
      const value = preset.getAttribute('data-uplift');
      preset.setAttribute('aria-checked', value !== null && Number(value) === cents ? 'true' : 'false');
    }
    const other = document.getElementById('uplift-other');
    if (other !== null) {
      other.setAttribute('aria-checked', cents > 0 && !UPLIFT_PRESETS.includes(cents) ? 'true' : 'false');
    }
    void refreshQuote().catch((error: unknown) => showFailure(regions, error));
  };

  upliftSwitch?.addEventListener('click', () => {
    const on = upliftSwitch.getAttribute('aria-checked') === 'true';
    upliftSwitch.setAttribute('aria-checked', on ? 'false' : 'true');
    if (upliftAmounts !== null) upliftAmounts.hidden = on;
    setUplift(on ? 0 : 500);
  });

  for (const preset of presets) {
    preset.addEventListener('click', () => {
      const value = preset.getAttribute('data-uplift');
      if (value === null) {
        otherField?.focus();
        preset.setAttribute('aria-checked', 'true');
        return;
      }
      setUplift(Number(value));
    });
  }

  otherField?.addEventListener('change', () => {
    const dollars = Number((otherField.value ?? '').replace(',', '.'));
    if (!Number.isFinite(dollars)) return;
    const cents = Math.round(dollars * 100);
    if (cents < 100 || cents > 50000) {
      const error = document.getElementById('uplift-other-amount-error');
      if (error !== null) error.textContent = tr('field_uplift');
      return;
    }
    setUplift(cents);
  });

  const addPayer = document.getElementById('add-payer');
  addPayer?.addEventListener('click', () => {
    const container = document.getElementById('payers');
    if (container === null) return;
    const index = payerRows().length + 1;
    if (index > 6) return;
    const template = payerRows()[0];
    const clone = template.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-payer', String(index));
    for (const node of clone.querySelectorAll<HTMLElement>('[id]')) {
      node.id = node.id.replace(/\d+$/, String(index));
    }
    for (const node of clone.querySelectorAll<HTMLElement>('label[for]')) {
      node.setAttribute('for', (node.getAttribute('for') ?? '').replace(/\d+$/, String(index)));
      node.setAttribute('data-i18n-args', JSON.stringify({ n: index }));
      setI18n(node, node.getAttribute('data-i18n') ?? 'payer_name', { n: index });
    }
    for (const node of clone.querySelectorAll<HTMLInputElement>('input')) node.value = node.type === 'number' ? '0' : '';
    const remove = clone.querySelector<HTMLElement>('.remove-payer');
    if (remove !== null) {
      remove.setAttribute('data-payer', String(index));
      setI18n(remove, 'remove_payer', { n: index });
      remove.addEventListener('click', () => {
        clone.remove();
        syncPay();
      });
    }
    container.insertBefore(clone, addPayer);
    syncPay();
  });

  for (const remove of document.querySelectorAll<HTMLElement>('.remove-payer')) {
    remove.addEventListener('click', () => {
      remove.closest('.payer-row')?.remove();
      syncPay();
    });
  }

  for (const input of document.querySelectorAll<HTMLInputElement>('#payers input, #cardholder-name, #guest-name, #guest-email')) {
    input.addEventListener('input', syncPay);
  }

  const tick = (): void => {
    if (timer === null) return;
    const remaining = Math.floor((new Date(data.expires_at).getTime() - (Date.now() + offsetMs)) / 1000);
    const clamped = Math.max(0, remaining);
    timer.textContent = `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`;
    if (clamped === 0 && !expired) {
      expired = true;
      showHoldExpired();
      syncPay();
    }
  };

  function showHoldExpired(): void {
    const error = document.getElementById(regions.error);
    if (error === null) return;
    error.textContent = tr('err_hold_expired');
    const link = document.createElement('a');
    link.href = `/${locale()}/screenings/${data.screening_id}`;
    link.id = 'choose-again';
    setI18n(link, 'choose_seats_again');
    error.append(' ', link);
  }

  tick();
  window.setInterval(tick, 1000);

  payButton.addEventListener('click', () => {
    void (async () => {
      clearFeedback(regions);
      payButton.disabled = true;
      setI18n(payButton, 'pay_pending');
      showStatus(regions, 'pay_pending');
      try {
        const payers = payerRows().map((row, index) => ({
          name: row.querySelector<HTMLInputElement>('input[type="text"]')?.value.trim() ?? `Payer ${index + 1}`,
          seats: Number(row.querySelector<HTMLInputElement>('input[type="number"]')?.value ?? '0'),
        }));
        const result = await call<{ booking: { ref: string }; guest_link: string | null }>(
          'POST',
          '/api/checkout',
          {
            hold_id: data.hold_id,
            fares: data.group ? undefined : fares,
            uplift_cents: upliftCents,
            cardholder_name: (document.getElementById('cardholder-name') as HTMLInputElement | null)?.value.trim() ?? '',
            note: (document.getElementById('note') as HTMLInputElement | null)?.value ?? '',
            guest: data.signed_in
              ? undefined
              : {
                  name: (document.getElementById('guest-name') as HTMLInputElement | null)?.value.trim() ?? '',
                  email: (document.getElementById('guest-email') as HTMLInputElement | null)?.value.trim() ?? '',
                  phone: (document.getElementById('guest-phone') as HTMLInputElement | null)?.value.trim() ?? '',
                },
            split: data.group ? payers : undefined,
          },
          { 'Idempotency-Key': idempotencyKey },
        );
        const target =
          result.guest_link === null
            ? `/${locale()}/account/bookings/${result.booking.ref}?confirmed=1`
            : `${result.guest_link}?confirmed=1`;
        window.location.assign(target);
      } catch (error) {
        if (error instanceof ApiCallError && error.failure.code === 'hold_expired') {
          expired = true;
          showHoldExpired();
        } else {
          showFailure(regions, error);
        }
        syncPay();
      }
    })();
  });

  releaseButton?.addEventListener('click', () => {
    void (async () => {
      try {
        await call('DELETE', `/api/holds/${data.hold_id}`);
        showStatus(regions, 'release_done');
        window.location.assign(`/${locale()}/screenings/${data.screening_id}`);
      } catch (error) {
        showFailure(regions, error);
      }
    })();
  });

  initStepup({
    purpose: 'checkout',
    regions,
    onVerified: () => {
      void refreshQuote()
        .then(() => {
          payButton.focus();
        })
        .catch((error: unknown) => showFailure(regions, error));
    },
  });

  void refreshQuote().catch(() => undefined);
  window.setInterval(syncPay, 2000);
}
