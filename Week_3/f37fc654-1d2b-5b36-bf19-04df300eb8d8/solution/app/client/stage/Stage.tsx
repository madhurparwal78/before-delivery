// The one venue stage, fixed edge to edge behind every route and never unmounted.
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/motion";
import { keyframeOf, stage } from "./state";
import { StillStage } from "./still";
import { WebGLStage } from "./webgl";

type Renderer = { kind: "webgl"; stage: WebGLStage } | { kind: "still"; stage: StillStage };

export function Stage() {
  const state = stage.use();
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext("webgl2", { antialias: true, alpha: false });
    if (gl) setRenderer({ kind: "webgl", stage: new WebGLStage(element, gl) });
    else {
      const ctx = element.getContext("2d");
      if (ctx) setRenderer({ kind: "still", stage: new StillStage(element, ctx) });
    }
  }, []);

  useEffect(() => {
    if (renderer?.kind === "webgl") renderer.stage.update(state, reduced);
    else renderer?.stage.update(state);
  }, [renderer, state, reduced]);

  const motion = renderer?.kind === "still" ? "fallback" : reduced ? "still" : "animated";
  return (
    <div
      className={`stage stage-${state.scene}`}
      role="img"
      aria-label="Venue stage"
      data-scene={state.scene}
      data-motion={motion}
      data-keyframe={state.scene === "landing" ? keyframeOf(state.scroll) : undefined}
      data-room-width={state.roomW ?? ""}
      data-room-depth={state.roomD ?? ""}
      data-silhouette={state.silhouette}
      data-dust={state.dust}
    >
      <canvas ref={canvas} className="stage-canvas" />
    </div>
  );
}
