import { useState } from "react";
import { ChevronIcon } from "../icons.tsx";
import { useMediaQuery, WIDE } from "../hooks.ts";
import type { BoardResponse } from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

type ClockName = "Equity session" | "ETH price" | "Holdings week";
const CLOCK_NAMES: readonly ClockName[] = ["Equity session", "ETH price", "Holdings week"];

interface ClockText {
  line: string;
  short: string;
  stale: boolean;
}

function clockText(name: ClockName, board: BoardResponse | null): ClockText {
  if (!board) return { line: "", short: name === "Holdings week" ? "Week 0000-00-00" : "Closed", stale: false };
  const { equity, eth, holdings } = board.clocks;
  if (name === "Equity session") {
    if (equity.status === "open" && equity.closes_at) return { line: `Session open — closes at ${isoWallClock(equity.closes_at, false)} ET`, short: "Open", stale: false };
    const date = equity.official_close?.date ?? "";
    return { line: `Market closed — share price is the ${date} official close`, short: "Closed", stale: false };
  }
  if (name === "ETH price") {
    if (eth.status === "live" && eth.last_tick) return { line: `Live — last tick ${isoWallClock(eth.last_tick.at, true)} ET`, short: "Live", stale: false };
    const line = eth.last_tick ? `Stale — no ETH tick since ${isoWallClock(eth.last_tick.at, true)} ET` : "Stale — no ETH tick received";
    return { line, short: "Stale", stale: true };
  }
  return {
    line: `Week ending ${holdings.week_ending} — as of ${isoWallDate(holdings.as_of)} ${isoWallClock(holdings.as_of, true)} ET`,
    short: `Week ${holdings.week_ending}`,
    stale: false,
  };
}

export function Rail({ board }: { board: BoardResponse | null }) {
  const wide = useMediaQuery(WIDE);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <section className="rail" aria-label="Clocks">
      {CLOCK_NAMES.map((name) => {
        const text = clockText(name, board);
        const expanded = open[name] === true;
        const showLine = wide || expanded;
        return (
          <div className="clock" role="group" aria-label={name} key={name}>
            <div className="clock-head">
              <span className="clock-name">{name}</span>
              {!wide && (
                <span className={text.stale ? "clock-short stale" : board ? "clock-short" : "clock-short ghost"} aria-hidden={board ? undefined : true}>
                  {text.short.startsWith("Week ") ? (
                    <>
                      Week <span className="nowrap">{text.short.slice(5)}</span>
                    </>
                  ) : (
                    text.short
                  )}
                </span>
              )}
              {!wide && (
                <button type="button" className="clock-details" aria-label={`${name} details`} aria-expanded={expanded} onClick={() => setOpen((current) => ({ ...current, [name]: !expanded }))}>
                  Details
                  <ChevronIcon />
                </button>
              )}
              {wide && <p className={text.stale ? "clock-line stale" : text.line === "" ? "clock-line ghost" : "clock-line"} aria-hidden={text.line === "" || undefined}>{text.line === "" ? "Week ending 0000-00-00 — as of 0000-00-00 00:00:00 ET" : text.line}</p>}
            </div>
            {!wide && showLine && text.line !== "" && <p className={text.stale ? "clock-line stale" : "clock-line"}>{text.line}</p>}
          </div>
        );
      })}
    </section>
  );
}
