/**
 * The agenda board: day tabs, Stage and Format filters, search, the
 * results count, the calendar download and the session rows. The chosen
 * filters live in the address, each applied change pushes one history entry,
 * and the board restores itself on Back and Forward.
 */

import * as api from '../api.js';
import type { Session } from '../api.js';
import { el, announce } from '../dom.js';
import { state, mergeSessions } from '../state.js';
import { route } from '../router.js';
import * as shared from './shared.js';
import * as booking from '../booking.js';
import { venueLine, dayTabLabel } from '../venue-display.js';

const FORMATS: Array<{ slug: string; label: string }> = [
  { slug: 'demo-qa', label: 'Demo + Q&A' },
  { slug: 'fireside', label: 'Fireside' },
  { slug: 'game', label: 'Game' },
  { slug: 'keynote', label: 'Keynote' },
  { slug: 'panel', label: 'Panel' },
  { slug: 'workshop', label: 'Workshop' },
];

const DAY_DATES: Record<'1' | '2', string> = { '1': '2026-10-31', '2': '2026-11-01' };

/** One day tab, with its full published label. */
function dayTab(day: '1' | '2', selected: boolean): HTMLButtonElement {
  return el('button', {
    role: 'tab',
    type: 'button',
    'aria-selected': selected ? 'true' : 'false',
    class: `day-tab${selected ? ' is-active' : ''}`,
    id: `day-${day}-tab`,
  }, `Day ${day} - ${dayTabLabel(DAY_DATES[day])}`);
}

interface BoardFilters {
  day: '1' | '2';
  stage: string;
  format: string;
  q: string;
}

/** The filters from the address; unknown values fall back to All. */
function filtersFromAddress(): BoardFilters {
  const params = new URLSearchParams(location.search);
  const day = params.get('day') === '2' ? '2' : '1';
  const stageSlug = params.get('stage');
  const formatSlug = params.get('format');
  return {
    day,
    stage: state.stages.some((s) => s.slug === stageSlug) ? stageSlug! : 'all',
    format: FORMATS.some((f) => f.slug === formatSlug) ? formatSlug! : 'all',
    q: params.get('q') ?? '',
  };
}

/** The address for a board state, in the published key order. */
export function boardAddress(filters: BoardFilters): string {
  const parts: string[] = [`day=${filters.day}`];  if (filters.stage !== 'all') parts.push(`stage=${encodeURIComponent(filters.stage)}`);
  if (filters.format !== 'all') parts.push(`format=${encodeURIComponent(filters.format)}`);
  if (filters.q !== '') parts.push(`q=${encodeURIComponent(filters.q)}`);
  return parts.length === 0 ? '/agenda' : `/agenda?${parts.join('&')}`;
}

