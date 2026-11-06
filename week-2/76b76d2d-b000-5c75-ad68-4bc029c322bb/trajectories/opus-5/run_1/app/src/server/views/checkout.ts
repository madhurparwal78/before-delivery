import type { Locale } from '../../shared/money.ts';
import { UPLIFT_PRESETS, fareLabelKey, type Fare } from '../../shared/domain.ts';
import { formatMoney } from '../../shared/money.ts';
import { t } from '../../shared/strings.ts';
import { esc, h, labelled, tel, text } from './html.ts';
import { heading } from './layout.ts';
import type { QuoteContext } from '../service/holds.ts';

function fareRow(locale: Locale, seat: string, fare: Fare, allowed: Fare[]): string {
  const args = { seat, fare: `@${fareLabelKey(fare)}` };
  return h(
    'div',
    { class: 'fare-row', 'data-seat': seat },
    h(
      'button',
      {
        type: 'button',
        class: 'option-opener fare-opener',
        id: `fare-${seat}`,
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-label': t('fare_button', locale, args),
        'data-i18n-aria': 'fare_button',
        'data-i18n-args': JSON.stringify(args),
        'data-seat': seat,
        'data-fare': fare,
      },
      h('span', { class: 'mono' }, esc(seat)),
      tel('span', locale, fareLabelKey(fare), undefined, { class: 'fare-label' }),
    ),
    h(
      'ul',
      {
        role: 'listbox',
        class: 'option-list',
        ...labelled(locale, 'fare_listbox'),
        hidden: true,
        'data-for': seat,
      },
      ...allowed.map((option) =>
        tel('li', locale, fareLabelKey(option), undefined, {
          role: 'option',
          'data-fare': option,
          'aria-selected': option === fare ? 'true' : 'false',
          tabindex: '-1',
        }),
      ),
    ),
  );
}

export function priceSummary(locale: Locale, quote: {
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  credit_applied_cents: number;
  total_cents: number;
  pay_now_cents: number;
}): string {
  const row = (key: string, cents: number): string =>
    h(
      'tr',
      {},
      tel('th', locale, key, undefined, { scope: 'row' }),
      tel('td', locale, 'money_plain', { amount_cents: cents }, { class: 'mono' }),
    );
  return h(
    'table',
    { class: 'price-summary', id: 'price-summary', ...labelled(locale, 'price_summary') },
    h(
      'tbody',
      {},
      row('row_admission', quote.admission_cents),
      row('row_gst', quote.gst_cents),
      row('row_qst', quote.qst_cents),
      quote.uplift_cents > 0 ? row('row_uplift', quote.uplift_cents) : '',
      quote.credit_applied_cents > 0 ? row('row_credit', quote.credit_applied_cents) : '',
      row('row_total', quote.total_cents),
      row('row_pay_now', quote.pay_now_cents),
    ),
  );
}

function upliftControl(locale: Locale, upliftCents: number): string {
  const on = upliftCents > 0;
  return h(
    'div',
    { class: 'uplift' },
    h(
      'button',
      {
        type: 'button',
        role: 'switch',
        id: 'uplift-switch',
        class: 'switch',
        'aria-checked': on ? 'true' : 'false',
        ...labelled(locale, 'uplift_switch'),
      },
      h('span', { class: 'switch-thumb', 'aria-hidden': 'true' }),
      tel('span', locale, 'uplift_switch', undefined, { class: 'switch-text' }),
    ),
    h(
      'div',
      {
        id: 'uplift-amounts',
        class: 'uplift-amounts',
        role: 'radiogroup',
        ...labelled(locale, 'uplift_group'),
        hidden: !on,
      },
      ...UPLIFT_PRESETS.map((preset) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'uplift-preset mono',
            'data-uplift': preset,
            'aria-checked': upliftCents === preset ? 'true' : 'false',
            'aria-label': formatMoney(preset, locale),
            'data-i18n-aria': 'money_plain',
            'data-i18n-args': JSON.stringify({ amount_cents: preset }),
          },
          esc(formatMoney(preset, locale)),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'uplift-preset',
          id: 'uplift-other',
          'aria-checked': on && !UPLIFT_PRESETS.includes(upliftCents) ? 'true' : 'false',
          ...labelled(locale, 'uplift_other'),
        },
        text(locale, 'uplift_other'),
      ),
      h(
        'div',
        { class: 'field' },
        tel('label', locale, 'uplift_other_field', undefined, { for: 'uplift-other-amount' }),
        h('input', {
          type: 'text',
          id: 'uplift-other-amount',
          inputmode: 'decimal',
          'aria-describedby': 'uplift-other-amount-error',
        }),
        h('p', { class: 'field-error', id: 'uplift-other-amount-error' }),
      ),
    ),
  );
}

