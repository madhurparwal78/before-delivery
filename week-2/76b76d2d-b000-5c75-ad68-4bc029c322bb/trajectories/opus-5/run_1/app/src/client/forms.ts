import { TIER_PLANS, type Cadence, type Tier } from '../shared/domain.ts';
import { call, newIdempotencyKey } from './api.ts';
import { clearFeedback, runAction, showPlainStatus, showStatus, type Regions } from './feedback.ts';
import { setI18n, tr } from './i18n.ts';
import { initStepup } from './stepup.ts';
import { closeDialog, initOptionMenu, openDialog } from './widgets.ts';

const regions: Regions = { status: 'form-status', error: 'form-error' };

function value(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)?.value.trim() ?? '';
}

export function initMembership(data: { has_membership: boolean }): void {
  let tier: Tier = 'cinephile';
  let cadence: Cadence = 'annual';
  const joinButton = document.getElementById('join-button') as HTMLButtonElement | null;
  const changeButton = document.getElementById('change-button') as HTMLButtonElement | null;

  const syncPrice = (): void => {
    if (joinButton === null) return;
    setI18n(joinButton, 'join_for', { amount_cents: TIER_PLANS[tier][cadence] });
  };

  for (const card of document.querySelectorAll<HTMLElement>('.tier-card')) {
    card.addEventListener('click', () => {
      tier = (card.getAttribute('data-tier') ?? 'cinephile') as Tier;
      for (const other of document.querySelectorAll('.tier-card')) {
        other.setAttribute('aria-checked', other === card ? 'true' : 'false');
      }
      syncPrice();
    });
  }

  const opener = document.getElementById('cadence-opener');
  const list = opener?.parentElement?.querySelector<HTMLElement>('[role="listbox"]') ?? null;
  if (opener !== null && list !== null) {
    initOptionMenu(
      opener,
      list,
      (chosen, option) => {
        cadence = chosen as Cadence;
        for (const other of list.querySelectorAll('[role="option"]')) {
          other.setAttribute('aria-selected', other === option ? 'true' : 'false');
        }
        opener.setAttribute('data-cadence', chosen);
        opener.setAttribute('data-i18n-args', JSON.stringify({ cadence: `@cadence_${chosen}` }));
        opener.setAttribute('aria-label', tr('billing_button', { cadence: `@cadence_${chosen}` }));
        const label = opener.querySelector('span');
        if (label !== null) setI18n(label, 'billing_button', { cadence: `@cadence_${chosen}` });
        syncPrice();
      },
      'data-cadence',
    );
  }

  joinButton?.addEventListener('click', () => {
    void runAction(joinButton, regions, async () => {
      clearFeedback(regions);
      const result = await call<{ invoice: { amount_cents: number } }>('POST', '/api/membership', { tier, cadence });
      showStatus(regions, 'membership_active');
      const heading = document.getElementById('main-heading');
      if (heading !== null) setI18n(heading, 'membership_active');
      showPlainStatus(regions, `${tr('membership_active')} ${tr('mail_amount_charged', { amount_cents: result.invoice.amount_cents })}`);
    });
  });

  changeButton?.addEventListener('click', () => {
    void runAction(changeButton, regions, async () => {
      clearFeedback(regions);
      const result = await call<{
        effective: 'immediate' | 'end-of-term';
        effective_date: string;
        invoice: { amount_cents: number } | null;
      }>('POST', '/api/membership/change', { tier, cadence });
      if (result.effective === 'immediate') {
        showStatus(regions, 'upgrade_done', { amount_cents: result.invoice?.amount_cents ?? 0 });
      } else {
        showStatus(regions, 'change_scheduled', { date: result.effective_date });
      }
    });
  });

  initStepup({
    purpose: 'membership',
    regions,
    onVerified: () => {
      const button = data.has_membership ? changeButton : joinButton;
      const trigger = document.getElementById('stepup-trigger');
      if (trigger !== null) trigger.hidden = true;
      if (button !== null) {
        button.removeAttribute('data-locked');
        button.disabled = false;
        button.focus();
      }
    },
  });
  syncPrice();
}

