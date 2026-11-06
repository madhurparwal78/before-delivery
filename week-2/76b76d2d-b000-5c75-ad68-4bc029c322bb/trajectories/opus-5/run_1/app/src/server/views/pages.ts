import type { Locale } from '../../shared/money.ts';
import { CADENCES, TIERS, TIER_PLANS, cadenceLabelKey, fareLabelKey, tierLabelKey, type Cadence, type Tier } from '../../shared/domain.ts';
import { t } from '../../shared/strings.ts';
import { esc, h, labelled, tel } from './html.ts';
import { heading, statusRegions } from './layout.ts';
import { priceSummary, stepupDialog } from './checkout.ts';
import type { BookingPayload } from '../repo/bookings.ts';
import type { MembershipPayload } from '../service/membership.ts';
import type { Movement } from '../repo/credit.ts';

export function bookingMain(input: {
  locale: Locale;
  booking: BookingPayload;
  confirmed: boolean;
  email: string;
  guestLink: string | null;
  canRefund: boolean;
  mailDelayed: boolean;
}): string {
  const { locale, booking } = input;
  return [
    input.confirmed
      ? heading(locale, 'booking_confirmed')
      : heading(locale, 'booking_heading', { ref: booking.ref }),
    h('p', { class: 'mono booking-ref' }, esc(booking.ref)),
    input.confirmed ? tel('p', locale, 'confirmation_line', { email: input.email }) : '',
    input.confirmed && input.mailDelayed ? tel('p', locale, 'mail_delayed_line', undefined, { class: 'note' }) : '',
    h(
      'table',
      { class: 'tickets', ...labelled(locale, 'tickets_table') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_ticket', undefined, { scope: 'col' }),
          tel('th', locale, 'col_seat', undefined, { scope: 'col' }),
          tel('th', locale, 'col_fare', undefined, { scope: 'col' }),
          tel('th', locale, 'col_status', undefined, { scope: 'col' }),
        ),
      ),
      h(
        'tbody',
        {},
        ...booking.tickets.map((ticket) =>
          h(
            'tr',
            {},
            h('td', { class: 'mono' }, esc(ticket.code)),
            h('td', { class: 'mono' }, esc(ticket.seat)),
            tel('td', locale, fareLabelKey(ticket.fare)),
            tel('td', locale, `ticket_status_${ticket.status}`),
          ),
        ),
      ),
    ),
    priceSummary(locale, {
      admission_cents: booking.admission_cents,
      gst_cents: booking.gst_cents,
      qst_cents: booking.qst_cents,
      uplift_cents: booking.uplift_cents,
      credit_applied_cents: booking.credit_applied_cents,
      total_cents: booking.total_cents,
      pay_now_cents: booking.paid_cents,
    }),
    booking.split === null
      ? ''
      : h(
          'table',
          { class: 'cost-split', ...labelled(locale, 'cost_split_table') },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              tel('th', locale, 'col_payer', undefined, { scope: 'col' }),
              tel('th', locale, 'col_seat', undefined, { scope: 'col' }),
              tel('th', locale, 'col_share', undefined, { scope: 'col' }),
            ),
          ),
          h(
            'tbody',
            {},
            ...booking.split.map((payer) =>
              h(
                'tr',
                {},
                h('td', {}, esc(payer.name)),
                h('td', { class: 'mono' }, String(payer.seats)),
                tel('td', locale, 'money_plain', { amount_cents: payer.share_cents }, { class: 'mono' }),
              ),
            ),
          ),
        ),
    input.guestLink === null
      ? ''
      : h(
          'p',
          { class: 'guest-link' },
          tel('span', locale, 'private_link_label'),
          ' ',
          h('a', { href: input.guestLink, id: 'guest-link' }, esc(input.guestLink)),
        ),
    input.canRefund
      ? tel('button', locale, 'refund_booking', undefined, {
          type: 'button',
          id: 'refund-booking',
          class: 'secondary',
        })
      : '',
    h(
      'div',
      {
        id: 'refund-dialog',
        class: 'dialog',
        role: 'dialog',
        'aria-modal': 'true',
        ...labelled(locale, 'refund_booking'),
        hidden: true,
      },
      tel('h2', locale, 'refund_booking'),
      tel('button', locale, 'confirm_refund', undefined, { type: 'button', id: 'confirm-refund', class: 'primary' }),
      tel('button', locale, 'close', undefined, { type: 'button', id: 'refund-close', class: 'secondary' }),
    ),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

