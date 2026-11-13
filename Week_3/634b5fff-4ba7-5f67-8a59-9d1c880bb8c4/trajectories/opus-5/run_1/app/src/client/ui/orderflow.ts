import { errorCopy, paymentStateCopy, plateFor, type Plate } from '../../shared/copy.js';
import { formatKroner } from '../../shared/money.js';
import type { CheckoutReply, OrderResponse, PaymentState } from '../../shared/types.js';
import { ApiCallFailed, call } from '../api.js';
import { markMotion, markTree, runMotion } from '../motion.js';
import { loadEdition, store } from '../store.js';
import { clear, el, field, textareaField, trapFocus } from './dom.js';
import { heldBox, holdBecameOrder } from './hold.js';
import { plateDrawing } from './plate.js';

export interface BoxSheetOptions {
  boxNumber: number;
  onHold: (boxNumber: number) => void;
}

/** The box page: number, plate, plate art, state and price with the charity share. */
export async function buildBoxSheet(options: BoxSheetOptions): Promise<HTMLElement> {
  const edition = await loadEdition();
  const box = await call<{ number: number; plate: string; state: string; artUrl: string | null }>(
    `/api/boxes/${options.boxNumber}`,
  );
  const art =
    box.artUrl === null
      ? plateDrawing(box.plate as Plate)
      : el('img', { src: box.artUrl, alt: `Plate art for ${box.plate}`, width: 320, height: 320 });

  const take = el('button', { type: 'button', class: 'primary', text: 'Choose this number' });
  take.addEventListener('click', () => {
    runMotion(take, 'press');
    options.onHold(options.boxNumber);
  });

  return el('div', { class: 'sheet' }, [
    el('h1', { text: `Box ${box.number}` }),
    el('p', { text: `Plate: ${box.plate}` }),
    el('p', { text: `State: ${box.state}` }),
    art,
    el('p', { text: `DKK ${formatKroner(edition.totalOre)} including courier and VAT` }),
    el('p', {
      class: 'muted',
      text: `Charity share of this box: DKK ${formatKroner(edition.charityOre)} to ${edition.charityName}`,
    }),
    box.state === 'available' ? take : el('p', { class: 'muted', text: 'This number is not on the shelf.' }),
  ]);
}

export interface CheckoutOptions {
  onOrder: (reference: string, orderToken: string) => void;
  onHoldEnded: (message: string) => void;
}

interface CheckoutFields {
  name: HTMLInputElement;
  email: HTMLInputElement;
  street: HTMLInputElement;
  postcode: HTMLInputElement;
  city: HTMLInputElement;
  gift: HTMLInputElement;
  recipientName: HTMLInputElement;
  recipientEmail: HTMLInputElement;
  message: HTMLTextAreaElement;
  cardNumber: HTMLInputElement;
  expiry: HTMLInputElement;
  cvc: HTMLInputElement;
}

