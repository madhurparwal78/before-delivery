import { useEffect, useMemo, useRef, useState } from 'react';
import type { LabResponse } from '../../shared/api.js';
import { pageCopy } from '../../shared/copy.js';
import { derivedReadouts, readoutText, type ParamValues } from '../../shared/readouts.js';
import { MAX_STEPS_PER_FRAME, STEP_SECONDS, Simulation, type Body } from '../../shared/sim.js';
import { ApiFault, api } from '../api.js';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { Stage } from '../editor/Stage.jsx';
import { Telemetry } from '../editor/Telemetry.jsx';
import { useLayout } from '../editor/layout.js';

type Mode = 'edit' | 'running' | 'paused';

export function Lab({ token }: { token: string }): JSX.Element {
  const layout = useLayout();
  const [lab, setLab] = useState<LabResponse | null>(null);
  const [problem, setProblem] = useState<'missing' | 'storage' | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>('edit');
  const [step, setStep] = useState(0);
  const [stateHash, setStateHash] = useState('');
  const [fps, setFps] = useState(0);
  const [frameMs, setFrameMs] = useState(0);
  const [bodies, setBodies] = useState<ReadonlyMap<string, Body>>(new Map());
  const [tab, setTab] = useState<'Parameters' | 'Readouts'>('Parameters');
  const simulation = useRef<Simulation | null>(null);
  const handle = useRef(0);
  const clock = useRef({ last: 0, accumulator: 0, telemetry: 0 });

  useEffect(() => {
    void api<LabResponse>(`/api/labs/${token}`, { allowUnauthenticated: true })
      .then((response) => {
        setLab(response);
        setValues(
          Object.fromEntries(response.lab.exposed.map((parameter) => [parameter.key, parameter.value])),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.code === 'storage_unavailable') setProblem('storage');
        else setProblem('missing');
      });
  }, [token]);

  const document_ = lab?.bundle.document ?? null;

  const overridden = useMemo(() => {
    if (!document_) return null;
    return {
      ...document_,
      objects: document_.objects.map((object) => ({
        ...object,
        params: Object.fromEntries(
          Object.entries(object.params).map(([key, value]) => [
            key,
            values[`${object.id}.${key}`] ?? value,
          ]),
        ),
      })),
    };
  }, [document_, values]);

  useEffect(() => {
    if (mode !== 'running' || !overridden) return;
    clock.current = { last: performance.now(), accumulator: 0, telemetry: 0 };
    const frame = (now: number): void => {
      const simulated = simulation.current;
      if (!simulated) return;
      const elapsed = Math.min((now - clock.current.last) / 1000, 0.25);
      clock.current.last = now;
      clock.current.accumulator += elapsed;
      let steps = 0;
      while (clock.current.accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
        simulated.advanceOne();
        clock.current.accumulator -= STEP_SECONDS;
        steps += 1;
      }
      setBodies(new Map(simulated.bodies().map((body) => [body.id, body])));
      if (now - clock.current.telemetry > 500) {
        clock.current.telemetry = now;
        setFps(Math.round(1000 / Math.max(elapsed * 1000, 1)));
        setFrameMs(Math.round(elapsed * 1000 * 10) / 10);
        setStep(simulated.step);
        setStateHash(simulated.stateHash());
      }
      handle.current = requestAnimationFrame(frame);
    };
    handle.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle.current);
  }, [mode, overridden]);

  useEffect(() => {
    if (mode !== 'edit' || !overridden) return;
    const fresh = new Simulation(overridden);
    simulation.current = fresh;
    setStep(0);
    setStateHash(fresh.stateHash());
    setBodies(new Map());
  }, [mode, overridden]);

  if (problem === 'missing')
    return (
      <div className="screen">
        <Toolbar>
          <Wordmark />
        </Toolbar>
        <div className="screen-body">
          <div className="panel">
            <div className="panel-body">
              <h1>{pageCopy.missingLabHeading}</h1>
              <p>{pageCopy.missingLabBody}</p>
            </div>
          </div>
        </div>
      </div>
    );

  if (problem === 'storage')
    return (
      <div className="screen">
        <Toolbar>
          <Wordmark />
        </Toolbar>
        <div className="screen-body">
          <div className="panel">
            <div className="panel-body">
              <h1>{pageCopy.labStorageHeading}</h1>
              <p>{pageCopy.labStorageBody}</p>
            </div>
          </div>
        </div>
      </div>
    );

  const running = mode !== 'edit';

  const parameters = lab?.lab.exposed ?? [];
  const readoutObjects = overridden?.objects ?? [];

  const start = (): void => {
    if (!overridden) return;
    simulation.current = new Simulation(overridden);
    setStep(0);
    setMode('running');
  };

  const stop = (): void => {
    cancelAnimationFrame(handle.current);
    setMode('edit');
    setBodies(new Map());
    setFps(0);
    setFrameMs(0);
  };

  const pause = (): void => {
    if (mode === 'running') {
      cancelAnimationFrame(handle.current);
      setMode('paused');
      const simulated = simulation.current;
      if (simulated) {
        setStep(simulated.step);
        setStateHash(simulated.stateHash());
      }
      return;
    }
    if (mode === 'paused') setMode('running');
  };

  const stepOnce = (): void => {
    if (mode === 'edit') return;
    cancelAnimationFrame(handle.current);
    setMode('paused');
    const simulated = simulation.current;
    if (!simulated) return;
    simulated.advanceOne();
    setBodies(new Map(simulated.bodies().map((body) => [body.id, body])));
    setStep(simulated.step);
    setStateHash(simulated.stateHash());
  };

  const panels = (
    <>
      <section className="panel" aria-label="Lab parameters">
        <div className="panel-head">
          <h2 className="panel-title">Lab parameters</h2>
        </div>
        <div className="panel-body">
          {parameters.map((parameter) => (
            <div className="field" key={parameter.key}>
              <label htmlFor={`slider-${parameter.key}`}>{parameter.label}</label>
              <div className="row">
                <input
                  id={`slider-${parameter.key}`}
                  type="range"
                  aria-label={parameter.label}
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.step}
                  disabled={running}
                  value={values[parameter.key] ?? parameter.value}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [parameter.key]: Number(event.target.value),
                    }))
                  }
                  style={{ flex: 1 }}
                />
                <span className="num">
                  {values[parameter.key] ?? parameter.value} {parameter.unit}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" aria-label="Derived readouts">
        <div className="panel-head">
          <h2 className="panel-title">Derived readouts</h2>
        </div>
        <div className="panel-body readouts" aria-live="polite">
          {readoutObjects.map((object) => {
            const params: ParamValues = object.params;
            return derivedReadouts(object.kind, params, overridden?.gravity ?? null).map(
              (readout) => (
                <span className="readout" key={`${object.id}-${readout.label}`}>
                  {object.name} · {readoutText(readout)}
                </span>
              ),
            );
          })}
        </div>
      </section>
    </>
  );

  return (
    <div className="editor">
      <Toolbar>
        <button
          type="button"
          data-chip
          className={running ? 'chip go' : 'chip'}
          onClick={() => (running ? stop() : start())}
        >
          {running ? 'Stop' : 'Run'}
        </button>
        <button type="button" data-chip className="chip" disabled={!running} onClick={pause}>
          {mode === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button type="button" data-chip className="chip" disabled={!running} onClick={stepOnce}>
          Step
        </button>
        <ToolbarDivider />
        <Wordmark />
      </Toolbar>
      <div className="editor-split">
        <div className="stage-wrap">
          <h1 className="lab-title">{lab?.lab.sceneName ?? pageCopy.loading}</h1>
          <Stage
            document={overridden}
            bodies={bodies}
            selectedId={null}
            hiddenIds={new Set()}
            grid
            colliders={false}
            extents={new Map()}
            cursors={[]}
            view={null}
          />
          <Telemetry fps={fps} frameMs={frameMs} step={step} stateHash={stateHash} />
          {running ? (
            <>
              <span className="mode-pill" role="status" aria-label="Mode">
                {mode === 'paused' ? 'PAUSED' : 'RUNNING'}
              </span>
              <span className="centre-mark" role="img" aria-label="Centre mark">
                +
              </span>
            </>
          ) : null}
          {layout === 'floating' ? <div className="lab-panels">{panels}</div> : null}
        </div>
        {layout === 'docked' ? <div className="docked-column">{panels}</div> : null}
      </div>
      {layout === 'phone' ? (
        <div className="sheet">
          <div role="tablist" aria-label="Lab panels">
            {(['Parameters', 'Readouts'] as const).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="panel-body">
            {tab === 'Parameters' ? (
              <section aria-label="Lab parameters">
                {parameters.map((parameter) => (
                  <div className="field" key={parameter.key}>
                    <label htmlFor={`sheet-${parameter.key}`}>{parameter.label}</label>
                    <div className="row">
                      <input
                        id={`sheet-${parameter.key}`}
                        type="range"
                        aria-label={parameter.label}
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                        disabled={running}
                        value={values[parameter.key] ?? parameter.value}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [parameter.key]: Number(event.target.value),
                          }))
                        }
                        style={{ flex: 1 }}
                      />
                      <span className="num">
                        {values[parameter.key] ?? parameter.value} {parameter.unit}
                      </span>
                    </div>
                  </div>
                ))}
              </section>
            ) : (
              <section className="readouts" aria-label="Derived readouts" aria-live="polite">
                {readoutObjects.map((object) =>
                  derivedReadouts(object.kind, object.params, overridden?.gravity ?? null).map(
                    (readout) => (
                      <span className="readout" key={`${object.id}-${readout.label}`}>
                        {object.name} · {readoutText(readout)}
                      </span>
                    ),
                  ),
                )}
              </section>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