function membershipRegion(locale: Locale, membership: MembershipPayload | null): string {
  return h(
    'section',
    { class: 'panel', role: 'region', ...labelled(locale, 'region_membership') },
    tel('h2', locale, 'region_membership'),
    membership === null
      ? tel('p', locale, 'no_membership')
      : [
          tel('p', locale, 'membership_tier_line', { tier: `@${tierLabelKey(membership.tier)}` }),
          tel('p', locale, 'membership_billing_line', { cadence: `@${cadenceLabelKey(membership.cadence)}` }),
          membership.cadence === 'gift'
            ? tel('p', locale, 'membership_ends_line', { date: membership.ends_on ?? '' })
            : tel('p', locale, 'membership_renews_line', { date: membership.charged_through ?? '' }),
          membership.pending_change === null
            ? ''
            : tel('p', locale, 'membership_pending_line', {
                tier: `@${tierLabelKey(membership.pending_change.tier)}`,
                cadence: `@${cadenceLabelKey(membership.pending_change.cadence)}`,
                date: membership.pending_change.effective_date,
              }),
        ].join(''),
  );
}

export function accountMain(input: {
  locale: Locale;
  membership: MembershipPayload | null;
  balanceCents: number;
  movements: Movement[];
  bookings: BookingPayload[];
}): string {
  const { locale } = input;
  return [
    heading(locale, 'account_heading'),
    membershipRegion(locale, input.membership),
    h(
      'section',
      { class: 'panel', role: 'region', ...labelled(locale, 'region_credit') },
      tel('h2', locale, 'region_credit'),
      tel('p', locale, 'credit_balance', { amount_cents: input.balanceCents }, { id: 'credit-balance' }),
      h(
        'table',
        { class: 'movements', ...labelled(locale, 'credit_movements') },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            tel('th', locale, 'col_kind', undefined, { scope: 'col' }),
            tel('th', locale, 'col_amount', undefined, { scope: 'col' }),
            tel('th', locale, 'col_reference', undefined, { scope: 'col' }),
            tel('th', locale, 'col_when', undefined, { scope: 'col' }),
          ),
        ),
        h(
          'tbody',
          {},
          ...input.movements.map((movement) =>
            h(
              'tr',
              {},
              tel('td', locale, `movement_${movement.kind}`),
              tel('td', locale, 'money_plain', { amount_cents: movement.amount_cents }, { class: 'mono' }),
              h('td', { class: 'mono' }, esc(movement.reference)),
              h('td', { class: 'mono' }, esc(movement.at.slice(0, 10))),
            ),
          ),
        ),
      ),
    ),
    h(
      'table',
      { class: 'bookings', ...labelled(locale, 'my_bookings') },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          tel('th', locale, 'col_booking', undefined, { scope: 'col' }),
          tel('th', locale, 'col_film', undefined, { scope: 'col' }),
          tel('th', locale, 'col_state', undefined, { scope: 'col' }),
          tel('th', locale, 'col_amount', undefined, { scope: 'col' }),
        ),
      ),
      h(
        'tbody',
        {},
        ...input.bookings.map((booking) =>
          h(
            'tr',
            {},
            h(
              'td',
              { class: 'mono' },
              h('a', { href: `/${locale}/account/bookings/${booking.ref}` }, esc(booking.ref)),
            ),
            h('td', {}, esc(booking.screening.film_title)),
            tel('td', locale, `booking_state_${booking.state}`),
            tel('td', locale, 'money_plain', { amount_cents: booking.total_cents }, { class: 'mono' }),
          ),
        ),
      ),
    ),
  ].join('');
}

