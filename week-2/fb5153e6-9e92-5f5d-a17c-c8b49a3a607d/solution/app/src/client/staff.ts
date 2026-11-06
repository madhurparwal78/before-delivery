import { all, announce, one, readState } from './dom.js';
import { call, newIdempotencyKey } from './api.js';
import { showFailure } from './forms.js';
import type { Locale } from '../shared/locale.js';
import { formatAmount, localeFromLang } from '../shared/locale.js';
import { refundDone, s } from '../shared/strings.js';
import { orderStatusLabel } from '../shared/labels.js';

interface OrderState {
  order: string;
  locale: Locale;
  lang: string | null;
}

const state = readState<OrderState>('order-state');
const notices = one('[data-staff-notices]');
const alertNode = one('[data-staff-alert]');
const locale: Locale = state?.locale ?? localeFromLang(new URL(window.location.href).searchParams.get('lang'));

interface RefundReply {
  order: string;
  refund_cents: number;
  refunded_cents: number;
  status: 'paid' | 'partially_refunded' | 'refunded';
}

async function refund(orderRef: string, body: Record<string, unknown>): Promise<void> {
  announce(notices, s('issuingRefund', locale));
  try {
    const reply = await call<RefundReply>(`/api/staff/orders/${orderRef}/refunds`, {
      method: 'POST',
      locale,
      idempotencyKey: newIdempotencyKey(),
      body,
    });
    const refunded = one('[data-order-refunded]');
    if (refunded !== null) refunded.textContent = formatAmount(reply.refunded_cents, locale);
    const status = one('[data-order-status]');
    if (status !== null) status.textContent = orderStatusLabel(reply.status, locale);
    announce(notices, refundDone(formatAmount(reply.refund_cents, locale), reply.order, locale));
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    announce(notices, '');
    showFailure(alertNode, error, locale, null);
  }
}

for (const button of all<HTMLButtonElement>('[data-refund-full]')) {
  button.addEventListener('click', () => {
    void refund(button.dataset.refundFull ?? '', { kind: 'full' });
  });
}

for (const button of all<HTMLButtonElement>('[data-refund-seats]')) {
  button.addEventListener('click', () => {
    const seats = Number.parseInt(
      one<HTMLInputElement>('[data-refund-seats-input]')?.value ?? '1',
      10,
    );
    void refund(button.dataset.refundSeats ?? '', { kind: 'seats', seats });
  });
}
