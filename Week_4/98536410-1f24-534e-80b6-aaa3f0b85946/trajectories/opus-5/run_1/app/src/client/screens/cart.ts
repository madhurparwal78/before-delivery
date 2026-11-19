import { announce, el, ensureOrder, on } from '../lib/dom.js';
import { ApiFailure, call, get, makeRequestKey, post, put, remove } from '../lib/api.js';
import { COPY, amount, kilometres, minuteSeconds, weekdayOfDate } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf, trapFocus } from '../lib/focus.js';
import type { Trap } from '../lib/focus.js';
import { closeWithMotion, openAtOnce, openWithMotion, setFigure } from '../lib/motion.js';
import { dropSavedScreen, loadTabState, maybeMe, readSavedScreen, saveTabState } from '../lib/state.js';
import { isStorageDown, onStorageChange, pauseControl } from '../components/chrome.js';
import { radioGroup } from '../components/radioGroup.js';
import type { Cart, CartShops, Hold, Order, SlotDays } from '../lib/types.js';
import { navigate, pushAddress, replaceAddress, type Screen } from '../router.js';

const LIVE_MILLIS = 5000;
const CHECKOUT_KEY = 'checkout';

type CheckoutMemory = {
  day: string | null;
  time: string | null;
  name: string;
  email: string;
  focusId: string | null;
  scroll: number;
  requestKey: string | null;
  requestBody: unknown;
};

