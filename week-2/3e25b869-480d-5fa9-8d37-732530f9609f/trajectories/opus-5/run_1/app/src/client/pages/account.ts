import { dropTimeText, longDateText } from '../../shared/bilingual.js';
import { CADENCE_LABELS, scentName } from '../../shared/catalog.js';
import { ACCOUNT, UI } from '../../shared/copy.js';
import { taxCodeLabel } from '../../shared/money.js';
import type { Cadence, Order, Subscription } from '../../shared/types.js';
import { api, ApiFailure } from '../api.js';
import { cash, locale, longDate } from '../i18n.js';
import { announce, clearRegion, regionText } from '../live.js';
import { navigate } from '../router.js';
import { everyPoll, loadAccount, loadStatus, store } from '../store.js';
import { bind, el, focusHeading, refresh, say, trapFocus } from '../ui.js';
import { cadenceMenu } from './subscribe.js';
import { codeRequestedMessage, emailStep, FieldSet } from './forms.js';
import { renderNotFound } from './not-found.js';

function signInView(main: HTMLElement): void {
  const heading = el('h1', { class: 'page-heading' });
  const fields = new FieldSet();
  const region = el('p', { role: 'status', class: 'live-region' });
  const step = emailStep({
    purpose: 'sign_in',
    fields,
    onCodeRequested: (email) => announce('account', codeRequestedMessage(email)),
    onVerified: () => {
      void (async () => {
        await loadAccount();
        navigate('/account', { replace: true });
      })();
    },
  });
  bind(() => {
    heading.textContent = say(UI.signIn);
    region.setAttribute('aria-label', say(UI.accountUpdates));
    region.textContent = regionText('account');
  });
  main.append(heading, fields.summary, step.alerts, step.element, region);
}

function summaryList(label: typeof UI.orders, items: () => HTMLElement[]): HTMLElement {
  const list = el('ul', { role: 'list', class: 'record-list' });
  bind(() => {
    list.setAttribute('aria-label', say(label));
    while (list.firstChild) list.firstChild.remove();
    for (const item of items()) list.append(el('li', {}, [item]));
  });
  return list;
}

export async function renderAccount(main: HTMLElement): Promise<void> {
  await loadStatus();
  const signedIn = await loadAccount();
  if (!signedIn) {
    signInView(main);
    return;
  }
  const heading = el('h1', { class: 'page-heading' });
  const region = el('p', { role: 'status', class: 'live-region' });
  const signOut = el('button', { type: 'button', class: 'button quiet' });
  signOut.addEventListener('click', () => {
    void (async () => {
      await api.post('/api/auth/sign-out');
      store.account = null;
      navigate('/account', { replace: true });
    })();
  });
  bind(() => {
    heading.textContent = say(UI.yourAccount);
    signOut.textContent = say(UI.signOut);
    region.setAttribute('aria-label', say(UI.accountUpdates));
    region.textContent = regionText('account');
  });
  const orders = summaryList(UI.orders, () =>
    (store.account?.orders ?? []).map((order) =>
      el('a', {
        href: `/account/orders/${order.number}`,
        class: 'link tabular',
        text: `${order.number} \u00B7 ${cash(order.total)}`,
      }),
    ),
  );
  const subscriptions = summaryList(UI.subscriptions, () =>
    (store.account?.subscriptions ?? []).map((subscription) =>
      el('a', {
        href: `/account/subscriptions/${subscription.number}`,
        class: 'link',
        text: `${subscription.number} \u00B7 ${scentName(subscription.scent, locale())}`,
      }),
    ),
  );
  main.append(heading, orders, subscriptions, signOut, region);
  everyPoll(async () => {
    await loadStatus();
    refresh();
  });
}

export async function renderOrder(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const number = params['number'] ?? '';
  let order: Order;
  try {
    order = await api.get<Order>(`/api/account/orders/${number}`);
  } catch (error) {
    if (error instanceof ApiFailure) {
      renderNotFound(main);
      return;
    }
    throw error;
  }
  const heading = el('h1', { class: 'page-heading' });
  const lines = el('dl', { class: 'money-rows tabular' });
  bind(() => {
    heading.textContent =
      locale() === 'fr-CA' ? `Commande ${order.number}` : `Order ${order.number}`;
    while (lines.firstChild) lines.firstChild.remove();
    for (const line of order.lines) {
      lines.append(
        el('dt', {
          text: `${locale() === 'fr-CA' ? 'Pain' : 'Bar'} ${line.bar} \u00B7 ${line.batch} \u00B7 ${scentName(line.scent, locale())}`,
        }),
        el('dd', { text: cash(line.unit_price) }),
      );
    }
    lines.append(el('dt', { text: say(UI.lineSubtotal) }), el('dd', { text: cash(order.subtotal) }));
    lines.append(el('dt', { text: say(UI.lineShipping) }), el('dd', { text: cash(order.shipping_fee) }));
    for (const tax of order.taxes) {
      lines.append(el('dt', { text: taxCodeLabel(tax.code, locale()) }), el('dd', { text: cash(tax.amount) }));
    }
    lines.append(el('dt', { text: say(UI.lineTotal) }), el('dd', { text: cash(order.total) }));
    lines.append(el('dt', { text: say(UI.lineShipping) }), el('dd', { text: longDate(order.ship_on) }));
  });
  main.append(heading, lines);
}

