import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Session, Stage } from '../../shared/api';
import { apiPath, request } from '../api';
import { OUTAGE_COPY, FIELD_COPY } from '../copy';
import { DAY_NOON, DAY_TABS, FORMATS, knownStages, loadStages } from '../data';
import { sessionCount, timeRange, venueLine } from '../format';
import { useLiveRefresh, useMedia, useReducedMotion, useTitle } from '../hooks';
import { useRouter } from '../router';
import { useApp } from '../state';
import { useBooking } from '../components/booking';
import { Loading } from '../components/chrome';
import { codePoints } from '../components/forms';
import { ChevronIcon, SearchIcon } from '../components/icons';
import { Pills, SessionRow } from '../components/session-row';

type Day = 1 | 2;

interface Board {
  day: Day;
  stage: string | null;
  format: string | null;
  q: string;
}

const SEARCH_PAUSE_MS = 330;
const MOVE = { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

// Board data by query, so Back and Forward redraw a board at once.
const boardCache = new Map<string, Session[]>();

function readBoard(search: string, stages: Stage[]): Board {
  const params = new URLSearchParams(search);
  const stage = params.get('stage');
  const format = params.get('format');
  return {
    day: params.get('day') === '2' ? 2 : 1,
    stage: stages.some((s) => s.slug === stage) ? stage : null,
    format: FORMATS.some(([slug]) => slug === format) ? format : null,
    q: params.get('q') ?? '',
  };
}

// The address order is day, stage, format, q; All and an empty search drop their key.
function boardQuery(board: Board): string {
  const params = new URLSearchParams();
  params.set('day', String(board.day));
  if (board.stage) params.set('stage', board.stage);
  if (board.format) params.set('format', board.format);
  if (board.q) params.set('q', board.q);
  return params.toString();
}

function DayTabs({ day, onSelect }: { day: Day; onSelect: (day: Day) => void }) {
  const narrow = useMedia('(max-width: 479px)');
  const tabs = useRef<Record<Day, HTMLButtonElement | null>>({ 1: null, 2: null });
  const choose = (next: Day) => {
    onSelect(next);
    tabs.current[next]?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, Day> = { ArrowRight: day === 1 ? 2 : 1, ArrowLeft: day === 1 ? 2 : 1, Home: 1, End: 2 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  };
  return (
    <div className="day-tabs" role="tablist" aria-label="Conference day" onKeyDown={onKey}>
      {([1, 2] as const).map((tab) => (
        <button
          key={tab}
          ref={(element) => {
            tabs.current[tab] = element;
          }}
          id={`day-tab-${tab}`}
          type="button"
          role="tab"
          aria-selected={day === tab}
          aria-controls="day-panel"
          aria-label={DAY_TABS[tab]}
          tabIndex={day === tab ? 0 : -1}
          onClick={() => choose(tab)}
        >
          {narrow ? `Day ${tab}` : DAY_TABS[tab]}
        </button>
      ))}
    </div>
  );
}

function LeavingRow({ session, top, onDone }: { session: Session; top: number; onDone: () => void }) {
  const row = useRef<HTMLDivElement>(null);
  const finished = useRef(onDone);
  useEffect(() => {
    finished.current = onDone;
  });
  useLayoutEffect(() => {
    const animation = row.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
    if (!animation) return undefined;
    animation.onfinish = () => finished.current();
    return () => animation.cancel();
  }, []);
  return (
    <div ref={row} className="leaving-row" style={{ top }}>
      <p className="row-time">{timeRange(session.start_local, session.end_local)}</p>
      <div className="row-main">
        <p className="row-title">{session.title}</p>
        <Pills session={session} />
      </div>
    </div>
  );
}

// The session list; when the set of rows changes, staying rows glide to their new places,
// new rows fade in and leaving rows fade out where they stood.
function BoardList({ sessions, render }: { sessions: Session[]; render: (session: Session) => ReactNode }) {
  const reduced = useReducedMotion();
  const list = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  const before = useRef(sessions);
  const ids = sessions.map((session) => session.id).join(' ');
  const lastIds = useRef(ids);
  const [leaving, setLeaving] = useState<{ session: Session; top: number }[]>([]);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const base = element.getBoundingClientRect().top;
    const now = new Map<string, number>();
    const rows = Array.from(element.querySelectorAll<HTMLElement>(':scope > li'));
    rows.forEach((row, index) => {
      const id = sessions[index]?.id;
      if (id) now.set(id, row.getBoundingClientRect().top - base);
    });
    if (ids !== lastIds.current && !reduced) {
      rows.forEach((row, index) => {
        const id = sessions[index]?.id ?? '';
        const was = tops.current.get(id);
        const top = now.get(id) ?? 0;
        if (was === undefined) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
        else if (was !== top) row.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], MOVE);
      });
      const gone = before.current.filter((session) => !now.has(session.id));
      setLeaving(gone.map((session) => ({ session, top: tops.current.get(session.id) ?? 0 })));
    }
    lastIds.current = ids;
    tops.current = now;
    before.current = sessions;
  }, [ids, sessions, reduced]);

  const done = useCallback((id: string) => setLeaving((current) => current.filter((item) => item.session.id !== id)), []);
  return (
    <div className="board-list">
      <ul ref={list} className="session-list" aria-label="Sessions" data-list="board">
        {sessions.map(render)}
      </ul>
      {leaving.length > 0 && (
        <div className="leaving-layer" aria-hidden="true" inert>
          {leaving.map((item) => (
            <LeavingRow key={item.session.id} session={item.session} top={item.top} onDone={() => done(item.session.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgendaPage() {
  useTitle('Agenda');
  const { place, navType, navigate, memory } = useRouter();
  const { auth, viewer } = useApp();
  const token = auth?.token ?? null;
  const [stages, setStages] = useState<Stage[] | null>(knownStages);
  const [outage, setOutage] = useState(false);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const shown = useRef<Session[] | null>(null);

  useEffect(() => {
    if (stages) return;
    void loadStages().then((loaded) => (loaded ? setStages(loaded) : setOutage(true)));
  }, [stages]);

  const board = stages ? readBoard(place.search, stages) : null;
  const query = board ? boardQuery(board) : '';
  const cacheKey = `${token ?? ''}|${query}`;
  const rows = (board && boardCache.get(cacheKey)) ?? shown.current;
  useLayoutEffect(() => {
    shown.current = rows;
  });

  const fetchBoard = useCallback(async () => {
    if (!query) return;
    const result = await request<Session[]>(apiPath(`/sessions?${query}`), { token });
    if (result.ok) {
      boardCache.set(cacheKey, result.data);
      setOutage(false);
    } else {
      setOutage(true);
    }
    redraw();
  }, [query, cacheKey, token]);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  const booking = useBooking(fetchBoard);
  useLiveRefresh(() => {
    if (!booking.busy) void fetchBoard();
  }, board !== null);

  // Back and Forward restore the entry's scroll position, and focus the title link followed from it.
  const restored = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!rows || restored.current === place.key) return;
    restored.current = place.key;
    if (navType !== 'pop') return;
    const entry = memory(place.key);
    window.scrollTo(0, entry.scrollY);
    if (entry.followed) {
      document.querySelector<HTMLElement>(`[data-title-link="${CSS.escape(entry.followed)}"]`)?.focus({ preventScroll: true });
    }
  });

  // The pinned strip's height feeds the scroll margins so focused controls never hide under it.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current;
    if (!element) return undefined;
    const root = document.documentElement;
    const measure = () => {
      const pinned = getComputedStyle(element).position === 'sticky';
      root.style.setProperty('--pin', `${pinned ? element.offsetHeight : 0}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty('--pin');
    };
  }, [stages]);

  const [text, setText] = useState(board?.q ?? '');
  const [searchError, setSearchError] = useState('');
  const appliedQ = board?.q ?? '';
  useEffect(() => {
    setText(appliedQ);
  }, [appliedQ]);
  const pause = useRef<number | null>(null);
  useEffect(() => () => {
    if (pause.current !== null) window.clearTimeout(pause.current);
  }, []);

  if (!stages || !board) return <section className="page board-page">{outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />}</section>;

  const change = (next: Board) => {
    if (boardQuery(next) === boardQuery(readBoard(window.location.search, stages))) return;
    navigate(`/agenda?${boardQuery(next)}`, { keepScroll: true });
  };
  const applySearch = (value: string) => {
    if (pause.current !== null) window.clearTimeout(pause.current);
    pause.current = null;
    const q = value.trim();
    if (codePoints(q) > 2048) {
      setSearchError(FIELD_COPY.search);
      return;
    }
    setSearchError('');
    change({ ...board, q });
  };
  const stageLabel = stages.find((s) => s.slug === board.stage)?.name ?? 'All';
  const formatLabel = FORMATS.find(([slug]) => slug === board.format)?.[1] ?? 'All';
  const follow = (id: string) => {
    memory(place.key).followed = id;
  };

  return (
    <section className="page board-page">
      <header className="page-head">
        <h1 className="page-title">Agenda</h1>
      </header>
      <div className="board-strip" ref={strip}>
        <DayTabs day={board.day} onSelect={(day) => change({ ...board, day })} />
        <div className="board-bar">
          <h2 className="day-heading">Day {board.day}</h2>
          <div className="filters">
            <div className="control">
              <label htmlFor="filter-stage">Stage</label>
              <span className="select-box">
                <select
                  id="filter-stage"
                  value={stageLabel}
                  onChange={(event) => change({ ...board, stage: stages.find((s) => s.name === event.target.value)?.slug ?? null })}
                >
                  <option value="All">All</option>
                  {stages.map((stage) => (
                    <option key={stage.slug} value={stage.name}>
                      {stage.name}
                    </option>
                  ))}
                </select>
                <ChevronIcon />
              </span>
            </div>
            <div className="control">
              <label htmlFor="filter-format">Format</label>
              <span className="select-box">
                <select
                  id="filter-format"
                  value={formatLabel}
                  onChange={(event) =>
                    change({ ...board, format: FORMATS.find(([, label]) => label === event.target.value)?.[0] ?? null })
                  }
                >
                  <option value="All">All</option>
                  {FORMATS.map(([slug, label]) => (
                    <option key={slug} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronIcon />
              </span>
            </div>
            <div className={searchError ? 'control control-search has-error' : 'control control-search'}>
              <label htmlFor="filter-search">Search sessions</label>
              <span className="search-box">
                <SearchIcon />
                <input
                  id="filter-search"
                  type="search"
                  placeholder="Title, speaker or company"
                  value={text}
                  aria-invalid={searchError ? 'true' : undefined}
                  aria-describedby={searchError ? 'filter-search-error' : undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setText(value);
                    if (pause.current !== null) window.clearTimeout(pause.current);
                    pause.current = window.setTimeout(() => applySearch(value), SEARCH_PAUSE_MS);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applySearch(event.currentTarget.value);
                    }
                  }}
                />
              </span>
              {searchError && (
                <p className="field-error" id="filter-search-error">
                  {searchError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div role="tabpanel" id="day-panel" aria-labelledby={`day-tab-${board.day}`} className="board-panel">
        <p className="helper venue-line">{venueLine(rows?.[0]?.start_instant ?? DAY_NOON[board.day])}</p>
        <div className="results-bar">
          <p className="results-count" role="status" aria-label="Agenda results">
            {rows ? sessionCount(rows.length) : ''}
          </p>
          {rows && rows.length > 0 && (
            <a className="download-link" href={apiPath(`/agenda.ics?${query}`)}>
              Download Agenda
            </a>
          )}
        </div>
        <p className="booking-messages" role="status" aria-label="Booking messages">
          {booking.message}
        </p>
        {outage && !rows && <p className="helper">{OUTAGE_COPY}</p>}
        {!rows && !outage && <Loading />}
        {rows && rows.length === 0 && (
          <div className="empty-filter">
            <p>No sessions match these filters.</p>
            <button type="button" className="btn btn-outline" onClick={() => change({ day: board.day, stage: null, format: null, q: '' })}>
              Clear filters
            </button>
          </div>
        )}
        {rows && rows.length > 0 && (
          <BoardList
            sessions={rows}
            render={(session) => (
              <SessionRow key={session.id} session={session} context="board" booking={booking} viewer={viewer} onFollow={follow} />
            )}
          />
        )}
      </div>
    </section>
  );
}
