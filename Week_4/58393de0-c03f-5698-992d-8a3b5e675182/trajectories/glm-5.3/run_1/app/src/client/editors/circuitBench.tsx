import type { VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { CircuitSnapshot, CircuitComponent } from '../../shared/scene.js';
import type { EditorHandle } from '../pages/editor.js';
import { solveCircuit, stoppedReadings, type ComponentReading } from '../circuitSolver.js';
import { say } from '../status.js';
import { M } from '../copy.js';

const VOLT_MIN = 1, VOLT_MAX = 12;
const OHM_MIN = 1, OHM_MAX = 10_000_000;

interface UndoState { components: CircuitComponent[]; wires: { from: string; to: string }[] }

export function CircuitBench(props: {
  snapshot: CircuitSnapshot;
  readOnly: boolean;
  markDirty: () => void;
  onHandle: (h: EditorHandle) => void;
  name: string;
  setName: (n: string) => void;
  simTickMs: number;
}): VNode {
  const [components, setComponents] = useState<CircuitComponent[]>(props.snapshot.components);
  const [wires, setWires] = useState<{ from: string; to: string }[]>(props.snapshot.wires);
  const [simRunning, setSimRunning] = useState(false);
  const [readings, setReadings] = useState<ComponentReading[]>(stoppedReadings(props.snapshot.components));
  const [pendingTerminal, setPendingTerminal] = useState<string | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const compsRef = useRef(components);
  compsRef.current = components;
  const wiresRef = useRef(wires);
  wiresRef.current = wires;
  const brokenRef = useRef<Set<string>>(new Set(props.snapshot.components.filter((c) => c.broken).map((c) => c.label)));
  const undoStack = useRef<UndoState[]>([]);
  const redoStack = useRef<UndoState[]>([]);
  const counters = useRef({ battery: 0, led: 0, resistor: 0, switch: 0 });
  const shortAnnouncedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setComponents(props.snapshot.components);
    setWires(props.snapshot.wires);
    for (const c of props.snapshot.components) {
      const m = /^([A-Z]+)-(\d+)$/.exec(c.label);
      if (m) {
        const prefix = m[1] === 'BAT' ? 'battery' : m[1] === 'LED' ? 'led' : m[1] === 'R' ? 'resistor' : 'switch';
        counters.current[prefix as keyof typeof counters.current] = Math.max(counters.current[prefix as keyof typeof counters.current], parseInt(m[2]!, 10));
      }
    }
    setReadings(stoppedReadings(props.snapshot.components));
  }, [props.snapshot]);

  const snapshotOf = useCallback((): CircuitSnapshot => ({
    kind: 'circuit',
    components: compsRef.current.map((c) => ({ ...c })),
    wires: wiresRef.current.map((w) => ({ ...w })),
  }), []);

  useEffect(() => {
    props.onHandle({
      getSnapshot: snapshotOf,
      getName: () => props.name,
      setSnapshot: (s) => {
        const snap = s as CircuitSnapshot;
        setComponents(snap.components);
        setWires(snap.wires);
        setReadings(stoppedReadings(snap.components));
      },
      markSaved: () => {},
      isDirty: () => false,
    });
  }, [props.name]);

  const pushUndo = (nextComps: CircuitComponent[], nextWires: { from: string; to: string }[]) => {
    undoStack.current.push({ components: [...compsRef.current], wires: [...wiresRef.current] });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setComponents(nextComps);
    setWires(nextWires);
    compsRef.current = nextComps;
    wiresRef.current = nextWires;
    props.markDirty();
  };

  const undo = () => {
    const step = undoStack.current.pop();
    if (!step) return;
    redoStack.current.push({ components: [...compsRef.current], wires: [...wiresRef.current] });
    setComponents(step.components); compsRef.current = step.components;
    setWires(step.wires); wiresRef.current = step.wires;
    if (!simRunning) setReadings(stoppedReadings(step.components));
  };

  const redo = () => {
    const step = redoStack.current.pop();
    if (!step) return;
    undoStack.current.push({ components: [...compsRef.current], wires: [...wiresRef.current] });
    setComponents(step.components); compsRef.current = step.components;
    setWires(step.wires); wiresRef.current = step.wires;
    if (!simRunning) setReadings(stoppedReadings(step.components));
  };

  const addComponent = (type: CircuitComponent['type']) => {
    const prefix = type === 'battery' ? 'BAT' : type === 'led' ? 'LED' : type === 'resistor' ? 'R' : 'SW';
    counters.current[type] += 1;
    const label = `${prefix}-${counters.current[type]}`;
    const comp: CircuitComponent = type === 'battery' ? { label, type, volts: 9 } : type === 'resistor' ? { label, type, ohms: 1000 } : type === 'switch' ? { label, type, closed: false } : { label, type };
    pushUndo([...compsRef.current, comp], wiresRef.current);
    setFocusedLabel(label);
  };

  const statusWords = (c: CircuitComponent, r: ComponentReading | undefined): string => {
    if (c.type === 'battery') return r?.status === 'shorted' ? 'short-circuited' : 'ok';
    if (c.type === 'led') {
      if (r?.status === 'broken') return 'burnt out';
      if (r?.status === 'lit') return `lit ${r.currentMa.toFixed(1)} mA`;
      return 'off';
    }
    if (c.type === 'resistor') return `${c.ohms ?? 1000} Ω`;
    return c.closed ? 'closed' : 'open';
  };

  const wire = (from: string, to: string) => {
    if (from === to) return;
    const exists = wiresRef.current.some((w) => (w.from === from && w.to === to) || (w.from === to && w.to === from));
    if (exists) { say(M.alreadyWired); return; }
    pushUndo(compsRef.current, [...wiresRef.current, { from, to }]);
    say(M.wired(from, to));
  };

  const deleteWire = (from: string, to: string) => {
    pushUndo(compsRef.current, wiresRef.current.filter((w) => !(w.from === from && w.to === to)));
  };

  const setVolts = (label: string, value: string) => {
    const v = parseFloat(value);
    if (Number.isNaN(v) || v < VOLT_MIN || v > VOLT_MAX) {
      setFieldErrors((e) => ({ ...e, [`${label}-volts`]: M.voltageRange }));
      return;
    }
    setFieldErrors((e) => { const next = { ...e }; delete next[`${label}-volts`]; return next; });
    // applied as typed — a value change is not an undo step by itself per the
    // interactions table (only a valid apply is; keep it as a mark-dirty edit)
    const next = compsRef.current.map((c) => c.label === label ? { ...c, volts: v } : c);
    setComponents(next);
    compsRef.current = next;
    props.markDirty();
  };

  const setOhms = (label: string, value: string) => {
    const v = parseFloat(value);
    if (Number.isNaN(v) || v < OHM_MIN || v > OHM_MAX) {
      setFieldErrors((e) => ({ ...e, [`${label}-ohms`]: M.resistanceRange }));
      return;
    }
    setFieldErrors((e) => { const next = { ...e }; delete next[`${label}-ohms`]; return next; });
    const next = compsRef.current.map((c) => c.label === label ? { ...c, ohms: v } : c);
    setComponents(next);
    compsRef.current = next;
    props.markDirty();
  };

  const toggleSwitch = (label: string) => {
    const next = compsRef.current.map((c) => c.label === label && c.type === 'switch' ? { ...c, closed: !c.closed } : c);
    pushUndo(next, wiresRef.current);
  };

  const resetLed = (label: string) => {
    brokenRef.current.delete(label);
    const next = compsRef.current.map((c) => c.label === label ? { ...c, broken: false } : c);
    setComponents(next);
    compsRef.current = next;
    if (!simRunning) setReadings(stoppedReadings(next));
    say(M.ledReset(label));
    props.markDirty();
  };

  const deleteComponent = (label: string) => {
    pushUndo(
      compsRef.current.filter((c) => c.label !== label),
      wiresRef.current.filter((w) => !w.from.startsWith(`${label}`) && !w.to.startsWith(`${label}`)),
    );
  };

  const startSim = () => {
    setSimRunning(true);
    say(M.simStarted);
  };
  const stopSim = () => {
    setSimRunning(false);
    setReadings(stoppedReadings(compsRef.current));
    say(M.simStopped);
  };

  // Simulation ticks: re-solve on every tick so edits land within one tick.
  useEffect(() => {
    if (!simRunning) return;
    const tick = () => {
      const comps = compsRef.current.map((c) => c.type === 'led' ? { ...c, broken: brokenRef.current.has(c.label) } : c);
      const res = solveCircuit(comps, wiresRef.current);
      if (res.ledBurnt) {
        brokenRef.current.add(res.ledBurnt);
        const burntReading = res.readings.find((r) => r.label === res.ledBurnt);
        say(M.ledBurnt(res.ledBurnt, (burntReading?.currentMa ?? 0).toFixed(1)));
        setComponents(compsRef.current.map((c) => c.label === res.ledBurnt ? { ...c, broken: true } : c));
      }
      for (const r of res.readings) {
        if (r.type === 'battery' && r.status === 'shorted' && !shortAnnouncedRef.current.has(r.label)) {
          shortAnnouncedRef.current.add(r.label);
          say(M.batteryShorted(r.label));
        }
        if (r.type === 'battery' && r.status !== 'shorted') shortAnnouncedRef.current.delete(r.label);
      }
      setReadings(res.readings);
    };
    tick();
    const timer = setInterval(tick, props.simTickMs);
    return () => clearInterval(timer);
  }, [simRunning, props.simTickMs]);

  // Announce LED state changes while running (compare to previous).
  const prevRef = useRef<Map<string, ComponentReading>>(new Map());
  useEffect(() => {
    if (!simRunning) { prevRef.current = new Map(); return; }
    for (const r of readings) {
      if (r.type !== 'led') continue;
      const prev = prevRef.current.get(r.label);
      if (!prev || prev.status !== r.status) {
        if (r.status === 'lit') say(M.ledLit(r.label, r.currentMa.toFixed(1)));
      } else if (r.status === 'lit' && prev.currentMa !== r.currentMa) {
        say(M.ledLit(r.label, r.currentMa.toFixed(1)));
      }
    }
    prevRef.current = new Map(readings.filter((r) => r.type === 'led').map((r) => [r.label, r]));
  }, [readings, simRunning]);

  // keyboard: undo/redo/save wiring by keyboard handled per terminal button
  useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      return node !== null && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (props.readOnly) return;
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape' && pendingTerminal) { setPendingTerminal(null); return; }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingTerminal, props.readOnly]);

  const readingFor = (label: string) => readings.find((r) => r.label === label);

  return (
    <>
      <div class="panel toolbar-col" style="width:200px">
        <h2 id="parts-heading">Parts</h2>
        <div class="tool-row" role="toolbar" aria-labelledby="parts-heading">
          <button class="btn" aria-label="Battery" onClick={() => addComponent('battery')} disabled={props.readOnly}>Battery</button>
          <button class="btn" aria-label="LED" onClick={() => addComponent('led')} disabled={props.readOnly}>LED</button>
          <button class="btn" aria-label="Resistor" onClick={() => addComponent('resistor')} disabled={props.readOnly}>Resistor</button>
          <button class="btn" aria-label="Switch" onClick={() => addComponent('switch')} disabled={props.readOnly}>Switch</button>
        </div>
      </div>

      <div class="circuit-stage">
        <svg viewBox="0 0 800 500" aria-hidden="true">
          {components.map((c, i) => {
            const x = 80 + (i % 4) * 180;
            const y = 90 + Math.floor(i / 4) * 150;
            return (
              <g key={c.label}>
                <rect x={x - 50} y={y - 28} width="100" height="56" rx="10"
                  fill={c.type === 'battery' ? '#ffecb3' : c.type === 'led' ? (readingFor(c.label)?.status === 'lit' ? '#c8f7c5' : '#f0f0f0') : c.type === 'switch' ? (c.closed ? '#cfe4ff' : '#f0f0f0') : '#f3e5f5'}
                  stroke={focusedLabel === c.label ? 'var(--accent)' : 'var(--card-edge)'} strokeWidth="2" />
                <text x={x} y={y + 5} textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--ink)">{c.label}</text>
              </g>
            );
          })}
          {wires.map((w, i) => {
            const from = components.findIndex((c) => w.from.startsWith(c.label));
            const to = components.findIndex((c) => w.to.startsWith(c.label));
            if (from === -1 || to === -1) return null;
            const x1 = 80 + (from % 4) * 180;
            const y1 = 90 + Math.floor(from / 4) * 150;
            const x2 = 80 + (to % 4) * 180;
            const y2 = 90 + Math.floor(to / 4) * 150;
            return <line key={i} x1={x1} y1={y1 + 30} x2={x2} y2={y2 + 30} stroke="var(--accent-deep)" strokeWidth="3" />;
          })}
        </svg>
      </div>

      <div class="readouts" role="region" aria-label="Readouts">
        <h2>Components</h2>
        <div role="list" aria-label="Components">
          {components.map((c) => {
            const r = readingFor(c.label);
            return (
              <div class="ro-line" key={c.label} role="group" aria-label={`${c.label}, ${statusWords(c, r)}`}>
                <span>{c.label}, {statusWords(c, r)}</span>
                <span>
                  {c.type === 'battery' && (
                    <>
                      <label class="qy-hidden" htmlFor={`${c.label}-volts`}>Voltage (V)</label>
                      <input id={`${c.label}-volts`} style="width:70px;min-height:34px" value={c.volts ?? 9} disabled={props.readOnly}
                        onInput={(e) => setVolts(c.label, (e.target as HTMLInputElement).value)} />
                    </>
                  )}
                  {c.type === 'resistor' && (
                    <>
                      <label class="qy-hidden" htmlFor={`${c.label}-ohms`}>Resistance (Ω)</label>
                      <input id={`${c.label}-ohms`} style="width:80px;min-height:34px" value={c.ohms ?? 1000} disabled={props.readOnly}
                        onInput={(e) => setOhms(c.label, (e.target as HTMLInputElement).value)} />
                    </>
                  )}
                </span>
                <span class="v num">
                  {r ? `${r.currentMa.toFixed(1)} mA` : '0.0 mA'}
                </span>
                <span style="display:flex;gap:6px;flex-wrap:wrap">
                  <button class="btn" aria-label={`${c.label} + terminal`} aria-pressed={pendingTerminal === `${c.label}+`}
                    onClick={() => onTerminal(`${c.label}+`)} disabled={props.readOnly}>+</button>
                  <button class="btn" aria-label={`${c.label} − terminal`} aria-pressed={pendingTerminal === `${c.label}-`}
                    onClick={() => onTerminal(`${c.label}-`)} disabled={props.readOnly}>−</button>
                  {c.type === 'switch' && (
                    <>
                      <label class="qy-hidden" htmlFor={`sw-${c.label}`}>{c.label}</label>
                      <input type="checkbox" role="switch" id={`sw-${c.label}`} checked={Boolean(c.closed)} disabled={props.readOnly}
                        onChange={() => toggleSwitch(c.label)} style="width:44px;height:44px" />
                    </>
                  )}
                  {c.type === 'led' && (
                    <button class="btn" aria-label={`Reset ${c.label}`} onClick={() => resetLed(c.label)} disabled={props.readOnly}>Reset LED</button>
                  )}
                  <button class="btn" aria-label={`Delete ${c.label}`} onClick={() => deleteComponent(c.label)} disabled={props.readOnly}>Delete</button>
                </span>
                {fieldErrors[`${c.label}-volts`] && <span class="err" role="alert">{fieldErrors[`${c.label}-volts`]}</span>}
                {fieldErrors[`${c.label}-ohms`] && <span class="err" role="alert">{fieldErrors[`${c.label}-ohms`]}</span>}
              </div>
            );
          })}
        </div>
        <h2>Wires</h2>
        <div role="list" aria-label="Wires">
          {wires.map((w) => (
            <div class="ro-line" key={`${w.from}-${w.to}`} role="listitem">
              <span>{w.from} to {w.to}</span>
              <button class="btn" aria-label={`Delete wire ${w.from} to ${w.to}`} onClick={() => deleteWire(w.from, w.to)} disabled={props.readOnly}>Delete</button>
            </div>
          ))}
        </div>
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
          {simRunning ? (
            <button class="pill" onClick={stopSim}>Stop Simulation</button>
          ) : (
            <button class="pill" onClick={startSim} disabled={props.readOnly}>Start Simulation</button>
          )}
        </div>
      </div>

      <div id="qy-circuit" class="qy-hidden" aria-hidden="true" data-sim={simRunning ? 'running' : 'stopped'}>
        {components.map((c) => {
          const r = readingFor(c.label);
          return (
            <div key={c.label}
              data-component={c.label}
              data-status={r?.status ?? (c.type === 'led' ? 'off' : c.type === 'switch' ? (c.closed ? 'closed' : 'open') : 'ok')}
              data-current-ma={(r?.currentMa ?? 0).toFixed(1)}
              data-voltage={(r?.voltage ?? 0).toFixed(2)}
              data-brightness={c.type === 'led' ? (r?.brightness ?? 0).toFixed(2) : undefined}
            />
          );
        })}
      </div>
    </>
  );

  function onTerminal(term: string): void {
    if (pendingTerminal === null) {
      setPendingTerminal(term);
      const label = term.slice(0, term.length - 1);
      const sign = term.endsWith('+') ? '+' : '−';
      say(M.wiringFrom(label, sign));
      return;
    }
    if (pendingTerminal === term) { setPendingTerminal(null); return; }
    wire(pendingTerminal, term);
    setPendingTerminal(null);
  }
}
