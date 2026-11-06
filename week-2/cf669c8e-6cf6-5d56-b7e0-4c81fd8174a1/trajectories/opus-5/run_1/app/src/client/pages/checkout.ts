/**
 * The checkout dialog: Delivery, Schedule, then Deposit.
 *
 * `Pay deposit` creates the order once for this open checkout, carrying the
 * total on screen, then requests the deposit. One press sends one key and
 * further presses reuse it; a new key is made only after the stage reads
 * `failed`. A money action is never re-sent automatically.
 */

import { ApiCallError, NetworkError, api } from '../api.js';
import { formatAmount } from '../../shared/format.js';
import { el, setMoneyDisabled, setTextIfChanged } from '../dom.js';
import { store } from '../state.js';
import { Panel } from '../ui/dialog.js';
import { figure } from '../ui/money.js';
import type { FitResult, Order, Stage } from '../../shared/types.js';

export const PAYMENT_SENT = 'Payment sent. Waiting for confirmation.';

const GATE_MESSAGES: Record<string, string> = {
  fit_not_passed: 'Fit not proven. No deposit can be taken.',
  donor_unconfirmed: 'Donor unconfirmed. No deposit can be taken.',
  donor_changed: "This scooter's registration changed. Prove the fit again.",
  quote_changed: 'The inspection fee changed. Check the new total before paying.',
  refund_in_flight: 'A refund is still pending. Try again once it settles.',
  payments_paused: 'Payments are paused. Nothing has been charged.',
  registry_unreachable: 'Plate registry unreachable. Your fit stays unconfirmed until it answers.',
};

/**
 * What checkout shows. The schedule is the server's, so the browser never
 * re-decides the published rounding; a bike has none until its order exists.
 */
export interface CheckoutSummary {
  totalCents: number;
  lines: { name: string; grossCents: number }[];
  schedule: Stage[] | null;
}

export interface CheckoutOptions {
  opener: HTMLElement;
  navigate: (href: string) => void;
  paymentStatus: HTMLElement;
  summary: CheckoutSummary;
  fit: FitResult | null;
  /** The order body, less the plan and the expected total. */
  body: Record<string, unknown>;
}

type Step = 'Delivery' | 'Schedule' | 'Deposit';

