import { Move3d, Rotate3d, Scale3d } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GizmoMode } from "../engine/renderer.ts";
import { StageController } from "../engine/stage-controller.ts";
import type { StageSource } from "../engine/stage-source.ts";
import type { EditorStore } from "../store/editor.ts";

export const NO_WEBGL = "This browser can't draw the stage. Your set still saves.";

/** Mounts the stage canvas and its controller; `source` is the editor store or the show page's source. */
export function useStage(source: StageSource, assetUrl: (id: string) => string): {
  canvas: React.RefObject<HTMLCanvasElement | null>;
  controller: StageController | null;
  failed: boolean;
} {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [controller, setController] = useState<StageController | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    const made = new StageController(canvas.current, source, { url: assetUrl });
    if (!made.available) setFailed(true);
    setController(made);
    return () => made.dispose();
  }, [source]);
  return { canvas, controller, failed };
}

const MODES: { mode: GizmoMode; label: string; Icon: typeof Move3d }[] = [
  { mode: "move", label: "Move", Icon: Move3d },
  { mode: "rotate", label: "Rotate", Icon: Rotate3d },
  { mode: "scale", label: "Scale", Icon: Scale3d },
];

export function StageView({ store }: { store: EditorStore }) {
  const { canvas, controller, failed } = useStage(store, (id) => `/api/assets/${id}/content`);
  useEffect(() => {
    store.compiler = (text) => controller?.compile(text) ?? null;
    return () => {
      store.compiler = null;
    };
  }, [controller, store]);
  const cameras = store.doc.layers.filter((layer) => layer.kind === "camera");
  return (
    <div className="stage" data-region="stage">
      {failed ? (
        <p className="stage-fallback">{NO_WEBGL}</p>
      ) : (
        <canvas ref={canvas} role="img" aria-label="Stage viewport" className="stage-canvas" />
      )}
      <div role="toolbar" aria-label="Gizmos" className="gizmo-strip">
        {MODES.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={store.gizmoMode === mode}
            aria-label={label}
            title={label}
            className="tool"
            onClick={() => store.setGizmoMode(mode)}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div role="toolbar" aria-label="Snapping" className="snap-strip">
        <button type="button" className="pill" aria-pressed={store.gridSnap} onClick={() => store.toggleSnap("grid")}>Grid snap</button>
        <button type="button" className="pill" aria-pressed={store.angleSnap} onClick={() => store.toggleSnap("angle")}>Angle snap</button>
      </div>
      <select
        className="select camera-pick"
        aria-label="Stage camera"
        value={store.doc.set.active_camera_id ?? ""}
        disabled={!store.canEdit || cameras.length === 0}
        onChange={(event) => store.commit({ type: "set.update", target: "set", payload: { active_camera_id: event.target.value } })}
      >
        {cameras.length === 0 ? <option value="">Default view</option> : null}
        {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
      </select>
    </div>
  );
}
