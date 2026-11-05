import { useEffect, useRef, useState } from "preact/hooks";
import { call } from "../api.js";
import { openCourseDay } from "../../shared/courseDays.js";
import { Live, Page } from "../ui/kit.js";
import { StaffSignIn, useStaff } from "../ui/StaffSignIn.js";

interface Match {
  reservation_id: string;
  attendee_name: string;
  bench: string;
  day1: boolean;
  day2: boolean;
}

const REFUSALS: Record<string, (name: string, day: number) => string> = {
  already_checked_in: (name, day) => `${name} is already checked in for day ${day}.`,
  balance_due: (name) => `${name} has a balance due. Send them to the registrar.`,
  not_checked_in_day1: (name) => `${name} has no day 1 check-in. Send them to the registrar.`,
  no_attendee: () => "This seat has no attendee yet. Send them to the registrar.",
  checkin_closed: () => "Check-in is closed today.",
};

export function Checkin() {
  const { me, refresh } = useStaff("frontdesk");
  const [query, setQuery] = useState("");
  const [listed, setListed] = useState<{ q: string; results: Match[] } | null>(null);
  const [message, setMessage] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const day = me ? openCourseDay(me.venue_date) : null;

  const typed = useRef("");
  const wait = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Lists matches for the text in the box; an answer for any other text is dropped, whenever it arrives. */
  const find = async (text: string, announce: boolean) => {
    const q = text.trim();
    if (q.length < 2) return setListed(null);
    const reply = await call<{ q: string; results: Match[] }>("GET", `/api/checkin?q=${encodeURIComponent(q)}`);
    if (!reply.ok || reply.data.q !== typed.current) return;
    setListed(reply.data);
    if (announce) setMessage(reply.data.results.length ? `Found ${reply.data.results.length} for "${q}".` : `No attendee matches "${q}".`);
  };
  const matches = listed && listed.q === query.trim() ? listed.results : [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (me === undefined) return <Page title="Check-in">{null}</Page>;
  if (me === null) {
    return (
      <Page title="Check-in">
        <h1 class="page-title">Check-in</h1>
        <StaffSignIn heading="Front desk sign-in" onSignedIn={refresh} />
      </Page>
    );
  }

  const checkIn = async (match: Match, today: 1 | 2) => {
    const reply = await call("POST", "/api/checkin", { reservation_id: match.reservation_id, day: today });
    if (reply.ok) setMessage(`${match.attendee_name} checked in for day ${today}.`);
    else setMessage(REFUSALS[reply.error.error]?.(match.attendee_name, today) ?? reply.error.message);
    await find(query, false);
    search.current?.focus();
    search.current?.select();
  };

  return (
    <Page title="Check-in">
      <div class="checkin">
        <h1 class="page-title">{day ? `Day ${day} check-in` : "Check-in is closed today"}</h1>
        <p class="muted">
          Press <kbd>/</kbd> to search. Type two letters of a name, then Enter.
        </p>
        <div class="checkin__search">
          <label for="checkin-search">Attendee name</label>
          <input
            id="checkin-search"
            ref={search}
            type="search"
            aria-label="Attendee name"
            autocomplete="off"
            value={query}
            onInput={(event) => {
              const value = (event.target as HTMLInputElement).value;
              setQuery(value);
              setMessage("");
              typed.current = value.trim();
              if (wait.current) clearTimeout(wait.current);
              wait.current = setTimeout(() => void find(value, true), 150);
            }}
            onKeyDown={(event) => {
              const only = matches[0];
              if (event.key === "Enter" && matches.length === 1 && only && day) {
                event.preventDefault();
                void checkIn(only, day);
              }
              if (event.key === "ArrowDown" && matches.length) {
                event.preventDefault();
                buttons.current[0]?.focus();
              }
            }}
          />
        </div>
        <Live label="Check-in updates" message={message} />
        {message && <p class="echo echo--large">{message}</p>}
        <ul class="matches" aria-label="Matches">
          {matches.map((match, index) => (
            <li key={match.reservation_id} class="match">
              <span class="match__bench num">{match.bench}</span>
              <span class="match__name">{match.attendee_name}</span>
              <span class="match__days">
                Day 1 {match.day1 ? "in" : "not yet"} · Day 2 {match.day2 ? "in" : "not yet"}
              </span>
              {day && (
                <button
                  type="button"
                  class="button button--primary"
                  ref={(el) => {
                    buttons.current[index] = el;
                  }}
                  onClick={() => void checkIn(match, day)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const next = index + (event.key === "ArrowDown" ? 1 : -1);
                      if (next < 0) search.current?.focus();
                      else buttons.current[Math.min(matches.length - 1, next)]?.focus();
                    }
                  }}
                >
                  Check in {match.attendee_name} for day {day}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Page>
  );
}
