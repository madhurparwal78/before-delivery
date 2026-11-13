import { useEffect, useRef, useState } from 'react';
import type { SceneRecord, ViewProjectResponse, ViewSceneResponse } from '../../shared/api.js';
import { pageCopy } from '../../shared/copy.js';
import { POSITION_LABELS, specsFor } from '../../shared/params.js';
import type { SceneDocument } from '../../shared/scene.js';
import { MAX_STEPS_PER_FRAME, STEP_SECONDS, Simulation, type Body } from '../../shared/sim.js';
import { ApiFault, api } from '../api.js';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { Stage } from '../editor/Stage.jsx';
import { Telemetry } from '../editor/Telemetry.jsx';
import { useLayout } from '../editor/layout.js';

function DeadLink(): JSX.Element {
  return (
    <div className="screen">
      <Toolbar>
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <div className="panel">
          <div className="panel-body">
            <h1>{pageCopy.deadLink}</h1>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ViewProject({ token }: { token: string }): JSX.Element {
  const [data, setData] = useState<ViewProjectResponse | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    const load = (): void => {
      void api<ViewProjectResponse>(`/api/view/${token}`, { allowUnauthenticated: true })
        .then(setData)
        .catch((error: unknown) => {
          if (error instanceof ApiFault && error.status === 404) setDead(true);
        });
    };
    load();
    const timer = window.setInterval(load, 3_000);
    return () => window.clearInterval(timer);
  }, [token]);

  if (dead) return <DeadLink />;

  return (
    <div className="screen">
      <Toolbar>
        <span className="pill-status" role="status">
          View only
        </span>
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <section className="panel" aria-label="Scenes">
          <div className="panel-head">
            <h1 className="panel-title">{data ? data.project.name : pageCopy.loading}</h1>
          </div>
          <div className="panel-body">
            <ul className="list">
              {(data?.scenes ?? []).map((scene) => (
                <li key={scene.id}>
                  <a href={`/view/${token}/s/${scene.id}`}>{scene.name}</a>
                  <span className="muted num">{scene.stateHash.slice(0, 12)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export function ViewScene({ token, sceneId }: { token: string; sceneId: string }): JSX.Element {
  const layout = useLayout();
  const [scene, setScene] = useState<SceneRecord | null>(null);
  const [document_, setDocument] = useState<SceneDocument | null>(null);
  const [dead, setDead] = useState(false);
  const [extents, setExtents] = useState<ReadonlyMap<string, number>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'running' | 'paused'>('edit');
  const [step, setStep] = useState(0);
  const [stateHash, setStateHash] = useState('');
  const [fps, setFps] = useState(0);
  const [bodies, setBodies] = useState<ReadonlyMap<string, Body>>(new Map());
  const simulation = useRef<Simulation | null>(null);
  const handle = useRef(0);

  const load = (): void => {
    void api<ViewSceneResponse>(`/api/view/${token}/scenes/${sceneId}`, {
      allowUnauthenticated: true,
    })
      .then((response) => {
        setScene(response.scene);
        setDocument(response.document);
        setStateHash(response.scene.stateHash);
        setExtents(
          new Map(
            response.assets
              .filter((asset) => asset.extentMetres !== null)
              .map((asset) => [asset.id, asset.extentMetres as number]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFault && error.status === 404) setDead(true);
      });
  };

  useEffect(() => {
    load();
    const stream = new EventSource(`/api/view/${token}/scenes/${sceneId}/live`);
    stream.addEventListener('revision', () => load());
    stream.addEventListener('link_dead', () => {
      setDead(true);
      stream.close();
    });
    stream.addEventListener('error', () => undefined);
    return () => stream.close();
  }, [token, sceneId]);

  useEffect(() => {
    if (mode !== 'running' || !document_) return;
    let last = performance.now();
    let accumulator = 0;
    let telemetry = 0;
    const frame = (now: number): void => {
      const simulated = simulation.current;
      if (!simulated) return;
      const elapsed = Math.min((now - last) / 1000, 0.25);
      last = now;
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
        simulated.advanceOne();
        accumulator -= STEP_SECONDS;
        steps += 1;
      }
      setBodies(new Map(simulated.bodies().map((body) => [body.id, body])));
      if (now - telemetry > 500) {
        telemetry = now;
        setFps(Math.round(1000 / Math.max(elapsed * 1000, 1)));
        setStep(simulated.step);
        setStateHash(simulated.stateHash());
      }
      handle.current = requestAnimationFrame(frame);
    };
    handle.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle.current);
  }, [mode, document_]);

  if (dead) return <DeadLink />;

  const selected = document_?.objects.find((object) => object.id === selectedId) ?? null;
  const running = mode !== 'edit';

  const panels = (
    <>
      <section className="panel" aria-label="Outline">
        <div className="panel-head">
          <h2 className="panel-title">Outline</h2>
        </div>
        <div className="panel-body">
          <ul className="tree" role="tree" aria-label="Scene outline">
            {(document_?.objects ?? []).map((object) => (
              <li
                key={object.id}
                role="treeitem"
                aria-selected={selectedId === object.id}
                aria-label={object.name}
                tabIndex={0}
                onClick={() => setSelectedId(object.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelectedId(object.id);
                }}
              >
                <span className="name">{object.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="panel" aria-label="Inspector">
        <div className="panel-head">
          <h2 className="panel-title">Inspector</h2>
        </div>
        <div className="panel-body value-rows">
          {selected ? (
            <>
              {POSITION_LABELS.map((label, axis) => (
                <span key={label}>{`${label}: ${selected.position[axis]}`}</span>
              ))}
              {specsFor(selected.kind).map((spec) => (
                <span key={spec.key}>{`${spec.label}: ${selected.params[spec.key]}`}</span>
              ))}
            </>
          ) : (
            <>
              <span>{`Scene name: ${document_?.name ?? ''}`}</span>
              <span>{`Gravity (m/s²): ${document_?.gravity ?? ''}`}</span>
            </>
          )}
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
          onClick={() => {
            if (running) {
              cancelAnimationFrame(handle.current);
              setMode('edit');
              setBodies(new Map());
              setStep(0);
              setStateHash(scene?.stateHash ?? '');
              return;
            }
            if (!document_) return;
            simulation.current = new Simulation(document_);
            setMode('running');
          }}
        >
          {running ? 'Stop' : 'Run'}
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          disabled={!running}
          onClick={() => {
            if (mode === 'running') {
              cancelAnimationFrame(handle.current);
              setMode('paused');
              const simulated = simulation.current;
              if (simulated) {
                setStep(simulated.step);
                setStateHash(simulated.stateHash());
              }
            } else setMode('running');
          }}
        >
          {mode === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          data-chip
          className="chip"
          disabled={!running}
          onClick={() => {
            cancelAnimationFrame(handle.current);
            setMode('paused');
            const simulated = simulation.current;
            if (!simulated) return;
            simulated.advanceOne();
            setBodies(new Map(simulated.bodies().map((body) => [body.id, body])));
            setStep(simulated.step);
            setStateHash(simulated.stateHash());
          }}
        >
          Step
        </button>
        <ToolbarDivider />
        <span className="pill-status" role="status">
          View only
        </span>
        <Wordmark />
      </Toolbar>
      <div className="editor-split">
        <div className="stage-wrap">
          <h1 className="visually-hidden">{scene?.name ?? pageCopy.loading}</h1>
          <Stage
            document={document_}
            bodies={bodies}
            selectedId={selectedId}
            hiddenIds={new Set()}
            grid
            colliders={false}
            extents={extents}
            cursors={[]}
            view={null}
            onPick={(objectId) => setSelectedId(objectId)}
          />
          <Telemetry fps={fps} frameMs={0} step={step} stateHash={stateHash} />
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
      {layout === 'phone' ? <div className="sheet">{panels}</div> : null}
    </div>
  );
}
