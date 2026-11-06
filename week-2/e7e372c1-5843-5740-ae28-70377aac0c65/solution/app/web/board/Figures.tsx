import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CLOCK_BADGES } from "../copy.ts";
import { FULL, WIDE, prefersReducedMotion, useMediaQuery } from "../hooks.ts";
import { Panel, asOfText, liveTime } from "./Panel.tsx";
import { anchorThreads, cancelRunning, filedInputs, neighbour, playClosing, playOpening } from "./unspool.ts";
import { FIGURE_KEYS, FIGURE_LABELS, type Computation, type ComputationInput, type FigureKey } from "../../shared/domain.ts";
import { isoWallClock, isoWallDate } from "../../shared/newyork.ts";

type Phase = "opening" | "open" | "closing";

interface Trace {
  figure: FigureKey;
  computation: Computation;
  selected: string;
  phase: Phase;
  reduced: boolean;
}

interface FiguresProps {
  figures: Computation[] | null;
  /** The board's market date: present on the board, where the trace links to the citation. */
  marketDate: string | null;
  restore?: { figure: FigureKey; step: string } | null;
  onStep?: (figure: FigureKey, step: string | null) => void;
  only?: FigureKey;
}

const OPERATORS: Partial<Record<FigureKey, string[]>> = {
  "eth-held": ["+", "+"],
  "eth-per-1000-diluted": ["÷"],
};

const FORMULA_LINE: Partial<Record<FigureKey, string>> = {
  mnav: "mNAV = (share price × diluted shares) ÷ (ending ETH balance × ETH price)",
};

function badgeOf(computation: Computation): string {
  const setter = computation.inputs.find((input) => input.sets_as_of) ?? computation.inputs[0];
  return setter ? CLOCK_BADGES[setter.clock] : "";
}

function NumeralText({ display }: { display: string }) {
  const space = display.indexOf(" ");
  if (space < 0) return <span className="digits">{display}</span>;
  return (
    <>
      <span className="digits">{display.slice(0, space)}</span>
      <span className="unit">{display.slice(space)}</span>
    </>
  );
}