export function openCheckout(options: CheckoutOptions): void {
  const panel = new Panel({ name: 'Checkout', variant: 'dialog' });
  document.body.append(panel.root);

  let step: Step = 'Delivery';
  let orderId: string | null = null;
  // One press sends one key; further presses reuse it.
  let depositKey = crypto.randomUUID();

  const name = field('checkout-name', 'Name');
  const street = field('checkout-street', 'Street');
  const postcode = field('checkout-postcode', 'Postcode');
  const city = field('checkout-city', 'City');

  const problem = el('p', { class: 'field-error', hidden: true });
  const body = el('div', { class: 'checkout-body' });
  const back = el('button', { type: 'button' }, ['Back']);
  const next = el('button', { type: 'button', class: 'primary' }, ['Next']);
  const pay = el('button', { type: 'button', class: 'primary' }, ['Pay deposit']);

  const form = el('form', { class: 'stack' }, [
    el('h2', { class: 'heading-2', 'data-step': '' }, ['Delivery']),
    problem,
    body,
    el('div', { class: 'dialog-actions' }, [back, next, pay]),
  ]);
  panel.content.append(form);

  const heading = form.querySelector('[data-step]') as HTMLElement;

  function renderStep(): void {
    setTextIfChanged(heading, step);
    while (body.firstChild) body.firstChild.remove();

    if (step === 'Delivery') {
      body.append(
        el('div', { class: 'grid-fields' }, [
          el('label', { for: 'checkout-name' }, ['Name']),
          name,
          el('label', { for: 'checkout-street' }, ['Street']),
          street,
          el('label', { for: 'checkout-postcode' }, ['Postcode']),
          postcode,
          el('label', { for: 'checkout-city' }, ['City']),
          city,
        ]),
      );
    } else if (step === 'Schedule') {
      const schedule = options.summary.schedule;
      if (schedule) {
        body.append(
          el('table', { class: 'schedule-table' }, [
            el('caption', {}, ['Payment schedule']),
            el(
              'tbody',
              {},
              schedule.map((stage) =>
                el('tr', {}, [
                  el('th', { scope: 'row' }, [stage.label]),
                  el('td', {}, [figure(stage.amountCents, 'scheduled').element]),
                ]),
              ),
            ),
          ]),
        );
      } else {
        body.append(
          el(
            'table',
            { class: 'lines-table' },
            [
              el('caption', {}, ['Kit lines']),
              el(
                'tbody',
                {},
                options.summary.lines.map((line) =>
                  el('tr', {}, [
                    el('th', { scope: 'row' }, [line.name]),
                    el('td', {}, [figure(line.grossCents, 'quoted').element]),
                  ]),
                ),
              ),
            ],
          ),
          el('p', {}, ['Your stages are set when the order is made.']),
        );
      }
      body.append(el('p', {}, [`Total ${formatAmount(options.summary.totalCents)} quoted`]));
    } else {
      const deposit = options.summary.schedule?.[0]?.amountCents ?? null;
      body.append(
        deposit === null
          ? el('p', {}, [`Total ${formatAmount(options.summary.totalCents)} quoted`])
          : el('p', {}, ['Deposit ', figure(deposit, 'scheduled').element]),
      );
    }

    back.hidden = step === 'Delivery';
    next.hidden = step === 'Deposit';
    pay.hidden = step !== 'Deposit';
    updateGate();
  }

  /** A failing verdict or an unconfirmed donor keeps `Pay deposit` disabled. */
  function updateGate(): void {
    const fit = options.fit;
    if (!fit) {
      setMoneyDisabled(pay, false);
      return;
    }
    if (!fit.confirmed) {
      setMoneyDisabled(pay, true, GATE_MESSAGES.donor_unconfirmed);
      setTextIfChanged(options.paymentStatus, GATE_MESSAGES.donor_unconfirmed as string);
      return;
    }
    if (fit.verdict !== 'fits') {
      setMoneyDisabled(pay, true, GATE_MESSAGES.fit_not_passed);
      setTextIfChanged(options.paymentStatus, GATE_MESSAGES.fit_not_passed as string);
      return;
    }
    if (store.status.killbill === 'down') {
      setMoneyDisabled(pay, true, GATE_MESSAGES.payments_paused);
      return;
    }
    setMoneyDisabled(pay, false);
  }

  next.addEventListener('click', () => {
    if (step === 'Delivery') {
      const missing = [name, street, postcode, city].filter((input) => input.value.trim() === '');
      if (missing.length > 0) {
        problem.hidden = false;
        problem.textContent = 'Required.';
        missing[0]?.focus();
        return;
      }
      problem.hidden = true;
      step = 'Schedule';
    } else if (step === 'Schedule') {
      step = 'Deposit';
    }
    renderStep();
    (step === 'Deposit' ? pay : next).focus();
  });

  back.addEventListener('click', () => {
    // Back keeps entered values, because the fields are reused.
    step = step === 'Deposit' ? 'Schedule' : 'Delivery';
    renderStep();
    next.focus();
  });

  // Enter activates Next.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (step === 'Deposit') pay.click();
    else next.click();
  });

  pay.addEventListener('click', () => {
    if (pay.getAttribute('aria-disabled') === 'true') return;
    void payDeposit();
  });

  async function payDeposit(): Promise<void> {
    problem.hidden = true;
    const plan = {
      name: name.value.trim(),
      street: street.value.trim(),
      postcode: postcode.value.trim(),
      city: city.value.trim(),
    };

    try {
      // The order is created once for this open checkout.
      if (!orderId) {
        const created: Order = await api.createOrder({
          ...options.body,
          plan,
          expectedTotalCents: options.summary.totalCents,
        });
        orderId = created.id;
      }

      setTextIfChanged(options.paymentStatus, PAYMENT_SENT);
      await api.pay(orderId, 'deposit', depositKey);
      panel.close();
      options.navigate(`/orders/${orderId}`);
    } catch (error) {
      if (error instanceof NetworkError) {
        problem.hidden = false;
        problem.textContent = 'The shop could not be reached. Press again.';
        return;
      }
      if (!(error instanceof ApiCallError)) throw error;

      if (error.status === 401) {
        // The rider presses again, and that press reuses the same key.
        store.sessionEnded({ opener: pay, retry: null, retryAutomatically: false });
        return;
      }
      if (error.code === 'payment_refused') {
        // A new key is made only after the stage reads failed.
        depositKey = crypto.randomUUID();
        setTextIfChanged(options.paymentStatus, 'Deposit failed. Nothing was taken.');
        return;
      }
      const message = error.code ? GATE_MESSAGES[error.code] : null;
      if (message) setTextIfChanged(options.paymentStatus, message);
      problem.hidden = false;
      problem.textContent = message ?? firstError(error) ?? 'That could not be done.';
    }
  }

  renderStep();
  panel.open(options.opener);
}

function field(id: string, label: string): HTMLInputElement {
  return el('input', { type: 'text', id, 'aria-label': label });
}

function firstError(error: ApiCallError): string | null {
  if (!error.errors) return null;
  return Object.values(error.errors)[0] ?? null;
}
