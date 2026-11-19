import { announce, clear, el, ensureOrder, on } from '../lib/dom.js';
import { ApiFailure, LatestOnly, get, post } from '../lib/api.js';
import { COPY, lisbonClock, wholeNumber } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf, trapFocus } from '../lib/focus.js';
import type { Trap } from '../lib/focus.js';
import {
  PANEL_AFTER_GLIDE_MILLIS,
  SELECTION_MILLIS,
  closeWithMotion,
  openAtOnce,
  openWithMotion,
  reducedMotion,
  setFigure,
} from '../lib/motion.js';
import { STATE_ORDER, STATE_STYLES, stateCell } from '../lib/shopState.js';
import { loadTabState, saveTabState } from '../lib/state.js';
import type { DisplayState, Review, Store, StoreList } from '../lib/types.js';
import { createEstateMap } from '../components/estateMap.js';
import { rememberStoreNames } from '../components/chrome.js';
import { pushAddress, replaceAddress, type Screen } from '../router.js';

const REVIEW_WINDOW_SECONDS = 86400;
const SEARCH_DEBOUNCE_MILLIS = 333;
const LIVE_MILLIS = 5000;

type Filters = { q: string; states: DisplayState[]; shop: string | null };

function readFilters(): { filters: Filters; rewrite: boolean } {
  const params = new URL(location.href).searchParams;
  const q = (params.get('q') ?? '').trim();
  const rawState = params.get('state');
  let rewrite = false;
  let states: DisplayState[] = [...STATE_ORDER];

  if (rawState !== null) {
    if (rawState === 'none') {
      states = [];
    } else {
      const parts = rawState.split(',').filter((part) => part !== '');
      const known = parts.filter((part) =>
        (STATE_ORDER as readonly string[]).includes(part),
      ) as DisplayState[];
      states = STATE_ORDER.filter((state) => known.includes(state));
      const canonical = states.join(',');
      if (canonical !== rawState) rewrite = true;
      if (states.length === 0) {
        states = [];
        rewrite = true;
      }
    }
  }
  return { filters: { q, states, shop: params.get('shop') }, rewrite };
}

function addressFor(filters: Filters): string {
  const parts: string[] = [];
  if (filters.q !== '') parts.push(`q=${encodeURIComponent(filters.q).replace(/%20/g, '%20')}`);
  const allStates = filters.states.length === STATE_ORDER.length;
  if (filters.states.length === 0) parts.push('state=none');
  else if (!allStates) parts.push(`state=${filters.states.join(',')}`);
  if (filters.shop) parts.push(`shop=${filters.shop}`);
  return parts.length === 0 ? '/estate' : `/estate?${parts.join('&')}`;
}

type PanelMemory = { scroll: number; focusId: string | null };