export function cartScreen(): Screen {
  const life = makeLife();
  let cart: Cart | null = null;
  let shops: CartShops['shops'] = [];
  let slotDays: SlotDays['days'] = [];
  let holdState: Hold | null = null;
  let everHeld = false;
  let holdShownSeconds = 0;
  let holdTicker: number | null = null;
  let announcedOneMinute = false;
  let awaitingHoldAnswer = false;
  let placing = false;
  let requestKey: string | null = null;
  let requestBody: unknown = null;
  let checkoutTrap: Trap | null = null;
  let conflictTrap: Trap | null = null;

  const cartUpdates = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Cart updates' });
  const checkoutTotalRegion = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Checkout total',
  });
  const holdStatusRegion = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Hold status',
  });
  const checkoutMessages = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Checkout messages',
  });

  const linesBody = el('tbody');
  const cartTable = el('table', { class: 'data-table', 'aria-label': 'Cart lines' }, [
    el(
      'thead',
      {},
      el('tr', {}, [
        el('th', {}, 'Item'),
        el('th', {}, 'Quantity'),
        el('th', {}, 'Line total'),
        el('th', {}, 'Actions'),
      ]),
    ),
    linesBody,
  ]);

  const cartTotal = el('span', { class: 'figure cart-total' });
  const checkoutButton = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'checkout' },
    'Checkout',
  );
  const emptyCart = el('p', { class: 'blunt-field', hidden: true }, COPY.cartEmpty);

  const shopGroup = radioGroup('Collection shop', 'collection-shop', (storeId) => {
    void chooseShop(storeId);
  });
  const dayGroup = radioGroup('Collection day', 'collection-day', () => {
    paintTimes();
    rememberCheckout();
  });
  const timeGroup = radioGroup('Collection time', 'collection-time', () => {
    refreshRequestKey();
    rememberCheckout();
  });

  const holdButton = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'hold-items' },
    'Hold items',
  );
  const releaseButton = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'release-hold' },
    'Release hold',
  );
  const timerText = el('span', { class: 'timer-text' });
  const meterFill = el('div', { class: 'hold-meter-fill' });
  const holdTimer = el(
    'div',
    {
      class: 'hold-timer',
      role: 'timer',
      'aria-label': 'Hold time left',
      'data-seconds-left': '0',
      'data-hold-fraction': '0.000',
      'data-hold-state': 'checking',
    },
    [timerText, el('div', { class: 'hold-meter' }, meterFill)],
  );

  const fullName = el('input', {
    type: 'text',
    class: 'text-box',
    'aria-label': 'Full name',
    'data-focus-id': 'full-name',
  });
  const emailBox = el('input', {
    type: 'email',
    class: 'text-box',
    'aria-label': 'Email',
    'data-focus-id': 'email',
  });

  const checkoutLines = el('ul', { class: 'checkout-lines', 'aria-label': 'Checkout lines' });
  const checkoutTotal = el('span', { class: 'figure checkout-total' });

  const placeOrder = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'place-order' },
    'Place order',
  );
  const closeCheckout = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'close-checkout' },
    'Close checkout',
  );

  const holdControls = el('div', { class: 'hold-controls' }, [holdButton, releaseButton, holdTimer]);

  const checkoutScroller = el('div', { class: 'dialog-scroller' }, [
    el('h2', {}, 'Checkout'),
    el('div', { class: 'checkout-field' }, [el('h3', {}, 'Collection shop'), shopGroup.node]),
    holdControls,
    el('div', { class: 'checkout-field' }, [el('h3', {}, 'Collection day'), dayGroup.node]),
    el('div', { class: 'checkout-field' }, [el('h3', {}, 'Collection time'), timeGroup.node]),
    el('label', { class: 'field' }, [el('span', {}, 'Full name'), fullName]),
    el('label', { class: 'field' }, [el('span', {}, 'Email'), emailBox]),
    checkoutLines,
    el('p', { class: 'checkout-total-line' }, [el('span', {}, 'Total: '), checkoutTotal]),
    checkoutTotalRegion,
    holdStatusRegion,
    checkoutMessages,
    el('div', { class: 'dialog-actions' }, [placeOrder, closeCheckout]),
  ]);

  const checkoutDialog = el(
    'div',
    {
      class: 'dialog checkout-dialog',
      role: 'dialog',
      'aria-label': 'Checkout',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    checkoutScroller,
  );

  const conflictMessage = el('p', { class: 'conflict-message' });
  const removeLine = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'remove-conflict-line' },
    'Remove line',
  );
  const backToCheckout = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'back-to-checkout' },
    'Back to checkout',
  );
  const conflictDialog = el(
    'div',
    {
      class: 'dialog conflict-dialog',
      role: 'alertdialog',
      'aria-label': 'Stock changed',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('h2', {}, 'Stock changed'),
      conflictMessage,
      el('div', { class: 'dialog-actions' }, [removeLine, backToCheckout]),
    ],
  );
  let conflictSku: string | null = null;

  const node = el('section', { class: 'cart-screen' }, [
    el('h1', { class: 'screen-title' }, 'Cart'),
    emptyCart,
    el('div', { class: 'cart-body' }, [
      el('div', { class: 'charcoal-panel table-holder' }, cartTable),
      el('div', { class: 'cart-totals' }, [
        el('p', { class: 'cart-total-line' }, [el('span', {}, 'Total: '), cartTotal]),
        checkoutButton,
        cartUpdates,
      ]),
    ]),
    checkoutDialog,
    conflictDialog,
  ]);

  const quantityBoxes = new Map<string, HTMLInputElement>();
  const lineRows = new Map<string, HTMLTableRowElement>();
  const checkoutItems = new Map<string, HTMLLIElement>();

  function checkoutIsOpen(): boolean {
    const state = checkoutDialog.dataset['state'];
    return state === 'open' || state === 'opening';
  }

  function totalRegion(): HTMLElement {
    return checkoutIsOpen() ? checkoutTotalRegion : cartUpdates;
  }

  function paintCart(next: Cart): void {
    cart = next;
    emptyCart.hidden = next.lines.length > 0;

    const wanted = new Set(next.lines.map((line) => line.sku));
    for (const [sku, row] of lineRows) {
      if (!wanted.has(sku)) {
        row.remove();
        lineRows.delete(sku);
        quantityBoxes.delete(sku);
      }
    }

    for (const line of next.lines) {
      let row = lineRows.get(line.sku);
      if (!row) {
        const box = el('input', {
          type: 'number',
          class: 'text-box quantity-box',
          min: '0',
          max: '999',
          step: '1',
          'aria-label': `Quantity of ${line.sku}`,
          'data-focus-id': `quantity-${line.sku}`,
        });
        on(box, 'change', () => void changeQuantity(line.sku, Number(box.value)));
        const removeButton = el(
          'button',
          {
            type: 'button',
            class: 'block-button row-action',
            'aria-label': `Remove ${line.sku}`,
            'data-focus-id': `remove-${line.sku}`,
          },
          'Remove',
        );
        on(removeButton, 'click', () => void changeQuantity(line.sku, 0));
        quantityBoxes.set(line.sku, box);
        row = el('tr', { 'data-sku': line.sku }, [
          el('td', { class: 'cell-item' }, [
            el('span', {}, `${line.sku} ${line.name}`),
            el('span', { class: 'short-message' }),
          ]),
          el('td', {}, box),
          el('td', { class: 'cell-line-total' }),
          el('td', {}, removeButton),
        ]) as HTMLTableRowElement;
        lineRows.set(line.sku, row);
        linesBody.appendChild(row);
      }
      const box = quantityBoxes.get(line.sku);
      if (box && document.activeElement !== box) box.value = String(line.quantity);
      (row.querySelector('.cell-line-total') as HTMLElement).textContent = amount(
        line.line_total_cents,
      );
      (row.querySelector('.short-message') as HTMLElement).textContent =
        line.status === 'short' && next.store_name
          ? `Only ${line.available ?? 0} left at ${next.store_name}.`
          : '';
    }

    ensureOrder(
      linesBody,
      next.lines.map((line) => lineRows.get(line.sku)).filter(Boolean) as HTMLElement[],
    );
    setFigure(cartTotal, 'cart-total', next.total_cents, amount);
    setFigure(checkoutTotal, 'checkout-total', next.total_cents, amount);
    paintCheckoutLines(next);
    syncHold(next.hold);
  }

  function paintCheckoutLines(next: Cart): void {
    const wanted = new Set(next.lines.map((line) => line.sku));
    for (const [sku, item] of checkoutItems) {
      if (!wanted.has(sku)) {
        item.remove();
        checkoutItems.delete(sku);
      }
    }
    for (const line of next.lines) {
      let item = checkoutItems.get(line.sku);
      if (!item) {
        item = el('li', { class: 'checkout-line', 'data-sku': line.sku }, [
          el('span', { class: 'checkout-line-name' }),
          el('span', { class: 'short-message' }),
        ]) as HTMLLIElement;
        checkoutItems.set(line.sku, item);
        checkoutLines.appendChild(item);
      }
      (item.querySelector('.checkout-line-name') as HTMLElement).textContent =
        `${line.name} × ${line.quantity}`;
      (item.querySelector('.short-message') as HTMLElement).textContent =
        line.status === 'short' && next.store_name
          ? `Only ${line.available ?? 0} left at ${next.store_name}.`
          : '';
    }
    ensureOrder(
      checkoutLines,
      next.lines.map((line) => checkoutItems.get(line.sku)).filter(Boolean) as HTMLElement[],
    );
  }

  async function changeQuantity(sku: string, quantity: number): Promise<void> {
    try {
      const answer = await put<Cart>(`/api/cart/lines/${sku}`, { quantity });
      paintCart(answer);
      announce(totalRegion(), `Cart total ${amount(answer.total_cents)}.`);
      await refreshShops();
    } catch {
      if (cart) paintCart(cart);
      announce(totalRegion(), COPY.somethingWrong);
    }
  }

  async function chooseShop(storeId: string): Promise<void> {
    try {
      const answer = await put<Cart>('/api/cart/store', { store_id: storeId });
      paintCart(answer);
      announce(checkoutTotalRegion, `Cart total ${amount(answer.total_cents)}.`);
      await refreshSlots();
      refreshRequestKey();
    } catch {
      if (cart) paintCart(cart);
      announce(checkoutMessages, COPY.somethingWrong);
    }
  }

  function paintShops(): void {
    shopGroup.setOptions(
      shops.map((shop) => ({
        value: shop.store_id,
        label: `${shop.name}, ${kilometres(shop.distance_km)} km`,
      })),
    );
    if (cart?.store_id) shopGroup.setValue(cart.store_id);
  }

  async function refreshShops(): Promise<void> {
    if (!cart?.area) {
      shops = [];
      paintShops();
      announce(checkoutMessages, COPY.noArea);
      holdButton.hidden = true;
      return;
    }
    holdButton.hidden = false;
    try {
      const answer = await get<CartShops>('/api/cart/shops');
      shops = answer.shops;
      paintShops();
    } catch {
      /* the next read tries again */
    }
  }

  function paintDays(): void {
    dayGroup.setOptions(
      slotDays.map((day) => ({ value: day.date, label: `${weekdayOfDate(day.date)}, ${day.date}` })),
    );
    paintTimes();
    if (slotDays.length === 0 && cart?.store_id) announce(checkoutMessages, COPY.noSlots);
  }

  function paintTimes(): void {
    const chosenDay = dayGroup.value();
    const day = slotDays.find((candidate) => candidate.date === chosenDay);
    timeGroup.setOptions(
      (day?.slots ?? []).map((slot) => ({ value: slot.start_utc, label: slot.start_local })),
    );
  }

  async function refreshSlots(): Promise<void> {
    if (!cart?.store_id) {
      slotDays = [];
      paintDays();
      return;
    }
    try {
      const answer = await get<SlotDays>(`/api/stores/${cart.store_id}/slots`);
      slotDays = answer.days;
      paintDays();
    } catch {
      /* the next read tries again */
    }
  }

  function writeTimer(seconds: number, fraction: number, state: string): void {
    holdTimer.dataset['secondsLeft'] = String(seconds);
    holdTimer.dataset['holdFraction'] = fraction.toFixed(3);
    holdTimer.dataset['holdState'] = state;
    timerText.textContent = `${minuteSeconds(seconds)}`;
    meterFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function holdWindowSeconds(hold: Hold): number {
    return Math.max(
      1,
      Math.round(
        (new Date(hold.expires_at).getTime() - new Date(hold.created_at).getTime()) / 1000,
      ),
    );
  }

  function stopTicker(): void {
    if (holdTicker !== null) window.clearInterval(holdTicker);
    holdTicker = null;
  }

  /** The countdown follows the server's latest answer, never the device clock. */
  function applyHoldAnswer(hold: Hold | null, announceSuccess: boolean): void {
    const previousId = holdState?.id ?? null;
    holdState = hold;
    awaitingHoldAnswer = false;
    if (hold) everHeld = true;

    if (!hold || hold.status !== 'active') {
      stopTicker();
      releaseButton.hidden = true;
      holdButton.textContent = everHeld ? 'Hold again' : 'Hold items';
      holdButton.setAttribute('aria-label', holdButton.textContent);
      holdButton.dataset['focusId'] = everHeld ? 'hold-again' : 'hold-items';
      writeTimer(0, 0, hold ? hold.status : 'released');
      if (hold && hold.status === 'released') {
        announce(holdStatusRegion, COPY.holdEnded);
        if (document.activeElement === placeOrder) holdButton.focus();
      }
      return;
    }

    if (hold.id !== previousId) announcedOneMinute = false;
    releaseButton.hidden = false;
    holdButton.textContent = 'Hold items';
    holdButton.setAttribute('aria-label', 'Hold items');
    holdButton.dataset['focusId'] = 'hold-items';

    holdShownSeconds = hold.seconds_left;
    const fullWindow = holdWindowSeconds(hold);
    writeTimer(holdShownSeconds, holdShownSeconds / fullWindow, 'active');
    if (announceSuccess && cart?.store_name) {
      announce(holdStatusRegion, `Items held at ${cart.store_name}.`);
    }
    if (holdShownSeconds <= 60 && !announcedOneMinute) {
      announcedOneMinute = true;
      announce(holdStatusRegion, COPY.oneMinuteLeft);
    }

    stopTicker();
    holdTicker = window.setInterval(() => {
      if (holdShownSeconds <= 0) {
        stopTicker();
        awaitingHoldAnswer = true;
        writeTimer(0, 0, 'checking');
        announce(holdStatusRegion, COPY.checkingHold);
        void readHold();
        return;
      }
      holdShownSeconds -= 1;
      writeTimer(holdShownSeconds, holdShownSeconds / fullWindow, 'active');
      if (holdShownSeconds <= 60 && !announcedOneMinute) {
        announcedOneMinute = true;
        announce(holdStatusRegion, COPY.oneMinuteLeft);
      }
    }, 1000);
  }

  /** The cart only carries an active hold, so a vanished hold is read back explicitly. */
  function syncHold(fromCart: Hold | null): void {
    if (fromCart) {
      applyHoldAnswer(fromCart, false);
      return;
    }
    if (holdState && holdState.status === 'active') {
      void readHold();
      return;
    }
    if (!holdState && !everHeld) {
      releaseButton.hidden = true;
      holdButton.textContent = 'Hold items';
      holdButton.setAttribute('aria-label', 'Hold items');
      holdButton.dataset['focusId'] = 'hold-items';
    }
  }

  async function readHold(): Promise<void> {
    const id = holdState?.id;
    if (!id) return;
    try {
      const answer = await get<Hold>(`/api/holds/${id}`);
      applyHoldAnswer(answer, false);
    } catch {
      /* the next read tries again */
    }
  }

  function openConflict(sku: string, remaining: number, storeName: string): void {
    conflictSku = sku;
    conflictMessage.textContent = `Only ${remaining} left at ${storeName}.`;
    announce(checkoutMessages, `Only ${remaining} left at ${storeName}.`);
    openWithMotion(conflictDialog);
    conflictTrap = trapFocus(conflictDialog, closeConflict);
    removeLine.focus();
  }

  function closeConflict(): void {
    conflictTrap?.release();
    conflictTrap = null;
    closeWithMotion(conflictDialog);
    holdButton.focus();
  }

  on(backToCheckout, 'click', closeConflict);
  on(removeLine, 'click', () => {
    const sku = conflictSku;
    closeConflict();
    if (sku) void changeQuantity(sku, 0);
  });

  on(holdButton, 'click', () => {
    announce(holdStatusRegion, COPY.holdingItems);
    void post<Hold>('/api/holds', {})
      .then((answer) => {
        applyHoldAnswer(answer, true);
        refreshRequestKey();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) {
          announce(checkoutMessages, COPY.somethingWrong);
          return;
        }
        if (error.code === 'stock_conflict') {
          openConflict(
            String(error.payload['sku'] ?? ''),
            Number(error.payload['remaining'] ?? 0),
            cart?.store_name ?? '',
          );
          return;
        }
        if (error.code === 'store_suspended') {
          announce(
            checkoutMessages,
            `${cart?.store_name ?? ''} is not taking orders right now.`,
          );
          return;
        }
        announce(checkoutMessages, COPY.somethingWrong);
      });
  });

  on(releaseButton, 'click', () => {
    const id = holdState?.id;
    if (!id) return;
    void remove<Hold>(`/api/holds/${id}`)
      .then((answer) => applyHoldAnswer(answer, false))
      .catch(() => announce(checkoutMessages, COPY.somethingWrong));
  });

  function placementBody(): Record<string, unknown> {
    return {
      hold_id: holdState?.id ?? null,
      slot_start_utc: timeGroup.value(),
      customer: { name: fullName.value, email: emailBox.value },
    };
  }

  /** A fresh key for each attempt whose body differs from the last body sent. */
  function refreshRequestKey(): void {
    const wanted = JSON.stringify(placementBody());
    if (JSON.stringify(requestBody) !== wanted) {
      requestKey = makeRequestKey();
      requestBody = JSON.parse(wanted) as unknown;
    }
    rememberCheckout();
  }

  on(fullName, 'input', refreshRequestKey);
  on(emailBox, 'input', refreshRequestKey);

  async function sendPlacement(): Promise<void> {
    if (placing) return;
    if (isStorageDown()) {
      announce(checkoutMessages, COPY.placeOrderPaused);
      return;
    }
    refreshRequestKey();
    placing = true;
    placeOrder.setAttribute('aria-disabled', 'true');
    announce(checkoutMessages, COPY.placingOrder);
    try {
      const order = await call<Order>('POST', '/api/orders', {
        body: requestBody,
        requestKey: requestKey as string,
      });
      saveTabState('order.success', {
        orderId: order.id,
        message: `Order ${order.number} placed. Collect at ${order.store_name} on ${order.slot_local_date} at ${order.slot_local_time}.`,
      });
      dropSavedScreen();
      await navigate(`/orders/${order.id}`);
      return;
    } catch (error) {
      placing = false;
      placeOrder.setAttribute('aria-disabled', 'false');
      if (!(error instanceof ApiFailure)) {
        announce(checkoutMessages, COPY.somethingWrong);
        return;
      }
      if (error.code === 'request_in_progress') {
        announce(checkoutMessages, COPY.orderInProgress);
        return;
      }
      if (error.code === 'slot_unavailable') {
        announce(checkoutMessages, COPY.slotGone);
        await refreshSlots();
        return;
      }
      if (error.code === 'hold_expired') {
        announce(holdStatusRegion, COPY.holdEnded);
        applyHoldAnswer({ ...(holdState as Hold), status: 'released', seconds_left: 0 }, false);
        requestKey = null;
        requestBody = null;
        holdButton.focus();
        return;
      }
      if (error.code === 'request_key_reuse') {
        requestKey = null;
        requestBody = null;
      }
      if (error.code === 'storage_unavailable') {
        announce(checkoutMessages, COPY.placeOrderPaused);
        return;
      }
      announce(checkoutMessages, COPY.somethingWrong);
    }
  }

  on(placeOrder, 'click', () => void sendPlacement());

  function rememberCheckout(): void {
    saveTabState<CheckoutMemory>(CHECKOUT_KEY, {
      day: dayGroup.value(),
      time: timeGroup.value(),
      name: fullName.value,
      email: emailBox.value,
      focusId: focusIdOf(document.activeElement),
      scroll: checkoutScroller.scrollTop,
      requestKey,
      requestBody,
    });
  }
  life.listen(checkoutDialog, 'focusin', rememberCheckout);
  life.listen(checkoutScroller, 'scroll', rememberCheckout);

  function openCheckout(restored: boolean): void {
    if (restored) openAtOnce(checkoutDialog);
    else openWithMotion(checkoutDialog);
    checkoutTrap?.release();
    checkoutTrap = trapFocus(checkoutDialog, shutCheckout);
    document.body.classList.add('dialog-open');
  }

  function shutCheckout(): void {
    checkoutTrap?.release();
    checkoutTrap = null;
    closeWithMotion(checkoutDialog);
    document.body.classList.remove('dialog-open');
    replaceAddress('/cart');
    checkoutButton.focus();
  }

  on(closeCheckout, 'click', shutCheckout);
  on(checkoutButton, 'click', () => {
    pushAddress('/cart?checkout=open');
    openCheckout(false);
    void refreshShops().then(() => shopGroup.focus());
    void refreshSlots();
  });

  onStorageChange((down) => {
    pauseControl(placeOrder, 'place-order-pause', COPY.placeOrderPaused, down);
  });

  async function refreshAll(): Promise<void> {
    try {
      const answer = await get<Cart>('/api/cart');
      const changed = cart !== null && cart.total_cents !== answer.total_cents;
      paintCart(answer);
      if (changed) announce(totalRegion(), `Cart total ${amount(answer.total_cents)}.`);
      if (checkoutIsOpen()) {
        await refreshShops();
        await refreshSlots();
      }
    } catch {
      /* the next read tries again */
    }
  }

  life.every(LIVE_MILLIS, () => void refreshAll());
  life.listen(window, 'focus', () => void refreshAll());

  return {
    node,
    destroy: () => {
      stopTicker();
      life.kill();
      document.body.classList.remove('dialog-open');
    },
    stateForSignIn: () => ({
      day: dayGroup.value(),
      time: timeGroup.value(),
      name: fullName.value,
      email: emailBox.value,
      focusId: focusIdOf(document.activeElement),
      scroll: checkoutScroller.scrollTop,
      requestKey,
      requestBody,
    }),
    afterMount: () => {
      const wantsCheckout = new URL(location.href).searchParams.get('checkout') === 'open';
      const saved = readSavedScreen();
      const me = maybeMe();
      const restored =
        saved && me && saved.account === me.user.id
          ? (saved.payload as CheckoutMemory)
          : loadTabState<CheckoutMemory>(CHECKOUT_KEY);

      void get<Cart>('/api/cart').then(async (answer) => {
        paintCart(answer);
        await refreshShops();
        await refreshSlots();

        if (restored) {
          if (restored.day) dayGroup.setValue(restored.day);
          paintTimes();
          if (restored.time) timeGroup.setValue(restored.time);
          fullName.value = restored.name ?? '';
          emailBox.value = restored.email ?? '';
          requestKey = restored.requestKey ?? null;
          requestBody = restored.requestBody ?? null;
        }

        if (wantsCheckout) {
          openCheckout(true);
          if (restored) {
            checkoutScroller.scrollTop = restored.scroll ?? 0;
            if (!focusByName(checkoutDialog, restored.focusId)) shopGroup.focus();
          } else {
            shopGroup.focus();
          }
        }
        if (saved && me && saved.account === me.user.id) dropSavedScreen();
      });
    },
  };
}
