import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PAGES } from "../../shared/copy";
import { createStage, type CameraViewName, type SceneView } from "../stage/scene";
import type { LoadedModel } from "../stage/models";
import type { EditorStore } from "./store";
import { STAGE_VIEWS } from "./views";

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useStore(store: EditorStore): ReturnType<EditorStore["getSnapshot"]> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}


export function StageHost({ store, onNudge }: { store: EditorStore; onNudge: (event: React.KeyboardEvent) => void }): JSX.Element {
  const state = useStore(store);
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SceneView | null>(null);

  useEffect(() => {
    const created = createStage(host.current as HTMLDivElement, true, reducedMotion());
    if (!created) {
      store.setWebgl(false);
      return;
    }
    store.stage = created;
    created.events = {
      onPick: (id) => {
        if (id && store.state.pickLocked.includes(id)) return;
        store.select(id);
      },
      onGizmo: (commit) => store.applyGizmo(commit),
      onGround: (point) => store.setCursor(point),
      onCamera: () => cameraTick(),
      onFrame: store.runner.frame,
    };
    setView(created);
    let pending = false;
    function cameraTick(): void {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        store.bumpCamera();
      });
    }
    return () => {
      created.dispose();
      store.stage = null;
    };
  }, [store]);

  const models = store.models as ReadonlyMap<string, LoadedModel>;
  useEffect(() => {
    if (!view) return;
    view.setDocument(state.doc, models);
    view.setPoses(store.runner.currentPoses());
  }, [view, state.doc, state.modelsVersion, models, store]);
  useEffect(() => {
    view?.setHidden(new Set(state.hidden));
  }, [view, state.hidden]);
  useEffect(() => {
    view?.setOptions({ grid: state.grid, colliders: state.colliders, tool: state.tool, snap: state.snap }, state.colliders ? store.runner.colliders : []);
  }, [view, state.grid, state.colliders, state.tool, state.snap, state.doc, store]);
  useEffect(() => {
    view?.setSelection(state.mode === "edit" ? state.selection : null, store.fieldsEditable(state.selection));
  }, [view, state.selection, state.holds, state.mode, state.role, state.demoted, state.services.locks, state.conflict, store]);

  return (
    <div className="stage-host" ref={host} role="application" aria-label="Stage" tabIndex={0} onKeyDown={onNudge} onPointerDownCapture={() => host.current?.focus({ preventScroll: true })}>
      {!state.webgl ? <p className="no-webgl">{PAGES.noWebgl}</p> : null}
      {view
        ? state.people
            .filter((p) => p.userId !== state.user.id && p.cursor !== null)
            .map((p) => {
              const spot = view.project(p.cursor as [number, number, number]);
              return spot.visible ? (
                <div key={p.userId} className="remote-cursor" role="img" aria-label={`Cursor: ${p.displayName}`} style={{ left: spot.x, top: spot.y }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M1 1 L12 6 L7 7.5 L5.5 12.5 Z" fill="currentColor" stroke="#1e1e2e" strokeWidth="1" />
                  </svg>
                  <span className="cursor-tag">{p.displayName}</span>
                </div>
              ) : null;
            })
        : null}
    </div>
  );
}

export function CameraWidget({ store }: { store: EditorStore }): JSX.Element {
  return (
    <div className="camera-widget" role="group" aria-label="Camera view">
      {STAGE_VIEWS.map((v) => (
        <button key={v.name} type="button" className={`view-btn ${v.stripe}`} onClick={() => store.stage?.viewTo(v.name as CameraViewName)}>
          {v.name}
        </button>
      ))}
    </div>
  );
}

export function TelemetryCard({ store, extra }: { store: EditorStore; extra?: React.ReactNode }): JSX.Element {
  const { telemetry } = useStore(store);
  const [more, setMore] = useState(false);
  return <TelemetryView telemetry={telemetry} more={more} onMore={() => setMore((m) => !m)} fullHash={more ? store.fullHash() : null} extra={extra} />;
}

function fpsBand(fps: number): string {
  return fps >= 50 ? "good" : fps >= 30 ? "mid" : "low";
}

export function TelemetryView({ telemetry, more, onMore, fullHash, extra }: { telemetry: { fps: number; ms: number; step: number; hash: string }; more: boolean; onMore: () => void; fullHash: string | null; extra?: React.ReactNode }): JSX.Element {
  return (
    <div className="telemetry" role="group" aria-label="Run telemetry">
      <button type="button" className="expander" aria-label="More telemetry" aria-expanded={more} onClick={onMore}>
        ▸
      </button>
      <div className={`fps ${fpsBand(telemetry.fps)}`}>fps {telemetry.fps}</div>
      <div>ms {telemetry.ms.toFixed(1)}</div>
      <div>step {telemetry.step}</div>
      <div>hash {telemetry.hash.slice(0, 12)}</div>
      {more && fullHash ? <div className="full-hash">{fullHash}</div> : null}
      {extra}
    </div>
  );
}