export function estateScreen(): Screen {
  const life = makeLife();
  const listLoad = new LatestOnly();
  let filters = readFilters().filters;
  let stores: Store[] = [];
  let reviewWindowStart: number | null = null;
  let reviewEvents: Review['events'] = [];
  let knownOrders = new Set<string>();
  let firstReviewRead = true;
  let searchTimer: number | null = null;
  let panelTrap: Trap | null = null;
  let panelOpener: HTMLElement | null = null;
  let selectedShop: string | null = filters.shop;

  const updates = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Estate updates',
  });

  const search = el('input', {
    type: 'search',
    class: 'text-box',
    'aria-label': 'Search shops',
    'data-focus-id': 'search-shops',
    value: filters.q,
  });

  const boxes = new Map<DisplayState, HTMLInputElement>();
  const filterFields = el('div', { class: 'filter-fields' }, [
    el('label', { class: 'field' }, [el('span', {}, 'Search shops'), search]),
    ...STATE_ORDER.map((state) => {
      const box = el('input', {
        type: 'checkbox',
        class: 'check-box',
        'aria-label': STATE_STYLES[state].label,
        'data-focus-id': `filter-${state}`,
      });
      box.checked = filters.states.includes(state);
      boxes.set(state, box);
      on(box, 'change', () => applyFilters(collectFilters(), true));
      return el('label', { class: 'check-field' }, [box, el('span', {}, STATE_STYLES[state].label)]);
    }),
  ]);

  const filterSheet = el(
    'div',
    {
      class: 'filter-sheet',
      role: 'region',
      'aria-label': 'Filters',
      'data-state': 'closed',
    },
    filterFields,
  );

  const filtersButton = el(
    'button',
    {
      type: 'button',
      class: 'block-button filters-button',
      'aria-expanded': 'false',
      'data-focus-id': 'filters',
    },
    'Filters',
  );

  let filterTrap: Trap | null = null;
  const closeFilterSheet = (): void => {
    filtersButton.setAttribute('aria-expanded', 'false');
    filterTrap?.release();
    filterTrap = null;
    closeWithMotion(filterSheet);
    filtersButton.focus();
  };
  on(filtersButton, 'click', () => {
    if (filtersButton.getAttribute('aria-expanded') === 'true') {
      closeFilterSheet();
      return;
    }
    filtersButton.setAttribute('aria-expanded', 'true');
    openWithMotion(filterSheet);
    filterTrap = trapFocus(filterSheet, closeFilterSheet);
    search.focus();
  });

  const skip = el(
    'a',
    { class: 'skip-link', href: '#estate-shops', 'data-focus-id': 'skip' },
    'Skip to shops table',
  );

  const mapTab = el(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: 'view-tab',
      'aria-selected': 'true',
      'data-focus-id': 'tab-map',
    },
    'Map',
  );
  const tableTab = el(
    'button',
    {
      type: 'button',
      role: 'tab',
      class: 'view-tab',
      'aria-selected': 'false',
      'data-focus-id': 'tab-table',
    },
    'Table',
  );
  const tabs = el('div', { class: 'view-tabs', role: 'tablist', 'aria-label': 'Estate view' }, [
    mapTab,
    tableTab,
  ]);

  const estateMap = createEstateMap({
    onSelect: (storeId, opener) => void selectShop(storeId, opener),
  });

  const reviewSlider = el('input', {
    type: 'range',
    class: 'review-slider',
    min: '0',
    max: '1000',
    step: '1',
    value: '1000',
    'aria-label': 'Review last 24 hours',
    'data-focus-id': 'review-slider',
  });
  const reviewCount = el('span', { class: 'figure review-count' });
  const reviewReadout = el('p', {
    class: 'live-region review-readout',
    role: 'status',
    'aria-label': 'Review readout',
  });

  const panelHeading = el('h2', { class: 'panel-heading', tabindex: '-1', 'data-focus-id': 'panel-heading' });
  const panelCritical = el('span', { class: 'figure panel-critical' });
  const panelState = el('p', { class: 'panel-state' });
  const panelCloses = el('p', { class: 'panel-closes' });
  const criticalBody = el('tbody');
  const criticalTable = el('table', { class: 'data-table', 'aria-label': 'Critical lines' }, [
    el('thead', {}, el('tr', {}, [el('th', {}, 'Item'), el('th', {}, 'On hand')])),
    criticalBody,
  ]);
  const suspendToggle = el('button', {
    type: 'button',
    class: 'block-button',
    'data-focus-id': 'panel-suspend',
  });
  const closeDetail = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'close-detail' },
    'Close detail',
  );
  const detailPanel = el(
    'div',
    {
      class: 'detail-panel',
      role: 'region',
      'aria-label': 'Shop detail',
      'data-state': 'closed',
    },
    [
      panelHeading,
      panelState,
      panelCloses,
      el('p', { class: 'panel-critical-line' }, [
        el('span', {}, 'Critical lines: '),
        panelCritical,
      ]),
      el('div', { class: 'charcoal-panel table-holder' }, criticalTable),
      suspendToggle,
      closeDetail,
    ],
  );

  const reasonError = el('p', { class: 'field-error', id: 'suspend-reason-error' });
  const reason = el('input', {
    type: 'text',
    class: 'text-box',
    'aria-label': 'Reason',
    'aria-describedby': 'suspend-reason-error',
    'data-focus-id': 'suspend-reason',
  });
  const suspendConfirm = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'suspend-confirm' },
    'Suspend',
  );
  const keepOpen = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'keep-open' },
    'Keep open',
  );
  const suspendDialog = el(
    'div',
    {
      class: 'dialog suspend-dialog',
      role: 'dialog',
      'aria-label': 'Suspend shop',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('h2', {}, 'Suspend shop'),
      el('label', { class: 'field' }, [el('span', {}, 'Reason'), reason]),
      reasonError,
      el('div', { class: 'dialog-actions' }, [suspendConfirm, keepOpen]),
    ],
  );

  const tableBody = el('tbody');
  const shopsTable = el(
    'table',
    {
      class: 'data-table shops-table',
      'aria-label': 'Shops',
      tabindex: '0',
      id: 'estate-shops',
      'data-focus-id': 'shops-table',
    },
    [
      el(
        'thead',
        {},
        el('tr', {}, [
          el('th', {}, 'Shop'),
          el('th', {}, 'City'),
          el('th', {}, 'State'),
          el('th', {}, 'Critical lines'),
          el('th', {}, 'Closes'),
          el('th', {}, 'Actions'),
        ]),
      ),
      tableBody,
    ],
  );

  const emptyMessage = el('p', { class: 'blunt-field', hidden: true }, COPY.noShopsMatch);

  const node = el('section', { class: 'estate-screen' }, [
    skip,
    el('div', { class: 'estate-top' }, [filtersButton, tabs]),
    filterSheet,
    el('div', { class: 'estate-body' }, [
      el('div', { class: 'estate-map-column' }, [
        estateMap.region,
        estateMap.legend,
        el('div', { class: 'review-strip' }, [
          el('label', { class: 'field' }, [
            el('span', {}, 'Review last 24 hours'),
            reviewSlider,
          ]),
          reviewCount,
          reviewReadout,
        ]),
      ]),
      detailPanel,
    ]),
    el('div', { class: 'estate-table-wrap' }, [
      emptyMessage,
      el('div', { class: 'charcoal-panel table-holder' }, shopsTable),
    ]),
    updates,
    suspendDialog,
  ]);

  function collectFilters(): Filters {
    const states = STATE_ORDER.filter((state) => boxes.get(state)?.checked);
    return { q: search.value.trim(), states: [...states], shop: selectedShop };
  }

  const rowNodes = new Map<string, HTMLTableRowElement>();
  const rowFigures = new Map<string, HTMLElement>();

  function renderRows(): void {
    const wanted = new Set(stores.map((store) => store.id));
    for (const [storeId, row] of rowNodes) {
      if (!wanted.has(storeId)) {
        row.remove();
        rowNodes.delete(storeId);
        rowFigures.delete(storeId);
      }
    }
    for (const store of stores) {
      let row = rowNodes.get(store.id);
      if (!row) {
        row = el('tr', { 'data-store-id': store.id }) as HTMLTableRowElement;
        const figure = el('span', { class: 'figure' });
        rowFigures.set(store.id, figure);
        const details = el(
          'button',
          { type: 'button', class: 'block-button row-action', 'data-focus-id': `details-${store.id}` },
          'Details',
        );
        const suspend = el('button', {
          type: 'button',
          class: 'block-button row-action',
          'data-focus-id': `suspend-${store.id}`,
        });
        on(details, 'click', () => {
          if (tableTab.getAttribute('aria-selected') === 'true') showTab('map');
          void selectShop(store.id, details);
        });
        on(suspend, 'click', () => {
          const target = stores.find((candidate) => candidate.id === store.id);
          if (!target) return;
          if (target.suspended) void resumeShop(target, suspend);
          else openSuspendDialog(target, suspend);
        });
        row.append(
          el('td', { class: 'cell-name' }),
          el('td', { class: 'cell-city' }),
          el('td', { class: 'cell-state' }),
          el('td', { class: 'cell-critical' }, figure),
          el('td', { class: 'cell-closes' }),
          el('td', { class: 'cell-actions' }, [details, suspend]),
        );
        rowNodes.set(store.id, row);
        tableBody.appendChild(row);
      }
      row.dataset['markerState'] = store.display_state;
      (row.querySelector('.cell-name') as HTMLElement).textContent = store.name;
      (row.querySelector('.cell-city') as HTMLElement).textContent = store.city;
      const stateCellNode = row.querySelector('.cell-state') as HTMLElement;
      clear(stateCellNode);
      stateCellNode.appendChild(stateCell(store.display_state));
      (row.querySelector('.cell-closes') as HTMLElement).textContent = store.closes_local ?? '—';
      const figure = rowFigures.get(store.id);
      if (figure) setFigure(figure, 'critical-lines', store.critical_lines, wholeNumber);
      const [details, suspend] = [...row.querySelectorAll('button')] as HTMLButtonElement[];
      details!.setAttribute('aria-label', `Details for ${store.name}`);
      suspend!.textContent = store.suspended ? 'Resume' : 'Suspend';
      suspend!.setAttribute(
        'aria-label',
        store.suspended ? `Resume ${store.name}` : `Suspend ${store.name}`,
      );
    }
    ensureOrder(
      tableBody,
      stores.map((store) => rowNodes.get(store.id)).filter(Boolean) as HTMLElement[],
    );
  }

  async function loadShops(announceCount: boolean): Promise<void> {
    if (filters.states.length === 0) {
      stores = [];
      estateMap.update([], 0);
      renderRows();
      emptyMessage.hidden = false;
      announce(updates, COPY.noShopsMatch);
      return;
    }
    if (announceCount) announce(updates, COPY.loadingShops);
    const params = new URLSearchParams();
    if (filters.q !== '') params.set('q', filters.q);
    params.set('state', filters.states.join(','));
    try {
      await listLoad.run(
        () => get<StoreList>(`/api/stores?${params.toString()}`),
        (answer) => {
          stores = answer.stores;
          rememberStoreNames(answer.stores);
          estateMap.update(answer.stores, answer.count);
          renderRows();
          emptyMessage.hidden = answer.count > 0;
          if (announceCount) {
            announce(
              updates,
              answer.count === 0 ? COPY.noShopsMatch : `${answer.count} shops shown.`,
            );
          }
          if (selectedShop) paintPanel();
          paintReview();
        },
      );
    } catch {
      if (announceCount) announce(updates, COPY.somethingWrong);
    }
  }

  function applyFilters(next: Filters, addHistory: boolean): void {
    filters = next;
    const target = addressFor(filters);
    if (addHistory) pushAddress(target);
    else replaceAddress(target);
    void loadShops(true);
  }

  on(search, 'input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = life.after(SEARCH_DEBOUNCE_MILLIS, () => applyFilters(collectFilters(), true));
  });

  function paintPanel(): void {
    const store = stores.find((candidate) => candidate.id === selectedShop);
    if (!store) return;
    panelHeading.textContent = store.name;
    panelState.textContent = `State: ${store.state_label}`;
    panelCloses.textContent = store.closes_local
      ? `Closes at ${store.closes_local}`
      : 'Closed today';
    setFigure(panelCritical, 'critical-lines', store.critical_lines, wholeNumber);
    suspendToggle.textContent = store.suspended ? 'Resume shop' : 'Suspend shop';
    suspendToggle.setAttribute('aria-label', store.suspended ? 'Resume shop' : 'Suspend shop');
  }

  async function loadCriticalLines(storeId: string): Promise<void> {
    try {
      const answer = await get<{ lines: { sku: string; name: string; on_hand: number; critical: boolean }[] }>(
        `/api/stores/${storeId}/stock`,
      );
      clear(criticalBody);
      for (const line of answer.lines.filter((candidate) => candidate.critical)) {
        criticalBody.appendChild(
          el('tr', {}, [
            el('td', {}, `${line.sku} ${line.name}`),
            el('td', {}, String(line.on_hand)),
          ]),
        );
      }
    } catch {
      clear(criticalBody);
    }
  }

  function openPanel(opener: HTMLElement | null, restored: boolean): void {
    panelOpener = opener;
    estateMap.setPanelOpen(true);
    if (restored) openAtOnce(detailPanel);
    else openWithMotion(detailPanel);
    panelTrap?.release();
    panelTrap = trapFocus(detailPanel, closePanel);
  }

  function closePanel(): void {
    const opener = panelOpener;
    selectedShop = null;
    filters = { ...filters, shop: null };
    replaceAddress(addressFor(filters));
    panelTrap?.release();
    panelTrap = null;
    estateMap.setPanelOpen(false);
    closeWithMotion(detailPanel);
    savePanelMemory();
    (opener ?? shopsTable).focus();
  }

  on(closeDetail, 'click', closePanel);

  async function selectShop(storeId: string, opener: HTMLElement | null): Promise<void> {
    selectedShop = storeId;
    filters = { ...filters, shop: storeId };
    replaceAddress(addressFor(filters));
    paintPanel();
    void loadCriticalLines(storeId);
    estateMap.select(storeId, opener);
    const wait = reducedMotion() ? 0 : SELECTION_MILLIS + PANEL_AFTER_GLIDE_MILLIS;
    life.after(wait, () => {
      if (selectedShop !== storeId) return;
      openPanel(opener, false);
      panelHeading.focus();
      savePanelMemory();
    });
  }

  let suspendTarget: Store | null = null;
  let suspendOpener: HTMLElement | null = null;
  let suspendTrap: Trap | null = null;

  function closeSuspendDialog(): void {
    suspendTrap?.release();
    suspendTrap = null;
    closeWithMotion(suspendDialog);
    (suspendOpener ?? suspendToggle).focus();
  }

  function openSuspendDialog(store: Store, opener: HTMLElement): void {
    suspendTarget = store;
    suspendOpener = opener;
    reason.value = '';
    reason.removeAttribute('aria-invalid');
    reasonError.textContent = '';
    openWithMotion(suspendDialog);
    suspendTrap = trapFocus(suspendDialog, closeSuspendDialog);
    reason.focus();
  }

  on(keepOpen, 'click', closeSuspendDialog);
  on(suspendConfirm, 'click', () => {
    if (reason.value.trim() === '') {
      reasonError.textContent = COPY.reasonRequired;
      reason.setAttribute('aria-invalid', 'true');
      reason.focus();
      return;
    }
    const store = suspendTarget;
    if (!store) return;
    announce(updates, COPY.saving);
    void post<Store>(`/api/stores/${store.id}/suspension`, {
      suspended: true,
      reason: reason.value.trim(),
    })
      .then((updated) => {
        announce(updates, `${updated.name} is suspended.`);
        closeSuspendDialog();
        void loadShops(false);
      })
      .catch(() => {
        announce(updates, COPY.somethingWrong);
      });
  });

  async function resumeShop(store: Store, opener: HTMLElement): Promise<void> {
    announce(updates, COPY.saving);
    try {
      const updated = await post<Store>(`/api/stores/${store.id}/suspension`, { suspended: false });
      announce(updates, `${updated.name} is open for orders again.`);
      await loadShops(false);
      opener.focus();
    } catch {
      announce(updates, COPY.somethingWrong);
    }
  }

  on(suspendToggle, 'click', () => {
    const store = stores.find((candidate) => candidate.id === selectedShop);
    if (!store) return;
    if (store.suspended) void resumeShop(store, suspendToggle);
    else openSuspendDialog(store, suspendToggle);
  });

  function reviewAt(progress: number): { count: number; moment: Date; perShop: Map<string, number> } {
    const perShop = new Map<string, number>();
    if (reviewWindowStart === null) return { count: 0, moment: new Date(), perShop };
    const moment = new Date(reviewWindowStart + progress * REVIEW_WINDOW_SECONDS * 1000);
    let count = 0;
    for (const event of reviewEvents) {
      if (event.type !== 'order.placed') continue;
      if (new Date(event.at).getTime() > moment.getTime()) continue;
      count += 1;
      perShop.set(event.store_id, (perShop.get(event.store_id) ?? 0) + 1);
    }
    return { count, moment, perShop };
  }

  function paintReview(): void {
    const progress = Number(reviewSlider.value) / 1000;
    estateMap.setReviewProgress(progress);
    const at = reviewAt(progress);
    setFigure(reviewCount, 'review-count', at.count, wholeNumber);
    estateMap.setBadges(at.perShop);
    announce(
      reviewReadout,
      `${at.count} orders by ${lisbonClock(at.moment.toISOString())} Lisbon time`,
    );
  }

  on(reviewSlider, 'input', paintReview);
  on(reviewSlider, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const current = Number(reviewSlider.value);
    const move: Record<string, number> = {
      ArrowRight: 10,
      ArrowUp: 10,
      ArrowLeft: -10,
      ArrowDown: -10,
      PageUp: 100,
      PageDown: -100,
    };
    if (key in move) {
      event.preventDefault();
      reviewSlider.value = String(Math.min(1000, Math.max(0, current + (move[key] as number))));
      paintReview();
      return;
    }
    if (key === 'Home' || key === 'End') {
      event.preventDefault();
      reviewSlider.value = key === 'Home' ? '0' : '1000';
      paintReview();
    }
  });

  async function loadReview(): Promise<void> {
    try {
      const answer = await get<Review>('/api/estate/review');
      if (reviewWindowStart === null) reviewWindowStart = new Date(answer.window_start).getTime();
      reviewEvents = answer.events;

      const arrivals = answer.events.filter((event) => event.type === 'order.placed');
      if (firstReviewRead) {
        knownOrders = new Set(arrivals.map((event) => event.order_id));
        firstReviewRead = false;
      } else {
        for (const event of arrivals) {
          if (knownOrders.has(event.order_id)) continue;
          knownOrders.add(event.order_id);
          estateMap.showArrival(event.store_id);
          const store = stores.find((candidate) => candidate.id === event.store_id);
          announce(
            updates,
            `New order ${event.order_number} at ${store?.name ?? event.store_id}.`,
          );
        }
      }
      paintReview();
    } catch {
      /* the next read tries again */
    }
  }

  function showTab(which: 'map' | 'table'): void {
    const mapChosen = which === 'map';
    mapTab.setAttribute('aria-selected', mapChosen ? 'true' : 'false');
    tableTab.setAttribute('aria-selected', mapChosen ? 'false' : 'true');
    node.dataset['view'] = which;
  }

  on(mapTab, 'click', () => showTab('map'));
  on(tableTab, 'click', () => showTab('table'));
  on(tabs, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault();
    const next = mapTab.getAttribute('aria-selected') === 'true' ? 'table' : 'map';
    showTab(next);
    (next === 'map' ? mapTab : tableTab).focus();
  });

  on(skip, 'click', (event) => {
    event.preventDefault();
    showTab('table');
    shopsTable.focus();
  });

  function savePanelMemory(): void {
    saveTabState<PanelMemory>('estate.panel', {
      scroll: detailPanel.scrollTop,
      focusId: focusIdOf(document.activeElement),
    });
  }
  life.listen(detailPanel, 'scroll', savePanelMemory);
  life.listen(detailPanel, 'focusin', savePanelMemory);

  life.listen(document, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'Escape') return;
    if (suspendDialog.dataset['state'] === 'open') return;
    if (detailPanel.dataset['state'] === 'open' && !detailPanel.contains(document.activeElement)) {
      closePanel();
    }
  });

  life.every(LIVE_MILLIS, () => {
    void loadShops(false);
    void loadReview();
  });

  return {
    node,
    destroy: () => {
      life.kill();
      estateMap.destroy();
    },
    afterMount: () => {
      const parsed = readFilters();
      filters = parsed.filters;
      selectedShop = filters.shop;
      search.value = filters.q;
      for (const [state, box] of boxes) box.checked = filters.states.includes(state);
      const canonical = addressFor(filters);
      if (parsed.rewrite || canonical !== location.pathname + location.search) {
        replaceAddress(canonical);
      }
      showTab('map');
      void loadShops(true).then(() => {
        if (!selectedShop) return;
        paintPanel();
        void loadCriticalLines(selectedShop);
        const marker = estateMap.markerOf(selectedShop);
        estateMap.select(selectedShop, marker);
        openPanel(marker, true);
        const memory = loadTabState<PanelMemory>('estate.panel');
        if (memory) {
          detailPanel.scrollTop = memory.scroll;
          if (!focusByName(detailPanel, memory.focusId)) panelHeading.focus();
        } else {
          panelHeading.focus();
        }
      });
      void loadReview();
      if (window.innerWidth >= 1200) {
        openAtOnce(filterSheet);
        filtersButton.setAttribute('aria-expanded', 'true');
      }
    },
  };
}
