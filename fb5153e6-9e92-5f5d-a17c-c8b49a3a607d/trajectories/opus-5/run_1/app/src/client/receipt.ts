import { all, one, readState } from './dom.js';
import { ApiCallError, call, newIdempotencyKey } from './api.js';
import type { Locale } from '../shared/locale.js';
import { localeFromLang } from '../shared/locale.js';

interface ReceiptState {
  slug: string;
  receipt: string;
  email: string;
  locale: Locale;
  lang: string | null;
}

const state = readState<ReceiptState>('receipt-state');
const alertNode = one('[data-receipt-alert]');
const heading = one<HTMLElement>('[data-receipt-heading]');
heading?.focus();

if (state !== null) {
  const locale: Locale = state.locale ?? localeFromLang(state.lang);
  for (const button of all<HTMLButtonElement>('[data-upgrade]')) {
    const key = newIdempotencyKey();
    button.addEventListener('click', () => {
      void (async () => {
        try {
          const reply = await call<{ receipt_url: string }>('/api/checkout', {
            method: 'POST',
            locale,
            idempotencyKey: key,
            body: {
              model: state.slug,
              licence: button.dataset.upgrade,
              email: state.email,
              terms: true,
              locale,
              upgrade_from: state.receipt,
            },
          });
          const url = new URL(reply.receipt_url, window.location.origin);
          if (state.lang !== null) url.searchParams.set('lang', state.lang);
          window.location.assign(url.toString());
        } catch (error) {
          if (!(error instanceof ApiCallError)) throw error;
          if (alertNode !== null) alertNode.textContent = error.failure.message;
        }
      })();
    });
  }
}
