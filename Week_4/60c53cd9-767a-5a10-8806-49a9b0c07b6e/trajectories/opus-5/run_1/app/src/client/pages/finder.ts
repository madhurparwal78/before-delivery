/**
 * The finder: filters, the tower stage with its lens, and the results, all
 * reading the same live inventory. The address carries every active filter.
 */

import { get } from '../api';
import { Header } from '../chrome';
import { announce, closeLayer, el, noticesNode, openLayer, prefersReducedMotion } from '../dom';
import { DetailDialog } from '../finder/detail';
import { FilterPanel } from '../finder/filters';
import { ResultsPane } from '../finder/results';
import { TowerView, displayStatus, isPinnable, type CellState } from '../tower/towerView';
import { currentAccount, loadSession, onAccountChange } from '../session';
import { pushAddress, rewriteAddress, type Page } from '../router';
import { ERROR_MESSAGES } from '../../shared/errors';
import { filtersAreEqual, filtersToQueryString, sanitiseAddressFilters } from '../../shared/searchInput';
import { stackSpec, type StackLetter } from '../../shared/units';
import { facingForBearing } from '../../shared/derived';
import type { Hold, PublicUnit, SearchResponse, TowerCell, TowerResponse } from '../../shared/types';

const RE_READ_MS = 5000;
const OUTAGE_RETRY_MS = 10000;
const DESKTOP_WIDTH = 1280;
const TABLET_WIDTH = 768;

type Layout = 'phone' | 'tablet' | 'desktop';

function layoutFor(width: number): Layout {
  if (width >= DESKTOP_WIDTH) return 'desktop';
  return width >= TABLET_WIDTH ? 'tablet' : 'phone';
}