route(/^\/agenda$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);

  if (state.stages.length === 0) {
    state.stages = await api.listStages().catch(() => []);
  }
  const filters = filtersFromAddress();

  const messages = el('p', { id: 'booking-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Booking messages', class: 'live-region' });
  state.bookingMessages = messages;

  // Day tabs. Left and Right arrows move between them and select the one reached.
  const tabs = el('div', { role: 'tablist', 'aria-label': 'Conference day', class: 'day-tabs' });
  const tabOne = dayTab('1', filters.day === '1');
  const tabTwo = dayTab('2', filters.day === '2');
  tabOne.setAttribute('aria-controls', 'sessions-list');
  tabTwo.setAttribute('aria-controls', 'sessions-list');
  tabs.append(tabOne, tabTwo);
  tabs.addEventListener('keydown', (event) => {
    const toRight = event.key === 'ArrowRight';
    if (toRight || event.key === 'ArrowLeft') {
      event.preventDefault();
      const target = document.activeElement === tabOne ? tabTwo : tabOne;
      target.focus();
      chooseDay(target === tabOne ? '1' : '2');
    } else if (event.key === 'Home') {
      event.preventDefault();
      tabOne.focus();
      chooseDay('1');
    } else if (event.key === 'End') {
      event.preventDefault();
      tabTwo.focus();
      chooseDay('2');
    }
  });

  const heading = el('h2', { class: 'day-heading' }, 'Day 1');
  const stageSelect = el('select', { 'aria-label': 'Stage', class: 'filter-select' },
    el('option', { value: 'all' }, 'All'),
    ...state.stages.map((s) => el('option', { value: s.slug }, s.name)),
  );
  stageSelect.value = filters.stage;
  const formatSelect = el('select', { 'aria-label': 'Format', class: 'filter-select' },
    el('option', { value: 'all' }, 'All'),
    ...FORMATS.map((f) => el('option', { value: f.slug }, f.label)),
  );
  formatSelect.value = filters.format;

  // A search applies on Enter, or when typing has paused for a third of a
  // second. Each applied search counts as one change.
  const search = el('input', {
    type: 'search',
    'aria-label': 'Search sessions',
    placeholder: 'Title, speaker or company',
    class: 'search-box',
    value: filters.q,
  });
  let searchTimer: number | undefined;
  let appliedSearch = filters.q;
  const applySearch = (): void => {
    window.clearTimeout(searchTimer);
    if (search.value !== appliedSearch) {
      appliedSearch = search.value;
      filters.q = search.value;
      applyChange();
    }
  };
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applySearch, 300);
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applySearch();
  });

  const filterRow = el('div', { class: 'filters' }, stageSelect, formatSelect, search);
  const dayBox = el('div', { class: 'day-box' }, heading, filterRow);

  const venuePara = el('p', { class: 'venue-line' }, venueLine(DAY_DATES[filters.day]));
  const results = el('p', { id: 'agenda-results', role: 'status', 'aria-live': 'polite', 'aria-label': 'Agenda results', class: 'results-count' });
  const download = el('a', { href: '/api/v2/agenda.ics', class: 'download-link' }, 'Download Agenda');
  const countRow = el('div', { class: 'count-row' }, results, download);
  const clearButton = el('button', { type: 'button', class: 'action clear-filters' }, 'Clear filters');
  const sessionList = el('ul', { id: 'sessions-list', role: 'list', 'aria-label': 'Sessions', class: 'session-list' });

  stageSelect.addEventListener('change', () => {
    filters.stage = stageSelect.value;
    applyChange();
  });
  formatSelect.addEventListener('change', () => {
    filters.format = formatSelect.value;
    applyChange();
  });
  clearButton.addEventListener('click', () => {
    filters.stage = 'all';
    filters.format = 'all';
    filters.q = '';
    search.value = '';
    appliedSearch = '';
    applyChange();
  });

  const controls = el('div', { class: 'board-controls' }, tabs, dayBox);
  main.append(controls, venuePara, countRow, sessionList, clearButton, messages);

  function chooseDay(day: '1' | '2'): void {
    if (filters.day !== day) {
      filters.day = day;
      applyChange();
    }
  }

  tabOne.addEventListener('click', () => chooseDay('1'));
  tabTwo.addEventListener('click', () => chooseDay('2'));

  /** Each applied change adds one history entry. */
  function applyChange(): void {
    history.pushState({}, '', boardAddress(filters));
    void draw(true);
  }

  async function draw(announceCount: boolean): Promise<void> {
    const list = await api.listSessions({ ...filters, day: filters.day }).catch(() => [] as Session[]);
    state.sessions = mergeSessions(state.sessions, list);

    heading.textContent = `Day ${filters.day}`;
    venuePara.textContent = venueLine(DAY_DATES[filters.day]);
    tabOne.setAttribute('aria-selected', filters.day === '1' ? 'true' : 'false');
    tabTwo.setAttribute('aria-selected', filters.day === '2' ? 'true' : 'false');
    tabOne.classList.toggle('is-active', filters.day === '1');
    tabTwo.classList.toggle('is-active', filters.day === '2');

    // A background refresh leaves alone any row whose action is pending, and
    // keeps focus on the control now in the focused control's place.
    const focused = document.activeElement as HTMLElement | null;
    const focusedRowId = focused?.closest('.session-row')?.getAttribute('data-session-id') ?? null;
    const focusedLabel = focused?.getAttribute('aria-label') ?? null;
    const pending = new Set(
      Array.from(sessionList.querySelectorAll('.session-row'))
        .filter((row) => row.querySelector('[aria-disabled="true"]') !== null)
        .map((row) => row.getAttribute('data-session-id') ?? ''),
    );
    const existing = new Map(
      Array.from(sessionList.querySelectorAll('.session-row')).map((row) => [
        row.getAttribute('data-session-id') ?? '',
        row,
      ]),
    );
    sessionList.textContent = '';
    if (list.length === 0) {
      results.textContent = 'No sessions match these filters.';
      if (announceCount) announce(results, 'No sessions match these filters.');
      download.classList.add('is-hidden');
      clearButton.classList.remove('is-hidden');
      sessionList.append(el('li', { class: 'empty-filters' }, 'No sessions match these filters.'));
      return;
    }
    const count = list.length === 1 ? '1 session' : `${list.length} sessions`;
    results.textContent = count;
    if (announceCount) announce(results, count);
    download.classList.remove('is-hidden');
    clearButton.classList.add('is-hidden');
    download.setAttribute(
      'href',
      `/api/v2/agenda.ics${api.sessionsQuery({ ...filters, day: filters.day })}`,
    );
    for (const session of list) {
      const held = existing.get(session.id);
      sessionList.append(pending.has(session.id) && held !== undefined ? held : buildRow(session));
    }
    if (focusedLabel !== null && focusedRowId !== null) {
      const replacement = sessionList.querySelector(
        `.session-row[data-session-id="${CSS.escape(focusedRowId)}"] [aria-label="${CSS.escape(focusedLabel)}"]`,
      );
      if (replacement !== null && document.activeElement === document.body) {
        (replacement as HTMLElement).focus();
      }
    }
    // Returning from a session page restores focus to the followed title link.
    if (state.followedTitle !== null) {
      const id = state.followedTitle.getAttribute('data-session-id');
      const link = id === null ? null : sessionList.querySelector(`a[data-session-id="${CSS.escape(id)}"]`);
      if (link !== null) {
        (link as HTMLElement).focus();
        state.followedTitle = null;
      }
    }
  }

  function buildRow(session: Session): HTMLElement {
    const refusal = el('span', { class: 'row-refusal' });
    const row = el('li', { class: 'session-row', 'data-session-id': session.id });
    const link = el('a', {
      href: `/sessions/${session.id}`,
      class: 'session-link',
      'data-session-id': session.id,
    }, session.title);
    link.addEventListener('click', () => {
      state.followedTitle = link;
    });
    const seats = session.seats;
    const seatBox = el('div', { class: 'session-seats' });
    if (seats !== null) {
      seatBox.append(shared.seatLine(session), shared.seatBar(session));
      if (session.waitlist_count > 0) {
        seatBox.append(el('span', { class: 'waitlist-line' }, booking.waitlistLineText(session)));
      }
    }
    seatBox.append(
      shared.rowActions(session, {
        rowRefusal: refusal,
        onDone: () => redraw(),
      }),
      refusal,
    );
    row.append(
      el('span', { class: 'session-time' }, shared.sessionTime(session)),
      el('div', { class: 'session-body' },
        el('h3', { class: 'session-title' }, link),
        el('p', { class: 'session-speakers' }, shared.speakerLine(session)),
        shared.sessionPills(session),
      ),
      seatBox,
    );
    return row;
  }

  async function redraw(): Promise<void> {
    const fresh = await api.listSessions({ ...filters, day: filters.day }).catch(() => null);
    if (fresh === null) return;
    state.sessions = mergeSessions(state.sessions, fresh);
    sessionList.textContent = '';
    for (const session of fresh) {
      sessionList.append(buildRow(session));
    }
    download.setAttribute(
      'href',
      `/api/v2/agenda.ics${api.sessionsQuery({ ...filters, day: filters.day })}`,
    );
  }

  await draw(false);
  state.refresh = async (): Promise<void> => {
    await draw(false);
  };

});
