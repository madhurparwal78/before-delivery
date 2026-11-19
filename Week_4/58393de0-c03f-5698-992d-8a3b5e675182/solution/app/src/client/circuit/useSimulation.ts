import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { copy } from "../../shared/copy";
import { useConfig } from "../lib/config";
import { useStatus } from "../lib/status";
import { formatMa } from "./readouts";
import { settle, type Settled, type Solution } from "./solver";
import type { CircuitDocument } from "./useCircuitDocument";

interface Simulation {
  running: boolean;
  /** The latest solve; null while stopped, when every part reads as idle. */
  solution: Solution | null;
  start: () => void;
  stop: () => void;
}

/** What the last tick said about a part, so Status speaks only when something changed. */
interface Heard {
  lit: string | null;
  shorted: boolean;
}

/** Runs the solver once at start and then every `simTickMs`; an edit is read by the next tick. */
export function useSimulation(doc: CircuitDocument): Simulation {
  const { simTickMs } = useConfig();
  const { announce } = useStatus();
  const [state, setState] = useState<{ running: boolean; solution: Solution | null }>({ running: false, solution: null });
  const heard = useRef(new Map<string, Heard>());
  const { latest, record } = doc;

  const speak = useCallback((settled: Settled) => {
    for (const burnt of settled.burnt) announce(copy.burntOut(burnt.label, formatMa(burnt.currentMa)));
    for (const part of settled.circuit.components) {
      const before = heard.current.get(part.label);
      const reading = settled.solution.readings.get(part.label);
      const lit = part.type === "led" && !part.broken && reading && reading.currentMa > 0 ? formatMa(reading.currentMa) : null;
      const shorted = settled.solution.shorted.has(part.label);
      if (lit !== null && before?.lit !== lit) announce(copy.litAt(part.label, lit));
      if (shorted && !before?.shorted) announce(copy.shorted(part.label));
      heard.current.set(part.label, { lit, shorted });
    }
  }, [announce]);

  const tick = useCallback(() => {
    const settled = settle(latest.current);
    flushSync(() => {
      if (settled.burnt.length > 0) record(settled.circuit);
      setState({ running: true, solution: settled.solution });
    });
    speak(settled);
  }, [latest, record, speak]);

  const start = useCallback(() => {
    heard.current.clear();
    announce(copy.simStarted);
    tick();
  }, [announce, tick]);

  const stop = useCallback(() => {
    heard.current.clear();
    setState({ running: false, solution: null });
    announce(copy.simStopped);
  }, [announce]);

  useEffect(() => {
    if (!state.running) return undefined;
    const timer = window.setInterval(tick, simTickMs);
    return () => window.clearInterval(timer);
  }, [state.running, simTickMs, tick]);

  return { running: state.running, solution: state.solution, start, stop };
}