export function membershipMain(input: {
  locale: Locale;
  membership: MembershipPayload | null;
  selectedTier: Tier;
  cadence: Cadence;
  stepupNeeded: boolean;
}): string {
  const { locale } = input;
  const price = TIER_PLANS[input.selectedTier][input.cadence];
  return [
    heading(locale, 'membership_heading'),
    input.membership === null ? '' : membershipRegion(locale, input.membership),
    h(
      'div',
      { role: 'radiogroup', class: 'tier-cards', id: 'tier-group', ...labelled(locale, 'tier_group') },
      ...TIERS.map((tier) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'tier-card',
            'data-tier': tier,
            'aria-checked': tier === input.selectedTier ? 'true' : 'false',
            ...labelled(locale, tierLabelKey(tier)),
          },
          tel('span', locale, tierLabelKey(tier), undefined, { class: 'tier-name' }),
          tel('span', locale, 'tier_price_annual', { amount_cents: TIER_PLANS[tier].annual }, { class: 'mono' }),
          tel('span', locale, 'tier_price_monthly', { amount_cents: TIER_PLANS[tier].monthly }, { class: 'mono' }),
          tel('span', locale, 'tier_allowance', { count: TIER_PLANS[tier].allowance }),
        ),
      ),
    ),
    h(
      'div',
      { class: 'cadence' },
      h(
        'button',
        {
          type: 'button',
          class: 'option-opener',
          id: 'cadence-opener',
          'aria-haspopup': 'listbox',
          'aria-expanded': 'false',
          'aria-label': t('billing_button', locale, { cadence: `@${cadenceLabelKey(input.cadence)}` }),
          'data-i18n-aria': 'billing_button',
          'data-i18n-args': JSON.stringify({ cadence: `@${cadenceLabelKey(input.cadence)}` }),
          'data-cadence': input.cadence,
        },
        tel('span', locale, 'billing_button', { cadence: `@${cadenceLabelKey(input.cadence)}` }),
      ),
      h(
        'ul',
        { role: 'listbox', class: 'option-list', ...labelled(locale, 'billing_listbox'), hidden: true },
        ...CADENCES.map((cadence) =>
          tel('li', locale, cadenceLabelKey(cadence), undefined, {
            role: 'option',
            'data-cadence': cadence,
            'aria-selected': cadence === input.cadence ? 'true' : 'false',
            tabindex: '-1',
          }),
        ),
      ),
    ),
    tel('button', locale, 'verify_with_code', undefined, {
      type: 'button',
      id: 'stepup-trigger',
      class: 'secondary',
      hidden: !input.stepupNeeded,
    }),
    input.membership === null
      ? h(
          'button',
          {
            type: 'button',
            id: 'join-button',
            class: 'primary',
            'data-i18n': 'join_for',
            'data-i18n-args': JSON.stringify({ amount_cents: price }),
            'data-billing-sensitive': true,
            'data-locked': input.stepupNeeded ? '1' : null,
            disabled: input.stepupNeeded,
          },
          esc(t('join_for', locale, { amount_cents: price })),
        )
      : tel('button', locale, 'change_tier', undefined, {
          type: 'button',
          id: 'change-button',
          class: 'primary',
          'data-billing-sensitive': true,
          'data-locked': input.stepupNeeded ? '1' : null,
          disabled: input.stepupNeeded,
        }),
    statusRegions(locale, 'form_status', 'form_error'),
    stepupDialog(locale),
  ].join('');
}

