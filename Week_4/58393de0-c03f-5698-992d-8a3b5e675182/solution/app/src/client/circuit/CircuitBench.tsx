import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Play, Square } from "lucide-react";
import { MINUS, copy } from "../../shared/copy";
import type { CircuitPartType } from "../../shared/types";
import type { EditorProps } from "../editors/contract";
import { useStatus } from "../lib/status";
import { Breadboard } from "./Breadboard";
import { PartCard, type PartActions } from "./PartCard";
import { Readouts, WireList, type WireListHandle } from "./Panels";
import { PART_ICONS } from "./partIcons";
import { PART_NAMES, PART_TYPES, addPart, connect, endName, parseEnd, removePart, removeWire, signGlyph, updatePart } from "./model";
import { viewOf } from "./readouts";
import { useCircuitDocument } from "./useCircuitDocument";
import { useSimulation } from "./useSimulation";
import { useTerminalDrag } from "./useTerminalDrag";
import "./circuit.css";

const NARROW = "(max-width: 599px)";
const WIDE = "(min-width: 1024px)";

/** How many slots a breadboard row holds at the current width. */
function useBoardColumns(): number {
  const [columns, setColumns] = useState(() => (window.matchMedia(NARROW).matches ? 2 : window.matchMedia(WIDE).matches ? 3 : 4));
  useEffect(() => {
    const queries = [window.matchMedia(NARROW), window.matchMedia(WIDE)] as const;
    const update = () => setColumns(queries[0].matches ? 2 : queries[1].matches ? 3 : 4);
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return columns;
}

function Bench(props: EditorProps) {
  const { readOnly } = props;
  const { announce } = useStatus();
  const doc = useCircuitDocument(props);
  const sim = useSimulation(doc);
  const columns = useBoardColumns();
  const { circuit, edit, seal } = doc;
  const [pending, setPending] = useState<string | null>(null);
  const groups = useRef(new Map<string, HTMLDivElement>());
  const partsToolbar = useRef<HTMLDivElement>(null);
  const wireList = useRef<WireListHandle>(null);
  const focusAfterRender = useRef<string | null>(null);
  const wireFocusAfterRender = useRef<number | null>(null);

  const views = useMemo(() => circuit.components.map((part) => viewOf(part, sim.solution)), [circuit.components, sim.solution]);
  const viewByLabel = useMemo(() => new Map(views.map((view) => [view.label, view])), [views]);

  useLayoutEffect(() => {
    const label = focusAfterRender.current;
    if (label === null) return;
    focusAfterRender.current = null;
    groups.current.get(label)?.focus();
  }, [circuit.components]);

  useLayoutEffect(() => {
    const index = wireFocusAfterRender.current;
    if (index === null) return;
    wireFocusAfterRender.current = null;
    wireList.current?.focusNear(index);
  }, [circuit.wires]);

  const pendingLabel = pending ? parseEnd(pending)?.label : undefined;
  useEffect(() => {
    if (pendingLabel !== undefined && !circuit.components.some((c) => c.label === pendingLabel)) setPending(null);
  }, [pendingLabel, circuit.components]);

  const wire = useCallback((from: string, to: string) => {
    setPending(null);
    const joined = connect(doc.latest.current, from, to);
    if (joined.outcome === "duplicate") {
      announce(copy.alreadyWired);
      return;
    }
    if (joined.outcome === "wired" && edit(() => joined.circuit)) announce(copy.wired(endName(from), endName(to)));
  }, [announce, doc.latest, edit]);

  const terminal = useCallback((end: string) => {
    if (readOnly) return;
    if (pending === null) {
      const ref = parseEnd(end);
      if (!ref) return;
      setPending(end);
      announce(copy.wiringFrom(ref.label, signGlyph(ref.sign)));
    } else if (pending === end) {
      setPending(null);
    } else {
      wire(pending, end);
    }
  }, [announce, pending, readOnly, wire]);

  const boardRef = useRef<SVGSVGElement>(null);
  const { drag, begin } = useTerminalDrag(boardRef, !readOnly, wire);

  const actions = useMemo<PartActions>(() => ({
    onTerminal: terminal,
    onTerminalPointer: begin,
    onDelete: (label) => {
      const index = doc.latest.current.components.findIndex((c) => c.label === label);
      const neighbour = doc.latest.current.components[index + 1] ?? doc.latest.current.components[index - 1];
      if (neighbour) focusAfterRender.current = neighbour.label;
      else partsToolbar.current?.querySelector<HTMLButtonElement>("button")?.focus();
      edit((c) => removePart(c, label));
    },
    onVolts: (label, volts) => edit((c) => updatePart(c, label, { volts }), `volts:${label}`),
    onOhms: (label, ohms) => edit((c) => updatePart(c, label, { ohms }), `ohms:${label}`),
    onToggle: (label, closed) => edit((c) => updatePart(c, label, { closed })),
    onReset: (label) => {
      if (edit((c) => updatePart(c, label, { broken: false }))) announce(copy.ledReset(label));
    },
    onSeal: seal,
  }), [announce, begin, doc.latest, edit, seal, terminal]);

  const add = (type: CircuitPartType) => {
    const added = addPart(doc.latest.current, type);
    focusAfterRender.current = added.label;
    edit(() => added.circuit);
  };

  const focusPart = useCallback((label: string) => groups.current.get(label)?.focus(), []);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && pending !== null) setPending(null);
  };

  return (
    <div className="bench" data-read-only={readOnly ? "true" : undefined} onKeyDown={onKeyDown}>
      <div id="qy-circuit" className="sr-only" aria-hidden="true" data-sim={sim.running ? "running" : "stopped"}>
        {views.map((view) => (
          <div
            key={view.label}
            data-component={view.label}
            data-status={view.status}
            data-current-ma={view.currentMa}
            data-voltage={view.volts}
            data-brightness={view.brightness ?? undefined}
          />
        ))}
      </div>
      <header className="bench__top">
        <div className="bench__title">
          <p className="eyebrow">Circuit Bench</p>
          <h2>Breadboard</h2>
        </div>
        <div role="toolbar" aria-label="Parts" className="bench__parts" ref={partsToolbar}>
          {PART_TYPES.map((type) => {
            const Icon = PART_ICONS[type];
            return (
              <button key={type} type="button" className="pill pill--circuit" disabled={readOnly} onClick={() => add(type)}>
                <Icon size={20} aria-hidden="true" />
                {PART_NAMES[type]}
              </button>
            );
          })}
        </div>
        <div className="bench__sim">
          <span className="bench__sim-state" data-running={sim.running ? "true" : "false"}>{sim.running ? "Running" : "Stopped"}</span>
          {sim.running ? (
            <button type="button" className="pill pill--circuit" onClick={sim.stop}>
              <Square size={18} aria-hidden="true" />
              Stop Simulation
            </button>
          ) : (
            <button type="button" className="pill pill--circuit" onClick={sim.start}>
              <Play size={18} aria-hidden="true" />
              Start Simulation
            </button>
          )}
        </div>
      </header>
      <div className="bench__grid">
        <div className="bench__canvas card">
          <Breadboard
            circuit={circuit}
            views={viewByLabel}
            columns={columns}
            pending={pending}
            boardRef={boardRef}
            drag={drag}
            onTerminal={terminal}
            onTerminalPointer={begin}
            onPart={focusPart}
          />
        </div>
        <div className="bench__parts-panel bench-panel card">
          <h3>Components</h3>
          <ul className="part-list" aria-label="Components">
            {circuit.components.map((part) => {
              const view = viewByLabel.get(part.label);
              return view ? (
                <li key={part.label}>
                  <PartCard
                    part={part}
                    view={view}
                    pendingEnd={pending}
                    readOnly={readOnly}
                    actions={actions}
                    groupRef={(element) => {
                      if (element) groups.current.set(part.label, element);
                      else groups.current.delete(part.label);
                    }}
                  />
                </li>
              ) : null;
            })}
          </ul>
          {circuit.components.length === 0 ? <p className="bench-hint">Add a battery and an LED from Parts, then wire their {MINUS} and + terminals.</p> : null}
        </div>
        <div className="bench__side">
          <WireList
            wires={circuit.wires}
            readOnly={readOnly}
            handle={wireList}
            onDelete={(index) => {
              wireFocusAfterRender.current = index;
              edit((c) => removeWire(c, index));
            }}
          />
          <Readouts views={views} />
        </div>
      </div>
    </div>
  );
}

const CircuitBench: ComponentType<EditorProps> = (props) => <Bench key={props.documentKey} {...props} />;

export default CircuitBench;
