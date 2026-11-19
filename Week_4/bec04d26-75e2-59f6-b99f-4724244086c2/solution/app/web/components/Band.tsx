import { useLayoutEffect, useRef } from "react";
import { dateWords, daysBetween } from "../../shared/calendar";
import { deadlineOrder } from "../../shared/order";
import { TILE_COLOURS } from "../../shared/tile";
import type { ClockView, ReturnView } from "../../shared/types";
import { prefersReducedMotion } from "../lib/dom";
import { Link } from "../router";
import { returnData } from "./Tile";

const AXIS_HOURS = 36;
/** Central midnight of the open day sits six hours into the axis, which starts at 6 pm the evening before. */
const MIDNIGHT_HOUR = 6;
const GROW_MS = 250;
const SLIDE_MS = 400;
const STAGGER_MS = 40;

const hourName = (hour: number): string => `${hour % 12 || 12} ${hour % 24 < 12 ? "am" : "pm"}`;
const TICKS = Array.from({ length: AXIS_HOURS / 3 + 1 }, (_, i) => ({ at: i * 3, name: hourName(18 + i * 3) }));

interface BandProps {
  date: string;
  returns: ReturnView[];
  clock: ClockView;
  closing: boolean;
  onCollapsed: () => void;
}

/** The Midnight meridian: each state's deadline of one day placed on a 36-hour axis of Central hours. */
export function Band({ date, returns, clock, closing, onCollapsed }: BandProps) {
  const root = useRef<HTMLElement>(null);
  const lane = useRef<HTMLOListElement>(null);
  const strips = [...returns].sort(deadlineOrder);
  const nowHour = daysBetween(date, clock.today) * 24 + clock.minute / 60 + MIDNIGHT_HOUR;
  const nowInside = nowHour >= 0 && nowHour <= AXIS_HOURS;

  useLayoutEffect(() => {
    const band = root.current!;
    if (prefersReducedMotion()) return;
    band.style.overflow = "hidden";
    const full = band.scrollHeight;
    band.animate([{ height: "0px" }, { height: `${full}px` }], { duration: GROW_MS, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" })
      .finished.then(() => { band.style.overflow = ""; }, () => undefined);
    const hour = lane.current!.clientWidth / AXIS_HOURS;
    lane.current!.querySelectorAll<HTMLElement>("li").forEach((strip, index) => {
      const offset = Number(strip.dataset.offsetHours);
      strip.animate([{ transform: `translateX(${offset * hour}px)` }, { transform: "translateX(0)" }],
        { duration: SLIDE_MS, delay: index * STAGGER_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "backwards" });
    });
  }, []);

  useLayoutEffect(() => {
    if (!closing) return;
    const band = root.current!;
    if (prefersReducedMotion()) {
      onCollapsed();
      return;
    }
    band.style.overflow = "hidden";
    band.animate([{ height: `${band.offsetHeight}px` }, { height: "0px" }],
      { duration: GROW_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" })
      .finished.then(onCollapsed, () => undefined);
  }, [closing, onCollapsed]);

  return (
    <section ref={root} className="band" aria-label={`Deadlines on ${dateWords(date)}`}>
      <h3>Midnight meridian</h3>
      <p className="hint">Each deadline against Central hours. The heavy lines mark Central midnight.</p>
      <div className="axis">
        <ol className="ticks" aria-hidden="true">
          {TICKS.map((t) => <li key={t.at} data-minor={t.at % 6 ? "" : undefined} style={{ left: `${(t.at / AXIS_HOURS) * 100}%` }}>{t.name}</li>)}
        </ol>
        <ol ref={lane} className="lane">
          {strips.map((r) => (
            <li key={r.id} className="strip" {...returnData(r)} data-offset-hours={r.offset_hours} data-past={String(r.past)}
              style={{ marginLeft: `${((MIDNIGHT_HOUR - r.offset_hours) / AXIS_HOURS) * 100}%`, background: r.overdue ? TILE_COLOURS.black : TILE_COLOURS[r.tone] }}>
              <Link href={`/returns/${r.id}`} className={r.overdue || r.tone === "black" ? "on-black" : undefined}>
                <span>{`${r.client.name} ${r.state} · ${r.local_deadline_label} · ${r.practice_deadline_label}`}</span>
                {r.overdue && <strong>Overdue</strong>}
                {r.carried_from && <span>{`Carried from ${dateWords(r.carried_from)}`}</span>}
              </Link>
            </li>
          ))}
        </ol>
        <div className="now-line" data-now={clock.now} hidden={!nowInside} style={{ left: `${(nowHour / AXIS_HOURS) * 100}%` }} />
      </div>
      <table aria-label="Deadlines">
        <thead>
          <tr><th scope="col">State</th><th scope="col">Local deadline</th><th scope="col">Practice deadline</th><th scope="col">Status</th></tr>
        </thead>
        <tbody>
          {strips.map((r) => (
            <tr key={r.id}>
              <td>{r.state}</td><td>{r.local_deadline_label}</td><td>{r.practice_deadline_label}</td>
              <td>{r.overdue ? `${r.status_label} · Overdue` : r.status_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
