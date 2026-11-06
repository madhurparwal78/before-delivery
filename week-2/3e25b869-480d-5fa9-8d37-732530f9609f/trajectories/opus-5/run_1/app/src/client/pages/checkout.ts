import { moneyText } from '../../shared/bilingual.js';
import { scentName } from '../../shared/catalog.js';
import { CART, UI } from '../../shared/copy.js';
import type { Hold, Order, ProvinceCode } from '../../shared/types.js';
import { api, ApiFailure, newIdempotencyKey } from '../api.js';
import { formatCountdown, serverClock } from '../countdown.js';
import { cash, locale } from '../i18n.js';
import { announce, clearRegion, regionText } from '../live.js';
import { navigate } from '../router.js';
import { everyPoll, loadCart, loadDrop, loadStatus, store } from '../store.js';
import { bind, el, refresh, say } from '../ui.js';
import {
  codeRequestedMessage,
  emailStep,
  FieldSet,
  moneyRegion,
  provincePicker,
  shippingForm,
} from './forms.js';

type RowActions = { release: (hold: Hold, index: number) => void };

function holdRow(hold: Hold, index: number, actions: RowActions): HTMLElement {
  const row = el('div', { class: 'hold-row', 'data-hold': hold.id });
  const label = el('p', { class: 'hold-row-label' });
  const timer = el('p', { role: 'timer', class: 'hold-timer tabular' });
  const release = el('button', { type: 'button', class: 'button quiet release-button' });
  row.append(label, timer, release);
  const batch = store.batches.find((candidate) => candidate.code === hold.batch);
  bind(() => {
    label.textContent = `${locale() === 'fr-CA' ? 'Pain' : 'Bar'} ${hold.bar} \u00B7 ${
      batch ? scentName(batch.scent, locale()) : hold.batch
    } \u00B7 ${hold.batch}`;
    timer.setAttribute(
      'aria-label',
      locale() === 'fr-CA'
        ? `Temps restant pour le pain ${hold.bar}`
        : `Hold time left for bar ${hold.bar}`,
    );
    release.textContent =
      locale() === 'fr-CA' ? `Libérer le pain ${hold.bar}` : `Release bar ${hold.bar}`;
  });
  release.addEventListener('click', () => actions.release(hold, index));
  return row;
}

