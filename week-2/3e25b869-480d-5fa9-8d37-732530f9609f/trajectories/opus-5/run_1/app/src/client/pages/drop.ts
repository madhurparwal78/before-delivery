import { dropScent, scentName } from '../../shared/catalog.js';
import { CART, barItemText, dropOpensMessage, UI } from '../../shared/copy.js';
import { dropTimeText, moneyText } from '../../shared/bilingual.js';
import type { Hold } from '../../shared/types.js';
import { ApiFailure, api } from '../api.js';
import { formatCountdown, serverClock } from '../countdown.js';
import { cash, locale, longDate } from '../i18n.js';
import { announce, clearRegion, regionText } from '../live.js';
import { deepLinkOffset, LoafFigure, SCROLL_TRAVEL } from '../loaf/figure.js';
import { defaultBatch, everyPoll, loadCart, loadDrop, loadStatus, selectedBatch, store } from '../store.js';
import { bind, bindText, el, refresh, say } from '../ui.js';

const WIDE = 1024;

function activeHolds(): Hold[] {
  return store.cart?.holds ?? [];
}

export function announceCart(
  events: ReturnType<typeof CART.released>[] | null,
  previousTotalCents: number | null,
): void {
  const total = store.cart?.total.cents ?? 0;
  const messages = events ?? [];
  const totalChanged = previousTotalCents !== null && previousTotalCents !== total;
  announce(
    'cart',
    ...messages,
    totalChanged ? CART.totalChanged(moneyText(store.cart?.total ?? { cents: 0, currency: 'CAD' })) : null,
  );
}

function scentChips(figure: LoafFigure, onSelect: () => void): HTMLElement {
  const group = el('div', { role: 'radiogroup', class: 'scent-chips' });
  bind(() => group.setAttribute('aria-label', say(UI.scentGroup)));

  const build = (): void => {
    while (group.firstChild) group.firstChild.remove();
    const batches = store.batches;
    const current = selectedBatch();
    batches.forEach((batch, index) => {
      const chosen = batch.code === current?.code;
      const chip = el('button', {
        type: 'button',
        role: 'radio',
        class: 'scent-chip',
        'aria-checked': chosen ? 'true' : 'false',
        tabindex: chosen ? '0' : '-1',
        'data-batch': batch.code,
      });
      bindText(chip, () => scentName(batch.scent, locale()));
      chip.addEventListener('click', () => select(index));
      chip.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        select((index + step + batches.length) % batches.length);
      });
      group.append(chip);
    });
  };

  const select = (index: number): void => {
    const batch = store.batches[index];
    if (!batch) return;
    store.selectedBatch = batch.code;
    history.replaceState(null, '', `/?batch=${batch.code}`);
    figure.setBatch(batch);
    build();
    onSelect();
    refresh();
    group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  };

  bind(() => {
    const codes = store.batches.map((batch) => batch.code).join(',');
    if (group.dataset['codes'] !== codes) {
      group.dataset['codes'] = codes;
      build();
    }
    const current = selectedBatch();
    for (const chip of group.querySelectorAll<HTMLElement>('.scent-chip')) {
      const chosen = chip.dataset['batch'] === current?.code;
      chip.setAttribute('aria-checked', chosen ? 'true' : 'false');
      chip.tabIndex = chosen ? 0 : -1;
    }
  });
  return group;
}

function ruledRegion(label: () => string, body: HTMLElement): HTMLElement {
  const region = el('section', { role: 'region', class: 'label-row' });
  const heading = el('h2', { class: 'label-row-title' });
  bindText(heading, label);
  bind(() => region.setAttribute('aria-label', label()));
  region.append(heading, body);
  return region;
}

function barList(): HTMLElement {
  const list = el('ul', { role: 'list', class: 'bar-list' });
  bind(() => {
    list.setAttribute('aria-label', say(UI.barsInBatch));
    const batch = selectedBatch();
    const bars = batch?.bars ?? [];
    while (list.childElementCount > bars.length) list.lastElementChild?.remove();
    while (list.childElementCount < bars.length) {
      list.append(el('li', { role: 'listitem', class: 'bar-list-item' }));
    }
    bars.forEach((bar, index) => {
      const item = list.children[index];
      if (!item) return;
      item.setAttribute('data-bar-status', bar.status);
      item.textContent = say(barItemText(bar.number, bar.status));
    });
  });
  return list;
}

