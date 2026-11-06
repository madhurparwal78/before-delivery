import { all, announce, manageDialog, one, readState, setText } from './dom.js';
import { ApiCallError, call, newIdempotencyKey } from './api.js';
import type { Locale } from '../shared/locale.js';
import { formatAmount, localeFromLang } from '../shared/locale.js';
import { copiesLeft, s } from '../shared/strings.js';
import { licenceLabel } from '../shared/labels.js';
import { errorMessage } from '../shared/copy.js';
import type { LicenceType } from '../domain/money.js';

interface EditionBlock {
  total: number;
  remaining: number;
  price_cents: number;
}

interface ModelState {
  slug: string;
  locale: Locale;
  lang: string | null;
  access: string | null;
  edition: EditionBlock | null;
}

const state = readState<ModelState>('model-state');
const dialog = one<HTMLDialogElement>('[data-checkout-dialog]');
if (state !== null && dialog !== null) wire(state, dialog);

function wire(state: ModelState, dialog: HTMLDialogElement): void {
  const locale: Locale = state.locale ?? localeFromLang(state.lang);
  const title = one('[data-checkout-title]', dialog);
  const amountNode = one('[data-checkout-amount]', dialog);
  const alertNode = one('[data-checkout-alert]', dialog);
  const statusNode = one('[data-checkout-status]', dialog);
  const emailField = one<HTMLInputElement>('[data-checkout-email]', dialog);
  const termsField = one<HTMLInputElement>('[data-checkout-terms]', dialog);
  const payButton = one<HTMLButtonElement>('[data-checkout-pay]', dialog);
  const cancelButton = one<HTMLButtonElement>('[data-checkout-cancel]', dialog);

  let opener: HTMLElement | null = null;
  let licence: LicenceType = 'personal';
  let idempotencyKey = newIdempotencyKey();
  const handle = manageDialog(dialog, () => opener);

  function open(button: HTMLElement, chosen: LicenceType, amountCents: number): void {
    opener = button;
    licence = chosen;
    // One key is made when the dialog opens and reused for every submit from it.
    idempotencyKey = newIdempotencyKey();
    setText(title, licenceLabel(chosen, locale));
    setText(amountNode, formatAmount(amountCents, locale));
    setText(alertNode, '');
    setText(statusNode, '');
    if (payButton !== null) payButton.disabled = false;
    handle.open();
    emailField?.focus();
  }

  for (const button of all<HTMLButtonElement>('[data-buy]')) {
    button.addEventListener('click', () => {
      open(
        button,
        button.dataset.buy as LicenceType,
        Number.parseInt(button.dataset.amount ?? '0', 10),
      );
    });
  }

  cancelButton?.addEventListener('click', () => handle.close());

  async function pay(): Promise<void> {
    setText(alertNode, '');
    announce(statusNode, s('processingPayment', locale));
    try {
      const reply = await call<{ receipt_url: string }>('/api/checkout', {
        method: 'POST',
        locale,
        idempotencyKey,
        body: {
          model: state.slug,
          licence,
          email: emailField?.value ?? '',
          terms: termsField?.checked === true,
          locale,
          ...(state.access === null ? {} : { access: state.access }),
        },
      });
      const url = new URL(reply.receipt_url, window.location.origin);
      if (state.lang !== null) url.searchParams.set('lang', state.lang);
      window.location.assign(url.toString());
    } catch (error) {
      setText(statusNode, '');
      if (!(error instanceof ApiCallError)) throw error;
      const fields = Object.values(error.failure.fields);
      setText(alertNode, fields.length > 0 ? fields.join(' ') : error.failure.message);
      if (error.failure.code === 'edition_sold_out' && payButton !== null) payButton.disabled = true;
    }
  }

  payButton?.addEventListener('click', () => void pay());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && document.activeElement === payButton) {
      event.preventDefault();
      void pay();
    }
  });

  /* The edition counter refreshes at least once a second while the page is open. */
  const editionStatus = one(`[data-edition-status="${state.slug}"]`);
  if (state.edition !== null && editionStatus !== null) {

    let shown = state.edition.remaining;
    window.setInterval(() => {
      void (async () => {
        const reply = await call<{ remaining: number; total: number }>(
          `/api/models/${state.slug}/edition${state.access === null ? '' : `?access=${encodeURIComponent(state.access)}`}`,
          { locale },
        ).catch(() => null);
        if (reply === null || reply.remaining === shown) return;
        shown = reply.remaining;
        editionStatus.textContent =
          shown === 0 ? s('soldOut', locale) : copiesLeft(shown, reply.total, locale);
        if (shown === 0) {
          for (const button of all<HTMLButtonElement>('[data-buy="edition"]')) {
            button.disabled = true;
          }
          if (dialog.open && licence === 'edition') {
            setText(alertNode, errorMessage('edition_sold_out', locale));
            if (payButton !== null) payButton.disabled = true;
          }
        }
      })();
    }, 1000);
  }
}