export function giftMain(input: {
  locale: Locale;
  signedIn: boolean;
  selectedTier: Tier;
  stepupNeeded: boolean;
}): string {
  const { locale } = input;
  const price = TIER_PLANS[input.selectedTier].annual;
  const field = (id: string, key: string, type = 'text'): string =>
    h(
      'div',
      { class: 'field' },
      tel('label', locale, key, undefined, { for: id }),
      h('input', { type, id, 'aria-describedby': `${id}-error` }),
      h('p', { class: 'field-error', id: `${id}-error` }),
    );
  return [
    heading(locale, 'gift_heading'),
    h(
      'div',
      { role: 'radiogroup', class: 'tier-cards', id: 'tier-group', ...labelled(locale, 'tier_group') },
      ...TIERS.map((tier) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'tier-card',
            'data-tier': tier,
            'aria-checked': tier === input.selectedTier ? 'true' : 'false',
            ...labelled(locale, tierLabelKey(tier)),
          },
          tel('span', locale, tierLabelKey(tier), undefined, { class: 'tier-name' }),
          tel('span', locale, 'tier_price_annual', { amount_cents: TIER_PLANS[tier].annual }, { class: 'mono' }),
        ),
      ),
    ),
    input.signedIn ? '' : field('your-name', 'your_name'),
    input.signedIn ? '' : field('your-email', 'your_email', 'email'),
    field('recipient-name', 'recipient_name'),
    field('recipient-email', 'recipient_email', 'email'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'recipient_language', undefined, { for: 'recipient-locale' }),
      h(
        'select',
        { id: 'recipient-locale', 'aria-describedby': 'recipient-locale-error' },
        tel('option', locale, 'language_en', undefined, { value: 'en', selected: locale === 'en' }),
        tel('option', locale, 'language_fr', undefined, { value: 'fr', selected: locale === 'fr' }),
      ),
      h('p', { class: 'field-error', id: 'recipient-locale-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'message_optional', undefined, { for: 'gift-message' }),
      h('textarea', { id: 'gift-message', rows: 3, 'aria-describedby': 'gift-message-error' }, ''),
      h('p', { class: 'field-error', id: 'gift-message-error' }),
    ),
    field('cardholder-name', 'cardholder_name'),
    tel('button', locale, 'verify_with_code', undefined, {
      type: 'button',
      id: 'stepup-trigger',
      class: 'secondary',
      hidden: !input.stepupNeeded,
    }),
    h(
      'button',
      {
        type: 'button',
        id: 'buy-gift',
        class: 'primary',
        'data-i18n': 'buy_gift_for',
        'data-i18n-args': JSON.stringify({ amount_cents: price }),
        'data-billing-sensitive': true,
        'data-locked': input.stepupNeeded ? '1' : null,
        disabled: input.stepupNeeded,
      },
      esc(t('buy_gift_for', locale, { amount_cents: price })),
    ),
    statusRegions(locale, 'form_status', 'form_error'),
    stepupDialog(locale),
  ].join('');
}