export function renderDrop(main: HTMLElement, query: URLSearchParams): void {
  const figure = new LoafFigure();
  const heading = el('h1', { class: 'page-heading' });
  const section = el('section', { class: 'drop-section' });
  const rail = el('div', { class: 'drop-rail' });
  const figureColumn = el('div', { class: 'drop-figure' }, [figure.element]);

  const sizeSection = (): void => {
    section.style.height = `${window.innerHeight + SCROLL_TRAVEL}px`;
  };
  sizeSection();

  const batchBody = el('p', { class: 'label-row-value tabular' });
  const cureBody = el('p', { class: 'label-row-value tabular' });
  const notesBody = el('p', { class: 'label-row-value' });
  const dropTimeBody = el('p', { class: 'label-row-value' });
  const dropTimeValue = el('time', { class: 'tabular' });
  dropTimeBody.append(dropTimeValue);
  const priceBody = el('p', { class: 'label-row-value tabular' });

  const counts = el('p', { role: 'status', class: 'counts-strip tabular' });
  const holdButton = el('button', { type: 'button', class: 'button primary hold-button' });
  const holdSlot = el('div', { class: 'hold-slot' }, [holdButton]);
  const holdResult = el('p', { class: 'hold-result' });
  const cartRegion = el('p', { role: 'status', class: 'live-region' });
  const checkoutLink = el('a', { href: '/checkout', class: 'button secondary checkout-link' });
  const disclosure = el('button', { type: 'button', class: 'button quiet disclosure' });
  const list = barList();
  const listWrapper = el('div', { class: 'bar-list-wrapper', id: 'bar-list-panel' }, [list]);
  let expanded = false;

  const isNarrow = (): boolean => window.innerWidth < WIDE;

  const applyDisclosure = (): void => {
    const narrow = isNarrow();
    disclosure.hidden = !narrow;
    disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    disclosure.setAttribute('aria-controls', 'bar-list-panel');
    listWrapper.hidden = narrow && !expanded;
  };

  disclosure.addEventListener('click', () => {
    expanded = !expanded;
    applyDisclosure();
    disclosure.focus();
  });

  let holding = false;
  let previousTotal = store.cart?.total.cents ?? 0;

  const hold = async (): Promise<void> => {
    const batch = selectedBatch();
    if (!batch || holding) return;
    holding = true;
    refresh();
    try {
      const result = await api.post<{ hold: Hold }>('/api/holds', { batch: batch.code });
      await Promise.all([loadDrop(), loadCart()]);
      serverClock.sync(store.cart?.server_now ?? new Date().toISOString());
      const left = formatCountdown(serverClock.remaining(result.hold.expires_at));
      announceCart([CART.holdSucceeded(result.hold.bar, left)], previousTotal);
      previousTotal = store.cart?.total.cents ?? 0;
      figure.setBatch(selectedBatch());
    } catch (error) {
      await handleHoldFailure(error);
    } finally {
      holding = false;
      refresh();
    }
  };

  const handleHoldFailure = async (error: unknown): Promise<void> => {
    if (!(error instanceof ApiFailure)) throw error;
    const message =
      error.code === 'sold_out'
        ? CART.soldOut
        : error.code === 'all_held'
          ? CART.allHeld
          : error.code === 'hold_limit'
            ? CART.holdLimit
            : error.code === 'not_live'
              ? CART.notLive
              : CART.networkFailure;
    await loadDrop().catch(() => undefined);
    announceCart([message], null);
    figure.setBatch(selectedBatch());
  };

  holdButton.addEventListener('click', () => void hold());

  bind(() => {
    const batch = selectedBatch();
    heading.textContent = batch ? scentName(batch.scent, locale()) : say(UI.brand);
    batchBody.textContent = batch
      ? `${batch.code} \u00B7 ${
          locale() === 'fr-CA' ? `${batch.bars_cut} pains coupés` : `${batch.bars_cut} bars cut`
        }`
      : '';
    cureBody.textContent = batch ? longDate(batch.cure_date) : '';
    notesBody.textContent = batch ? say(dropScent(batch.scent)?.notes ?? UI.regionScentNotes) : '';
    if (batch?.drop_at) {
      dropTimeValue.setAttribute('datetime', batch.drop_at);
      dropTimeValue.textContent = say(dropTimeText(new Date(batch.drop_at)));
    } else {
      dropTimeValue.removeAttribute('datetime');
      dropTimeValue.textContent = '\u2014';
    }
    priceBody.textContent = batch
      ? locale() === 'fr-CA'
        ? `${cash(batch.unit_price)} le pain`
        : `${cash(batch.unit_price)} a bar`
      : '';
    counts.setAttribute('aria-label', say(UI.batchCounts));
    counts.textContent = batch
      ? locale() === 'fr-CA'
        ? `Coupés ${batch.bars_cut} \u00B7 Disponibles ${batch.available} \u00B7 Réservés ${batch.held} \u00B7 Vendus ${batch.sold}`
        : `Cut ${batch.bars_cut} \u00B7 Available ${batch.available} \u00B7 Held ${batch.held} \u00B7 Sold ${batch.sold}`
      : '';

    while (holdSlot.firstChild) holdSlot.firstChild.remove();
    if (batch?.state === 'live') {
      holdSlot.append(holdButton);
      const noneFree = batch.available === 0 && batch.held > 0;
      holdButton.disabled = holding || noneFree;
      holdButton.setAttribute('aria-busy', holding ? 'true' : 'false');
      holdButton.textContent = holding
        ? say(UI.holdingPending)
        : noneFree
          ? say(UI.allBarsHeld)
          : say(UI.holdABar);
    } else if (batch?.state === 'sold_out') {
      holdSlot.append(el('p', { class: 'hold-state', text: say(UI.soldOut) }));
    } else if (batch?.state === 'scheduled' && batch.drop_at) {
      holdSlot.append(
        el('p', {
          class: 'hold-state',
          text: say(dropOpensMessage(dropTimeText(new Date(batch.drop_at)))),
        }),
      );
    }

    holdResult.textContent = regionText('cart');
    cartRegion.setAttribute('aria-label', say(UI.cartUpdates));
    cartRegion.textContent = regionText('cart');
    disclosure.textContent = say(UI.showBarList);
    const held = activeHolds().length;
    checkoutLink.hidden = held === 0;
    checkoutLink.textContent =
      locale() === 'fr-CA' ? `Passer au paiement (${held})` : `Go to checkout (${held})`;
    applyDisclosure();
  });

  rail.append(
    heading,
    scentChips(figure, () => figure.setBatch(selectedBatch())),
    ruledRegion(() => say(UI.regionBatch), batchBody),
    ruledRegion(() => say(UI.regionCureDate), cureBody),
    ruledRegion(() => say(UI.regionScentNotes), notesBody),
    ruledRegion(() => say(UI.regionDropTime), dropTimeBody),
    ruledRegion(() => say(UI.regionPrice), priceBody),
    counts,
    holdSlot,
    holdResult,
    checkoutLink,
    disclosure,
    listWrapper,
    cartRegion,
  );
  section.append(el('div', { class: 'grid drop-grid' }, [figureColumn, rail]));
  main.append(section);

  window.addEventListener('resize', () => {
    applyDisclosure();
  });

  const startingBatch = query.get('batch');
  const hash = location.hash;

  void (async () => {
    await loadStatus();
    await loadDrop();
    await loadCart();
    serverClock.sync(store.cart?.server_now ?? new Date().toISOString());
    previousTotal = store.cart?.total.cents ?? 0;
    const known = store.batches.find((candidate) => candidate.code === startingBatch);
    store.selectedBatch = (known ?? defaultBatch())?.code ?? null;
    figure.setBatch(selectedBatch());
    refresh();
    const barMatch = /^#bar-(\d+)$/.exec(hash);
    const batch = selectedBatch();
    if (barMatch && batch) {
      const offset = deepLinkOffset(Number(barMatch[1]), batch.bars_cut);
      if (offset !== null) window.scrollTo({ top: offset, behavior: 'auto' });
    }
    figure.apply();
  })();

  let knownHolds = new Map<string, number>();

  everyPoll(async () => {
    await loadStatus();
    const previousMarks = selectedBatch()?.bars.map((bar) => bar.status).join('') ?? '';
    await loadDrop().catch(() => undefined);
    await loadCart().catch(() => undefined);
    serverClock.sync(store.cart?.server_now ?? new Date().toISOString());
    const current = new Map(activeHolds().map((entry) => [entry.id, entry.bar]));
    const ended = [...knownHolds].filter(([id]) => !current.has(id)).map(([, bar]) => bar);
    knownHolds = current;
    if (ended.length > 0) {
      announceCart(
        ended.sort((left, right) => left - right).map((bar) => CART.holdEnded(bar)),
        previousTotal,
      );
    }
    previousTotal = store.cart?.total.cents ?? 0;
    const batch = selectedBatch();
    if (batch && batch.bars.map((bar) => bar.status).join('') !== previousMarks) {
      figure.setBatch(batch);
    }
    refresh();
    figure.apply();
  });

  clearRegion('cart');
}
