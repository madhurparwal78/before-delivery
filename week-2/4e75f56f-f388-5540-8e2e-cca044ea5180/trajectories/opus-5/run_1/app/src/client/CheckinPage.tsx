import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CheckinResponse, Reservation } from '../shared/api.js';
import { checkinCopy } from '../shared/copy.js';
import { ApiFailure, api } from './api.js';
import { LiveRegion } from './ui.js';

const DEBOUNCE_MS = 150;

export function CheckinPage(): ReactNode {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<CheckinResponse | null>(null);
  const [message, setMessage] = useState('');
  const [openDay, setOpenDay] = useState<1 | 2 | null>(null);
  const latest = useRef('');
  const search = useRef<HTMLInputElement>(null);
  const matches = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    void api<CheckinResponse>('/api/checkin?q=__')
      .then((result) => setOpenDay(result.open_day))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 422) setOpenDay(null);
      });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/') return;
      const active = document.activeElement;
      const inField =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      if (inField) return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const load = useCallback(async (text: string) => {
    latest.current = text;
    if (text.trim().length < 2) {
      setAnswer(null);
      return;
    }
    try {
      const result = await api<CheckinResponse>(`/api/checkin?q=${encodeURIComponent(text)}`);
      if (latest.current !== text || result.q !== text.trim()) return;
      setAnswer(result);
      setOpenDay(result.open_day);
      setMessage(
        result.results.length === 0
          ? checkinCopy.noMatches(result.q)
          : checkinCopy.matches(result.results.length, result.q),
      );
    } catch {
      if (latest.current === text) setAnswer(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const checkIn = useCallback(
    async (reservationId: string, name: string) => {
      const day = openDay;
      if (day === null) {
        setMessage(checkinCopy.dayHeading(null));
        return;
      }
      try {
        await api<{ reservation: Reservation }>('/api/checkin', {
          body: { reservation_id: reservationId, day },
        });
        setMessage(checkinCopy.checkedIn(name, day));
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.code === 'already_checked_in') setMessage(checkinCopy.alreadyCheckedIn(name, day));
          else if (error.code === 'balance_due') setMessage(checkinCopy.balanceDue(name));
          else if (error.code === 'not_checked_in_day1') setMessage(checkinCopy.noDay1(name));
          else if (error.code === 'no_attendee') setMessage(checkinCopy.noAttendee);
          else setMessage(error.body.message);
        } else {
          setMessage('Something went wrong.');
        }
      }
      await load(latest.current);
      search.current?.focus();
      search.current?.select();
    },
    [load, openDay],
  );

  const current = answer !== null && answer.q === query.trim() ? answer.results : [];

  return (
    <main className="staff checkin">
      <h1>{checkinCopy.dayHeading(openDay)}</h1>
      <p>
        <a href="/">Back to the programme</a>
      </p>
      <p className="field">
        <label htmlFor="checkin-search">Attendee name</label>
        <input
          id="checkin-search"
          ref={search}
          type="search"
          role="searchbox"
          aria-label="Attendee name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              matches.current.get(0)?.focus();
              return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (current.length !== 1) return;
            const only = current[0];
            if (only === undefined) return;
            void checkIn(only.reservation_id, only.attendee_name);
          }}
        />
      </p>
      <ul aria-label="Matches" className="match-list">
        {current.map((match, index) => (
          <li key={match.reservation_id}>
            <button
              type="button"
              ref={(element) => {
                if (element === null) matches.current.delete(index);
                else matches.current.set(index, element);
              }}
              aria-label={`Check in ${match.attendee_name} for day ${openDay ?? 1}`}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  matches.current.get(Math.min(current.length - 1, index + 1))?.focus();
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (index === 0) search.current?.focus();
                  else matches.current.get(index - 1)?.focus();
                }
              }}
              onClick={() => void checkIn(match.reservation_id, match.attendee_name)}
            >
              {match.attendee_name} <span className="num">Bench {match.bench}</span>
            </button>
          </li>
        ))}
      </ul>
      <LiveRegion name="Check-in updates" message={message} />
    </main>
  );
}
