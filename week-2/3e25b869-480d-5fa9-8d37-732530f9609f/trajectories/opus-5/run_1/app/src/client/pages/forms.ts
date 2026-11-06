import { CART, LOCKOUT_MESSAGE, RATE_LIMIT_MESSAGE, UI } from '../../shared/copy.js';
import { PROVINCES, provinceName } from '../../shared/money.js';
import type { Bilingual } from '../../shared/catalog.js';
import type { Money, ProvinceCode, TaxLine } from '../../shared/types.js';
import { isProvinceCode } from '../../shared/money.js';
import { taxCodeLabel } from '../../shared/money.js';
import { api, ApiFailure } from '../api.js';
import { cash, locale } from '../i18n.js';
import { bind, bindText, el, labelled, say, setFieldError } from '../ui.js';

export type TextField = { wrapper: HTMLElement; input: HTMLInputElement; error: HTMLElement };

export function textField(
  label: Bilingual,
  options: { type?: string; autocomplete?: string; inputmode?: string } = {},
): TextField {
  const input = el('input', {
    type: options.type ?? 'text',
    class: 'input',
    autocomplete: options.autocomplete ?? 'off',
    inputmode: options.inputmode ?? null,
  });
  input.id = `input-${Math.random().toString(36).slice(2, 10)}`;
  const error = el('p', { class: 'field-error', id: `${input.id}-error`, hidden: true });
  const wrapper = labelled(label, input);
  wrapper.append(error);
  return { wrapper, input, error };
}

export class FieldSet {
  private readonly fields: { key: string; label: Bilingual; field: TextField }[] = [];
  readonly summary: HTMLElement;
  private readonly list: HTMLElement;

  constructor() {
    this.list = el('ul', { class: 'error-list' });
    this.summary = el('div', { role: 'alert', class: 'error-summary', hidden: true, tabindex: '-1' }, [
      this.list,
    ]);
    bind(() => this.summary.setAttribute('aria-label', say(UI.errorSummary)));
  }

  add(key: string, label: Bilingual, field: TextField): TextField {
    this.fields.push({ key, label, field });
    return field;
  }

  clear(): void {
    for (const entry of this.fields) setFieldError(entry.field.input, entry.field.error, null);
    this.summary.hidden = true;
    while (this.list.firstChild) this.list.firstChild.remove();
  }

  /** Shows one link per invalid field in the form's order and takes focus. */
  show(errors: Record<string, string>): void {
    this.clear();
    let shown = 0;
    for (const entry of this.fields) {
      const message = errors[entry.key];
      if (message === undefined) continue;
      shown += 1;
      setFieldError(entry.field.input, entry.field.error, message);
      const link = el('a', { href: `#${entry.field.input.id}`, text: message });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        entry.field.input.focus();
      });
      this.list.append(el('li', {}, [link]));
    }
    if (shown === 0) return;
    this.summary.hidden = false;
    this.summary.focus();
  }
}

export function provincePicker(onChange: (province: ProvinceCode) => void, initial: ProvinceCode): HTMLElement {
  const select = el('select', { class: 'input select' });
  for (const province of PROVINCES) {
    const option = el('option', { value: province.code });
    bindText(option, () => provinceName(province.code, locale()));
    select.append(option);
  }
  select.value = initial;
  select.addEventListener('change', () => {
    if (isProvinceCode(select.value)) onChange(select.value);
  });
  return labelled(UI.province, select);
}

export function moneyRegion(
  label: Bilingual,
  read: () => { subtotal: Money; shipping: Money | null; discount: Money | null; taxes: TaxLine[]; total: Money; chargedToday: Money | null },
): HTMLElement {
  const region = el('section', { role: 'region', class: 'money-region' });
  const rows = el('dl', { class: 'money-rows tabular' });
  region.append(rows);
  bind(() => {
    region.setAttribute('aria-label', say(label));
    const value = read();
    while (rows.firstChild) rows.firstChild.remove();
    const line = (name: string, amount: Money, prefix = ''): void => {
      rows.append(el('dt', { text: name }), el('dd', { text: `${prefix}${cash(amount)}` }));
    };
    line(say(UI.lineSubtotal), value.subtotal);
    if (value.discount) {
      line(`${say(UI.lineDiscount)} (${locale() === 'fr-CA' ? '12\u00A0%' : '12%'})`, {
        cents: -value.discount.cents,
        currency: 'CAD',
      });
    }
    if (value.shipping) line(say(UI.lineShipping), value.shipping);
    for (const tax of value.taxes) line(taxCodeLabel(tax.code, locale()), tax.amount);
    line(say(UI.lineTotal), value.total);
    if (value.chargedToday) line(say(UI.chargedToday), value.chargedToday);
  });
  return region;
}

export type EmailStep = {
  element: HTMLElement;
  alerts: HTMLElement;
  verified: () => string | null;
};

export type EmailStepOptions = {
  purpose: 'checkout' | 'sign_in';
  fields: FieldSet;
  onCodeRequested: (email: string) => void;
  onVerified: (email: string) => void;
};

