// The Buyout Rail: one notch per month across the contract's term, tier bands, and a handle moved by mouse, finger or
// keys. It shows the server's quote for the handle's month; with reduced motion it is a plain range beside a table.

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { Quote, Tier } from "../../shared/api.js";
import { formatMoney } from "../../shared/money.js";
import { formatDate } from "../../shared/storeTime.js";
import { useBand } from "../hooks.js";
import { MEDIUM, QUICK, spring, tween, type Motion } from "../motion.js";
import { info, quiet, Status, type Notice } from "./ui.js";

const STEP_PAGE = 12;
/** Figures start rolling, and the tier label and boundary rule change, after the brass has begun to move. */
const ROLL_DELAY = 120;
const TIER_DELAY = 560;

/** Money that rolls digit by digit to a new value; the text node always holds the final value. */
function Odometer({ text, reduced, className }: { text: string; reduced: boolean; className?: string }): ReactNode {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(text);
  const rolling = useRef(new Map<HTMLElement, Motion>());
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = text;
    const node = ref.current;
    if (reduced || !node || before === text) return;
    const oldDigits = before.replace(/\D/g, "");
    const digits = Array.from(node.querySelectorAll<HTMLElement>(".odo__digit"));
    digits.forEach((digit, i) => {
      const fromRight = digits.length - 1 - i;
      const shown = digit.style.getPropertyValue("--roll");
      const from = rolling.current.has(digit) && shown !== "" ? Number(shown) : Number(oldDigits[oldDigits.length - 1 - fromRight] ?? "0");
      const to = Number(digit.dataset.d);
      rolling.current.get(digit)?.stop();
      rolling.current.delete(digit);
      const roll = (v: number): void => digit.style.setProperty("--roll", String(v));
      roll(from);
      rolling.current.set(digit, tween(from, to, MEDIUM, roll, { delay: ROLL_DELAY, onComplete: () => rolling.current.delete(digit) }));
    });
  }, [text, reduced]);
  useLayoutEffect(() => () => rolling.current.forEach((m) => m?.stop()), []);
  if (reduced) return <span className={className}>{text}</span>;
  const count = text.replace(/\D/g, "").length;
  let seen = 0;
  return (
    <span ref={ref} className={`odo ${className ?? ""}`}>
      {Array.from(text, (ch, i) => {
        if (!/\d/.test(ch)) return <span key={`s${i}-${ch}`} className="odo__sep">{ch}</span>;
        seen += 1;
        return <span key={`d${count - seen}`} className="odo__digit" data-d={ch} style={{ "--roll": ch } as CSSProperties}>{ch}</span>;
      })}
    </span>
  );
}

function railText(quote: Quote): string {
  return `Month ${quote.month} of ${quote.term_months}: equity ${formatMoney(quote.equity_cents)}, ${quote.tier.label}, payoff ${formatMoney(quote.payoff_cents)}`;
}

interface RailProps {
  quotes: Quote[] | "failed" | null;
  currentMonth: number;
  tiers: Tier[];
  month: number;
  reduced: boolean;
  onMonth: (month: number) => void;
  onRelease: (month: number) => void;
}