export async function buildCheckout(options: CheckoutOptions): Promise<HTMLElement> {
  const edition = await loadEdition();
  const hold = heldBox();

  const errors = el('div', { class: 'alert', role: 'alert', 'aria-label': 'Checkout errors' });

  const name = field('Your name');
  const email = field('Your email', 'email');
  const street = field('Street');
  const postcode = field('Postcode');
  const city = field('City');

  const giftBox = el('input', { type: 'checkbox', 'aria-label': 'This is a gift' });
  const recipientName = field('Recipient name');
  const recipientEmail = field('Recipient email', 'email');
  const giftMessage = textareaField('Gift message', { maxlength: 280 });
  const giftFields = el('div', {}, [recipientName.wrapper, recipientEmail.wrapper, giftMessage.wrapper]);
  giftFields.hidden = true;
  giftBox.addEventListener('change', () => {
    giftFields.hidden = !giftBox.checked;
    runMotion(giftFields, 'step');
  });

  const cardRadio = el('input', { type: 'radio', name: 'method', value: 'card', checked: true, 'aria-label': 'Card' });
  const bankRadio = el('input', { type: 'radio', name: 'method', value: 'bank', 'aria-label': 'Bank transfer' });

  const cardNumber = field('Card number');
  const expiry = field('Expiry');
  const cvc = field('Security code');
  const authorise = el('button', {
    type: 'submit',
    class: 'primary',
    text: `Authorise DKK ${formatKroner(edition.totalOre)}`,
  });
  const cardFields = el('div', {}, [cardNumber.wrapper, expiry.wrapper, cvc.wrapper, authorise]);

  const reserve = el('button', { type: 'submit', class: 'primary', text: 'Reserve for bank transfer' });
  const bankFields = el('div', {}, [reserve]);
  bankFields.hidden = true;

  function chooseMethod(): void {
    cardFields.hidden = !cardRadio.checked;
    bankFields.hidden = !bankRadio.checked;
    runMotion(cardRadio.checked ? cardFields : bankFields, 'step');
  }
  cardRadio.addEventListener('change', chooseMethod);
  bankRadio.addEventListener('change', chooseMethod);

  const fields: CheckoutFields = {
    name: name.input,
    email: email.input,
    street: street.input,
    postcode: postcode.input,
    city: city.input,
    gift: giftBox,
    recipientName: recipientName.input,
    recipientEmail: recipientEmail.input,
    message: giftMessage.input,
    cardNumber: cardNumber.input,
    expiry: expiry.input,
    cvc: cvc.input,
  };

  const errorNodes: Record<string, HTMLElement> = {
    'buyer.name': name.error,
    'buyer.email': email.error,
    'address.street': street.error,
    'address.postcode': postcode.error,
    'address.city': city.error,
    'gift.recipientName': recipientName.error,
    'gift.recipientEmail': recipientEmail.error,
    'gift.message': giftMessage.error,
    'card.number': cardNumber.error,
    'card.expiry': expiry.error,
    'card.cvc': cvc.error,
  };

  const form = el('form', { 'aria-label': 'Checkout', novalidate: true }, [
    errors,
    el('fieldset', {}, [
      el('legend', { text: 'Your details' }),
      name.wrapper,
      email.wrapper,
      street.wrapper,
      postcode.wrapper,
      city.wrapper,
    ]),
    el('fieldset', {}, [
      el('legend', { text: 'A gift' }),
      el('div', { class: 'check-row' }, [
        el('label', {}, [giftBox, document.createTextNode('This is a gift')]),
      ]),
      giftFields,
    ]),
    el('fieldset', {}, [
      el('legend', { text: 'Payment method' }),
      el('div', { class: 'radio-row' }, [
        el('label', {}, [cardRadio, document.createTextNode('Card')]),
        el('label', {}, [bankRadio, document.createTextNode('Bank transfer')]),
      ]),
    ]),
    el('fieldset', {}, [el('legend', { text: 'Payment' }), cardFields, bankFields]),
  ]);

  for (const node of form.querySelectorAll('input,textarea')) {
    node.addEventListener('focus', () => runMotion(node, 'focus'));
  }

  markMotion(giftFields, 'step');
  markMotion(cardFields, 'step');
  markMotion(bankFields, 'step');
  const sheet = el('div', { class: 'sheet' }, [
    el('h1', { text: hold === null ? 'Checkout' : `Box ${hold.number}, ${plateFor(hold.number)}` }),
    el('p', {
      class: 'muted',
      text: `DKK ${formatKroner(edition.totalOre)} including DKK ${formatKroner(edition.courierOre)} courier and DKK ${formatKroner(edition.vatOre)} VAT`,
    }),
    form,
  ]);

  function showFieldErrors(given: Record<string, string>): void {
    for (const node of Object.values(errorNodes)) node.textContent = '';
    for (const [key, message] of Object.entries(given)) {
      const node = errorNodes[key];
      if (node !== undefined) node.textContent = message;
    }
    errors.textContent = errorCopy.validation_failed;
    runMotion(form, 'shake');
  }

  function payload(): Record<string, unknown> {
    const current = heldBox();
    return {
      number: current?.number ?? 0,
      method: bankRadio.checked ? 'bank' : 'card',
      buyer: { name: fields.name.value, email: fields.email.value },
      address: {
        street: fields.street.value,
        postcode: fields.postcode.value,
        city: fields.city.value,
      },
      gift: fields.gift.checked
        ? {
            recipientName: fields.recipientName.value,
            recipientEmail: fields.recipientEmail.value,
            message: fields.message.value,
          }
        : null,
      ...(bankRadio.checked
        ? {}
        : {
            card: {
              number: fields.cardNumber.value,
              expiry: fields.expiry.value,
              cvc: fields.cvc.value,
            },
          }),
    };
  }

  let attemptKey = crypto.randomUUID();

  async function send(): Promise<void> {
    const current = heldBox();
    if (current === null) {
      options.onHoldEnded(errorCopy.hold_ended(hold?.number ?? 0));
      return;
    }
    errors.textContent = '';
    try {
      const reply = await call<CheckoutReply>('/api/checkout', {
        method: 'POST',
        body: payload(),
        headers: { 'X-Hold-Token': current.holdToken, 'Idempotency-Key': attemptKey },
      });
      store.keepOrder({ reference: reply.reference, orderToken: reply.orderToken });
      if (reply.challenge !== undefined) {
        openBankCheck(sheet, reply, current.number, fields.cardNumber.value, edition.totalOre, options);
        return;
      }
      holdBecameOrder();
      options.onOrder(reply.reference, reply.orderToken);
    } catch (error) {
      attemptKey = crypto.randomUUID();
      if (!(error instanceof ApiCallFailed)) throw error;
      const failure = error.failure;
      if (failure.code === 'validation_failed' && failure.fields !== undefined) {
        showFieldErrors(failure.fields);
        return;
      }
      if (failure.status === 410) {
        const reference = failure.extra.reference;
        const token = failure.extra.orderToken;
        if (failure.code === 'authorised_too_late' && typeof reference === 'string' && typeof token === 'string') {
          rememberNote(reference, failure.message);
          store.keepOrder({ reference, orderToken: token });
          holdBecameOrder();
          options.onOrder(reference, token);
          return;
        }
        options.onHoldEnded(failure.message);
        return;
      }
      errors.textContent = failure.message;
      runMotion(form, 'shake');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });

  return sheet;
}

