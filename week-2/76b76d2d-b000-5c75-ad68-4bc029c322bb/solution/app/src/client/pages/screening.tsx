import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Hold, ScreeningDetail, SeatState } from "../../shared/api.ts";
import { compareSeats } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { localDate, localTime } from "../i18n.ts";
import { Feedback, Num, useAction } from "../ui.tsx";

type Seat = { code: string; state: SeatState };

function rowsOf(seats: Seat[]): Seat[][] {
  const rows = new Map<string, Seat[]>();
  for (const seat of [...seats].sort((a, b) => compareSeats(a.code, b.code))) {
    const row = seat.code.charAt(0);
    rows.set(row, [...(rows.get(row) ?? []), seat]);
  }
  return [...rows.values()];
}

/**
 * Seat map (brief: Seat map): one Tab stop with roving focus; arrows move one seat and stop at the
 * edges, Up and Down keep the seat number (clamped), Home and End jump within the row, Space or
 * Enter toggles an available seat.
 */
function SeatMap({ seats, selected, onToggle }: { seats: Seat[]; selected: Set<string>; onToggle: (code: string) => void }) {
  const { t } = useApp();
  const rows = rowsOf(seats);
  const [focus, setFocus] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const current = focus ?? rows[0]?.[0]?.code ?? null;

  const move = (code: string) => {
    setFocus(code);
    cells.current.get(code)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, rowIndex: number, seatIndex: number, seat: Seat) => {
    const row = rows[rowIndex] ?? [];
    const sameNumber = (target: Seat[] | undefined) => {
      if (!target) return null;
      const number = Number(seat.code.slice(1));
      return target.reduce<Seat | null>((best, s) => {
        if (!best) return s;
        return Math.abs(Number(s.code.slice(1)) - number) < Math.abs(Number(best.code.slice(1)) - number) ? s : best;
      }, null);
    };
    let target: Seat | null | undefined = null;
    if (event.key === "ArrowRight") target = row[Math.min(row.length - 1, seatIndex + 1)];
    else if (event.key === "ArrowLeft") target = row[Math.max(0, seatIndex - 1)];
    else if (event.key === "ArrowDown") target = sameNumber(rows[rowIndex + 1]) ?? seat;
    else if (event.key === "ArrowUp") target = sameNumber(rows[rowIndex - 1]) ?? seat;
    else if (event.key === "Home") target = row[0];
    else if (event.key === "End") target = row[row.length - 1];
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      onToggle(seat.code);
      return;
    }
    if (!target) return;
    event.preventDefault();
    move(target.code);
  };

  return (
    <div class="seat-frame">
      <div class="screen-bar" aria-hidden="true"><span>{t.screen}</span></div>
      <div role="grid" aria-label={t.seatMap} class="seat-grid">
        {rows.map((row, rowIndex) => (
          <div role="row" key={row[0]?.code.charAt(0)} class="seat-row">
            <span class="row-letter" aria-hidden="true">{row[0]?.code.charAt(0)}</span>
            {row.map((seat, seatIndex) => {
              const taken = seat.state === "held" || seat.state === "sold";
              const mine = selected.has(seat.code) || seat.state === "mine";
              return (
                <div key={seat.code} role="gridcell" ref={(el) => { if (el) cells.current.set(seat.code, el); }}
                  class={taken ? "seat is-taken" : mine ? "seat is-mine" : "seat"} aria-label={`${t.seat} ${seat.code}`}
                  aria-selected={mine ? "true" : "false"} aria-disabled={taken ? "true" : undefined}
                  tabIndex={seat.code === current ? 0 : -1}
                  onKeyDown={(e) => onKeyDown(e, rowIndex, seatIndex, seat)}
                  onFocus={() => setFocus(seat.code)}
                  onClick={() => { setFocus(seat.code); onToggle(seat.code); }}>
                  <span class="num" aria-hidden="true">{seat.code}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScreeningPage({ id }: { id: string }) {
  const { locale, t, me, navigate } = useApp();
  const [screening, setScreening] = useState<ScreeningDetail | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const action = useAction();

  const load = () => {
    void api<{ screening: ScreeningDetail }>("GET", `/api/screenings/${encodeURIComponent(id)}`).then((r) => {
      if (!r.ok) {
        setScreening((current) => (r.status === 404 ? null : current));
        return;
      }
      setScreening(r.data.screening);
      setTaken(new Set());
      const unavailable = new Set(r.data.screening.seats.filter((s) => s.state === "held" || s.state === "sold").map((s) => s.code));
      setSelected((current) => new Set([...current].filter((code) => !unavailable.has(code))));
    });
  };
  useLayoutEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  if (screening === undefined) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.loading}</h1></section>;
  if (screening === null) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.notFound}</h1></section>;

  const seats: Seat[] = screening.seats.map((s) => (taken.has(s.code) && s.state === "available" ? { ...s, state: "held" } : s));
  const toggle = (code: string) => {
    const seat = seats.find((s) => s.code === code);
    if (!seat || seat.state === "held" || seat.state === "sold") return;
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelected(next);
    action.clear();
  };
  const hold = () => {
    const chosen = [...selected].sort(compareSeats);
    void action.run(
      () => api<{ hold: Hold }>("POST", "/api/holds", { screening_id: screening.id, seats: chosen, group }),
      (data) => {
        navigate(`/${locale}/checkout/${encodeURIComponent(data.hold.id)}`);
        return t.holdPlaced;
      },
      (error) => {
        if (error.code === "seat_taken" && error.seats) {
          const lost = new Set(error.seats);
          setTaken(new Set([...taken, ...lost]));
          setSelected(new Set(chosen.filter((code) => !lost.has(code))));
        }
        load();
      },
    );
  };
  const date = localDate(screening.starts_at);
  const time = localTime(screening.starts_at);

  return (
    <section class="page screening-page">
      <header class="screening-head">
        <h1 tabIndex={-1} class="page-title one-line">{screening.film_title}</h1>
        <p class="screening-meta one-line">
          <span><Num>{date}</Num> <Num>{time}</Num></span><span class="meta-sep"> · </span>
          <span class="meta-place">{screening.auditorium.name} (<Num>{screening.auditorium.code}</Num>) · <Num>{screening.format}</Num></span>
        </p>
      </header>
      <div class="screening-layout">
        <div class="notes-column">
          <button type="button" class="button ghost notes-toggle" aria-expanded={notesOpen ? "true" : "false"} aria-controls="film-notes"
            onClick={() => setNotesOpen(!notesOpen)}>{t.filmNotes}</button>
          <section id="film-notes" class={notesOpen ? "film-notes is-open" : "film-notes"} aria-labelledby="film-notes-heading">
            <h2 id="film-notes-heading" class="notes-heading">{t.filmNotes}</h2>
            <dl class="notes-facts">
              <div><dt>{t.format}</dt><dd><Num>{screening.format}</Num></dd></div>
              <div><dt>{t.auditorium}</dt><dd>{screening.auditorium.name} (<Num>{screening.auditorium.code}</Num>)</dd></div>
              <div><dt>{t.venue}</dt><dd class="one-line">{screening.auditorium.venue}</dd></div>
              <div><dt>{t.showtime}</dt><dd><Num>{date} {time}</Num></dd></div>
            </dl>
            <p class="notes-body">{t.notesNone}</p>
          </section>
        </div>
        <div class="seat-column">
          <SeatMap seats={seats} selected={selected} onToggle={toggle} />
          <div class="seat-controls">
            <p class="seats-count">
              {screening.seats_remaining === 0 ? t.soldOut : <><Num>{screening.seats_remaining}</Num> {t.left}</>}
            </p>
            <ul class="seat-legend" aria-hidden="true">
              <li><span class="swatch" /> {t.legendAvailable}</li>
              <li><span class="swatch is-mine" /> {t.legendSelected}</li>
              <li><span class="swatch is-taken" /> {t.legendTaken}</li>
            </ul>
            {me && me.role === "patron" ? (
              <label class="check">
                <input type="checkbox" checked={group} onChange={(e) => setGroup(e.currentTarget.checked)} />
                <span>{t.groupBooking}</span>
              </label>
            ) : null}
            <button type="button" class={selected.size ? "button primary" : "button"} disabled={action.busy} onClick={hold}>
              {action.busy ? t.working : t.holdSeats}
            </button>
            <Feedback statusName={t.bookingStatus} alertName={t.bookingError} status={action.status} error={action.error}>
              {Object.values(action.fields).map((message) => <p key={message} class="field-error">{message}</p>)}
            </Feedback>
          </div>
        </div>
      </div>
    </section>
  );
}