export function emailStep(options: EmailStepOptions): EmailStep {
  const { purpose, fields } = options;
  const email = fields.add('email', UI.email, textField(UI.email, { type: 'email', autocomplete: 'email' }));
  const code = fields.add('code', UI.code, textField(UI.code, { inputmode: 'numeric' }));
  const sendButton = el('button', { type: 'button', class: 'button secondary' });
  const verifyButton = el('button', { type: 'button', class: 'button primary' });
  const signedIn = el('p', { class: 'signed-in', hidden: true });
  const rateAlert = el('div', { role: 'alert', class: 'alert', hidden: true, tabindex: '-1' });
  const lockAlert = el('div', { role: 'alert', class: 'alert', hidden: true, tabindex: '-1' });
  const alerts = el('div', { class: 'alerts' }, [rateAlert, lockAlert]);
  const body = el('div', { class: 'email-step' }, [
    email.wrapper,
    sendButton,
    code.wrapper,
    verifyButton,
    signedIn,
  ]);
  let confirmed: string | null = null;
  let sending = false;
  let checking = false;

  const paint = (): void => {
    sendButton.textContent = sending ? say(UI.sendingPending) : say(UI.sendCode);
    sendButton.disabled = sending;
    sendButton.setAttribute('aria-busy', sending ? 'true' : 'false');
    verifyButton.textContent = checking ? say(UI.checkingPending) : say(UI.verify);
    verifyButton.disabled = checking;
    verifyButton.setAttribute('aria-busy', checking ? 'true' : 'false');
    rateAlert.setAttribute('aria-label', say(UI.rateLimitAlert));
    lockAlert.setAttribute('aria-label', say(UI.lockoutAlert));
    rateAlert.textContent = rateAlert.hidden ? '' : say(RATE_LIMIT_MESSAGE);
    lockAlert.textContent = lockAlert.hidden ? '' : say(LOCKOUT_MESSAGE);
    const done = confirmed !== null;
    email.wrapper.hidden = done;
    code.wrapper.hidden = done;
    sendButton.hidden = done;
    verifyButton.hidden = done;
    signedIn.hidden = !done;
    if (done) {
      signedIn.textContent =
        locale() === 'fr-CA' ? `Connecté en tant que ${confirmed}` : `Signed in as ${confirmed}`;
    }
  };

  const send = async (): Promise<void> => {
    if (sending) return;
    sending = true;
    paint();
    try {
      await api.post('/api/auth/code', { email: email.input.value.trim(), purpose });
      rateAlert.hidden = true;
      fields.clear();
      options.onCodeRequested(email.input.value.trim());
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'rate_limited') {
        rateAlert.hidden = false;
        paint();
        rateAlert.focus();
      } else if (error instanceof ApiFailure && error.status === 422) {
        fields.show(error.fields);
      }
    } finally {
      sending = false;
      paint();
    }
  };

  const verify = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    paint();
    try {
      const result = await api.post<{ customer: { email: string } }>('/api/auth/verify', {
        email: email.input.value.trim(),
        code: code.input.value.trim(),
      });
      confirmed = result.customer.email;
      fields.clear();
      lockAlert.hidden = true;
      paint();
      options.onVerified(confirmed);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'stepup_locked') {
        lockAlert.hidden = false;
        paint();
        lockAlert.focus();
      } else if (error instanceof ApiFailure && error.status === 422) {
        fields.show(error.fields);
      }
    } finally {
      checking = false;
      paint();
    }
  };

  sendButton.addEventListener('click', () => void send());
  verifyButton.addEventListener('click', () => void verify());
  code.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void verify();
    }
  });
  bind(paint);

  return { element: body, alerts, verified: () => confirmed };
}

export function codeRequestedMessage(email: string): Bilingual {
  return CART.codeRequested(email);
}

export type ShippingForm = {
  element: HTMLElement;
  read: () => { name: string; line1: string; city: string; postal_code: string };
  focusName: () => void;
};

export function shippingForm(fields: FieldSet): ShippingForm {
  const name = fields.add('shipping.name', UI.fullName, textField(UI.fullName, { autocomplete: 'name' }));
  const line1 = fields.add(
    'shipping.line1',
    UI.streetAddress,
    textField(UI.streetAddress, { autocomplete: 'address-line1' }),
  );
  const city = fields.add('shipping.city', UI.city, textField(UI.city, { autocomplete: 'address-level2' }));
  const postal = fields.add(
    'shipping.postal_code',
    UI.postalCode,
    textField(UI.postalCode, { autocomplete: 'postal-code' }),
  );
  const element = el('div', { class: 'shipping-form' }, [
    name.wrapper,
    line1.wrapper,
    city.wrapper,
    postal.wrapper,
  ]);
  return {
    element,
    read: () => ({
      name: name.input.value.trim(),
      line1: line1.input.value.trim(),
      city: city.input.value.trim(),
      postal_code: postal.input.value.trim(),
    }),
    focusName: () => name.input.focus(),
  };
}