function Chip({ input, selected, onSelect }: { input: ComputationInput; selected: boolean; onSelect: (key: string) => void }) {
  const tick = liveTime(input);
  const classes = ["chip", input.sets_as_of ? "sets-as-of" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
  return (
    <div className={classes} data-unspool-chip={input.key} aria-hidden="true" onClick={() => onSelect(input.key)}>
      <span className="chip-label">{input.label}</span>
      <span className="badge">{CLOCK_BADGES[input.clock]}</span>
      <span className="chip-time">{tick ?? asOfText(input)}</span>
    </div>
  );
}

function Strip({ trace, hasPanel, onSelect }: { trace: Trace; hasPanel: boolean; onSelect: (key: string) => void }) {
  const operators = OPERATORS[trace.figure] ?? [];
  const formula = FORMULA_LINE[trace.figure];
  const inputs = trace.computation.inputs;
  if (trace.reduced) {
    return (
      <div className="strip reduced" style={{ gridColumn: "1 / -1" }}>
        <ol>
          {inputs.map((input) => (
            <li key={input.key}>
              <Chip input={input} selected={input.key === trace.selected} onSelect={onSelect} />
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div className={hasPanel ? "strip has-panel" : "strip"}>
      {formula && <p className="formula" aria-hidden="true">{formula}</p>}
      {inputs.map((input, index) => (
        <Fragment key={input.key}>
          <Chip input={input} selected={input.key === trace.selected} onSelect={onSelect} />
          {operators[index] && index < inputs.length - 1 && <span className="operator" aria-hidden="true">{operators[index]}</span>}
          {trace.figure === "eth-per-1000-diluted" && index === inputs.length - 1 && <span className="operator" aria-hidden="true">× 1,000</span>}
        </Fragment>
      ))}
    </div>
  );
}

function TileFace({ display, badge, asOf, citation, hidden }: { display: string; badge: string; asOf: string; citation: string; hidden: boolean }) {
  return (
    <>
      <span className="numeral-rule" hidden={hidden} aria-hidden="true">
        <span className="numeral" data-numeral>
          <NumeralText display={display} />
        </span>
      </span>
      <span className="tile-meta" aria-hidden="true">
        <span className="badge">{badge}</span>
        <span className="asof">{asOf}</span>
        <span className="citation">{citation}</span>
      </span>
    </>
  );
}

function Tile({ computation, hidden, buttonRef, onOpen }: { computation: Computation; hidden: boolean; buttonRef: (node: HTMLButtonElement | null) => void; onOpen: () => void }) {
  const asOf = `As of ${isoWallDate(computation.as_of)} ${isoWallClock(computation.as_of, true)} ET`;
  const citation = `Accession ${computation.exhibit.accession} · p. ${computation.exhibit.page}`;
  const badge = badgeOf(computation);
  const describedBy = `tile-summary-${computation.figure}`;
  return (
    <article className="tile" data-figure={computation.figure}>
      <h3 className="tile-label">{computation.label}</h3>
      <button type="button" className="tile-button" aria-describedby={describedBy} ref={buttonRef} onClick={onOpen}>
        <span className="visually-hidden">{`Unspool ${computation.label}`}</span>
        <TileFace display={computation.display} badge={badge} asOf={asOf} citation={citation} hidden={hidden} />
      </button>
      <span id={describedBy} className="visually-hidden">
        {computation.display}. {badge}. {asOf}. {citation}.
      </span>
    </article>
  );
}

function Placeholder({ figure }: { figure: FigureKey }) {
  return (
    <article className="tile ghost" aria-hidden="true">
      <h3 className="tile-label">{FIGURE_LABELS[figure]}</h3>
      <div className="tile-button">
        <TileFace display="000,000.000 ETH" badge="Holdings week" asOf="As of 0000-00-00 00:00:00 ET" citation="Accession 0000000000-00-000000 · p. 0" hidden={false} />
      </div>
    </article>
  );
}

export function Figures({ figures, marketDate, restore, onStep, only }: FiguresProps) {
  const wide = useMediaQuery(WIDE);
  const full = useMediaQuery(FULL);
  const [trace, setTrace] = useState<Trace | null>(null);
  const traceRef = useRef<Trace | null>(null);
  traceRef.current = trace;
  const buttons = useRef(new Map<FigureKey, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restored = useRef(false);

  const updateTrace = useCallback((change: (current: Trace) => Trace) => {
    setTrace((current) => (current ? change(current) : current));
  }, []);

  const open = useCallback((figure: FigureKey, computation: Computation) => {
    if (traceRef.current) return;
    const first = computation.inputs[0];
    if (!first) return;
    setTrace({ figure, computation, selected: first.key, phase: "opening", reduced: prefersReducedMotion() });
  }, []);

  const close = useCallback(() => {
    const current = traceRef.current;
    if (!current || current.phase === "closing") return;
    buttons.current.get(current.figure)?.focus({ preventScroll: true });
    onStep?.(current.figure, null);
    setTrace({ ...current, phase: "closing" });
  }, [onStep]);

  // restore an open trace from a citation URL, with no opening sequence
  useEffect(() => {
    if (restored.current || !restore || !figures) return;
    const computation = figures.find((candidate) => candidate.figure === restore.figure);
    if (!computation || !computation.inputs.some((input) => input.key === restore.step)) return;
    restored.current = true;
    setTrace({ figure: restore.figure, computation, selected: restore.step, phase: "open", reduced: prefersReducedMotion() });
  }, [figures, restore]);

  // a trace that appears takes focus on its selected input
  useLayoutEffect(() => {
    if (!trace) return;
    panelRef.current?.querySelector<HTMLElement>('.input-button[aria-pressed="true"]')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.figure]);

  // opening: play the sequence (a reduced-motion trace appears in place)
  useLayoutEffect(() => {
    if (!trace || trace.phase !== "opening") return;
    const panel = panelRef.current;
    if (!panel) return;
    if (trace.reduced) {
      updateTrace((current) => ({ ...current, phase: "open" }));
      return;
    }
    const threadsDrawn = wide;
    anchorThreads(panel);
    let live = true;
    const frames = { id: 0 };
    const follow = (): void => {
      anchorThreads(panel);
      if (live) frames.id = window.requestAnimationFrame(follow);
    };
    frames.id = window.requestAnimationFrame(follow);
    const numeral = document.querySelector(`[data-figure="${trace.figure}"] [data-numeral]`);
    void playOpening(panel, numeral, wide ? "right" : "bottom", threadsDrawn).then(() => {
      live = false;
      window.cancelAnimationFrame(frames.id);
      anchorThreads(panel);
      updateTrace((current) => (current.phase === "opening" ? { ...current, phase: "open" } : current));
    });
    return () => {
      live = false;
      window.cancelAnimationFrame(frames.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.phase === "opening" ? trace.figure : null]);

  // closing: reverse the sequence, then remove everything
  useLayoutEffect(() => {
    if (!trace || trace.phase !== "closing") return;
    const panel = panelRef.current;
    if (trace.reduced || !panel) {
      setTrace(null);
      return;
    }
    cancelRunning();
    const numeral = document.querySelector(`[data-figure="${trace.figure}"] [data-numeral]`);
    void playClosing(panel, numeral, wide ? "right" : "bottom").then(() => setTrace(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace?.phase === "closing"]);

  // keep every thread on its chip and row through resize and scroll, without replaying the draw
  useEffect(() => {
    if (!trace || trace.reduced || !wide) return;
    const panel = panelRef.current;
    if (!panel) return;
    const reanchor = (): void => anchorThreads(panel);
    reanchor();
    window.addEventListener("scroll", reanchor, true);
    window.addEventListener("resize", reanchor);
    const observer = new ResizeObserver(reanchor);
    observer.observe(panel);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", reanchor, true);
      window.removeEventListener("resize", reanchor);
      observer.disconnect();
    };
  }, [trace?.figure, trace?.reduced, trace?.phase, wide]);

  // Escape and clicks outside the panel close the trace
  useEffect(() => {
    if (!trace) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onPointer = (event: MouseEvent): void => {
      if (!wide || !(event.target instanceof Element)) return;
      if (event.target.closest(".trace-panel, [data-unspool-chip], .strip, .modal-backdrop, .tile-button")) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onPointer);
    };
  }, [trace !== null, wide, close]);

  // a bottom sheet stops the page behind it from scrolling
  useEffect(() => {
    if (!trace || wide) return;
    document.documentElement.classList.add("sheet-open");
    return () => document.documentElement.classList.remove("sheet-open");
  }, [trace !== null, wide]);

  // the citation URL names the selected input
  useEffect(() => {
    if (trace && trace.phase !== "closing") onStep?.(trace.figure, trace.selected);
  }, [trace?.figure, trace?.selected, trace?.phase === "closing"]);

  const select = useCallback((key: string) => updateTrace((current) => ({ ...current, selected: key })), [updateTrace]);
  const step = useCallback((direction: 1 | -1) => updateTrace((current) => ({ ...current, selected: neighbour(current.computation, current.selected, direction) })), [updateTrace]);

  const shown = (figure: FigureKey): Computation | undefined => (trace?.figure === figure ? trace.computation : figures?.find((candidate) => candidate.figure === figure));
  const order = only ? [only] : FIGURE_KEYS;
  const columns = full ? 4 : wide ? 2 : 1;
  const traced = trace ? order.indexOf(trace.figure) : -1;
  const stripAfter = traced < 0 ? -1 : Math.min(order.length - 1, Math.floor(traced / columns) * columns + columns - 1);
  const cite = trace && marketDate ? `/cite/${trace.figure}/${marketDate}?step=${encodeURIComponent(trace.selected)}` : null;
  const threadsShown = trace !== null && wide && !trace.reduced;

  return (
    <section className="figures" aria-label="Figures">
      {order.map((figure, index) => {
        const computation = shown(figure);
        return (
          <Fragment key={figure}>
            {computation ? (
              <Tile
                computation={computation}
                hidden={trace?.reduced === true && trace.figure === figure}
                buttonRef={(node) => {
                  if (node) buttons.current.set(figure, node);
                  else buttons.current.delete(figure);
                }}
                onOpen={() => open(figure, computation)}
              />
            ) : (
              <Placeholder figure={figure} />
            )}
            {trace && index === stripAfter && <Strip trace={trace} hasPanel={wide} onSelect={select} />}
          </Fragment>
        );
      })}
      {trace && (
        <>
          <Panel ref={panelRef} computation={trace.computation} selected={trace.selected} citeHref={cite} closing={trace.phase === "closing"} onSelect={select} onClose={close} onStep={step} />
          {threadsShown && (
            <svg className="threads" aria-hidden="true" focusable="false">
              {filedInputs(trace.computation).map((input) => (
                <path key={input.key} data-unspool-thread={input.key} pathLength={1} d="" />
              ))}
            </svg>
          )}
        </>
      )}
    </section>
  );
}