export function initGift(data: { signed_in: boolean }): void {
  let tier: Tier = 'cinephile';
  const buyButton = document.getElementById('buy-gift') as HTMLButtonElement | null;
  const key = newIdempotencyKey();
  for (const card of document.querySelectorAll<HTMLElement>('.tier-card')) {
    card.addEventListener('click', () => {
      tier = (card.getAttribute('data-tier') ?? 'cinephile') as Tier;
      for (const other of document.querySelectorAll('.tier-card')) {
        other.setAttribute('aria-checked', other === card ? 'true' : 'false');
      }
      if (buyButton !== null) setI18n(buyButton, 'buy_gift_for', { amount_cents: TIER_PLANS[tier].annual });
    });
  }
  buyButton?.addEventListener('click', () => {
    void runAction(buyButton, regions, async () => {
      clearFeedback(regions);
      const body: Record<string, unknown> = {
        tier,
        recipient: {
          name: value('recipient-name'),
          email: value('recipient-email'),
          locale: value('recipient-locale'),
        },
        message: value('gift-message'),
        cardholder_name: value('cardholder-name'),
      };
      if (!data.signed_in) {
        body.purchaser = { name: value('your-name'), email: value('your-email') };
      }
      await call('POST', '/api/gifts', body, { 'Idempotency-Key': key });
      const heading = document.getElementById('main-heading');
      if (heading !== null) setI18n(heading, 'gift_purchased');
      showStatus(regions, 'gift_purchased_line', { email: value('recipient-email') });
    });
  });
  initStepup({
    purpose: 'gift',
    regions,
    onVerified: () => {
      const trigger = document.getElementById('stepup-trigger');
      if (trigger !== null) trigger.hidden = true;
      if (buyButton !== null) {
        buyButton.removeAttribute('data-locked');
        buyButton.disabled = false;
        buyButton.focus();
      }
    },
  });
}

export function initGiftRedemption(data: { token: string }): void {
  const button = document.getElementById('redeem-button') as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void runAction(button, regions, async () => {
      clearFeedback(regions);
      await call('POST', `/api/gift-redemptions/${data.token}/redeem`, {});
      const heading = document.getElementById('main-heading');
      if (heading !== null) setI18n(heading, 'gift_redeemed');
      showStatus(regions, 'gift_redeemed');
    });
  });
}

export function initSignin(): void {
  const button = document.getElementById('signin-button') as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void runAction(button, regions, async () => {
      clearFeedback(regions);
      const next = value('signin-next');
      const result = await call<{ redirect: string }>('POST', '/api/auth/signin', {
        email: value('signin-email'),
        password: (document.getElementById('signin-password') as HTMLInputElement | null)?.value ?? '',
        next: next === '' ? undefined : next,
      });
      window.location.assign(result.redirect);
    });
  });
}

export function initSignup(): void {
  const button = document.getElementById('signup-button') as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void runAction(button, regions, async () => {
      clearFeedback(regions);
      const chosen = value('signup-locale');
      await call('POST', '/api/auth/signup', {
        name: value('signup-name'),
        email: value('signup-email'),
        password: (document.getElementById('signup-password') as HTMLInputElement | null)?.value ?? '',
        locale: chosen,
      });
      window.location.assign(`/${chosen}/account`);
    });
  });
}

export function initBookingLink(): void {
  const button = document.getElementById('link-button') as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void runAction(button, regions, async () => {
      clearFeedback(regions);
      await call('POST', '/api/guest/booking-links', {
        booking_ref: value('link-ref'),
        email: value('link-email'),
      });
      showStatus(regions, 'booking_link_requested');
    });
  });
}

export function initContact(): void {
  const button = document.getElementById('contact-button') as HTMLButtonElement | null;
  button?.addEventListener('click', () => {
    void runAction(button, regions, async () => {
      clearFeedback(regions);
      const result = await call<{ enquiry: { ref: string } }>('POST', '/api/enquiries', {
        name: value('contact-name'),
        email: value('contact-email'),
        subject: value('contact-subject'),
        message: value('contact-message'),
      });
      showStatus(regions, 'enquiry_received', { ref: result.enquiry.ref });
    });
  });
}

export function initBookingPage(data: { booking_ref: string; token: string | null }): void {
  const refundButton = document.getElementById('refund-booking') as HTMLButtonElement | null;
  const dialog = document.getElementById('refund-dialog');
  const confirm = document.getElementById('confirm-refund') as HTMLButtonElement | null;
  const close = document.getElementById('refund-close');
  if (refundButton === null || dialog === null || confirm === null) return;
  refundButton.addEventListener('click', () => openDialog(dialog, refundButton));
  close?.addEventListener('click', () => closeDialog(dialog));
  confirm.addEventListener('click', () => {
    void runAction(confirm, regions, async () => {
      clearFeedback(regions);
      const path =
        data.token === null
          ? `/api/bookings/${data.booking_ref}/refund`
          : `/api/guest/bookings/${data.token}/refund`;
      const result = await call<{ refund: { refunded_cents: number; recredited_cents: number } }>('POST', path, {});
      closeDialog(dialog);
      const message =
        tr('refund_done', { amount_cents: result.refund.refunded_cents }) +
        (result.refund.recredited_cents > 0
          ? tr('refund_done_credit', { amount_cents: result.refund.recredited_cents })
          : '');
      showPlainStatus(regions, message);
      refundButton.hidden = true;
    });
  });
}


