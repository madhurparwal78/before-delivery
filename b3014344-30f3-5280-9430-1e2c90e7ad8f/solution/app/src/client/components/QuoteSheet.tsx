import { useEffect, useRef, useState, type CSSProperties } from "react";
import { settle, tween, useReducedMotion } from "../lib/motion";
import { COPY } from "../../shared/copy";
import { formatMoney, parseAmount, type Currency } from "../../shared/money";

// The fold-line quote: the crease divides due now from due at launch (or credit from new plan
// charge). A request folds the sheet flat; an answer slides the crease to the server's share, tilts
// the panels open to 18°, then counts the numerals from the values on screen to the server's figures.

export interface SheetFigures {
  currency: Currency;
  first: string;
  second: string;
  total: string;
  share: string;
}

export type SheetState = "quoting" | "ready" | "outage";

const TILT_OPEN = 18;
const FOLD_MS = 200;
const CREASE_MS = 333;
const COUNT_MS = 667;

interface Shown {
  first: bigint;
  second: bigint;
  crease: number;
  tilt: number;
}

function between(from: bigint, to: bigint, progress: number): bigint {
  return from + ((to - from) * BigInt(Math.round(progress * 1000))) / 1000n;
}

/** On screen the crease never pins a panel shut: its position maps the share into 22%–78% of the sheet. */
function visualCrease(share: number): number {
  return 22 + share * 0.56;
}

export function QuoteSheet(props: {
  state: SheetState;
  figures: SheetFigures | null;
  labels: [string, string];
  outageCopy: string;
  note?: string;
}) {
  const { state, figures, labels, outageCopy, note } = props;
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<Shown>({ first: 0n, second: 0n, crease: 0, tilt: 0 });
  const live = useRef(shown);
  live.current = shown;
  const cancel = useRef<() => void>(() => undefined);

  useEffect(() => {
    cancel.current();
    const from = live.current;
    if (state !== "ready" || !figures) {
      if (reduced || from.tilt === 0) {
        setShown({ ...from, tilt: 0 });
        return;
      }
      cancel.current = tween(FOLD_MS, (p) => setShown({ ...from, tilt: from.tilt * (1 - settle(p)) }));
      return () => cancel.current();
    }
    const target = { first: parseAmount(figures.first)!, second: parseAmount(figures.second)!, crease: Number(figures.share) };
    if (reduced) {
      setShown({ ...target, tilt: 0 });
      return;
    }
    const start = { ...from, tilt: 0 };
    cancel.current = tween(
      CREASE_MS,
      (p) => {
        const e = settle(p);
        setShown({ ...start, crease: start.crease + (target.crease - start.crease) * e, tilt: TILT_OPEN * e });
      },
      () => {
        setShown({ ...start, crease: target.crease, tilt: TILT_OPEN });
        cancel.current = tween(COUNT_MS, (p) => {
          const e = p >= 1 ? 1 : settle(p);
          setShown({ first: between(start.first, target.first, e), second: between(start.second, target.second, e), crease: target.crease, tilt: TILT_OPEN });
        });
      },
    );
    return () => cancel.current();
  }, [state, figures, reduced]);

  const currency = figures?.currency ?? "USD";
  const amounts = state === "ready" && figures !== null;
  // The currency code sits on its own small line above the digits; the text still reads "ARS 2.350.617,28".
  const value = (minor: bigint) => {
    const text = formatMoney(minor, currency);
    const gap = text.indexOf(" ");
    return (
      <span className="mono amount">
        <span className="amount__code">{text.slice(0, gap + 1)}</span>
        <span className="amount__digits">{text.slice(gap + 1)}</span>
      </span>
    );
  };
  const crease = shown.crease.toFixed(1);
  const tilt = shown.tilt.toFixed(1);

  if (reduced) {
    return (
      <section aria-label="Quote" className="quote quote--table" data-state={state} data-crease={crease} data-tilt="0">
        {state === "outage" ? (
          <p className="quote__outage">{outageCopy}</p>
        ) : (
          <table aria-label="Quote" className="quote-table">
            <thead>
              <tr>
                <th scope="col">{labels[0]}</th>
                <th scope="col">{labels[1]}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{amounts ? value(shown.first) : COPY.quoting}</td>
                <td>{amounts ? value(shown.second) : COPY.quoting}</td>
              </tr>
              <tr className="quote-table__total">
                <td colSpan={2}>Total {amounts ? value(shown.first + shown.second) : null}</td>
              </tr>
            </tbody>
          </table>
        )}
        {note ? <p className="quote__note">{note}</p> : null}
      </section>
    );
  }

  const position = `${visualCrease(shown.crease)}%`;
  return (
    <section
      aria-label="Quote"
      className={`quote quote--${state}`}
      data-state={state}
      data-crease={crease}
      data-tilt={tilt}
      style={{ "--crease": position, "--tilt": `${shown.tilt}deg`, "--fold": `${shown.tilt / TILT_OPEN}` } as CSSProperties}
    >
      <div className="sheet">
        <div className="sheet__panel sheet__panel--first">
          <div role="group" aria-label={labels[0]} className="sheet__figure">
            <span className="sheet__label">{labels[0]}</span>
            {amounts ? value(shown.first) : <span className="sheet__blank" aria-hidden="true" />}
          </div>
        </div>
        <div className="sheet__crease" aria-hidden="true" />
        <div className="sheet__panel sheet__panel--second">
          <div role="group" aria-label={labels[1]} className="sheet__figure">
            <span className="sheet__label">{labels[1]}</span>
            {amounts ? value(shown.second) : <span className="sheet__blank" aria-hidden="true" />}
          </div>
        </div>
        {state === "quoting" ? <p className="sheet__message">{COPY.quoting}</p> : null}
        {state === "outage" ? <p className="sheet__message sheet__message--outage">{outageCopy}</p> : null}
      </div>
      <p className="quote__total">Total {amounts ? value(shown.first + shown.second) : null}</p>
      {note ? <p className="quote__note">{note}</p> : null}
    </section>
  );
}
