import { api, formatAmount, fareLabel, type Locale, type ErrorShape } from './common';

const locale: Locale = document.documentElement.lang === 'fr' ? 'fr' : 'en';
const L = locale === 'fr';

function errOf(err: unknown): Error & { payload?: ErrorShape } {
  return err as Error & { payload?: ErrorShape };
}

function showError(err: unknown): void {
  const line = document.getElementById('form-error') ?? document.getElementById('checkout-error');
  const e = errOf(err);
  if (line) line.textContent = e.payload?.error?.message ?? e.message;
}

function announce(text: string): void {
  const line = document.getElementById('form-status');
  if (line) line.textContent = text;
}

function setupAuth(): void {
  const signin = document.getElementById('signin-submit');
  if (signin) {
    signin.addEventListener('click', async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const next = params.get('next') ?? '';
        const data = await api<{ redirect: string }>('/api/auth/signin', {
          method: 'POST',
          body: JSON.stringify({
            email: (document.getElementById('signin-email') as HTMLInputElement).value.trim(),
            password: (document.getElementById('signin-password') as HTMLInputElement).value,
            next,
          }),
        });
        window.location.href = data.redirect;
      } catch (err) {
        showError(err);
      }
    });
  }
  const signup = document.getElementById('signup-submit');
  if (signup) {
    signup.addEventListener('click', async () => {
      try {
        await api('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            name: (document.getElementById('signup-name') as HTMLInputElement).value.trim(),
            email: (document.getElementById('signup-email') as HTMLInputElement).value.trim(),
            password: (document.getElementById('signup-password') as HTMLInputElement).value,
            locale: (document.getElementById('signup-locale') as HTMLSelectElement).value,
          }),
        });
        window.location.href = `/${(document.getElementById('signup-locale') as HTMLSelectElement).value}/account`;
      } catch (err) {
        showError(err);
      }
    });
  }
}

