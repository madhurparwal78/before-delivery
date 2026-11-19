import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { BlockDetail, BlockShares } from "../../shared/api.ts";
import { cssVarsOf } from "../lib/cssVars.ts";
import { namespaceStyle } from "../lib/namespaceStyle.ts";
import { useReducedMotion } from "../lib/motion.ts";

type CardState = "hidden" | "rising" | "shown";

const STAGGER_MS = 100;
const RISE_MS = 600;
const TITLES = ["Lay out", "Extend", "Commit"] as const;
const VIEW = 240;

function StageFigure({ stage, shares, mine }: { stage: number; shares: BlockShares; mine: ReadonlySet<string> }) {
  const k = shares.k;
  const side = stage === 0 ? k : k * 2;
  const unit = VIEW / side;
  const hatch = useId();
  if (stage === 2) {
    const ticks = Array.from({ length: side }, (_, i) => i);
    return (
      <svg viewBox={`0 0 ${VIEW + 20} ${VIEW + 20}`} className="walk__figure" aria-hidden="true" focusable="false">
        <g className="stage-grid">
          {ticks.flatMap((r) => ticks.map((c) => <rect key={`${r}-${c}`} x={c * unit + 0.5} y={r * unit + 0.5} width={unit - 1} height={unit - 1} className="stage-cell stage-cell--faint" />))}
        </g>
        <rect x="0" y="0" width={VIEW} height={VIEW} className="stage-frame draw" pathLength={1} />
        {ticks.map((i) => (
          <line key={`r${i}`} x1={VIEW + 2} x2={VIEW + 14} y1={unit * (i + 0.5)} y2={unit * (i + 0.5)} className="stage-tick draw" pathLength={1}
            style={cssVarsOf({ "--d": i * 30 })} />
        ))}
        {ticks.map((i) => (
          <line key={`c${i}`} y1={VIEW + 2} y2={VIEW + 14} x1={unit * (i + 0.5)} x2={unit * (i + 0.5)} className="stage-tick draw" pathLength={1}
            style={cssVarsOf({ "--d": i * 30 })} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="walk__figure" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="#7A8AA0" strokeWidth="0.8" />
        </pattern>
      </defs>
      {shares.rows.slice(0, side).flatMap((cells, r) =>
        cells.slice(0, side).map((cell, c) => (
          <rect key={`${r}-${c}`} x={c * unit + 1} y={r * unit + 1} width={unit - 2} height={unit - 2} pathLength={1}
            className={`stage-cell draw stage-cell--${cell.kind}`} data-mine={mine.has(`${r},${c}`) ? "true" : undefined}
            style={{ ...(cell.kind === "blob" ? namespaceStyle(cell.namespace) : {}), ...(cell.kind === "parity" ? { fill: `url(#${hatch})` } : {}), ...cssVarsOf({ "--d": (r + c) * 24 }) }} />
        )),
      )}
    </svg>
  );
}

const COPY = [
  (k: number) => `Blobs become shares, ordered by namespace and laid row by row into this block's ${k} × ${k} original square.`,
  (k: number) => `Reed-Solomon parity grows it to ${k * 2} × ${k * 2}: row parity, column parity, then parity of parity.`,
  () => "Every row and every column gets a namespaced Merkle root. Together they commit to the data root.",
];

/** The block page's signature: three cards that rise in, activate by scroll third, hover or focus, and draw this block's stages. */
export function SquareWalk({ block, shares, meId }: { block: BlockDetail; shares: BlockShares; meId: string }) {
  const reduced = useReducedMotion();
  const k = shares.k;
  const mine = new Set(block.blobs.filter((blob) => blob.sender === meId).flatMap((blob) => blob.positions.map(([r, c]) => `${r},${c}`)));
  const [states, setStates] = useState<CardState[]>(reduced ? ["shown", "shown", "shown"] : ["hidden", "hidden", "hidden"]);
  const [scrolled, setScrolled] = useState(0);
  const [pointed, setPointed] = useState<number | null>(null);
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const triggered = useRef(reduced);
  const scrolledRef = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const setState = (index: number, value: CardState) => {
      flushSync(() => setStates((old) => old.map((state, i) => (i === index ? value : state))));
    };
    const start = () => {
      triggered.current = true;
      setState(0, "rising");
      TITLES.forEach((_, index) => {
        if (index > 0) timers.current.push(window.setTimeout(() => setState(index, "rising"), index * STAGGER_MS));
        timers.current.push(window.setTimeout(() => setState(index, "shown"), index * STAGGER_MS + RISE_MS));
      });
    };

    const read = (flush: boolean) => {
      const root = section.current;
      const cards = list.current;
      if (!root || !cards) return;
      if (!triggered.current && cards.getBoundingClientRect().top <= window.innerHeight * 0.8) {
        if (flush) start();
        else window.setTimeout(start, 0);
        triggered.current = true;
      }
      let next = 0;
      if (window.matchMedia("(max-width: 767px)").matches) {
        cards.querySelectorAll("article").forEach((card, index) => {
          const rect = card.getBoundingClientRect();
          if (rect.top + rect.height / 2 <= window.innerHeight / 2) next = index;
        });
      } else {
        const rect = root.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        const progress = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
        next = progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2;
      }
      if (next !== scrolledRef.current) {
        scrolledRef.current = next;
        if (flush) flushSync(() => setScrolled(next));
        else setScrolled(next);
      }
    };

    read(false);
    const onScroll = () => read(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const poll = window.setInterval(onScroll, 16);
    const pending = timers.current;
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearInterval(poll);
      pending.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const active = pointed ?? scrolled;
  return (
    <section ref={section} className="walk" aria-labelledby="walk-title">
      <div className="walk__stage">
        <h2 id="walk-title" className="section-title walk__title">Square walk</h2>
        <ol ref={list} aria-label="Square walk" className="walk__list">
          {TITLES.map((title, index) => (
            <li key={title} className="walk__item">
              <article tabIndex={0} aria-label={title} data-state={states[index]} aria-current={active === index ? "step" : undefined}
                data-cells={index === 0 ? k * k : index === 1 ? (2 * k) ** 2 : undefined} data-ticks={index === 2 ? 4 * k : undefined}
                className="walk__card" onMouseEnter={() => setPointed(index)} onMouseLeave={() => setPointed(null)}
                onFocus={() => setPointed(index)} onBlur={() => setPointed(null)}>
                <div className="walk__media" data-drawn={states[index] !== "hidden" ? "true" : "false"}>
                  <StageFigure stage={index} shares={shares} mine={mine} />
                </div>
                <div className="walk__text">
                  <h3>{title}</h3>
                  <p>{COPY[index]?.(k)}</p>
                </div>
                {index === 2 && <p className="walk__root">Data root <code>{block.dataRoot}</code></p>}
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