export function giftRedemptionMain(input: {
  locale: Locale;
  gift: { ref: string; tier: Tier; from_name: string; message: string };
}): string {
  const { locale, gift } = input;
  return [
    heading(locale, 'gift_redeem_heading'),
    tel('p', locale, 'mail_tier', { tier: `@${tierLabelKey(gift.tier)}` }),
    tel('p', locale, 'gift_from_line', { name: gift.from_name }),
    tel('p', locale, 'gift_term_line'),
    gift.message === '' ? '' : h('p', {}, esc(gift.message)),
    tel('button', locale, 'redeem_membership', undefined, {
      type: 'button',
      id: 'redeem-button',
      class: 'primary',
      'data-billing-sensitive': true,
    }),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

export function signinMain(locale: Locale, next: string | null): string {
  return [
    heading(locale, 'signin_heading'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'email', undefined, { for: 'signin-email' }),
      h('input', { type: 'email', id: 'signin-email', autocomplete: 'email', 'aria-describedby': 'signin-email-error' }),
      h('p', { class: 'field-error', id: 'signin-email-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'password', undefined, { for: 'signin-password' }),
      h('input', {
        type: 'password',
        id: 'signin-password',
        autocomplete: 'current-password',
        'aria-describedby': 'signin-password-error',
      }),
      h('p', { class: 'field-error', id: 'signin-password-error' }),
    ),
    h('input', { type: 'hidden', id: 'signin-next', value: next ?? '' }),
    tel('button', locale, 'sign_in', undefined, { type: 'button', id: 'signin-button', class: 'primary' }),
    tel('a', locale, 'create_account_link', undefined, { href: `/${locale}/signup` }),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

export function signupMain(locale: Locale): string {
  return [
    heading(locale, 'signup_heading'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'full_name', undefined, { for: 'signup-name' }),
      h('input', { type: 'text', id: 'signup-name', autocomplete: 'name', 'aria-describedby': 'signup-name-error' }),
      h('p', { class: 'field-error', id: 'signup-name-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'email', undefined, { for: 'signup-email' }),
      h('input', { type: 'email', id: 'signup-email', autocomplete: 'email', 'aria-describedby': 'signup-email-error' }),
      h('p', { class: 'field-error', id: 'signup-email-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'password', undefined, { for: 'signup-password' }),
      h('input', {
        type: 'password',
        id: 'signup-password',
        autocomplete: 'new-password',
        'aria-describedby': 'signup-password-error',
      }),
      h('p', { class: 'field-error', id: 'signup-password-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'preferred_language', undefined, { for: 'signup-locale' }),
      h(
        'select',
        { id: 'signup-locale', 'aria-describedby': 'signup-locale-error' },
        tel('option', locale, 'language_en', undefined, { value: 'en', selected: locale === 'en' }),
        tel('option', locale, 'language_fr', undefined, { value: 'fr', selected: locale === 'fr' }),
      ),
      h('p', { class: 'field-error', id: 'signup-locale-error' }),
    ),
    tel('button', locale, 'create_account', undefined, { type: 'button', id: 'signup-button', class: 'primary' }),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

export function bookingLinkMain(locale: Locale): string {
  return [
    heading(locale, 'booking_link_heading'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'booking_reference', undefined, { for: 'link-ref' }),
      h('input', { type: 'text', id: 'link-ref', 'aria-describedby': 'link-ref-error' }),
      h('p', { class: 'field-error', id: 'link-ref-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'email', undefined, { for: 'link-email' }),
      h('input', { type: 'email', id: 'link-email', 'aria-describedby': 'link-email-error' }),
      h('p', { class: 'field-error', id: 'link-email-error' }),
    ),
    tel('button', locale, 'email_me_link', undefined, { type: 'button', id: 'link-button', class: 'primary' }),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

export function contactMain(locale: Locale): string {
  return [
    heading(locale, 'contact_heading'),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'full_name', undefined, { for: 'contact-name' }),
      h('input', { type: 'text', id: 'contact-name', 'aria-describedby': 'contact-name-error' }),
      h('p', { class: 'field-error', id: 'contact-name-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'email', undefined, { for: 'contact-email' }),
      h('input', { type: 'email', id: 'contact-email', 'aria-describedby': 'contact-email-error' }),
      h('p', { class: 'field-error', id: 'contact-email-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'subject', undefined, { for: 'contact-subject' }),
      h('input', { type: 'text', id: 'contact-subject', 'aria-describedby': 'contact-subject-error' }),
      h('p', { class: 'field-error', id: 'contact-subject-error' }),
    ),
    h(
      'div',
      { class: 'field' },
      tel('label', locale, 'message', undefined, { for: 'contact-message' }),
      h('textarea', { id: 'contact-message', rows: 5, 'aria-describedby': 'contact-message-error' }, ''),
      h('p', { class: 'field-error', id: 'contact-message-error' }),
    ),
    tel('button', locale, 'send_enquiry', undefined, { type: 'button', id: 'contact-button', class: 'primary' }),
    statusRegions(locale, 'form_status', 'form_error'),
  ].join('');
}

export function notFoundMain(locale: Locale): string {
  return [heading(locale, 'err_not_found')].join('');
}