function payerRow(locale: Locale, index: number, name: string, seats: number): string {
  const args = { n: index };
  return h(
    'div',
    { class: 'payer-row', 'data-payer': index },
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'payer_name', args, { for: `payer-name-${index}` }),
      h('input', { type: 'text', id: `payer-name-${index}`, value: name, 'aria-describedby': `payer-name-${index}-error` }),
      h('p', { class: 'field-error', id: `payer-name-${index}-error` }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'payer_seats', args, { for: `payer-seats-${index}` }),
      h('input', {
        type: 'number',
        id: `payer-seats-${index}`,
        min: 1,
        max: 40,
        step: 1,
        value: seats,
        'aria-describedby': `payer-seats-${index}-error`,
      }),
      h('p', { class: 'field-error', id: `payer-seats-${index}-error` }),
    ),
    tel('button', locale, 'remove_payer', args, {
      type: 'button',
      class: 'secondary remove-payer',
      'data-payer': index,
    }),
  );
}

export function checkoutMain(input: {
  locale: Locale;
  quote: QuoteContext;
  allowedFares: Fare[];
  signedIn: boolean;
  seatCount: number;
  now: Date;
}): string {
  const { locale, quote } = input;
  const payNow = quote.pay_now_cents;
  const remaining = Math.max(
    0,
    Math.floor((quote.hold.expires_at.getTime() - input.now.getTime()) / 1000),
  );
  return [
    heading(locale, 'checkout_heading'),
    h('p', {
      id: 'hold-timer',
      role: 'timer',
      class: 'mono hold-timer',
      ...labelled(locale, 'hold_timer'),
      'data-expires': quote.hold.expires_at.toISOString(),
    }, `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`),
    h(
      'div',
      { class: 'checkout-grid' },
      h(
        'div',
        { class: 'checkout-form' },
        quote.hold.is_group
          ? ''
          : h(
              'div',
              { class: 'fares' },
              ...quote.seats.map((seat) => fareRow(locale, seat, quote.fares[seat], input.allowedFares)),
            ),
        upliftControl(locale, quote.uplift_cents),
        quote.hold.is_group
          ? h(
              'div',
              { class: 'payers', id: 'payers', 'data-seat-count': input.seatCount },
              payerRow(locale, 1, '', Math.ceil(input.seatCount / 2)),
              payerRow(locale, 2, '', input.seatCount - Math.ceil(input.seatCount / 2)),
              tel('button', locale, 'add_payer', undefined, { type: 'button', id: 'add-payer', class: 'secondary' }),
            )
          : '',
        input.signedIn
          ? ''
          : h(
              'div',
              { class: 'guest-fields' },
              h(
                'div',
                { class: 'field' },
                tel('label', locale, 'full_name', undefined, { for: 'guest-name' }),
                h('input', { type: 'text', id: 'guest-name', autocomplete: 'name', 'aria-describedby': 'guest-name-error' }),
                h('p', { class: 'field-error', id: 'guest-name-error' }),
              ),
              h(
                'div',
                { class: 'field' },
                tel('label', locale, 'email', undefined, { for: 'guest-email' }),
                h('input', { type: 'email', id: 'guest-email', autocomplete: 'email', 'aria-describedby': 'guest-email-error' }),
                h('p', { class: 'field-error', id: 'guest-email-error' }),
              ),
              h(
                'div',
                { class: 'field' },
                tel('label', locale, 'phone_optional', undefined, { for: 'guest-phone' }),
                h('input', { type: 'tel', id: 'guest-phone', autocomplete: 'tel', 'aria-describedby': 'guest-phone-error' }),
                h('p', { class: 'field-error', id: 'guest-phone-error' }),
              ),
            ),
        h(
          'div',
          { class: 'field' },
          tel('label', locale, 'note_optional', undefined, { for: 'note' }),
          h('input', { type: 'text', id: 'note', 'aria-describedby': 'note-error' }),
          h('p', { class: 'field-error', id: 'note-error' }),
        ),
        h(
          'div',
          { class: 'field' },
          tel('label', locale, 'cardholder_name', undefined, { for: 'cardholder-name' }),
          h('input', {
            type: 'text',
            id: 'cardholder-name',
            autocomplete: 'cc-name',
            'aria-describedby': 'cardholder-name-error',
          }),
          h('p', { class: 'field-error', id: 'cardholder-name-error' }),
        ),
        tel('button', locale, 'verify_with_code', undefined, {
          type: 'button',
          id: 'stepup-trigger',
          class: 'secondary',
          hidden: !quote.stepup_required,
        }),
        h(
          'button',
          {
            type: 'button',
            id: 'pay-button',
            class: 'primary pay-button',
            'data-i18n': payNow === 0 ? 'pay_confirm' : 'pay_amount',
            'data-i18n-args': JSON.stringify({ amount_cents: payNow }),
            disabled: quote.stepup_required,
          },
          esc(payNow === 0 ? t('pay_confirm', locale) : t('pay_amount', locale, { amount_cents: payNow })),
        ),
        tel('button', locale, 'release_seats', undefined, {
          type: 'button',
          id: 'release-seats',
          class: 'secondary',
        }),
        h('p', {
          id: 'checkout-status',
          role: 'status',
          'aria-live': 'polite',
          ...labelled(locale, 'checkout_status'),
        }),
        h('p', {
          id: 'checkout-error',
          role: 'alert',
          class: 'error-text',
          ...labelled(locale, 'checkout_error'),
        }),
      ),
      h('aside', { class: 'checkout-summary' }, priceSummary(locale, {
        admission_cents: quote.totals.admission_cents,
        gst_cents: quote.totals.gst_cents,
        qst_cents: quote.totals.qst_cents,
        uplift_cents: quote.totals.uplift_cents,
        credit_applied_cents: quote.credit_applied_cents,
        total_cents: quote.totals.total_cents,
        pay_now_cents: quote.pay_now_cents,
      })),
    ),
    stepupDialog(locale),
  ].join('');
}

export function stepupDialog(locale: Locale): string {
  return h(
    'div',
    {
      id: 'stepup-dialog',
      class: 'dialog',
      role: 'dialog',
      'aria-modal': 'true',
      ...labelled(locale, 'stepup_dialog'),
      hidden: true,
    },
    tel('h2', locale, 'stepup_dialog'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'verification_code', undefined, { for: 'stepup-code' }),
      h('input', {
        type: 'text',
        id: 'stepup-code',
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        'aria-describedby': 'stepup-code-error',
      }),
      h('p', { class: 'field-error', id: 'stepup-code-error' }),
    ),
    tel('button', locale, 'verify', undefined, { type: 'button', id: 'stepup-verify', class: 'primary' }),
    tel('button', locale, 'send_new_code', undefined, { type: 'button', id: 'stepup-resend', class: 'secondary' }),
    tel('button', locale, 'close', undefined, { type: 'button', id: 'stepup-close', class: 'secondary' }),
  );
}
