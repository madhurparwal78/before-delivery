// The schedule: filter bar, the ruled list of sessions and the clash-aware "My agenda" panel.
import { CalendarCheck, CalendarPlus, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { sessionTimeText } from "../../shared/brussels.ts";
import { euro } from "../../shared/money.ts";
import { holdSeat, joinWaitlist, ticketsForAgenda } from "../checkout/actions.ts";
import { copy } from "../copy.ts";
import { agendaView, toggleAgenda } from "../state/agenda.ts";
import { setFilters, type Filters } from "../state/filters.ts";
import type { Programme, Session, User } from "../types.ts";
import { EmptyState } from "./EmptyState.tsx";
import { Field } from "./Field.tsx";
import { Sheet } from "./Sheet.tsx";

type Agenda = ReturnType<typeof agendaView>;
type Props = { programme: Programme | null; filters: Filters; agenda: Agenda; agendaIds: string[]; user: User | null };

const timeOf = (s: Session) => sessionTimeText(Date.parse(s.starts_at), Date.parse(s.ends_at));

function seatText(s: Session): string {
  if (s.status === "cancelled") return "Cancelled";
  if (s.admission !== "seat") return "";
  return (s.seats_remaining ?? 0) > 0 ? copy.seatsLeft(s.seats_remaining!, s.capacity!) : "Sold out";
}

function ClashMarker({ titles }: { titles: string[] }) {
  if (!titles.length) return null;
  return (
    <span className="clash">
      <TriangleAlert aria-hidden="true" size={16} strokeWidth={2.5} />
      {titles.map((t) => copy.clashWith(t)).join(" · ")}
    </span>
  );
}

function Row({ session, programme, inAgenda, clashTitles, user, firstOfDay, announce }: {
  session: Session; programme: Programme; inAgenda: boolean; clashTitles: string[]; user: User | null; firstOfDay: string | null;
  announce: (text: string) => void;
}) {
  const venue = programme.venues.find((v) => v.id === session.venue_id)?.name ?? session.venue_id;
  const discipline = programme.disciplines.find((d) => d.id === session.discipline)?.name ?? session.discipline;
  const seat = session.admission === "seat";
  const cancelled = session.status === "cancelled";
  const soldOut = seat && !cancelled && (session.seats_remaining ?? 0) <= 0;
  return (
    <li className={`row${cancelled ? " row--cancelled" : ""}${inAgenda ? " row--lit" : ""}`} data-day-head={firstOfDay ?? undefined}>
      <p className="row__time figures">{timeOf(session)}</p>
      <div className="row__main">
        <h3 className="row__title">{session.title}</h3>
        <p className="row__meta">
          <span>{venue}</span>
          <span className="chip" data-discipline={session.discipline}>{discipline}</span>
        </p>
        <ClashMarker titles={clashTitles} />
      </div>
      <div className="row__seats figures">
        {seat ? <span className="row__price">{euro(session.price_full_cents ?? 0)}</span> : <span className="row__price row__price--pass">With a pass</span>}
        <span className="row__left">{seatText(session) || (cancelled ? "Cancelled" : "")}</span>
      </div>
      <div className="row__actions">
        <button type="button" className={`button button--agenda${inAgenda ? " is-on" : ""}`} aria-pressed={inAgenda}
          aria-label={`Add ${session.title} to agenda`}
          onClick={() => {
            const added = toggleAgenda(session.id);
            announce(added ? copy.added(session.title) : copy.removed(session.title));
          }}>
          {inAgenda ? <CalendarCheck aria-hidden="true" size={18} /> : <CalendarPlus aria-hidden="true" size={18} />}
          {inAgenda ? "In agenda" : "Add to agenda"}
        </button>
        {seat && !cancelled && !soldOut && (
          <button type="button" className="button button--primary" aria-label={`Hold a seat for ${session.title}`} onClick={() => void holdSeat(user, session)}>
            Hold a seat
          </button>
        )}
        {soldOut && (
          <button type="button" className="button" aria-label={`Join waitlist for ${session.title}`} onClick={() => void joinWaitlist(user, session)}>
            Join waitlist
          </button>
        )}
      </div>
    </li>
  );
}

function AgendaPanel({ programme, agenda, user, announcement, announce, open, onClose }: {
  programme: Programme; agenda: Agenda; user: User | null; announcement: string; announce: (text: string) => void; open: boolean; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<number | null>(null);
  // After a removal, focus moves to the next agenda item, or to the panel heading when none is left.
  useLayoutEffect(() => {
    if (focusAfter.current === null) return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button[data-remove]") ?? [];
    (buttons[Math.min(focusAfter.current, buttons.length - 1)] ?? heading.current)?.focus();
    focusAfter.current = null;
  }, [agenda.chosen]);
  const remove = (s: Session, index: number) => {
    focusAfter.current = index;
    toggleAgenda(s.id);
    announce(copy.removed(s.title));
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <aside className="agenda" aria-label="My agenda">
        <div className="agenda__head">
          <h2 className="agenda__title" ref={heading} tabIndex={-1}>My agenda</h2>
          <button type="button" className="button button--icon agenda__close" aria-label="Close my agenda" onClick={onClose}><X aria-hidden="true" size={20} /></button>
        </div>
        {agenda.chosen.length === 0 ? (
          <EmptyState text="Your agenda is empty. Add sessions from the schedule and clashes show up here." />
        ) : (
          <ul className="agenda__list" ref={list}>
            {agenda.chosen.map((s, i) => {
              const clashes = agenda.clashesOf(s.id).map((id) => programme.sessions.find((x) => x.id === id)?.title ?? id);
              return (
                <li key={s.id} className="agenda__item">
                  <p className="figures agenda__time">{timeOf(s)}</p>
                  <p className="agenda__name">{s.title}</p>
                  <ClashMarker titles={clashes} />
                  <button type="button" className="button button--quiet" data-remove={s.id} aria-label={`Remove ${s.title} from agenda`} onClick={() => remove(s, i)}>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="button button--primary agenda__cta" onClick={() => void ticketsForAgenda(user, agenda.chosen)}>
          Get tickets for my agenda
        </button>
      </aside>
      <p role="status" aria-label="Agenda updates" className="agenda__status">{announcement}</p>
    </Sheet>
  );
}

export function Schedule({ programme, filters, agenda, agendaIds, user }: Props) {
  const [announcement, setAnnouncement] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const pending = useRef<string | null>(null);
  const announce = (text: string) => { pending.current = text; };
  // The clash count follows each agenda change, so the announcement reads "<action> <n> clashes".
  useEffect(() => {
    if (pending.current === null) return;
    setAnnouncement(`${pending.current} ${copy.clashCount(agenda.pairs.length)}`);
    pending.current = null;
  }, [agendaIds, agenda.pairs.length]);

  const sessions = (programme?.sessions ?? []).filter((s) =>
    (!filters.day || s.festival_day === filters.day) && (!filters.venue || s.venue_id === filters.venue) &&
    (!filters.discipline || s.discipline === filters.discipline) && (!filters.clashes || agenda.clashesOf(s.id).length > 0));
  const titleOf = (id: string) => programme?.sessions.find((s) => s.id === id)?.title ?? id;
  const label = (date: string) => programme?.festival_days.find((d) => d.date === date)?.label.toUpperCase() ?? date;

  return (
    <section className="section section--schedule" data-ground="paper" aria-labelledby="schedule-head" id="schedule">
      <div className="grid">
        <h2 id="schedule-head" className="display section__head" data-fit data-kinetic>Schedule</h2>
        <div className="schedule">
          <div className="schedule__main">
            <form className="filters" onSubmit={(e) => e.preventDefault()}>
              <Field label="Day">
                <select value={filters.day ?? ""} onChange={(e) => setFilters({ day: e.target.value || null })}>
                  <option value="">All days</option>
                  {programme?.festival_days.map((d) => <option key={d.date} value={d.date}>{d.label}</option>)}
                </select>
              </Field>
              <Field label="Venue">
                <select value={filters.venue ?? ""} onChange={(e) => setFilters({ venue: e.target.value || null })}>
                  <option value="">All venues</option>
                  {programme?.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              <Field label="Discipline">
                <select value={filters.discipline ?? ""} onChange={(e) => setFilters({ discipline: e.target.value || null })}>
                  <option value="">All disciplines</option>
                  {programme?.disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" checked={filters.clashes} onChange={(e) => setFilters({ clashes: e.target.checked })} />
                <span>Clashes only</span>
              </label>
              <button type="button" className="button" onClick={() => setFilters({ day: null, venue: null, discipline: null, clashes: false })}>Clear filters</button>
            </form>
            <p role="status" aria-label="Programme results" className="results figures">{programme ? copy.results(sessions.length) : ""}</p>
            <button type="button" className="button agenda-opener" onClick={() => setSheetOpen(true)}>Open my agenda</button>
            {programme ? (
              <ul aria-label="Sessions" className="rows">
                {sessions.map((s, i) => (
                  <Row key={s.id} session={s} programme={programme} inAgenda={agendaIds.includes(s.id)} user={user} announce={announce}
                    clashTitles={agenda.clashesOf(s.id).map(titleOf)}
                    firstOfDay={i === 0 || sessions[i - 1]!.festival_day !== s.festival_day ? label(s.festival_day) : null} />
                ))}
              </ul>
            ) : (
              <ul aria-label="Sessions" className="rows rows--loading" aria-busy="true">
                {[0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="row row--skeleton" aria-hidden="true" />)}
              </ul>
            )}
          </div>
          {programme && (
            <AgendaPanel programme={programme} agenda={agenda} user={user} announcement={announcement} announce={announce}
              open={sheetOpen} onClose={() => setSheetOpen(false)} />
          )}
        </div>
      </div>
    </section>
  );
}