function setupMembership(): void {
  const root = document.getElementById('membership-page');
  if (!root) return;
  const currentTier = root.dataset.currentTier ?? '';
  const currentCadence = root.dataset.currentCadence ?? 'monthly';
  const creditBalance = Number(root.dataset.creditBalance ?? '0');
  let cadence: string = currentCadence === 'gift' ? 'monthly' : currentCadence;
  const prices: Record<string, Record<string, number>> = {
    friend: { annual: 6000, monthly: 600 },
    cinephile: { annual: 12000, monthly: 1200 },
    projectionist: { annual: 24000, monthly: 2400 },
  };

  const group = document.getElementById('tier-group') as HTMLElement | null;
  const actionButton = document.getElementById('membership-action') as HTMLButtonElement | null;
  const amountPreview = document.getElementById('membership-amount');
  const cadenceButton = document.getElementById('cadence-button') as HTMLButtonElement | null;
  const cadenceListbox = document.getElementById('cadence-listbox') as HTMLElement | null;
  let verified = false;
  let challengeId = '';

  function selectedTier(): string {
    const checked = group?.querySelector<HTMLInputElement>('input[name="tier"]:checked');
    return checked?.value ?? currentTier ?? 'friend';
  }

  function tierChosen(): boolean {
    return currentTier === selectedTier();
  }

  function refresh(): void {
    const tier = selectedTier();
    const amount = prices[tier]?.[cadence] ?? 0;
    if (amountPreview) amountPreview.textContent = formatAmount(amount, locale);
    if (actionButton) {
      const isChange = currentTier !== '' && tierChosen();
      actionButton.textContent = currentTier === ''
        ? `${L ? 'Adhérer pour' : 'Join for'} ${formatAmount(amount, locale)}`
        : (L ? 'Changer de palier' : 'Change tier');
      const needsStepup = verified
        ? false
        : (creditBalance > 0 && currentTier === '') || tierChosen();
      actionButton.disabled = needsStepup || document.body.classList.contains('billing-down');
      const verifyButton = document.getElementById('verify-code') as HTMLButtonElement | null;
      if (verifyButton) verifyButton.hidden = !needsStepup;
    }
  }

  group?.addEventListener('change', refresh);

  cadenceButton?.addEventListener('click', () => {
    if (!cadenceListbox) return;
    cadenceListbox.hidden = false;
    cadenceButton.setAttribute('aria-expanded', 'true');
    const options = Array.from(cadenceListbox.querySelectorAll('[role="option"]')) as HTMLElement[];
    const selected = options.find(o => o.dataset.value === cadence) ?? options[0];
    selected?.focus();
    const close = (focusButton: boolean) => {
      cadenceListbox.hidden = true;
      cadenceButton.setAttribute('aria-expanded', 'false');
      if (focusButton) cadenceButton.focus();
      document.removeEventListener('click', onDoc);
    };
    const onDoc = (e: MouseEvent) => {
      if (!cadenceListbox.contains(e.target as Node) && e.target !== cadenceButton) close(false);
    };
    document.addEventListener('click', onDoc);
    cadenceListbox.onkeydown = (e: KeyboardEvent) => {
      const index = options.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        options[Math.min(index + 1, options.length - 1)]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        options[Math.max(index - 1, 0)]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const option = options[index];
        if (option) {
          cadence = option.dataset.value ?? 'monthly';
          for (const o of options) o.setAttribute('aria-selected', o === option ? 'true' : 'false');
        }
        close(true);
        cadenceButton.textContent = `${L ? 'Facturation' : 'Billing'}: ${L ? (cadence === 'annual' ? 'Annuelle' : 'Mensuelle') : (cadence === 'annual' ? 'Annual' : 'Monthly')}`;
        refresh();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        close(false);
      }
    };
    for (const option of options) {
      option.addEventListener('click', () => {
        cadence = option.dataset.value ?? 'monthly';
        for (const o of options) o.setAttribute('aria-selected', o === option ? 'true' : 'false');
        close(true);
        cadenceButton.textContent = `${L ? 'Facturation' : 'Billing'}: ${L ? (cadence === 'annual' ? 'Annuelle' : 'Mensuelle') : (cadence === 'annual' ? 'Annual' : 'Monthly')}`;
        refresh();
      });
    }
  });

  const verifyButton = document.getElementById('verify-code');
  verifyButton?.addEventListener('click', async () => {
    const dialog = document.getElementById('stepup-dialog') as HTMLElement | null;
    if (!dialog) return;
    dialog.hidden = false;
    (document.getElementById('stepup-code') as HTMLInputElement | null)?.focus();
    if (!challengeId) {
      try {
        const data = await api<{ challenge: { id: string; masked_email: string } }>('/api/stepup/start', {
          method: 'POST',
          body: JSON.stringify({ purpose: 'membership' }),
        });
        challengeId = data.challenge.id;
        announce(L
          ? `Nous avons envoyé un code à 6 chiffres à ${data.challenge.masked_email}.`
          : `We sent a 6-digit code to ${data.challenge.masked_email}.`);
      } catch (err) {
        showError(err);
      }
    }
  });

  document.getElementById('stepup-verify')?.addEventListener('click', async () => {
    const code = (document.getElementById('stepup-code') as HTMLInputElement | null)?.value ?? '';
    try {
      await api('/api/stepup/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      verified = true;
      announce(L ? 'Vérifié.' : 'Verified.');
      const dialog = document.getElementById('stepup-dialog');
      if (dialog) dialog.hidden = true;
      refresh();
      actionButton?.focus();
    } catch (err) {
      showError(err);
    }
  });

  document.getElementById('stepup-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('stepup-dialog');
    if (dialog) dialog.hidden = true;
    verifyButton?.focus();
  });

  document.getElementById('stepup-resend')?.addEventListener('click', async () => {
    try {
      const data = await api<{ challenge: { id: string } }>('/api/stepup/resend', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      challengeId = data.challenge.id;
    } catch (err) {
      showError(err);
    }
  });

  actionButton?.addEventListener('click', async () => {
    if (!actionButton || actionButton.disabled) return;
    actionButton.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    const tier = selectedTier();
    try {
      const path = currentTier === '' ? '/api/membership' : '/api/membership/change';
      const data = await api<{ effective?: string; effective_date?: string; invoice?: { amount_cents: number } | null; membership: { tier: string } }>(path, {
        method: 'POST',
        body: JSON.stringify({ tier, cadence }),
      });
      if (data.effective === 'end-of-term') {
        announce(L
          ? `Votre changement prend effet le ${data.effective_date ?? ''}. Rien n'est facturé aujourd'hui.`
          : `Your change takes effect on ${data.effective_date ?? ''}. Nothing is charged today.`);
      } else {
        announce(L
          ? `Votre nouveau palier est actif. Facturé aujourd'hui : ${formatAmount(data.invoice?.amount_cents ?? 0, locale)}.`
          : `Your new tier is active. Charged today: ${formatAmount(data.invoice?.amount_cents ?? 0, locale)}.`);
      }
      window.setTimeout(() => { window.location.href = `/${locale}/account`; }, 1500);
    } catch (err) {
      showError(err);
      actionButton.removeAttribute('disabled');
    }
  });

  refresh();
}