/** The app draws the bank's check itself; the browser never reaches the gateway. */
function openBankCheck(
  sheet: HTMLElement,
  reply: CheckoutReply,
  boxNumber: number,
  cardNumber: string,
  totalOre: number,
  options: CheckoutOptions,
): void {
  const opener = document.activeElement as HTMLElement | null;
  const code = field('One-time code');
  const approve = el('button', { type: 'submit', class: 'primary', text: 'Approve' });
  const cancel = el('button', { type: 'button', text: 'Cancel' });
  const message = el('div', { class: 'alert' });
  const lastFour = cardNumber.replace(/\s+/g, '').slice(-4);
  const form = el('form', {}, [
    el('h2', { text: 'Bank check' }),
    el('p', { text: `Card ending ${lastFour} for DKK ${formatKroner(totalOre)}` }),
    message,
    code.wrapper,
    el('div', { class: 'row' }, [approve, cancel]),
  ]);
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bank check' }, [
    form,
  ]);
  const backdrop = el('div', { class: 'backdrop' }, [dialog]);
  document.body.append(backdrop);
  markTree(dialog);
  code.input.focus();

  let closed = false;
  const release = trapFocus(dialog, { onEscape: () => void answer({ cancel: true }) });
  const expiry = window.setTimeout(() => {
    close();
    message.textContent = errorCopy.challenge_expired;
    const hint = el('div', { class: 'alert', role: 'alert', text: errorCopy.challenge_expired });
    sheet.prepend(hint);
  }, reply.challenge?.expiresInMs ?? 0);

  function close(): void {
    if (closed) return;
    closed = true;
    window.clearTimeout(expiry);
    release();
    backdrop.remove();
    opener?.focus();
  }

  async function answer(body: { code?: string; cancel?: boolean }): Promise<void> {
    const hold = heldBox();
    if (hold === null) {
      close();
      options.onHoldEnded(errorCopy.hold_ended(boxNumber));
      return;
    }
    try {
      const settled = await call<CheckoutReply>(`/api/checkout/${reply.reference}/challenge`, {
        method: 'POST',
        body,
        headers: { 'X-Hold-Token': hold.holdToken },
      });
      close();
      store.keepOrder({ reference: settled.reference, orderToken: settled.orderToken });
      holdBecameOrder();
      options.onOrder(settled.reference, settled.orderToken);
    } catch (error) {
      if (!(error instanceof ApiCallFailed)) throw error;
      if (error.failure.status === 402) {
        close();
        const hint = el('div', { class: 'alert', role: 'alert', 'aria-label': 'Checkout errors' });
        hint.textContent = error.failure.message;
        sheet.prepend(hint);
        return;
      }
      close();
      const hint = el('div', { class: 'alert', role: 'alert', 'aria-label': 'Checkout errors' });
      hint.textContent = error.failure.message;
      sheet.prepend(hint);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(approve, 'press');
    void answer({ code: code.input.value });
  });
  cancel.addEventListener('click', () => {
    runMotion(cancel, 'press');
    void answer({ cancel: true });
  });
}

