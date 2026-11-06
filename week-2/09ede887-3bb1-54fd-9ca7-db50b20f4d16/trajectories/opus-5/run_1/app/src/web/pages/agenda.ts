import { api, type SessionView, type Stage } from '../api.js';
import { applyFocusWish, wireBookingControls, type BookingHost, type FocusWish } from '../booking.js';
import { EMPTY_COPY, FIELD_COPY, FORMAT_OPTIONS } from '../copy.js';
import { clear, el, liveRegion, say } from '../dom.js';
import { apiQuery, boardHref, readFilters, type BoardFilters } from '../filters.js';
import { pushFilters, replaceState, restoreScroll, type Page, type Route } from '../router.js';
import { countLabel, sessionRow, type RowRefusal } from '../components/sessionRow.js';
import { DAY_INSTANTS, dayLabel, venueTimeLine } from '../venueTime.js';
import { rememberTitles, titleOf } from '../titles.js';
import { startLiveRefresh } from '../live.js';

const SEARCH_PAUSE_MS = 330;

export function agendaPage(route: Route): Page {
  const element = el('main', { class: 'page page-agenda', id: 'main' });
  let stages: Stage[] = [];
  let filters = readFilters(route.search, []);
  let sessions: SessionView[] = [];
  const refusals = new Map<string, RowRefusal>();

  const resultsRegion = liveRegion('Agenda results', 'live results-count');
  const bookingRegion = liveRegion('Booking messages');
  const list = el('ul', { class: 'session-list', 'aria-label': 'Sessions', 'data-list': 'sessions' });
  const emptyLine = el('p', { class: 'empty-line' });
  const clearButton = el('button', { class: 'button', type: 'button', text: 'Clear filters' });
  const emptyBlock = el('div', { class: 'empty-block' }, [emptyLine, clearButton]);
  const download = el('a', { class: 'button button-download', text: 'Download Agenda' });
  const downloadSlot = el('div', { class: 'download-slot' });
  const dayHeading = el('h2', { class: 'day-heading' });
  const venueLine = el('p', { class: 'venue-line' });
  const tablist = el('div', { class: 'day-tabs', role: 'tablist', 'aria-label': 'Conference day' });
  const stageSelect = el('select', { class: 'filter-select', id: 'filter-stage' });
  const formatSelect = el('select', { class: 'filter-select', id: 'filter-format' });
  const searchBox = el('input', {
    class: 'search-box',
    id: 'filter-search',
    type: 'search',
    placeholder: 'Title, speaker or company',
  });
  const searchError = el('p', { class: 'field-error', id: 'search-error' });
  let searchTimer: number | null = null;

  const tabs: HTMLButtonElement[] = [1, 2].map((day) => {
    const full = `Day ${day} - ${dayLabel(DAY_INSTANTS[day as 1 | 2].slice(0, 10))}`;
    const tab = el('button', {
      class: 'day-tab',
      type: 'button',
      role: 'tab',
      'aria-label': full,
      'data-day': String(day),
    }, [
      el('span', { class: 'tab-full', text: full }),
      el('span', { class: 'tab-short', text: `Day ${day}` }),
    ]);
    tab.addEventListener('click', () => {
      selectDay(String(day) as '1' | '2');
    });
    return tab;
  });
  tablist.append(...tabs);
  tablist.addEventListener('keydown', (event) => {
    const index = tabs.findIndex((tab) => tab === document.activeElement);
    if (index === -1) return;
    const moves: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in moves) {
      event.preventDefault();
      const next = (index + (moves[event.key] as number) + tabs.length) % tabs.length;
      (tabs[next] as HTMLButtonElement).focus();
      selectDay(String(next + 1) as '1' | '2');
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : tabs.length - 1;
      (tabs[target] as HTMLButtonElement).focus();
      selectDay(String(target + 1) as '1' | '2');
    }
  });

  stageSelect.addEventListener('change', () => {
    applyChange({ ...filters, stage: stageSelect.value });
  });
  formatSelect.addEventListener('change', () => {
    applyChange({ ...filters, format: formatSelect.value });
  });
  searchBox.addEventListener('input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      applySearch();
    }, SEARCH_PAUSE_MS);
  });
  searchBox.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = null;
    applySearch();
  });
  clearButton.addEventListener('click', () => {
    applyChange({ ...filters, stage: 'all', format: 'all', search: '' });
  });

  function applySearch(): void {
    const typed = searchBox.value;
    if ([...typed].length > 2048) {
      searchError.textContent = FIELD_COPY.search;
      searchBox.setAttribute('aria-invalid', 'true');
      searchBox.setAttribute('aria-describedby', 'search-error');
      return;
    }
    searchError.textContent = '';
    searchBox.removeAttribute('aria-invalid');
    searchBox.removeAttribute('aria-describedby');
    if (typed === filters.search) return;
    applyChange({ ...filters, search: typed });
  }

  function selectDay(day: '1' | '2'): void {
    if (filters.day === day) return;
    applyChange({ ...filters, day, dayKnown: true });
  }

  function applyChange(next: BoardFilters): void {
    filters = next;
    pushFilters(boardHref(filters));
    paintControls();
    void load();
  }

  function paintControls(): void {
    for (const tab of tabs) {
      const selected = tab.dataset['day'] === filters.day;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('is-selected', selected);
    }
    if (!tabs.some((tab) => tab.tabIndex === 0)) (tabs[0] as HTMLButtonElement).tabIndex = 0;
    const shownDay = filters.day === '2' ? 2 : 1;
    dayHeading.textContent = `Day ${shownDay}`;
    venueLine.textContent = venueTimeLine(DAY_INSTANTS[shownDay]);
    stageSelect.value = filters.stage;
    formatSelect.value = filters.format;
    if (searchBox.value !== filters.search) searchBox.value = filters.search;
  }

  function paintStages(): void {
    clear(stageSelect);
    stageSelect.appendChild(el('option', { value: 'all', text: 'All' }));
    for (const stage of stages) {
      stageSelect.appendChild(el('option', { value: stage.slug, text: stage.name }));
    }
    clear(formatSelect);
    formatSelect.appendChild(el('option', { value: 'all', text: 'All' }));
    for (const option of FORMAT_OPTIONS) {
      formatSelect.appendChild(el('option', { value: option.slug, text: option.label }));
    }
  }

  const host: BookingHost = {
    messages: bookingRegion,
    reload: async (wish: FocusWish) => {
      await load();
      applyFocusWish(element, wish);
    },
    setRowRefusal: (sessionId, refusal) => {
      if (refusal === null) refusals.delete(sessionId);
      else refusals.set(sessionId, refusal);
    },
    titleOf,
  };

  function paintRows(): void {
    const keyBefore = (document.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null;
    clear(list);
    for (const session of sessions) {
      list.appendChild(
        sessionRow(session, {
          refusal: refusals.get(session.id) ?? null,
          showPosition: true,
          showHoldLine: false,
        }),
      );
    }
    wireBookingControls(list, sessions, host);
    const empty = sessions.length === 0;
    emptyLine.textContent = empty ? EMPTY_COPY.filtered : '';
    emptyBlock.hidden = !empty;
    downloadSlot.replaceChildren();
    if (!empty) {
      download.setAttribute('href', `/api/v2/agenda.ics${apiQuery(filters)}`);
      downloadSlot.appendChild(download);
    }
    if (keyBefore !== null && !element.contains(document.activeElement)) {
      applyFocusWish(element, { kind: 'key', key: keyBefore });
    }
  }

  async function load(): Promise<void> {
    try {
      sessions = await api.sessions(apiQuery(filters));
      rememberTitles(sessions);
      paintRows();
      say(resultsRegion, countLabel(sessions.length));
    } catch {
      say(resultsRegion, countLabel(0));
    }
  }

  /** Re-states the count so a live region already on the page announces it. */
  function announceCount(): void {
    const label = countLabel(sessions.length);
    resultsRegion.textContent = '';
    requestAnimationFrame(() => {
      resultsRegion.textContent = label;
    });
  }

  const board = el('div', { class: 'board' });
  const pinned = el('div', { class: 'board-pinned' }, [
    tablist,
    el('div', { class: 'board-head' }, [
      dayHeading,
      el('div', { class: 'filter-row' }, [
        el('div', { class: 'field' }, [
          el('label', { for: 'filter-stage', text: 'Stage' }),
          el('div', { class: 'select-wrap' }, [stageSelect, el('span', { class: 'icon icon-chevron', 'aria-hidden': 'true' })]),
        ]),
        el('div', { class: 'field' }, [
          el('label', { for: 'filter-format', text: 'Format' }),
          el('div', { class: 'select-wrap' }, [formatSelect, el('span', { class: 'icon icon-chevron', 'aria-hidden': 'true' })]),
        ]),
        el('div', { class: 'field field-search' }, [
          el('label', { for: 'filter-search', text: 'Search sessions' }),
          el('div', { class: 'search-wrap' }, [el('span', { class: 'icon icon-search', 'aria-hidden': 'true' }), searchBox]),
          searchError,
        ]),
      ]),
    ]),
  ]);
  board.append(
    pinned,
    venueLine,
    el('div', { class: 'results-row' }, [resultsRegion, downloadSlot]),
    bookingRegion,
    emptyBlock,
    list,
  );

  list.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest('a[href^="/sessions/"]');
      if (anchor === null || anchor === undefined) return;
      replaceState({ followed: anchor.getAttribute('href') });
    },
    true,
  );

  let stopLive: (() => void) | null = null;

  return {
    element,
    mount: () => {
      const loading = el('p', { class: 'loading', text: 'Loading' });
      element.appendChild(loading);
      void (async () => {
        try {
          stages = await api.stages();
        } catch {
          stages = [];
        }
        paintStages();
        filters = readFilters(location.search, stages.map((stage) => stage.slug));
        paintControls();
        await load();
        loading.remove();
        element.appendChild(board);
        // Returning from a session page writes nothing new into a live region.
        const returning = route.popped && (route.previousPath ?? '').startsWith('/sessions/');
        if (!returning) announceCount();
        const followed = route.state['followed'];
        if (route.popped && typeof followed === 'string') {
          element.querySelector<HTMLElement>(`a[href="${followed.replace(/"/g, '\\"')}"]`)?.focus();
        }
        if (route.popped) restoreScroll();
        stopLive = startLiveRefresh(async () => {
          sessions = await api.sessions(apiQuery(filters));
          rememberTitles(sessions);
          paintRows();
          resultsRegion.textContent = countLabel(sessions.length);
        });
      })();
    },
    unmount: () => {
      stopLive?.();
      if (searchTimer !== null) window.clearTimeout(searchTimer);
    },
  };
}
