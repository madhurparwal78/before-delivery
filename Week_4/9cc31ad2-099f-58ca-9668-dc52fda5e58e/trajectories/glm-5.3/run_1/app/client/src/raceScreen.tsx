// The race screen: 60 model steps per second of page time, HUD, pause, ghost.
import { useEffect, useRef, useState, type JSX } from 'react';
import { RaceCar, type InputEvent, type Pedals } from '../../shared/raceModel';
import { LAYOUTS, type LayoutId } from '../../shared/domain';
import { api, type CreateRunBody } from './api';
import { navigate, Dialog } from './ui';
import { fmtTime, fmtDelta, fmtSpeed, fmtCoins, fmtScore } from './formats';
import { drawRace } from './raceDraw';

export interface RaceAddress {
  layoutId: string;
  mode: 'practice' | 'circuit' | 'drift' | 'time-trial';
  event?: string;
  laps?: number;
  ghost?: string;
}

export function parseRaceAddress(search: string): RaceAddress {
  const q = new URLSearchParams(search);
  return {
    layoutId: q.get('layout') ?? 'saltflat-ring',
    mode: (q.get('mode') ?? 'practice') as RaceAddress['mode'],
    event: q.get('event') ?? undefined,
    laps: q.get('laps') ? Number(q.get('laps')) : undefined,
    ghost: q.get('ghost') ?? undefined
  };
}

export function raceAddressString(a: RaceAddress): string {
  let s = `/race?layout=${a.layoutId}&mode=${a.mode}`;
  if (a.event) s += `&event=${a.event}`;
  if (a.laps !== undefined) s += `&laps=${a.laps}`;
  if (a.ghost) s += `&ghost=${a.ghost}`;
  return s;
}

const LANES = ['left', 'middle', 'right'] as const;