const NOTE_PREFIX = 'press.note.';

function rememberNote(reference: string, message: string): void {
  sessionStorage.setItem(`${NOTE_PREFIX}${reference}`, message);
}

function noteFor(reference: string): string | null {
  return sessionStorage.getItem(`${NOTE_PREFIX}${reference}`);
}

export function paymentStatusCopy(order: OrderResponse): string {
  const state = order.paymentState as PaymentState;
  if (state === 'lapsed') return errorCopy.lapsed(order.number);
  if (state === 'voided') {
    return noteFor(order.reference) ?? paymentStateCopy.voided;
  }
  return paymentStateCopy[state as keyof typeof paymentStateCopy] ?? '';
}

export interface OrderPageOptions {
  reference: string;
  token: string;
}

export async function buildOrderPage(options: OrderPageOptions): Promise<HTMLElement> {
  const status = el('div', { role: 'status', 'aria-label': 'Payment status' });
  markMotion(status, 'payment-state');
  const boxLine = el('p', {});
  const transferLine = el('div', {});
  const certificate = el('a', {
    href: `/api/orders/${options.reference}/certificate?token=${options.token}`,
    text: 'Download certificate',
  });
  certificate.hidden = true;
  const sheet = el('div', { class: 'sheet' }, [
    el('h1', { text: `Order ${options.reference}` }),
    status,
    boxLine,
    transferLine,
    certificate,
  ]);
  markMotion(sheet, 'receipt');
  runMotion(sheet, 'receipt');

  let shown = '';

  async function refresh(): Promise<void> {
    try {
      const order = await call<OrderResponse>(
        `/api/orders/${options.reference}?token=${options.token}`,
      );
      let line = paymentStatusCopy(order);
      if (order.certificate.state === 'pending') line = errorCopy.certificate_pending;
      if (order.certificate.state === 'cancelled') line = errorCopy.certificate_cancelled;
      if (line !== shown) {
        shown = line;
        status.textContent = line;
        runMotion(status, 'payment-state');
      }
      boxLine.textContent = `Box ${order.number}, ${order.plate}: ${order.boxState}`;
      clear(transferLine);
      if (order.transfer !== null) {
        transferLine.append(
          el('p', { text: `IBAN ${order.transfer.iban}` }),
          el('p', { text: `Payment reference ${order.transfer.paymentReference}` }),
          el('p', { text: `DKK ${formatKroner(order.transfer.amountOre)}` }),
          el('p', { text: `Deadline ${order.transfer.deadlineAt}` }),
        );
      }
      certificate.hidden = order.certificate.state !== 'issued';
    } catch (error) {
      if (error instanceof ApiCallFailed) status.textContent = error.failure.message;
    }
  }

  await refresh();
  const timer = window.setInterval(() => void refresh(), 2500);
  sheet.addEventListener('press-unmount', () => window.clearInterval(timer));
  return sheet;
}

export interface LookupOptions {
  onFound: (reference: string, token: string) => void;
}

export function buildLookup(options: LookupOptions): HTMLElement {
  const reference = field('Order reference');
  const email = field('Email', 'email');
  const message = el('div', { class: 'alert', role: 'alert', 'aria-label': 'Lookup message' });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Find my order' });
  const form = el('form', { 'aria-label': 'Find your order', novalidate: true }, [
    message,
    reference.wrapper,
    email.wrapper,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(submit, 'press');
    void call<{ reference: string; orderToken: string }>('/api/orders/lookup', {
      method: 'POST',
      body: { reference: reference.input.value.trim(), email: email.input.value.trim() },
    })
      .then((found) => {
        store.keepOrder({ reference: found.reference, orderToken: found.orderToken });
        options.onFound(found.reference, found.orderToken);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallFailed) message.textContent = error.failure.message;
        runMotion(form, 'shake');
      });
  });
  return el('div', { class: 'sheet' }, [el('h1', { text: 'Find your order' }), form]);
}