function setupGift(): void {
  const rootMaybe = document.getElementById('gift-page');
  if (!rootMaybe) return;
  const root: HTMLElement = rootMaybe;
  const buyButton = document.getElementById('buy-gift') as HTMLButtonElement | null;
  const prices: Record<string, number> = {
    friend: 6000, cinephile: 12000, projectionist: 24000,
  };
  let verified = false;
  let challengeId = '';

  function refresh(): void {
    const checked = root.querySelector<HTMLInputElement>('input[name="tier"]:checked');
    const tier = checked?.value ?? 'cinephile';
    const amount = prices[tier] ?? 0;
    if (buyButton) {
      buyButton.textContent = `${L ? 'Acheter le cadeau pour' : 'Buy gift for'} ${formatAmount(amount, locale)}`;
      const needsStepup = verified ? false : (creditBalance() > 0 && signedIn());
      buyButton.disabled = document.body.classList.contains('billing-down') || !cardholderOk();
      const verifyButton = document.getElementById('verify-code') as HTMLButtonElement | null;
      if (verifyButton) verifyButton.hidden = !needsStepup;
    }
  }

  function signedIn(): boolean {
    return document.getElementById('purchaser-name') === null;
  }

  function creditBalance(): number {
    return 0;
  }

  function cardholderOk(): boolean {
    const value = (document.getElementById('gift-cardholder') as HTMLInputElement | null)?.value.trim() ?? '';
    if (signedIn()) return true;
    return value !== '';
  }

  root.addEventListener('change', refresh);
  for (const id of ['gift-cardholder', 'purchaser-name', 'purchaser-email', 'recipient-name', 'recipient-email']) {
    document.getElementById(id)?.addEventListener('input', refresh);
  }

  document.getElementById('verify-code')?.addEventListener('click', async () => {
    const dialog = document.getElementById('stepup-dialog') as HTMLElement | null;
    if (!dialog) return;
    dialog.hidden = false;
    (document.getElementById('stepup-code') as HTMLInputElement | null)?.focus();
    if (!challengeId) {
      try {
        const data = await api<{ challenge: { id: string } }>('/api/stepup/start', {
          method: 'POST',
          body: JSON.stringify({ purpose: 'gift' }),
        });
        challengeId = data.challenge.id;
      } catch (err) {
        showError(err);
      }
    }
  });
  document.getElementById('stepup-verify')?.addEventListener('click', async () => {
    const code = (document.getElementById('stepup-code') as HTMLInputElement | null)?.value ?? '';
    try {
      await api('/api/stepup/verify', {
        method: 'POST',
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      verified = true;
      announce(L ? 'Vérifié.' : 'Verified.');
      const dialog = document.getElementById('stepup-dialog');
      if (dialog) dialog.hidden = true;
      refresh();
      buyButton?.focus();
    } catch (err) {
      showError(err);
    }
  });
  document.getElementById('stepup-close')?.addEventListener('click', () => {
    const dialog = document.getElementById('stepup-dialog');
    if (dialog) dialog.hidden = true;
    document.getElementById('verify-code')?.focus();
  });

  buyButton?.addEventListener('click', async () => {
    if (!buyButton || buyButton.disabled) return;
    buyButton.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    const key = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    try {
      const purchaser = signedIn() ? undefined : {
        name: (document.getElementById('purchaser-name') as HTMLInputElement).value.trim(),
        email: (document.getElementById('purchaser-email') as HTMLInputElement).value.trim(),
      };
      const data = await api<{ gift: { ref: string } }>('/api/gifts', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({
          tier: root.querySelector<HTMLInputElement>('input[name="tier"]:checked')?.value ?? 'cinephile',
          purchaser,
          recipient: {
            name: (document.getElementById('recipient-name') as HTMLInputElement).value.trim(),
            email: (document.getElementById('recipient-email') as HTMLInputElement).value.trim(),
            locale: (document.getElementById('recipient-locale') as HTMLSelectElement).value,
          },
          message: (document.getElementById('gift-message') as HTMLInputElement).value.trim(),
          cardholder_name: (document.getElementById('gift-cardholder') as HTMLInputElement).value.trim(),
        }),
      });
      announce(L ? 'Adhésion-cadeau achetée.' : 'Gift membership purchased.');
      window.setTimeout(() => { window.location.href = `/${locale}/account`; }, 1500);
      void data;
    } catch (err) {
      showError(err);
      buyButton.removeAttribute('disabled');
    }
  });

  refresh();
}

function setupGiftRedemption(): void {
  const root = document.getElementById('gift-redemption');
  if (!root) return;
  const redeem = document.getElementById('redeem-membership');
  redeem?.addEventListener('click', async () => {
    if (!redeem) return;
    redeem.setAttribute('disabled', 'disabled');
    const token = window.location.pathname.split('/').pop() ?? '';
    try {
      await api(`/api/gift-redemptions/${token}/redeem`, { method: 'POST' });
      announce(L ? 'Votre adhésion-cadeau est active' : 'Your gift membership is active');
      window.setTimeout(() => { window.location.href = `/${locale}/account`; }, 1500);
    } catch (err) {
      showError(err);
      redeem.removeAttribute('disabled');
    }
  });
}

function setupContact(): void {
  const submit = document.getElementById('enquiry-submit');
  if (!submit) return;
  submit.addEventListener('click', async () => {
    submit.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    try {
      const data = await api<{ enquiry: { ref: string } }>('/api/enquiries', {
        method: 'POST',
        body: JSON.stringify({
          name: (document.getElementById('enquiry-name') as HTMLInputElement).value.trim(),
          email: (document.getElementById('enquiry-email') as HTMLInputElement).value.trim(),
          subject: (document.getElementById('enquiry-subject') as HTMLInputElement).value.trim(),
          message: (document.getElementById('enquiry-message') as HTMLTextAreaElement).value.trim(),
        }),
      });
      announce(L
        ? `Merci. Votre demande ${data.enquiry.ref} a bien été reçue. Nous répondons par courriel.`
        : `Thank you. Your enquiry ${data.enquiry.ref} has been received. We reply by email.`);
    } catch (err) {
      showError(err);
      submit.removeAttribute('disabled');
    }
  });
}

function setupBookingLink(): void {
  const submit = document.getElementById('link-submit');
  if (!submit) return;
  submit.addEventListener('click', async () => {
    submit.setAttribute('disabled', 'disabled');
    announce(L ? 'En cours…' : 'Working…');
    try {
      await api('/api/guest/booking-links', {
        method: 'POST',
        body: JSON.stringify({
          booking_ref: (document.getElementById('link-ref') as HTMLInputElement).value.trim(),
          email: (document.getElementById('link-email') as HTMLInputElement).value.trim(),
        }),
      });
      announce(L
        ? 'Si la référence et le courriel correspondent, un nouveau lien est en route et tout lien précédent ne fonctionne plus.'
        : 'If the reference and email match, a new link is on its way and any earlier link no longer works.');
    } catch (err) {
      showError(err);
      submit.removeAttribute('disabled');
    }
  });
}

function setupRefund(): void {
  const refundButton = document.getElementById('refund-booking');
  if (!refundButton) return;
  const dialog = document.getElementById('refund-dialog') as HTMLElement | null;
  refundButton.addEventListener('click', () => {
    if (dialog) {
      dialog.hidden = false;
      document.getElementById('confirm-refund')?.focus();
    }
  });
  document.getElementById('confirm-refund')?.addEventListener('click', async () => {
    const ref = (document.querySelector('.booking-view') as HTMLElement | null)?.dataset.bookingRef ?? '';
    const isGuestLink = window.location.pathname.includes('/b/');
    const path = isGuestLink
      ? `/api/guest/bookings/${window.location.pathname.split('/').pop()}/refund`
      : `/api/bookings/${ref}/refund`;
    try {
      const data = await api<{ refund: { refunded_cents: number; recredited_cents: number } }>(path, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const status = document.getElementById('refund-status');
      if (status) {
        status.textContent = L
          ? `Remboursement émis : ${formatAmount(data.refund.refunded_cents, locale)} sur le paiement d'origine.${data.refund.recredited_cents > 0 ? ` ${formatAmount(data.refund.recredited_cents, locale)} remis en crédit.` : ''}`
          : `Refund issued: ${formatAmount(data.refund.refunded_cents, locale)} to the original payment.${data.refund.recredited_cents > 0 ? ` ${formatAmount(data.refund.recredited_cents, locale)} returned to your credit.` : ''}`;
      }
      if (dialog) dialog.hidden = true;
      refundButton.remove();
    } catch (err) {
      showError(err);
    }
  });
}

setupAuth();
setupMembership();
setupGift();
setupGiftRedemption();
setupContact();
setupBookingLink();
setupRefund();
void fareLabel;
export {};