export default function RaceScreen({ address, units }: { address: RaceAddress; units: 'kmh' | 'mph' }): JSX.Element {
  const [run, setRun] = useState<CreateRunBody | null>(null);
  const [tooNarrow, setTooNarrow] = useState(window.innerWidth < 1024);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [ghostLabel, setGhostLabel] = useState<string | null>(null);
  const [ghostMissing, setGhostMissing] = useState(false);
  const [deltaText, setDeltaText] = useState('0.000 s');
  const [lapMsg, setLapMsg] = useState('');
  const hudRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const carRef = useRef<RaceCar | null>(null);
  const ghostCarRef = useRef<RaceCar | null>(null);
  const ghostTable = useRef<{ dist: number[]; ms: number[] }>({ dist: [], ms: [] });
  const inputRef = useRef<Pedals>({ throttle: 0, brake: 0, drift: 0, lane: 'middle' });
  const eventsRef = useRef<InputEvent[]>([{ step: 0, throttle: 0, brake: 0, drift: 0, lane: 'middle' }]);
  const stepRef = useRef(0);
  const aiRef = useRef<RaceCar[]>([]);
  const runTokenRef = useRef(0);
  const pausedRef = useRef(false);
  const [hud, setHud] = useState({ lap: 1, speed: 0, coins: 0, score: 0, seconds: 90 });

  pausedRef.current = paused;

  useEffect(() => {
    const onResize = (): void => setTooNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Create one new run for exactly what the address names.
  useEffect(() => {
    const token = ++runTokenRef.current;
    const body: Record<string, unknown> = { layoutId: address.layoutId, mode: address.mode };
    if (address.event) body.eventId = address.event;
    if (address.laps !== undefined) body.laps = address.laps;

    const makeCar = (created: CreateRunBody): RaceCar =>
      new RaceCar(LAYOUTS[created.layoutId as LayoutId], created.car.stats, created.laps,
        created.mode === 'practice' || created.mode === 'circuit', created.mode === 'drift');

    void api.createRun(body).then(created => {
      if (runTokenRef.current !== token) return;
      setRun(created);
      carRef.current = makeCar(created);
      aiRef.current = created.ai.map(a => new RaceCar(
        LAYOUTS[created.layoutId as LayoutId],
        // The AI cars are the reference driver's car model at stage 0.
        { accelMps2: 4, brakeMps2: 8, topMps: 45, gripPct: 100, laneChangeSteps: 30 },
        created.laps, false, false));
      eventsRef.current = [{ step: 0, throttle: 0, brake: 0, drift: 0, lane: 'middle' }];
      stepRef.current = 0;
      ghostTable.current = { dist: [], ms: [] };
      setStarted(false);
      setLapMsg('');
      setDeltaText('0.000 s');
      setHud({ lap: 1, speed: 0, coins: 0, score: 0, seconds: 90 });
      hudRef.current?.focus();
    }).catch(() => {
      if (runTokenRef.current !== token) return;
      navigate('/garage', 'a[href="/garage"]');
    });

    if (address.ghost) {
      setGhostLabel('loading');
      setGhostMissing(false);
      void api.run(address.ghost).then(summary => {
        if (runTokenRef.current !== token) return;
        const name = summary.name;
        return fetch(`/v1/runs/${address.ghost}/replay`).then(async res => {
          if (!res.ok) throw new Error('no replay');
          return res.text();
        }).then(text => {
          if (runTokenRef.current !== token) return;
          const parsed = JSON.parse(text) as { inputs: InputEvent[] };
          const gCar = new RaceCar(LAYOUTS[summary.layoutId as LayoutId], summary.car.stats, summary.laps, false, false);
          let gi = 0;
          let last = parsed.inputs[0];
          const table: { dist: number[]; ms: number[] } = { dist: [], ms: [] };
          const layoutLen = LAYOUTS[summary.layoutId as LayoutId].length;
          for (let k = 0; k < summary.stepLimit && !gCar.finished; k++) {
            while (gi < parsed.inputs.length && parsed.inputs[gi].step <= k) {
              last = parsed.inputs[gi]; gi++;
            }
            gCar.step(k, { throttle: last.throttle, brake: last.brake, drift: last.drift, lane: last.lane });
            const dist = (gCar.lap - 1) * layoutLen + gCar.position;
            table.dist.push(dist);
            table.ms.push(((k + 1) * 1000) / 60);
          }
          ghostCarRef.current = gCar;
          ghostTable.current = table;
          setGhostLabel(name);
        });
      }).catch(() => {
        if (runTokenRef.current !== token) return;
        setGhostLabel(null);
        setGhostMissing(true);
      });
    }
    return () => { runTokenRef.current++; };
  }, [address.layoutId, address.mode, address.event, address.laps, address.ghost]);

  // The 60Hz loop: model steps are independent of drawn frames.
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let finished = false;
    let deltaAcc = 0;

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(now - last, 250);
      last = now;
      if (pausedRef.current || !started) return;
      acc += dt;
      const stepMs = 1000 / 60;
      const car = carRef.current;
      if (!car) return;
      while (acc >= stepMs && !car.finished) {
        acc -= stepMs;
        const step = stepRef.current;
        const input = { ...inputRef.current };
        const prev = eventsRef.current;
        const lastEvent = prev[prev.length - 1];
        if (input.throttle !== lastEvent.throttle || input.brake !== lastEvent.brake ||
            input.drift !== lastEvent.drift || input.lane !== lastEvent.lane) {
          prev.push({ step, ...input });
        }
        const ev = car.step(step, input);
        for (let i = 0; i < aiRef.current.length; i++) {
          const factor = i === 0 ? 1.15 : 1.04;
          const aiStep = Math.floor(step / factor);
          if (aiStep <= step) aiRef.current[i].step(aiStep, aiRef.current[i].referencePedals());
        }
        stepRef.current = step + 1;
        if (ev.lapEnded) {
          const lapNo = car.lap - 1;
          setLapMsg(`Lap ${lapNo}: ${fmtTime(ev.lapEnded.lapMs)}${ev.lapEnded.valid ? '' : ', invalid'}`);
        }
        deltaAcc += stepMs;
        if (deltaAcc >= 250) {
          deltaAcc = 0;
          updateDelta(car);
        }
        if (car.finished && !finished) {
          finished = true;
          finish(car);
        }
      }
      setHud({
        lap: Math.min(car.lap, run.laps),
        speed: car.speed,
        coins: car.coinsCollected,
        score: car.driftScore,
        seconds: run.mode === 'drift' ? Math.max(0, Math.ceil((run.stepLimit - stepRef.current) / 60)) : 90
      });
      draw();
    };

    const updateDelta = (car: RaceCar): void => {
      const table = ghostTable.current;
      if (table.dist.length === 0) return;
      const layoutLen = LAYOUTS[run.layoutId as LayoutId].length;
      const dist = (car.lap - 1) * layoutLen + car.position;
      // The ghost's elapsed time when it reached the same distance in the same lap.
      let ghostMs: number | null = null;
      let lo = 0, hi = table.dist.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (table.dist[mid] <= dist) { ghostMs = table.ms[mid]; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (ghostMs !== null) {
        setDeltaText(fmtDelta(Math.round(((stepRef.current + 1) * 1000) / 60) - Math.round(ghostMs)));
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [run, started]);

  const draw = (): void => {
    const canvas = canvasRef.current;
    const car = carRef.current;
    if (!canvas || !car || !run) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawRace(ctx, canvas, LAYOUTS[run.layoutId as LayoutId], car, aiRef.current, ghostCarRef.current, units);
  };

  const finish = (car: RaceCar): void => {
    if (!run) return;
    const rawBody = JSON.stringify({ seed: run.seed, inputs: eventsRef.current });
    const token = runTokenRef.current;
    void (async () => {
      // Resend the byte-identical body until any HTTP response arrives.
      for (;;) {
        if (runTokenRef.current !== token) return;
        try {
          const res = await fetch(`/v1/runs/${run.runId}/finish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rawBody
          });
          if (res.status > 0) break;
        } catch { /* no response */ }
        await new Promise(r => setTimeout(r, 2000));
      }
    })();
    window.history.replaceState({}, '', `/runs/${run.runId}`);
    window.dispatchEvent(new CustomEvent('kerb-navigate', {
      detail: { path: `/runs/${run.runId}`, focusSel: '[data-focus="run-result"]' }
    }));
  };

  // The driving keys work whichever control has focus, and never activate buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const key = e.key;
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        inputRef.current.throttle = 1; e.preventDefault();
      } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        inputRef.current.brake = 1; e.preventDefault();
      } else if (key === ' ') {
        if (!(e.target instanceof HTMLElement && (e.target.tagName === 'BUTTON' || e.target.tagName === 'A'))) {
          inputRef.current.drift = 1; e.preventDefault();
        }
      } else if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
        const idx = LANES.indexOf(inputRef.current.lane);
        if (idx > 0) inputRef.current.lane = LANES[idx - 1];
        e.preventDefault();
      } else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
        const idx = LANES.indexOf(inputRef.current.lane);
        if (idx < 2) inputRef.current.lane = LANES[idx + 1];
        e.preventDefault();
      } else if (key === 'Escape') {
        if (!(e.target instanceof HTMLElement && e.target.closest('[role="dialog"]'))) {
          setPaused(p => !p);
        }
      } else if (key === 'Enter' && !started && !paused &&
                 !(e.target instanceof HTMLElement && e.target.tagName === 'BUTTON')) {
        setStarted(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      const key = e.key;
      if (key === 'ArrowUp' || key === 'w' || key === 'W') inputRef.current.throttle = 0;
      else if (key === 'ArrowDown' || key === 's' || key === 'S') inputRef.current.brake = 0;
      else if (key === ' ') inputRef.current.drift = 0;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [started, paused]);

  // The Paused dialog opens by itself when the page becomes hidden.
  useEffect(() => {
    const onVis = (): void => { if (document.hidden) setPaused(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const restart = (): void => {
    runTokenRef.current++;
    setPaused(false);
    setStarted(false);
    setLapMsg('');
    setDeltaText('0.000 s');
    navigate(window.location.pathname + window.location.search, '[data-focus="race-hud"]');
  };

  if (tooNarrow) {
    return (
      <main className="page" style={{ paddingTop: 24 }}>
        <div className="notice">Racing needs a desktop browser with a keyboard.</div>
        <p><a href="/garage" onClick={e => { e.preventDefault(); navigate('/garage', 'a[href="/garage"]'); }}>Back to garage</a></p>
      </main>
    );
  }

  const speed = fmtSpeed(hud.speed, units);
  return (
    <main className="page" style={{ paddingTop: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div>
          <canvas ref={canvasRef} role="img" aria-label="Race view" width={960} height={540}
                  style={{ width: '100%', height: 'auto', border: '1px solid var(--ink)', background: 'var(--paper-2)' }} />
        </div>
        <div>
          <div ref={hudRef} role="region" aria-label="Race HUD" tabIndex={-1} data-focus="race-hud"
               style={{ border: '1px solid var(--rule)', padding: 12, minHeight: 200 }}>
            <div className="mono">Lap {hud.lap}/{run?.laps ?? 1}</div>
            {address.mode === 'circuit' && <div className="mono">Position {positionOf()}/{(run?.ai.length ?? 0) + 1}</div>}
            <div className="mono">{speed} {units === 'kmh' ? 'km/h' : 'mph'}</div>
            {(address.mode === 'practice' || address.mode === 'circuit') && <div className="mono">Coins {fmtCoins(hud.coins)}</div>}
            {address.mode === 'drift' && (
              <>
                <div className="mono">Drift {fmtScore(hud.score)}</div>
                <div className="mono">Stage time {hud.seconds}</div>
              </>
            )}
            {address.ghost && (
              <div className="mono">Ghost: {ghostMissing ? 'unavailable' : (ghostLabel ?? 'loading')}</div>
            )}
            {address.ghost && ghostMissing && <div className="mono">Ghost unavailable. Racing without it.</div>}
            {address.ghost && !ghostMissing && ghostLabel !== null && ghostLabel !== 'loading' && (
              <div className="mono">Ghost: {ghostLabel}</div>
            )}
            {address.ghost && <div className="mono">Delta {deltaText}</div>}
            {!started && !paused && <div className="mono">Press Enter to start</div>}
          </div>
          <div className="status" role="status" aria-live="polite" style={{ marginTop: 12 }}>{lapMsg}</div>
          <button className="btn" onClick={() => setPaused(true)}>Pause</button>
        </div>
      </div>
      {paused && (
        <Dialog title="Paused" onClose={() => setPaused(false)}>
          <h2>Paused</h2>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => setPaused(false)}>Resume</button>
            <button className="btn" onClick={restart}>Restart</button>
            <button className="btn" onClick={() => {
              runTokenRef.current++;
              navigate('/garage', 'a[href="/garage"]');
            }}>Quit to garage</button>
          </div>
        </Dialog>
      )}
    </main>
  );

  function positionOf(): number {
    const car = carRef.current;
    if (!car || aiRef.current.length === 0) return 1;
    let pos = 1;
    for (const ai of aiRef.current) {
      const meAhead = car.lap !== ai.lap ? car.lap > ai.lap : car.distance >= ai.distance;
      if (!meAhead) pos++;
    }
    return pos;
  }
}