export async function renderSubscription(
  main: HTMLElement,
  params: Record<string, string>,
): Promise<void> {
  const number = params['number'] ?? '';
  let subscription: Subscription;
  try {
    subscription = await api.get<Subscription>(`/api/account/subscriptions/${number}`);
  } catch (error) {
    if (error instanceof ApiFailure) {
      renderNotFound(main);
      return;
    }
    throw error;
  }
  await loadStatus();

  const heading = el('h1', { class: 'page-heading' });
  const region = el('p', { role: 'status', class: 'live-region' });
  const facts = el('dl', { class: 'money-rows tabular' });
  const nextBill = el('section', { role: 'region', class: 'label-row' });
  const nextBillValue = el('p', { class: 'label-row-value tabular' });
  nextBill.append(nextBillValue);
  const price = el('dl', { class: 'money-rows tabular' });
  let busy = false;

  const act = async (
    run: () => Promise<{ subscription: Subscription }>,
    success: (next: Subscription) => void,
  ): Promise<void> => {
    if (busy) return;
    busy = true;
    refresh();
    try {
      const result = await run();
      subscription = result.subscription;
      success(subscription);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'cycle_locked') {
        announce(
          'account',
          ACCOUNT.cycleLocked(longDateText(subscription.next_bill_date ?? subscription.started_on)),
        );
      } else if (error.status === 503) {
        announce('account', ACCOUNT.invalidTransition);
      } else {
        announce('account', ACCOUNT.invalidTransition);
      }
    } finally {
      busy = false;
      refresh();
    }
  };

  const skipButton = el('button', { type: 'button', class: 'button secondary' });
  const undoButton = el('button', { type: 'button', class: 'button secondary' });
  const swapButton = el('button', { type: 'button', class: 'button secondary' });
  const pauseButton = el('button', { type: 'button', class: 'button secondary' });
  const resumeButton = el('button', { type: 'button', class: 'button secondary' });
  const cancelButton = el('button', { type: 'button', class: 'button quiet' });
  const scents = el('div', { role: 'radiogroup', class: 'scent-chips' });
  const menu = cadenceMenu((cadence: Cadence) => {
    void act(
      () => api.patch<{ subscription: Subscription }>(`/api/account/subscriptions/${number}`, { cadence }),
      (next) => {
        announce(
          'account',
          ACCOUNT.cadenceChanged(
            longDateText(next.next_bill_date ?? next.started_on),
            CADENCE_LABELS[next.pending_cadence ?? next.cadence],
          ),
        );
      },
    );
  });

  let chosenScent = subscription.scent;
  const scentRadios = ['oat-milk', 'cedar-sage', 'unscented'].map((slug, index) => {
    const radio = el('button', {
      type: 'button',
      role: 'radio',
      class: 'scent-chip',
      'data-scent': slug,
      tabindex: index === 0 ? '0' : '-1',
    });
    radio.addEventListener('click', () => {
      chosenScent = slug;
      paintControls();
      radio.focus();
    });
    scents.append(radio);
    return radio;
  });

  skipButton.addEventListener('click', () => {
    void act(
      () => api.post<{ subscription: Subscription }>(`/api/account/subscriptions/${number}/skip`),
      (next) => {
        announce(
          'account',
          ACCOUNT.skipped(
            longDateText(next.skipped_bill_date ?? next.started_on),
            longDateText(next.next_bill_date ?? next.started_on),
          ),
        );
        paintControls();
        undoButton.focus();
      },
    );
  });
  undoButton.addEventListener('click', () => {
    void act(
      () => api.post<{ subscription: Subscription }>(`/api/account/subscriptions/${number}/unskip`),
      (next) => {
        announce('account', ACCOUNT.unskipped(longDateText(next.next_bill_date ?? next.started_on)));
        paintControls();
        skipButton.focus();
      },
    );
  });
  swapButton.addEventListener('click', () => {
    void act(
      () =>
        api.patch<{ subscription: Subscription }>(`/api/account/subscriptions/${number}`, {
          scent: chosenScent,
        }),
      (next) => announce('account', ACCOUNT.scentSwapped({
        'en-CA': scentName(next.scent, 'en-CA'),
        'fr-CA': scentName(next.scent, 'fr-CA'),
      })),
    );
  });
  pauseButton.addEventListener('click', () => {
    void act(
      () => api.post<{ subscription: Subscription }>(`/api/account/subscriptions/${number}/pause`),
      (next) => announce('account', ACCOUNT.pausedFrom(longDateText(next.paused_from ?? next.started_on))),
    );
  });
  resumeButton.addEventListener('click', () => {
    void act(
      () => api.post<{ subscription: Subscription }>(`/api/account/subscriptions/${number}/resume`),
      (next) => announce('account', ACCOUNT.resumed(longDateText(next.next_bill_date ?? next.started_on))),
    );
  });

  const dialog = el('div', { role: 'dialog', class: 'dialog', 'aria-modal': 'true', hidden: true });
  const confirm = el('button', { type: 'button', class: 'button primary' });
  const keep = el('button', { type: 'button', class: 'button quiet' });
  dialog.append(confirm, keep);
  const closeDialog = (): void => {
    dialog.hidden = true;
    cancelButton.focus();
  };
  cancelButton.addEventListener('click', () => {
    dialog.hidden = false;
    confirm.focus();
  });
  keep.addEventListener('click', closeDialog);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    trapFocus(dialog, event);
  });
  confirm.addEventListener('click', () => {
    void act(
      () => api.post<{ subscription: Subscription }>(`/api/account/subscriptions/${number}/cancel`),
      () => {
        announce('account', ACCOUNT.cancelled);
        dialog.hidden = true;
        focusHeading();
      },
    );
  });

  const controls = el('div', { class: 'subscription-controls' });

  function paintControls(): void {
    while (controls.firstChild) controls.firstChild.remove();
    const skipped = subscription.skipped_bill_date !== null;
    controls.append(skipped ? undoButton : skipButton);
    controls.append(scents, swapButton, menu.element);
    controls.append(subscription.state === 'paused' ? resumeButton : pauseButton);
    controls.append(cancelButton, dialog);
    scentRadios.forEach((radio) => {
      const slug = radio.dataset['scent'] ?? '';
      radio.textContent = scentName(slug, locale());
      const selected = slug === chosenScent;
      radio.setAttribute('aria-checked', selected ? 'true' : 'false');
      radio.tabIndex = selected ? 0 : -1;
    });
  }

  bind(() => {
    heading.textContent =
      locale() === 'fr-CA' ? `Abonnement ${subscription.number}` : `Subscription ${subscription.number}`;
    region.setAttribute('aria-label', say(UI.accountUpdates));
    region.textContent = regionText('account');
    nextBill.setAttribute('aria-label', say(UI.nextBillDate));
    nextBillValue.textContent = subscription.next_bill_date
      ? longDate(subscription.next_bill_date)
      : say(UI.paused);
    while (facts.firstChild) facts.firstChild.remove();
    facts.append(el('dt', { text: say(UI.state) }), el('dd', { text: subscription.state }));
    facts.append(
      el('dt', { text: say(UI.scent) }),
      el('dd', { text: scentName(subscription.scent, locale()) }),
    );
    facts.append(
      el('dt', { text: say(UI.cadence) }),
      el('dd', { text: say(CADENCE_LABELS[subscription.cadence]) }),
    );
    facts.append(
      el('dt', { text: say(UI.pendingCadence) }),
      el('dd', {
        text: subscription.pending_cadence ? say(CADENCE_LABELS[subscription.pending_cadence]) : '\u2014',
      }),
    );
    facts.append(
      el('dt', { text: say(UI.lockDate) }),
      el('dd', {
        text: subscription.locks_at ? say(dropTimeText(new Date(subscription.locks_at))) : '\u2014',
      }),
    );
    while (price.firstChild) price.firstChild.remove();
    price.append(
      el('dt', { text: say(UI.lineSubtotal) }),
      el('dd', { text: cash(subscription.price.subtotal) }),
    );
    price.append(
      el('dt', { text: say(UI.lineDiscount) }),
      el('dd', { text: cash({ cents: -subscription.price.discount.cents, currency: 'CAD' }) }),
    );
    for (const tax of subscription.price.taxes) {
      price.append(el('dt', { text: taxCodeLabel(tax.code, locale()) }), el('dd', { text: cash(tax.amount) }));
    }
    price.append(el('dt', { text: say(UI.lineTotal) }), el('dd', { text: cash(subscription.price.total) }));
    skipButton.textContent = busy ? say(UI.savingPending) : say(UI.skipNext);
    undoButton.textContent = busy ? say(UI.savingPending) : say(UI.undoSkip);
    swapButton.textContent = busy ? say(UI.savingPending) : say(UI.swapScent);
    pauseButton.textContent = busy ? say(UI.savingPending) : say(UI.pause);
    resumeButton.textContent = busy ? say(UI.savingPending) : say(UI.resume);
    cancelButton.textContent = busy ? say(UI.savingPending) : say(UI.cancelSubscription);
    for (const button of [skipButton, undoButton, swapButton, pauseButton, resumeButton, cancelButton]) {
      button.disabled = busy;
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    dialog.setAttribute('aria-label', say(UI.cancelDialog));
    confirm.textContent = say(UI.cancelConfirm);
    keep.textContent = say(UI.keepIt);
    scents.setAttribute('aria-label', say(UI.trioScentGroup));
    paintControls();
  });

  main.append(heading, nextBill, facts, price, controls, region);
  everyPoll(async () => {
    await loadStatus();
    refresh();
  });
  clearRegion('account');
}
