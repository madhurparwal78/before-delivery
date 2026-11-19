import { Shapes } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { copy } from "../../shared/copy";
import type { Snapshot, Snapshot3d } from "../../shared/types";
import type { EditorProps } from "../editors/contract";
import { useStatus } from "../lib/status";
import { hasWebGL } from "../render";
import { Dialog } from "../ui/Dialog";
import { AlignDialog } from "./AlignDialog";
import { publishedAzimuth, publishedDistance } from "./camera";
import { Inspector } from "./Inspector";
import { trimmed, vectorText, wholeDegrees } from "./model";
import { attachPointerControls } from "./pointer";
import { SceneView } from "./scene";
import { WorkshopStore, type WorkshopState } from "./store";
import { summarise } from "./summary";
import { EditTools, ShapeButtons, ToolButton } from "./Tools";
import { FlatView } from "./FlatView";
import "./workshop.css";

const NARROW_QUERY = "(max-width: 599px)";

function requireDesign(snapshot: Snapshot): Snapshot3d {
  if (snapshot.kind !== "3d") throw new Error("The 3D Workshop opens 3D designs only.");
  return snapshot;
}

function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(NARROW_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
  );
}

/** The hidden scene description the page publishes for tests and assistive tooling: one child per top-level object. */
function SceneState({ state }: { state: WorkshopState }) {
  const summary = useMemo(() => summarise(state.design.objects, state.groups), [state.design.objects, state.groups]);
  const { workplane } = state.design;
  return (
    <div
      id="qy-scene"
      className="sr-only"
      aria-hidden="true"
      data-mesh-count={summary.items.length}
      data-total-volume={summary.totalVolume}
      data-triangle-count={summary.triangles}
      data-selected={state.selected.join(",")}
      data-workplane-normal={vectorText(workplane.normal)}
      data-workplane-origin={vectorText(workplane.origin)}
      data-camera-azimuth={publishedAzimuth(state.camera)}
      data-camera-distance={publishedDistance(state.camera)}
    >
      {summary.items.map(({ object, volume }) => (
        <div
          key={object.id}
          data-object-id={object.id}
          data-kind={object.kind}
          data-mode={object.mode}
          data-x={trimmed(object.x, 2)}
          data-y={trimmed(object.y, 2)}
          data-z={trimmed(object.z, 2)}
          data-w={trimmed(object.w, 2)}
          data-d={trimmed(object.d, 2)}
          data-h={trimmed(object.h, 2)}
          data-rotation-z={wholeDegrees(object.rotationZ)}
          data-volume={Math.round(volume)}
        />
      ))}
    </div>
  );
}

function GlCanvas({ store, mode }: { store: WorkshopStore; mode: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const view = new SceneView(canvas, store);
    const release = attachPointerControls(canvas, view, store);
    store.canvas = canvas;
    return () => {
      release();
      view.dispose();
      store.canvas = null;
    };
  }, [store]);
  return <canvas ref={ref} className="workshop-canvas" role="application" aria-label="3D workplane" tabIndex={0} data-mode={mode} />;
}

/** The 3D Workshop editor body: shape and editing buttons, the workplane canvas, and the Inspector. */
export default function Workshop3D({ snapshot, documentKey, readOnly, onChange, controllerRef }: EditorProps) {
  const { announce } = useStatus();
  const [alignOpen, setAlignOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const loadedKey = useRef(documentKey);
  const narrow = useNarrow();
  const [store] = useState(
    () => new WorkshopStore(requireDesign(snapshot), { announce, onChange, openAlign: () => setAlignOpen(true) }),
  );
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const webgl = useMemo(hasWebGL, []);

  useLayoutEffect(() => {
    store.hooks = { announce, onChange, openAlign: () => setAlignOpen(true) };
    store.setReadOnly(readOnly);
  });

  useLayoutEffect(() => {
    if (loadedKey.current === documentKey) return;
    loadedKey.current = documentKey;
    store.load(requireDesign(snapshot));
    setAlignOpen(false);
  }, [documentKey]);

  useEffect(() => {
    controllerRef.current = store.controller;
    return () => {
      if (controllerRef.current === store.controller) controllerRef.current = null;
    };
  }, [store, controllerRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (store.handleKey(event)) event.preventDefault();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [store]);

  const blocked = readOnly || state.grouping;
  const hint = state.mode === "rotate" ? copy.rotateHint : state.mode === "pickFace" ? copy.pickFaceHint : null;
  return (
    <div className="workshop" ref={rootRef}>
      <SceneState state={state} />
      <div className="workshop-stage">
        {webgl ? <GlCanvas store={store} mode={state.mode} /> : <FlatView store={store} />}
        {hint ? <p className="stage-hint">{hint}</p> : null}
      </div>
      <div className="workshop-tools">
        {narrow ? (
          <ToolButton primary label="Shapes" icon={<Shapes size={20} aria-hidden="true" />} disabled={blocked} onClick={() => setSheetOpen(true)} />
        ) : (
          <section className="tool-section" aria-labelledby="tools-shapes">
            <h3 id="tools-shapes" className="tool-heading">Add a shape</h3>
            <ShapeButtons store={store} state={state} />
          </section>
        )}
        <EditTools store={store} state={state} />
      </div>
      <Inspector state={state} store={store} narrow={narrow} />
      <Dialog open={narrow && sheetOpen} title="Shapes" className="sheet" onClose={() => setSheetOpen(false)}>
        <ShapeButtons store={store} state={state} added={() => setSheetOpen(false)} />
      </Dialog>
      <AlignDialog open={alignOpen} count={state.selected.length} onClose={() => setAlignOpen(false)} onAlign={(axis) => store.alignSelection(axis)} />
    </div>
  );
}