export function renderCheckout(main: HTMLElement): void {
  const heading = el('h1', { class: 'page-heading' });
  const heldRegion = el('section', { role: 'region', class: 'held-bars' });
  const rows = el('div', { class: 'hold-rows' });
  const backLink = el('a', { href: '/', class: 'link back-to-drop' });
  heldRegion.append(rows, backLink);
  const cartRegion = el('p', { role: 'status', class: 'live-region' });
  const fields = new FieldSet();
  const minuteWarned = new Set<string>();
  let previousTotal = store.cart?.total.cents ?? 0;

  const announceTotal = (...events: ReturnType<typeof CART.released>[]): void => {
    const total = store.cart?.total.cents ?? 0;
    const changed = total !== previousTotal;
    announce(
      'cart',
      ...events,
      changed ? CART.totalChanged(moneyText(store.cart?.total ?? { cents: 0, currency: 'CAD' })) : null,
    );
    previousTotal = total;
  };

  const release = (hold: Hold, index: number): void => {
    void (async () => {
      try {
        await api.delete(`/api/holds/${hold.id}`);
      } catch {
        announce('cart', CART.networkFailure);
        refresh();
        return;
      }
      await loadCart().catch(() => undefined);
      await loadDrop().catch(() => undefined);
      announceTotal(CART.released(hold.bar));
      refreshRows();
      const buttons = [...rows.querySelectorAll<HTMLElement>('.release-button')];
      const next = buttons[index] ?? buttons[index - 1];
      if (next) next.focus();
      else backLink.focus();
    })();
  };

  const refreshRows = (): void => {
    while (rows.firstChild) rows.firstChild.remove();
    (store.cart?.holds ?? []).forEach((hold, index) => {
      rows.append(holdRow(hold, index, { release }));
    });
    refresh();
  };

  const province = provincePicker((next: ProvinceCode) => {
    store.province = next;
    void (async () => {
      await loadCart().catch(() => undefined);
      announceTotal();
      refresh();
    })();
  }, store.province);

  const total = moneyRegion(UI.orderTotal, () => ({
    subtotal: store.cart?.subtotal ?? { cents: 0, currency: 'CAD' },
    shipping: store.cart?.shipping_fee ?? { cents: 0, currency: 'CAD' },
    discount: null,
    taxes: store.cart?.taxes ?? [],
    total: store.cart?.total ?? { cents: 0, currency: 'CAD' },
    chargedToday: null,
  }));

  const shipping = shippingForm(fields);
  const step = emailStep({
    purpose: 'checkout',
    fields,
    onCodeRequested: (email) => announce('cart', codeRequestedMessage(email)),
    onVerified: () => {
      refresh();
      shipping.focusName();
    },
  });

  const payButton = el('button', { type: 'button', class: 'button primary pay-button' });
  let paying = false;

  const payState = (): { name: string; enabled: boolean } => {
    if (paying) return { name: say(UI.payingPending), enabled: false };
    if (store.status?.billing === 'down') return { name: say(UI.checkoutPaused), enabled: false };
    if ((store.cart?.holds.length ?? 0) === 0) return { name: say(UI.noBarsHeld), enabled: false };
    if (step.verified() === null) return { name: say(UI.verifyFirst), enabled: false };
    const amount = cash(store.cart?.total ?? { cents: 0, currency: 'CAD' });
    return {
      name: locale() === 'fr-CA' ? `Payer ${amount}` : `Pay ${amount}`,
      enabled: true,
    };
  };

  const pay = async (): Promise<void> => {
    if (paying) return;
    paying = true;
    refresh();
    const key = newIdempotencyKey();
    try {
      const result = await api.post<{ order: Order }>(
        '/api/checkout',
        {
          holds: (store.cart?.holds ?? []).map((hold) => hold.id),
          shipping: { ...shipping.read(), province: store.province },
        },
        { idempotencyKey: key },
      );
      navigate(`/checkout/placed/${result.order.number}`);
      return;
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      await loadCart().catch(() => undefined);
      if (error.status === 410) announceTotal(CART.holdExpired);
      else if (error.status === 422) fields.show(error.fields);
      else if (error.status === 0) announce('cart', CART.networkFailure);
      else if (error.code === 'sold_out') announceTotal(CART.soldOut);
      refreshRows();
    } finally {
      paying = false;
      refresh();
    }
  };

  payButton.addEventListener('click', () => void pay());

  bind(() => {
    heading.textContent = say(UI.checkoutHeading);
    heldRegion.setAttribute('aria-label', say(UI.heldBars));
    backLink.textContent = say(UI.backToDrop);
    cartRegion.setAttribute('aria-label', say(UI.cartUpdates));
    cartRegion.textContent = regionText('cart');
    const state = payState();
    payButton.textContent = state.name;
    payButton.disabled = !state.enabled;
    payButton.setAttribute('aria-busy', paying ? 'true' : 'false');
  });

  main.append(
    heading,
    el('div', { class: 'grid checkout-grid' }, [
      heldRegion,
      province,
      el('aside', { class: 'checkout-total' }, [total]),
      fields.summary,
      step.alerts,
      step.element,
      shipping.element,
      payButton,
      cartRegion,
    ]),
  );

  const tick = (): void => {
    for (const hold of store.cart?.holds ?? []) {
      const row = rows.querySelector<HTMLElement>(`[data-hold="${hold.id}"] .hold-timer`);
      if (!row) continue;
      const remaining = serverClock.remaining(hold.expires_at);
      row.textContent = formatCountdown(remaining);
      if (remaining <= 60_000 && remaining > 0 && !minuteWarned.has(hold.id)) {
        minuteWarned.add(hold.id);
        announce('cart', CART.oneMinuteLeft(hold.bar));
      }
      if (remaining <= 0) {
        announceTotal(CART.holdEnded(hold.bar));
        void (async () => {
          await loadCart().catch(() => undefined);
          refreshRows();
        })();
      }
    }
  };

  window.setInterval(tick, 1_000);

  void (async () => {
    await loadStatus();
    await loadDrop().catch(() => undefined);
    await loadCart().catch(() => undefined);
    serverClock.sync(store.cart?.server_now ?? new Date().toISOString());
    previousTotal = store.cart?.total.cents ?? 0;
    refreshRows();
    tick();
    refresh();
  })();

  everyPoll(async () => {
    await loadStatus();
    const before = new Map((store.cart?.holds ?? []).map((hold) => [hold.id, hold.bar]));
    await loadCart().catch(() => undefined);
    serverClock.sync(store.cart?.server_now ?? new Date().toISOString());
    const after = new Map((store.cart?.holds ?? []).map((hold) => [hold.id, hold.bar]));
    const ended = [...before].filter(([id]) => !after.has(id)).map(([, bar]) => bar);
    if (ended.length > 0) {
      announceTotal(...ended.sort((left, right) => left - right).map((bar) => CART.holdEnded(bar)));
    }
    refreshRows();
    refresh();
  });

  clearRegion('cart');
}
