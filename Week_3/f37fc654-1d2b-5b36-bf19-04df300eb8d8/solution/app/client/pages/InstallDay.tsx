// `/c/<commission id>/day` — a month of the venue's own days; hold a free one and watch the countdown.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatDay, monthName } from "../../shared/format";
import { Icon } from "../components/icons";
import { Countdown, useHold } from "../components/Pay";
import { AppLink } from "../components/Shell";
import { HttpError, call } from "../lib/api";
import { CommissionLinks, Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission } from "./common";

interface Day { date: string; status: "free" | "held" | "booked" | "unavailable" | "yours"; startsAt: string; endsAt: string }

const STATUS_WORDS: Record<Day["status"], string> = { free: "free", held: "held", booked: "booked", unavailable: "unavailable", yours: "your hold" };

function venueToday(zone: string): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(Date.now());
  return { year: Number(parts.find((p) => p.type === "year")?.value), month: Number(parts.find((p) => p.type === "month")?.value) - 1 };
}

const pad = (n: number): string => String(n).padStart(2, "0");

function takenText(next: string[]): string {
  if (!next.length) return "That day was just taken. There are no free days in the next year.";
  const names = next.map(formatDay);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `That day was just taken. The next free days are ${list}.`;
}

/** Holds a day for the commission and reports it in words; true when the hold was recorded. */
export async function holdDay(id: string, date: string, report: (text: string) => void): Promise<boolean> {
  try {
    await call(`/api/commissions/${id}/hold`, { json: { date } });
    report(`Held ${formatDay(date)}. Finish checkout before the timer runs out.`);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.code === "day_taken") report(takenText((error.body.error as { nextFreeDays: string[] }).nextFreeDays));
    else if (error instanceof HttpError && error.code === "placement_incomplete") report("Place every piece in the configurator before holding a day.");
    else report(failureText(error));
    return false;
  }
}

export function InstallDay({ id }: { id: string }) {
  useScene("working");
  const [load, reload] = useLoad<Commission>(`/api/commissions/${id}`);
  const { hold, secondsLeft, refresh } = useHold(id);
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const c = load.status === "ready" ? load.data : null;

  useEffect(() => {
    if (c && !month) setMonth(c.hold ? { year: Number(c.hold.date.slice(0, 4)), month: Number(c.hold.date.slice(5, 7)) - 1 } : venueToday(c.venue.timeZone));
  }, [c, month]);

  const loadDays = useCallback(async () => {
    if (!c || !month) return;
    const last = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
    const prefix = `${month.year}-${pad(month.month + 1)}`;
    const result = await call<{ days: Day[] }>(`/api/venues/${c.venue.id}/days?from=${prefix}-01&to=${prefix}-${pad(last)}`);
    setDays(result.days);
  }, [c, month]);

  useEffect(() => {
    setDays(null);
    void loadDays();
  }, [loadDays]);

  const shift = (delta: number): void => {
    if (!month) return;
    const next = new Date(Date.UTC(month.year, month.month + delta, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
    setFocusDate(null);
  };

  const doHold = async (date: string): Promise<void> => {
    if (await holdDay(id, date, setStatus)) {
      setChosen(null);
      await Promise.all([refresh(), loadDays(), reload()]);
    } else await loadDays();
  };

  const release = async (): Promise<void> => {
    try {
      await call(`/api/commissions/${id}/hold`, { method: "DELETE" });
      setStatus("Hold released.");
      await Promise.all([refresh(), loadDays(), reload()]);
    } catch (error) {
      setStatus(failureText(error));
    }
  };

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  if (!c || !month) return <main className="column"><Skeleton rows={6} /></main>;

  const firstWeekday = (new Date(Date.UTC(month.year, month.month, 1)).getUTCDay() + 6) % 7;
  const roving = focusDate ?? chosen ?? days?.find((d) => d.status === "free")?.date ?? days?.[0]?.date ?? null;
  const cells: (Day | null)[] = [...Array<null>(firstWeekday).fill(null), ...(days ?? [])];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!days || !roving) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const at = days.findIndex((d) => d.date === roving);
    const next = days[Math.max(0, Math.min(days.length - 1, at + moves[event.key]))];
    setFocusDate(next.date);
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${next.date}"]`)?.focus());
  };

  const held = hold?.status === "held";
  const label = `${monthName(month.month)} ${month.year}`;
  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">{c.title} · {c.venue.name} · {c.venue.timeZone}</p>
        <h1>Install day</h1>
        <p className="muted">Days are whole calendar days in the venue's own time zone, one install per day, from 21 days to a year ahead.</p>
      </header>
      <div className="stack">
        <div className="calendar-head">
          <button type="button" className="button" onClick={() => shift(-1)}><Icon name="chevronLeft" /> <span className="wide-only">Previous month</span></button>
          <h2 style={{ fontSize: 21 }}>{label}</h2>
          <button type="button" className="button" onClick={() => shift(1)}><span className="wide-only">Next month</span> <Icon name="chevronRight" /></button>
        </div>
        {days ? (
          <div ref={grid} role="grid" aria-label={label} className="calendar" onKeyDown={onGridKey}>
            <div role="row">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} role="columnheader" className="dow">{d}</span>)}</div>
            {weeks.map((week, w) => (
              <div role="row" key={w}>
                {week.map((day, i) => (
                  <span role="gridcell" key={day?.date ?? `pad-${w}-${i}`}>
                    {day && (
                      <button
                        type="button"
                        data-date={day.date}
                        className={`day ${chosen === day.date ? "selected" : ""} ${day.status === "yours" ? "mine" : ""}`}
                        tabIndex={day.date === roving ? 0 : -1}
                        aria-label={`${formatDay(day.date)}, ${STATUS_WORDS[day.status]}`}
                        aria-disabled={day.status === "free" || day.status === "yours" ? undefined : true}
                        aria-pressed={chosen === day.date}
                        onClick={() => {
                          setFocusDate(day.date);
                          if (day.status === "free" || day.status === "yours") setChosen(day.date);
                        }}
                      >
                        <span>{Number(day.date.slice(8))}</span>
                        <small>{day.status === "free" ? "" : STATUS_WORDS[day.status]}</small>
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : <Skeleton rows={4} />}
        <div className="row-actions">
          {chosen && days?.find((d) => d.date === chosen)?.status === "free" && (
            <button type="button" className="button primary" onClick={() => void doHold(chosen)}>Hold {formatDay(chosen)}</button>
          )}
          {held && <button type="button" className="button" onClick={() => void release()}>Release hold</button>}
          {held && <Countdown seconds={secondsLeft} />}
          {held && <AppLink href={`/c/${id}/checkout`} className="button primary">Go to checkout <Icon name="arrowRight" /></AppLink>}
        </div>
        <p role="status" aria-label="Hold status" className="status-line">{status}</p>
      </div>
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>
    </main>
  );
}