export function createFinderPage(url: URL): Page {
  let filters = sanitiseAddressFilters(url.searchParams);
  let openUnit = url.searchParams.get('unit');
  let layout: Layout = layoutFor(window.innerWidth);

  const unitCache = new Map<string, PublicUnit>();
  const towerCells = new Map<string, TowerCell>();
  let matchingCodes: Set<string> | null = null;
  let searchSeq = 0;
  let pageSeq = 0;
  let nextCursor: string | null = null;
  let total = 0;
  let myHold: Hold | null = null;
  let outage = false;
  let outageTimer = 0;
  let rateLimitTimer = 0;
  let rateLimitUntil = 0;
  let detail: DetailDialog | null = null;
  let detailOpener: HTMLElement | null = null;
  let sheet: HTMLElement | null = null;
  let towerAssets: TowerResponse['assets'] | null = null;

  const banner = el('div', { class: 'banner', role: 'alert', hidden: true });

  function searchPath(current: typeof filters, cursor: string | null): string {
    const query = filtersToQueryString(current, null);
    if (cursor === null) return `/api/search${query}`;
    return `/api/search${query}${query ? '&' : '?'}after=${encodeURIComponent(cursor)}`;
  }

  const results = new ResultsPane({
    onPin: (code, row) => {
      detailOpener = row;
      openDetail(code);
    },
    onShowMore: () => void loadNextPage(),
  });

  const filterPanel = new FilterPanel(filters, {
    onSettled: (next) => {
      if (filtersAreEqual(next, filters)) return;
      filters = next;
      pushAddress(`/finder${filtersToQueryString(filters, openUnit)}`);
      void runSearch();
    },
  });

  const tower = new TowerView({
    insetLens: layout === 'phone',
    onLensUnit: (code) => void showLens(code),
    onPin: (code) => {
      detailOpener = code ? (tower.cellNode(code) ?? null) : null;
      openDetail(code);
    },
    onGridFallback: (reason) => {
      announce(
        reason === 'context'
          ? 'Tower view paused. Showing the floor grid.'
          : 'Tower model unavailable right now. Showing the floor grid.',
      );
    },
  });

  const filtersRegion = el('section', { class: 'filters-pane', role: 'region', 'aria-label': 'Filters' }, [
    filterPanel.node,
  ]);

  const header = new Header({ onFiltersPress: () => toggleSheet() });
  const main = el('main', { class: 'finder' }, [banner, filtersRegion, tower.region, results.node]);
  const node = el('div', { class: 'page page-finder' }, [header.node, main, noticesNode()]);

  // --- the tower's cells, painted from the newest tower read and the filters
  function cellStates(): CellState[] {
    const states: CellState[] = [];
    for (const cell of towerCells.values()) {
      const bearing = stackSpec(cell.stack as StackLetter).windowBearing;
      const visible = cell.status !== 'withdrawn' && cell.status !== 'unreleased';
      states.push({
        code: cell.code,
        floor: cell.floor,
        stack: cell.stack as StackLetter,
        bearing,
        facing: facingForBearing(bearing),
        status: cell.status,
        syncing: cell.syncing,
        outsideFilters: visible && matchingCodes !== null && !matchingCodes.has(cell.code),
        heldByYou: myHold !== null && myHold.status === 'active' && myHold.unitCode === cell.code,
      });
    }
    return states;
  }

  function paintTower(): void {
    tower.setCells(cellStates());
    results.updateStatuses((code) => {
      const cell = towerCells.get(code);
      if (!cell || cell.status === 'withdrawn' || cell.status === 'unreleased') return null;
      const state = cellStates().find((candidate) => candidate.code === code);
      return state ? { status: displayStatus(state), syncing: cell.syncing } : null;
    });
  }

  function stateFor(code: string): CellState | null {
    return cellStates().find((state) => state.code === code) ?? null;
  }

  // --- the lens always describes the unit now under the pointer or focus
  async function showLens(code: string | null): Promise<void> {
    if (code === null) return;
    const state = stateFor(code);
    if (!state) return;
    const showsView = state.status !== 'withdrawn' && state.status !== 'unreleased' && !state.outsideFilters;
    const cached = unitCache.get(code);
    tower.showLens({
      code,
      bearing: state.bearing,
      facing: state.facing,
      status: displayStatus(state),
      syncing: state.syncing,
      outsideFilters: state.outsideFilters,
      viewUrl: cached?.viewUrl ?? null,
      viewPhotographed: cached?.viewPhotographed ?? false,
      showsView,
    });
    results.setCurrent(results.codes().includes(code) ? code : null, true);
    if (!showsView || cached) return;
    const unit = await readUnit(code);
    if (unit === 'withdrawn' || !unit) return;
    if (tower.hoveredCode() !== code) return;
    void showLens(code);
  }

  async function readUnit(code: string): Promise<PublicUnit | 'withdrawn' | null> {
    const result = await get<{ unit: PublicUnit }>(`/api/units/${encodeURIComponent(code)}`);
    if (result.ok && result.data) {
      const previous = unitCache.get(code);
      if (previous && previous.priceVersion > result.data.unit.priceVersion) return previous;
      unitCache.set(code, result.data.unit);
      results.updateUnit(result.data.unit);
      return result.data.unit;
    }
    if (result.status === 404) return 'withdrawn';
    return null;
  }

  // --- search
  async function runSearch(): Promise<void> {
    if (rateLimitUntil > Date.now()) return;
    const sequence = ++searchSeq;
    results.setBusy(true);
    const result = await get<SearchResponse>(searchPath(filters, null));
    if (sequence !== searchSeq) return;
    if (result.status === 429) {
      startRateLimitWait(result.retryAfterSeconds ?? 1, result.error?.message ?? ERROR_MESSAGES.search_rate_limited);
      results.setBusy(false);
      return;
    }
    if (result.status === 503) {
      enterOutage(result.error?.message ?? ERROR_MESSAGES.search_unavailable);
      results.setBusy(false);
      return;
    }
    if (!result.ok || !result.data) {
      results.setBusy(false);
      return;
    }
    leaveOutage(result.data.total);
    applySearch(result.data);
    results.setBusy(false);
  }

  function applySearch(data: SearchResponse): void {
    total = data.total;
    nextCursor = data.nextCursor;
    matchingCodes = new Set(data.matchingCodes);
    for (const hit of data.hits) unitCache.set(hit.code, hit);
    filterPanel.setCounts(data.facets);
    results.setPage(data.hits, data.total, data.nextCursor);
    paintTower();
  }

  async function loadNextPage(): Promise<void> {
    if (nextCursor === null) return;
    const sequence = searchSeq;
    const page = ++pageSeq;
    results.setShowMoreBusy(true);
    results.setBusy(true);
    const result = await get<SearchResponse>(searchPath(filters, nextCursor));
    if (sequence !== searchSeq || page !== pageSeq) return;
    results.setBusy(false);
    results.setShowMoreBusy(false);
    if (!result.ok || !result.data) {
      if (result.error) showBanner(result.error.message, false);
      return;
    }
    for (const hit of result.data.hits) unitCache.set(hit.code, hit);
    const appended = results.appendPage(result.data.hits, result.data.total, result.data.nextCursor);
    nextCursor = result.data.nextCursor;
    total = result.data.total;
    matchingCodes = new Set(result.data.matchingCodes);
    filterPanel.setCounts(result.data.facets);
    paintTower();
    const shown = results.codes().length;
    announce(
      appended.length === 1
        ? `1 more home. ${shown} of ${total} shown.`
        : `${appended.length} more homes. ${shown} of ${total} shown.`,
    );
    const first = appended[0]?.querySelector('button');
    first?.focus();
  }

  function showBanner(message: string, blackField: boolean): void {
    banner.hidden = false;
    banner.textContent = message;
    banner.classList.toggle('banner-outage', blackField);
  }

  function hideBanner(): void {
    banner.hidden = true;
    banner.textContent = '';
    banner.classList.remove('banner-outage');
  }

  function enterOutage(message: string): void {
    if (!outage) {
      outage = true;
      showBanner(message, true);
      filterPanel.setUnavailable(true);
      matchingCodes = null;
      paintTower();
    }
    window.clearTimeout(outageTimer);
    outageTimer = window.setTimeout(() => void runSearch(), OUTAGE_RETRY_MS);
  }

  function leaveOutage(matched: number, announceRecovery = true): void {
    if (!outage) return;
    outage = false;
    window.clearTimeout(outageTimer);
    hideBanner();
    filterPanel.setUnavailable(false);
    if (announceRecovery) {
      announce(matched === 1 ? 'Search is back. 1 home matches.' : `Search is back. ${matched} homes match.`);
    }
  }

  function startRateLimitWait(seconds: number, message: string): void {
    rateLimitUntil = Date.now() + seconds * 1000;
    let remaining = seconds;
    showBanner(message, false);
    window.clearInterval(rateLimitTimer);
    rateLimitTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(rateLimitTimer);
        rateLimitUntil = 0;
        hideBanner();
        void runSearch();
        return;
      }
      showBanner(message.replace(/\d+ seconds/, `${remaining} seconds`), false);
    }, 1000);
  }

  // --- the open home
  function openDetail(code: string, fromAddress = false): void {
    const state = stateFor(code);
    if (state && !isPinnable(state) && !fromAddress) return;
    if (fromAddress && state && (state.status === 'withdrawn' || state.status === 'unreleased')) {
      announce(ERROR_MESSAGES.not_found);
      rewriteAddress(`/finder${filtersToQueryString(filters, null)}`);
      return;
    }
    if (detail && detail.code() === code) return;
    detail?.close();
    const cached = unitCache.get(code);
    openUnit = code;
    rewriteAddress(`/finder${filtersToQueryString(filters, code)}`);
    tower.setPinned(code);
    const build = (unit: PublicUnit): void => {
      detail = new DetailDialog({
        unit,
        heldByYou: myHold !== null && myHold.status === 'active' && myHold.unitCode === code,
        lensImageSrc: tower.lens.currentImageSrc(),
        lensRect: tower.lensRect(),
        returnFocus: detailOpener,
        onClose: () => {
          detail = null;
          openUnit = null;
          tower.setPinned(null);
          rewriteAddress(`/finder${filtersToQueryString(filters, null)}`);
        },
        onHoldPlaced: (hold) => {
          myHold = hold;
          header.setMyHold(hold);
          setLocalStatus(hold.unitCode, 'held');
          void refreshTower();
        },
        onHoldLost: (lostCode) => {
          setLocalStatus(lostCode, 'held');
          void refreshTower();
        },
        readUnit,
      });
    };
    if (cached) {
      build(cached);
      return;
    }
    void readUnit(code).then((unit) => {
      if (unit === 'withdrawn' || !unit) {
        announce(ERROR_MESSAGES.not_found);
        openUnit = null;
        tower.setPinned(null);
        rewriteAddress(`/finder${filtersToQueryString(filters, null)}`);
        return;
      }
      build(unit);
    });
  }

  /** Paints a status the server has just reported, before the next tower read. */
  function setLocalStatus(code: string, status: TowerCell['status']): void {
    const cell = towerCells.get(code);
    if (cell) towerCells.set(code, { ...cell, status });
    paintTower();
  }

  // --- staying current
  async function refreshTower(): Promise<void> {
    const result = await get<TowerResponse>('/api/tower');
    if (!result.ok || !result.data) return;
    towerCells.clear();
    for (const cell of result.data.units) towerCells.set(cell.code, cell);
    if (!towerAssets) {
      towerAssets = result.data.assets;
      tower.start(towerAssets);
    }
    paintTower();
    const open = detail;
    if (open) {
      const cell = towerCells.get(open.code());
      if (cell?.status === 'withdrawn') open.markWithdrawn();
      else if (cell && cell.status !== 'unreleased') {
        open.setStatus(cell.status);
        open.setHeldByYou(myHold !== null && myHold.status === 'active' && myHold.unitCode === open.code());
      }
    }
  }

  async function refreshHolds(): Promise<void> {
    if (!currentAccount()) {
      myHold = null;
      header.setMyHold(null);
      return;
    }
    const result = await get<{ holds: Hold[] }>('/api/holds');
    if (!result.ok || !result.data) return;
    myHold = result.data.holds.find((hold) => hold.status === 'active') ?? null;
    header.setMyHold(myHold);
  }

  async function refreshOpenUnit(): Promise<void> {
    const open = detail;
    if (!open) return;
    const unit = await readUnit(open.code());
    if (unit === 'withdrawn') {
      open.markWithdrawn();
      return;
    }
    if (unit) open.setUnit(unit, myHold !== null && myHold.status === 'active' && myHold.unitCode === unit.code);
  }

  const reRead = async (): Promise<void> => {
    await refreshTower();
    await refreshHolds();
    await refreshOpenUnit();
  };

  const interval = window.setInterval(() => void reRead(), RE_READ_MS);
  const onFocus = (): void => void reRead();
  window.addEventListener('focus', onFocus);

  // --- the filters sheet at tablet and phone width
  function toggleSheet(): void {
    if (sheet) {
      closeSheet();
      return;
    }
    const panel = el('div', { class: 'dialog filters-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filters' }, [
      el('h2', { class: 'sheet-title', text: 'Filters' }),
      filterPanel.node,
      el('button', { type: 'button', class: 'action action-quiet', text: 'Close filters', onclick: () => closeSheet() }),
    ]);
    sheet = el('div', { class: 'dialog-layer sheet-layer' }, [panel]);
    document.getElementById('app')?.append(sheet);
    openLayer({
      node: sheet,
      returnFocus: header.filtersButton,
      onEscape: () => closeSheet(),
      keepBackgroundReadable: true,
    });
    if (!prefersReducedMotion()) panel.classList.add('sheet-in');
  }

  function closeSheet(): void {
    if (!sheet) return;
    const node = sheet;
    sheet = null;
    closeLayer(node);
    filtersRegion.append(filterPanel.node);
    applyLayout(true);
  }

  function applyLayout(force = false): void {
    const next = layoutFor(window.innerWidth);
    if (next === layout && !force) return;
    layout = next;
    node.dataset.layout = layout;
    tower.setInsetLens(layout === 'phone');
    if (layout === 'desktop') {
      if (sheet) closeSheet();
      filtersRegion.hidden = false;
      filtersRegion.append(filterPanel.node);
      if (header.filtersButton) header.filtersButton.hidden = true;
    } else {
      filtersRegion.hidden = true;
      if (header.filtersButton) header.filtersButton.hidden = false;
      if (!sheet) filtersRegion.append(filterPanel.node);
    }
    tower.layout();
  }

  const onResize = (): void => {
    applyLayout();
    tower.layout();
  };
  window.addEventListener('resize', onResize);
  node.dataset.layout = layout;
  applyLayout(true);

  onAccountChange(() => void refreshHolds());

  const canonical = `/finder${filtersToQueryString(filters, openUnit)}`;
  if (`${url.pathname}${url.search}` !== canonical) rewriteAddress(canonical);

  void (async () => {
    await loadSession();
    await refreshTower();
    await refreshHolds();
    tower.focusCell(openUnit ?? '20C', false);
    await runSearch();
    if (openUnit) openDetail(openUnit, true);
  })();

  return {
    node,
    onAddress: (next) => {
      const nextFilters = sanitiseAddressFilters(next.searchParams);
      const nextUnit = next.searchParams.get('unit');
      const canonical = `/finder${filtersToQueryString(nextFilters, nextUnit)}`;
      if (`${next.pathname}${next.search}` !== canonical) rewriteAddress(canonical);
      const filtersChanged = !filtersAreEqual(nextFilters, filters);
      filters = nextFilters;
      filterPanel.setFilters(filters);
      if (nextUnit !== openUnit) {
        if (nextUnit === null) detail?.close();
        else openDetail(nextUnit, true);
      }
      openUnit = nextUnit;
      if (filtersChanged) void runSearch();
    },
    destroy: () => {
      window.clearInterval(interval);
      window.clearInterval(rateLimitTimer);
      window.clearTimeout(outageTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', onResize);
    },
  };
}
