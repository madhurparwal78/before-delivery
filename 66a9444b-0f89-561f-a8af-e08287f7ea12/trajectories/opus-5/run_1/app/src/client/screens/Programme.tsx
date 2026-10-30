import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkout, checkoutStepFromQuery, suggestedPasses } from '../components/Checkout.js';
import { Gallery } from '../components/Gallery.js';
import { ClashMark, ProblemMark } from '../components/Mark.js';
import { PinnedStory } from '../components/PinnedStory.js';
import { HeroTitle, SectionHead } from '../components/Display.js';
import { Lattice, LatticeControls } from '../lattice/Lattice.js';
import { useInViewOnce, useReducedMotion } from '../lib/motion.js';
import { ApiError, request } from '../lib/api.js';
import { formatEuros, formatSessionWhen, formatTime, overlaps } from '../lib/festival.js';
import { useAgenda, useRoute, useUser } from '../lib/store.js';
import type { Entry, Hold, Order, Programme as ProgrammeData, Session } from '../lib/types.js';
import type { JSX } from 'react';

const PLANETARIUM = 'planetarium-dome';
const SEATS_REFRESH_MS = 15_000;

export function ProgrammeScreen(): JSX.Element {
  const route = useRoute();
  const { user } = useUser();
  const agenda = useAgenda();
  const reducedMotion = useReducedMotion();
  const [programme, setProgramme] = useState<ProgrammeData | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [agendaMessage, setAgendaMessage] = useState('');
  const [checkoutStatus, setCheckoutStatus] = useState('');
  const [checkoutProblem, setCheckoutProblem] = useState('');
  const [initialPasses, setInitialPasses] = useState<
    { fullFestival: number; dayPasses: Record<string, number> } | null
  >(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [ticketsRef, ticketsSeen] = useInViewOnce<HTMLElement>();
  const agendaHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = useCallback(async () => {
    const body = await request<ProgrammeData>('/api/programme');
    setProgramme(body);
  }, []);

  useEffect(() => {
    void load();
    void request<{ entries: Entry[] }>('/api/gallery').then((body) => setEntries(body.entries));
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), SEATS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const sessions = programme?.sessions ?? [];
  const days = programme?.festival_days ?? [];
  const venues = programme?.venues ?? [];
  const disciplines = programme?.disciplines ?? [];

  /** The programme's filter state is the URL; unknown values are dropped. */
  const rawDay = route.query.get('day');
  const rawVenue = route.query.get('venue');
  const rawDiscipline = route.query.get('discipline');
  const day = days.some((candidate) => candidate.date === rawDay) ? rawDay : null;
  const venue = venues.some((candidate) => candidate.id === rawVenue) ? rawVenue : null;
  const discipline = disciplines.some((candidate) => candidate.id === rawDiscipline)
    ? rawDiscipline
    : null;
  const clashesOnly = route.query.get('clashes') === '1';
  const checkoutStep = checkoutStepFromQuery(route.query.get('checkout'));

  useEffect(() => {
    if (programme === null) return;
    const drop: Record<string, string | null> = {};
    if (rawDay !== null && day === null) drop['day'] = null;
    if (rawVenue !== null && venue === null) drop['venue'] = null;
    if (rawDiscipline !== null && discipline === null) drop['discipline'] = null;
    if (Object.keys(drop).length > 0) route.setQuery(drop, { replace: true });
  }, [programme, rawDay, rawVenue, rawDiscipline, day, venue, discipline, route]);

  const agendaSessions = useMemo(
    () =>
      sessions
        .filter((session) => agenda.ids.includes(session.id))
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [sessions, agenda.ids],
  );

  /** Two agenda sessions clash when their real intervals overlap. */
  const clashes = useMemo(() => {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < agendaSessions.length; i += 1) {
      for (let j = i + 1; j < agendaSessions.length; j += 1) {
        const first = agendaSessions[i] as Session;
        const second = agendaSessions[j] as Session;
        if (overlaps(first, second)) pairs.push([first.id, second.id]);
      }
    }
    return pairs;
  }, [agendaSessions]);

  const clashPartners = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [a, b] of clashes) {
      const titleA = sessions.find((session) => session.id === a)?.title ?? a;
      const titleB = sessions.find((session) => session.id === b)?.title ?? b;
      map.set(a, [...(map.get(a) ?? []), titleB]);
      map.set(b, [...(map.get(b) ?? []), titleA]);
    }
    return map;
  }, [clashes, sessions]);

  const visible = useMemo(
    () =>
      sessions
        .filter((session) => day === null || session.festival_day === day)
        .filter((session) => venue === null || session.venue_id === venue)
        .filter((session) => discipline === null || session.discipline === discipline)
        .filter((session) => !clashesOnly || clashPartners.has(session.id)),
    [sessions, day, venue, discipline, clashesOnly, clashPartners],
  );

  const toggleFilter = (kind: 'day' | 'venue' | 'discipline', id: string): void => {
    const current = kind === 'day' ? day : kind === 'venue' ? venue : discipline;
    route.setQuery({ [kind]: current === id ? null : id });
  };

  const toggleAgenda = (session: Session): void => {
    const added = !agenda.has(session.id);
    agenda.toggle(session.id);
    const nextIds = added
      ? [...agenda.ids, session.id]
      : agenda.ids.filter((id) => id !== session.id);
    const nextSessions = sessions.filter((candidate) => nextIds.includes(candidate.id));
    let count = 0;
    for (let i = 0; i < nextSessions.length; i += 1) {
      for (let j = i + 1; j < nextSessions.length; j += 1) {
        if (overlaps(nextSessions[i] as Session, nextSessions[j] as Session)) count += 1;
      }
    }
    setAgendaMessage(
      `${added ? 'Added' : 'Removed'} ${session.title} ${added ? 'to' : 'from'} your agenda. ` +
        (count === 0 ? 'No clashes in your agenda.' : `${count} clashes in your agenda.`),
    );
  };

  const removeFromAgenda = (session: Session, index: number): void => {
    agenda.remove(session.id);
    const remaining = agendaSessions.filter((candidate) => candidate.id !== session.id);
    let count = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        if (overlaps(remaining[i] as Session, remaining[j] as Session)) count += 1;
      }
    }
    setAgendaMessage(
      `Removed ${session.title} from your agenda. ` +
        (count === 0 ? 'No clashes in your agenda.' : `${count} clashes in your agenda.`),
    );
    window.setTimeout(() => {
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next !== undefined) {
        document.querySelector<HTMLButtonElement>(`[data-agenda-remove="${next.id}"]`)?.focus();
        return;
      }
      agendaHeadingRef.current?.focus();
    }, 0);
  };

  const holdSeat = async (session: Session, opener: HTMLElement): Promise<void> => {
    openerRef.current = opener;
    setCheckoutProblem('');
    setCheckoutStatus('Holding your seat…');
    if (user === null) {
      route.navigate(`/signin?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    try {
      const hold = await request<Hold>('/api/holds', {
        method: 'POST',
        body: { session_id: session.id, quantity: 1 },
      });
      setCheckoutStatus(`Seat held until ${formatTime(hold.expires_at)}.`);
      await load();
      route.setQuery({ checkout: 'tickets' });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setCheckoutStatus('');
      if (error.failure.code === 'sold_out') {
        setCheckoutProblem('That was the last seat. Join the waitlist to be offered the next one.');
        await load();
        return;
      }
      setCheckoutProblem('We could not hold that seat. Try again in a moment.');
    }
  };

  const joinWaitlist = async (session: Session): Promise<void> => {
    if (user === null) {
      route.navigate(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setCheckoutProblem('');
    try {
      const entry = await request<{ position: number }>(
        `/api/sessions/${session.id}/waitlist`,
        { method: 'POST' },
      );
      setCheckoutStatus(`You're number ${entry.position} on the waitlist for ${session.title}.`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setCheckoutProblem('We could not add you to that waitlist.');
    }
  };

  const getTicketsForAgenda = async (opener: HTMLElement): Promise<void> => {
    openerRef.current = opener;
    if (user === null) {
      route.navigate(
        `/signin?next=${encodeURIComponent(`/?${new URLSearchParams({ ...Object.fromEntries(route.query), checkout: 'tickets' }).toString()}`)}`,
      );
      return;
    }
    const seated = agendaSessions.filter(
      (session) => session.admission === 'seat' && (session.seats_remaining ?? 0) > 0,
    );
    for (const session of seated) {
      try {
        await request('/api/holds', {
          method: 'POST',
          body: { session_id: session.id, quantity: 1 },
        });
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    setInitialPasses(suggestedPasses(agendaSessions, PLANETARIUM));
    await load();
    route.setQuery({ checkout: 'tickets' });
  };

  const prices = programme?.price_policy ?? {
    full_festival_full_cents: 0,
    full_festival_reduced_cents: 0,
    day_full_cents: 0,
    day_reduced_cents: 0,
    group_discount_percent: 0,
  };

  const buyPass = (product: 'full_festival' | 'day', opener: HTMLElement): void => {
    openerRef.current = opener;
    if (user === null) {
      route.navigate(`/signin?next=${encodeURIComponent('/?checkout=tickets')}`);
      return;
    }
    setInitialPasses(
      product === 'full_festival'
        ? { fullFestival: 1, dayPasses: {} }
        : { fullFestival: 0, dayPasses: { [days[0]?.date ?? '']: 1 } },
    );
    route.setQuery({ checkout: 'tickets' });
  };

  return (
    <>
      <section className="hero ground-ink" id="programme">
        <HeroTitle>Kerf Frequencies 2027</HeroTitle>
        <Lattice
          days={days}
          venues={venues}
          disciplines={disciplines}
          sessions={sessions}
          selection={{ day, venue, discipline }}
          agenda={agenda.ids}
          clashes={clashes}
          onPick={toggleFilter}
        />
        <LatticeControls
          days={days}
          venues={venues}
          disciplines={disciplines}
          selection={{ day, venue, discipline }}
          onPick={toggleFilter}
        />
      </section>

      <div className="schedule-layout ground-paper">
        <section className="schedule" aria-label="Schedule">
          <SectionHead>Schedule</SectionHead>
          <div className="filter-bar">
            <label>
              Day
              <select
                value={day ?? ''}
                onChange={(event) =>
                  route.setQuery({ day: event.target.value === '' ? null : event.target.value })
                }
              >
                <option value="">All days</option>
                {days.map((candidate) => (
                  <option key={candidate.date} value={candidate.date}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Venue
              <select
                value={venue ?? ''}
                onChange={(event) =>
                  route.setQuery({ venue: event.target.value === '' ? null : event.target.value })
                }
              >
                <option value="">All venues</option>
                {venues.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Discipline
              <select
                value={discipline ?? ''}
                onChange={(event) =>
                  route.setQuery({
                    discipline: event.target.value === '' ? null : event.target.value,
                  })
                }
              >
                <option value="">All disciplines</option>
                {disciplines.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={clashesOnly}
                onChange={(event) => route.setQuery({ clashes: event.target.checked ? '1' : null })}
              />
              Clashes only
            </label>
            <button
              type="button"
              onClick={() =>
                route.setQuery({ day: null, venue: null, discipline: null, clashes: null })
              }
            >
              Clear filters
            </button>
          </div>

          <p className="status figures" role="status" aria-label="Programme results">
            {visible.length === 1 ? '1 session' : `${visible.length} sessions`}
          </p>

          <ul className="sessions ruled" aria-label="Sessions">
            {visible.map((session) => {
              const venueName =
                venues.find((candidate) => candidate.id === session.venue_id)?.name ?? '';
              const disciplineName =
                disciplines.find((candidate) => candidate.id === session.discipline)?.name ?? '';
              const partners = clashPartners.get(session.id) ?? [];
              const seated = session.admission === 'seat';
              const left = session.seats_remaining ?? 0;
              const inAgenda = agenda.has(session.id);
              return (
                <li key={session.id} className="session-row" data-session={session.id}>
                  <span className="figures when">
                    {formatSessionWhen(session.starts_at, session.ends_at)}
                  </span>
                  <h3>{session.title}</h3>
                  <span className="meta">{venueName}</span>
                  <span className="meta">{disciplineName}</span>
                  {seated ? (
                    <span className="figures seats">
                      {session.status === 'cancelled'
                        ? 'Cancelled'
                        : left === 0
                          ? 'Sold out'
                          : `${left} of ${session.capacity ?? 0} seats left`}
                    </span>
                  ) : null}
                  {seated && session.price_full_cents !== null ? (
                    <span className="figures price">{formatEuros(session.price_full_cents)}</span>
                  ) : null}
                  <button
                    type="button"
                    className={inAgenda ? 'toggle lit' : 'toggle'}
                    aria-pressed={inAgenda}
                    aria-label={`Add ${session.title} to agenda`}
                    onClick={() => toggleAgenda(session)}
                  >
                    {inAgenda ? 'In agenda' : 'Add to agenda'}
                  </button>
                  {seated && session.status !== 'cancelled' && left > 0 ? (
                    <button
                      type="button"
                      onClick={(event) => void holdSeat(session, event.currentTarget)}
                    >
                      {`Hold a seat for ${session.title}`}
                    </button>
                  ) : null}
                  {seated && session.status !== 'cancelled' && left === 0 ? (
                    <button type="button" onClick={() => void joinWaitlist(session)}>
                      {`Join waitlist for ${session.title}`}
                    </button>
                  ) : null}
                  {partners.length > 0 ? (
                    <ClashMark text={`Clash with ${partners.join(', ')}`} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <button
          type="button"
          className="agenda-open"
          onClick={() => setSheetOpen((open) => !open)}
        >
          Open my agenda
        </button>

        <aside
          className={sheetOpen ? 'agenda open' : 'agenda'}
          aria-label="My agenda"
        >
          <h2 tabIndex={-1} ref={agendaHeadingRef}>
            My agenda
          </h2>
          <p className="status" role="status" aria-label="Agenda updates">
            {agendaMessage}
          </p>
          <ol className="ruled">
            {agendaSessions.map((session, index) => {
              const partners = clashPartners.get(session.id) ?? [];
              return (
                <li key={session.id}>
                  <span className="figures">
                    {formatSessionWhen(session.starts_at, session.ends_at)}
                  </span>
                  <span>{session.title}</span>
                  {partners.length > 0 ? (
                    <ClashMark text={`Clash with ${partners.join(', ')}`} />
                  ) : null}
                  <button
                    type="button"
                    data-agenda-remove={session.id}
                    onClick={() => removeFromAgenda(session, index)}
                  >
                    {`Remove ${session.title} from agenda`}
                  </button>
                </li>
              );
            })}
            {agendaSessions.length === 0 ? <li className="muted">Nothing yet.</li> : null}
          </ol>
          <button
            type="button"
            className="primary"
            onClick={(event) => void getTicketsForAgenda(event.currentTarget)}
          >
            Get tickets for my agenda
          </button>
        </aside>
      </div>

      <PinnedStory reducedMotion={reducedMotion} />

      <Gallery entries={entries} reducedMotion={reducedMotion} />

      <section
        className={ticketsSeen || reducedMotion ? 'tickets ground-paper drawn' : 'tickets ground-paper'}
        aria-label="Tickets"
        ref={ticketsRef}
      >
        <SectionHead>Tickets</SectionHead>
        <table className="ruled" aria-label="Pass prices">
          <thead>
            <tr>
              <th scope="col">Pass</th>
              <th scope="col">Full rate</th>
              <th scope="col">Reduced rate</th>
              <th scope="col">Buy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Full-festival pass</td>
              <td className="figures">{formatEuros(prices.full_festival_full_cents)}</td>
              <td className="figures">{formatEuros(prices.full_festival_reduced_cents)}</td>
              <td>
                <button
                  type="button"
                  className="primary"
                  onClick={(event) => buyPass('full_festival', event.currentTarget)}
                >
                  Buy full-festival pass
                </button>
              </td>
            </tr>
            <tr>
              <td>Day pass</td>
              <td className="figures">{formatEuros(prices.day_full_cents)}</td>
              <td className="figures">{formatEuros(prices.day_reduced_cents)}</td>
              <td>
                <button
                  type="button"
                  className="primary"
                  onClick={(event) => buyPass('day', event.currentTarget)}
                >
                  Buy day pass
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">{`Day passes admit to one festival day at every venue except the Planetarium Dome.`}</p>
      </section>

      <footer className="ground-ink">
        <p>Kerf Collective · Kerf Frequencies 2027 · Brussels</p>
        <p className="muted">{`${days.length} days · ${venues.length} venues · ${sessions.length} published sessions`}</p>
      </footer>

      <div className="live-bar">
        <p className="status" role="status" aria-label="Checkout status">
          {checkoutStatus}
        </p>
        <ProblemMark label="Checkout problem" text={checkoutProblem} />
      </div>

      <Checkout
        open={checkoutStep !== null}
        step={checkoutStep ?? 'tickets'}
        onStatus={setCheckoutStatus}
        onProblem={setCheckoutProblem}
        days={days}
        sessions={sessions}
        prices={prices}
        openerRef={openerRef}
        initialPasses={initialPasses}
        onClose={() => route.setQuery({ checkout: null })}
        onDone={(order: Order) => {
          route.navigate(`/orders/${order.id}`);
        }}
      />
    </>
  );
}
