import { api, copy, escapeHtml, announce, wireCore } from './app-core.js';

function amountOf(cents: number): string {
  const l = document.documentElement.lang === 'de' ? 'de' : 'en';
  const whole = Math.floor(cents / 100).toLocaleString(l === 'en' ? 'en-US' : 'de-DE');
  const part = String(cents % 100).padStart(2, '0');
  return l === 'en' ? `€${whole}.${part}` : `${whole},${part} €`;
}

/** Receipt upgrade buttons open the checkout dialog with the receipt token. */
function wireUpgrades(): void {
  document.querySelectorAll<HTMLButtonElement>('.upgrade-button').forEach(button => {
    button.addEventListener('click', () => {
      const licence = button.dataset['upgrade'] ?? 'commercial';
      const priceCents = parseAmount(button.textContent ?? '0');
      const token = window.location.pathname.split('/').pop() ?? '';
      const modelSlug = button.dataset['model'] ?? '';
      openUpgradeCheckout(licence, priceCents, token, modelSlug);
    });
  });
}

function parseAmount(text: string): number {
  const match = /(\d+(?:[.,]\d{1,2})?)/.exec(text);
  if (match === null) return 0;
  const raw = match[1] ?? '0';
  if (raw.includes(',')) {
    const [whole, part = '0'] = raw.split(',');
    return Number(whole) * 100 + Number((part + '00').slice(0, 2));
  }
  if (raw.includes('.')) {
    const [whole, part = '0'] = raw.split('.');
    return Number(whole) * 100 + Number((part + '00').slice(0, 2));
  }
  return Number(raw) * 100;
}

function openUpgradeCheckout(licence: string, priceCents: number, token: string, modelSlug: string): void {
  const idemKey = `ui-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  const dialog = document.createElement('div');
  dialog.className = 'dialog-underlay';
  dialog.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
  <h2 id="checkout-title">${copy('checkout.title')}</h2>
  <p>${escapeHtml(copy(licence === 'commercial' ? 'licence.commercial' : 'licence.studio'))} · <span class="mono">${amountOf(priceCents)}</span></p>
  <label for="checkout-email">${copy('checkout.email')}</label>
  <input type="email" id="checkout-email" autocomplete="email">
  <label class="checkbox-row"><input type="checkbox" id="checkout-terms"> ${copy('checkout.terms')}</label>
  <button type="button" id="checkout-pay">${copy('checkout.pay_now')}</button>
  <button type="button" id="checkout-cancel">${copy('checkout.cancel')}</button>
  <p class="visually-hidden" role="status" id="checkout-status" aria-live="polite"></p>
  <p class="form-alert" role="alert" id="checkout-alert" hidden></p>
</div>`;
  document.body.appendChild(dialog);
  document.body.classList.add('modal-open');
  (dialog.querySelector('#checkout-email') as HTMLInputElement).focus();
  const close = (): void => {
    dialog.remove();
    document.body.classList.remove('modal-open');
  };
  (dialog.querySelector('#checkout-cancel') as HTMLButtonElement).addEventListener('click', close);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  const submit = (): void => {
    const email = (dialog.querySelector('#checkout-email') as HTMLInputElement).value;
    const terms = (dialog.querySelector('#checkout-terms') as HTMLInputElement).checked;
    const locale = document.documentElement.lang === 'de' ? 'de' : 'en';
    announce(dialog.querySelector<HTMLElement>('#checkout-status'), copy('checkout.pending'));
    void api<{ receipt_url: string }>('/api/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': idemKey },
      body: JSON.stringify({ model: modelSlug, licence, email, terms, locale, upgrade_from: token }),
    })
      .then(result => {
        window.location.href = result.receipt_url;
      })
      .catch(() => {
        announce(dialog.querySelector<HTMLElement>('#checkout-status'), copy('upgrade_not_possible'));
      });
  };
  (dialog.querySelector('#checkout-pay') as HTMLButtonElement).addEventListener('click', submit);
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });
}

wireCore();
wireUpgrades();
const heading = document.getElementById('receipt-heading');
if (heading !== null) heading.focus();