export function BuyoutRail({ quotes, currentMonth, tiers, month, reduced, onMonth, onRelease }: RailProps): ReactNode {
  const band = useBand();
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const tierRef = useRef<HTMLSpanElement>(null);
  const boundaryRefs = useRef(new Map<number, HTMLSpanElement>());
  const gesture = useRef<{ id: number; x: number; y: number; touch: boolean; dragging: boolean } | null>(null);
  const [notice, setNotice] = useState<Notice>(quiet);
  const previousMonth = useRef(month);
  /** Where the handle is drawn, in months, and the notch its spring is heading for. */
  const position = useRef<number | null>(null);
  const heading = useRef<number | null>(null);
  const springing = useRef<Motion>(null);
  const tierMotions = useRef<Motion[]>([]);
  const loaded = Array.isArray(quotes) ? quotes : null;
  const term = loaded ? loaded.length - 1 : 0;
  const quote = loaded?.[month];

  const place = (months: number): void => {
    position.current = months;
    if (handle.current && term > 0) handle.current.style.left = `${(months / term) * 100}%`;
  };
  const settleTo = (n: number): void => {
    springing.current?.stop();
    heading.current = n;
    const width = track.current?.getBoundingClientRect().width ?? 0;
    springing.current = spring(position.current ?? n, n, term > 0 ? width / term : 0, place);
  };

  useLayoutEffect(() => {
    if (reduced || !loaded || gesture.current?.dragging) return;
    if (position.current === null || handle.current?.style.left === "") {
      heading.current = month;
      place(month);
    } else if (heading.current !== month) settleTo(month);
  });

  useLayoutEffect(() => () => {
    springing.current?.stop();
    tierMotions.current.forEach((m) => m?.stop());
  }, []);

  useLayoutEffect(() => {
    const from = previousMonth.current;
    previousMonth.current = month;
    if (reduced || !loaded || from === month) return;
    const tierOf = (n: number): Tier | undefined => tiers.find((t) => t.from_month <= n && (t.to_month === null || n <= t.to_month));
    if (tierOf(from) === tierOf(month)) return;
    tierMotions.current.forEach((m) => m?.stop());
    const label = tierRef.current;
    const motions: Motion[] = [];
    if (label) {
      label.style.opacity = "0";
      motions.push(tween(0, 1, QUICK, (v) => { label.style.opacity = String(v); }, { delay: TIER_DELAY }));
    }
    const crossed = from < month ? tiers.filter((t) => t.from_month > from && t.from_month <= month)
      : tiers.filter((t) => t.from_month > month && t.from_month <= from);
    for (const tier of crossed) {
      const rule = boundaryRefs.current.get(tier.from_month);
      if (!rule) continue;
      motions.push(tween(0, 1, QUICK, (v) => {
        rule.style.backgroundColor = v === 1 ? "" : `color-mix(in srgb, var(--ink) ${Math.round((1 - v) * 100)}%, var(--rule))`;
      }, { delay: TIER_DELAY }));
    }
    tierMotions.current = motions;
  }, [month, reduced, loaded, tiers]);

  if (quotes === "failed") {
    return (
      <section className="rail rail--failed" aria-label="Buyout rail">
        <h2 className="rail__title">Buyout rail</h2>
        <div role="slider" aria-label="Buyout month" aria-disabled="true" aria-valuemin={0} aria-valuemax={0} aria-valuenow={0} className="rail__handle rail__handle--disabled" />
        <Status label="Payoff quote" notice={{ text: "Couldn't load the payoff schedule. Reload to try again.", tone: "error" }} />
      </section>
    );
  }
  if (!loaded || !quote) {
    return (
      <section className="rail" aria-label="Buyout rail">
        <h2 className="rail__title">Buyout rail</h2>
        <p className="muted">Loading the payoff schedule…</p>
        <Status label="Payoff quote" notice={quiet} />
      </section>
    );
  }

  const release = (n: number): void => {
    const q = loaded[n];
    setNotice(info(`Month ${n} payoff ${formatMoney(q.payoff_cents)}. Quote valid until ${formatDate(q.valid_until)}.`));
    onRelease(n);
  };

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    const moves: Record<string, number> = {
      ArrowLeft: month - 1, ArrowDown: month - 1, ArrowRight: month + 1, ArrowUp: month + 1,
      PageDown: month - STEP_PAGE, PageUp: month + STEP_PAGE, Home: 0, End: term,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = Math.min(term, Math.max(0, moves[event.key]));
    onMonth(next);
    if (!reduced) settleTo(next);
    release(next);
  };

  /** The pointer's place along the rail in months, unrounded. */
  const monthsAt = (clientX: number): number => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return month;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * term;
  };
  const follow = (clientX: number): void => {
    springing.current?.stop();
    heading.current = null;
    const at = monthsAt(clientX);
    place(at);
    onMonth(Math.round(at));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const touch = event.pointerType === "touch";
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, touch, dragging: !touch };
    if (!touch) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      handle.current?.focus();
      follow(event.clientX);
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    if (g.touch && !g.dragging) {
      const dx = Math.abs(event.clientX - g.x);
      if (dx < 6 || dx <= Math.abs(event.clientY - g.y)) return;
      g.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (g.dragging) follow(event.clientX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== event.pointerId) return;
    const n = Math.round(monthsAt(g.dragging ? event.clientX : g.x));
    onMonth(n);
    settleTo(n);
    release(n);
  };

  const pct = (n: number): string => `${(n / term) * 100}%`;
  const valueText = railText(quote);
  const figures = (
    <div className="rail__figures">
      <p className="rail__figure"><span className="rail__label">Equity</span>{" "}
        <Odometer text={formatMoney(quote.equity_cents)} reduced={reduced} className="figure equity" /></p>
      <p className="rail__figure"><span className="rail__label">Payoff</span>{" "}
        <Odometer text={formatMoney(quote.payoff_cents)} reduced={reduced} className="figure" /></p>
      <p className="rail__figure rail__tier"><span className="rail__label">Tier</span>{" "}
        <span ref={tierRef} className="rail__tier-label">{quote.tier.label}</span></p>
    </div>
  );

  if (reduced) {
    return (
      <section className={`rail rail--reduced ${band === "narrow" ? "" : "rail--beside"}`} aria-label="Buyout rail">
        <div className="rail__main">
          <h2 className="rail__title">Buyout rail</h2>
          {figures}
          <input type="range" className="rail__range" min={0} max={term} step={1} value={month} aria-label="Buyout month"
            aria-valuetext={valueText} aria-valuenow={month}
            onChange={(event) => {
              const n = Number(event.currentTarget.value);
              onMonth(n);
              release(n);
            }}
            onKeyDown={step} />
          <div className="rail__bands rail__bands--plain" aria-hidden="true">
            {tiers.map((t) => <span key={t.from_month} className="rail__band-label">{t.name}</span>)}
          </div>
          <Status label="Payoff quote" notice={notice} />
        </div>
        <table role="table" className="schedule" aria-label="Buyout schedule" tabIndex={0}>
          <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Month</th><th scope="col" role="columnheader">Equity</th><th scope="col" role="columnheader">Tier</th><th scope="col" role="columnheader">Payoff</th></tr></thead>
          <tbody role="rowgroup">
            {loaded.map((q) => (
              <tr role="row" key={q.month} className={q.month === currentMonth ? "schedule__now" : q.month === month ? "schedule__chosen" : ""}>
                <td role="cell" className="figure">{q.month}{q.month === currentMonth ? " (now)" : ""}</td>
                <td role="cell" className="figure equity">{formatMoney(q.equity_cents)}</td>
                <td role="cell">{q.tier.label}</td>
                <td role="cell" className="figure">{formatMoney(q.payoff_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="rail" aria-label="Buyout rail">
      <h2 className="rail__title">Buyout rail</h2>
      {figures}
      <div className="rail__bands" aria-hidden="true">
        {tiers.map((t, i) => {
          const end = t.to_month === null ? term : Math.min(term, t.to_month + 1);
          if (t.from_month > term) return null;
          return (
            <span key={t.from_month} className={`rail__band rail__band--${i % 2 === 0 ? "a" : "b"}`}
              style={{ left: pct(t.from_month), width: `calc(${pct(end)} - ${pct(t.from_month)})` }}>
              {band !== "narrow" && <span className="rail__band-label">{t.name}</span>}
            </span>
          );
        })}
      </div>
      {band === "narrow" && (
        <ul className="rail__legend" aria-hidden="true">
          {tiers.filter((t) => t.from_month <= term).map((t, i) => (
            <li key={t.from_month}>
              <span className={`rail__swatch rail__band--${i % 2 === 0 ? "a" : "b"}`} />
              <span className="rail__band-label">{t.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div ref={track} className="rail__track" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={() => { gesture.current = null; }}>
        <svg className="rail__notches" viewBox={`0 0 ${term * 10} 40`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {loaded.map((q) => (
            <line key={q.month} x1={q.month * 10} x2={q.month * 10} y1={q.month % 12 === 0 ? 4 : 12} y2={36}
              className={q.month <= currentMonth ? "notch notch--paid" : "notch notch--future"} />
          ))}
        </svg>
        {tiers.filter((t) => t.from_month > 0 && t.from_month <= term).map((t) => (
          <span key={t.from_month} className="rail__boundary" style={{ left: pct(t.from_month) }}
            ref={(node) => { if (node) boundaryRefs.current.set(t.from_month, node); else boundaryRefs.current.delete(t.from_month); }} />
        ))}
        <div ref={handle} role="slider" tabIndex={0} aria-label="Buyout month" aria-valuemin={0} aria-valuemax={term}
          aria-valuenow={month} aria-valuetext={valueText} className="rail__handle"
          onKeyDown={step}>
          <span className="rail__knob" aria-hidden="true" />
        </div>
      </div>
      <div className="rail__scale" aria-hidden="true">
        {loaded.filter((q) => q.month % 12 === 0 || q.month === term).map((q) => (
          <span key={q.month} className="figure" style={{ left: pct(q.month) }}>{q.month}</span>
        ))}
      </div>
      <Status label="Payoff quote" notice={notice} />
    </section>
  );
}
