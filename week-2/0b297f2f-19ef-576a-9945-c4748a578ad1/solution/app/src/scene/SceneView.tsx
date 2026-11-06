import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NO_WEBGL } from "../copy";
import type { View } from "../types";
import { SceneDirector, type DirectorHooks, type SceneRenderer } from "./director";
import { FlatRenderer } from "./flat";
import { GlRenderer } from "./gl";
import type { WallSpec, WorkSpec } from "./room";

export interface SceneHandle {
  setView: (view: View) => void;
  restore: (view: View, eye: boolean) => void;
  eyeLevel: () => boolean;
}

interface Props {
  label: string;
  walls: WallSpec[];
  works: WorkSpec[];
  selectedId: string | null;
  /** The wall the eye-line view faces when nothing is selected. */
  facingWallId?: string | null;
  reduced: boolean;
  hooks: DirectorHooks;
  children?: ReactNode;
}

function createRenderer(): SceneRenderer {
  try {
    return new GlRenderer();
  } catch {
    return new FlatRenderer();
  }
}

/** The scene region: the 3D gallery (or its flat drawing), the work markers and the eye readout. */
export const SceneView = forwardRef<SceneHandle, Props>(function SceneView({ label, walls, works, selectedId, facingWallId = null, reduced, hooks, children }, ref) {
  const region = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLParagraphElement>(null);
  const director = useRef<SceneDirector | null>(null);
  const hookRef = useRef(hooks);
  hookRef.current = hooks;
  const [flat, setFlat] = useState(false);

  useLayoutEffect(() => {
    const renderer = createRenderer();
    setFlat(renderer.kind === "flat");
    stage.current!.appendChild(renderer.element);
    const relay: DirectorHooks = {
      onSettled: (v) => hookRef.current.onSettled?.(v),
      onSelect: (id) => hookRef.current.onSelect?.(id),
      canMove: (id) => hookRef.current.canMove?.(id) ?? false,
      onNotMovable: (id) => hookRef.current.onNotMovable?.(id),
      onDrag: hookRef.current.onDrag ? (id, mm) => hookRef.current.onDrag?.(id, mm) : undefined,
      onDragEnd: (id) => hookRef.current.onDragEnd?.(id),
    };
    director.current = new SceneDirector(region.current!, layer.current!, readout.current!, renderer, reduced, relay);
    return () => {
      director.current?.dispose();
      director.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    director.current?.setData(walls, works, selectedId, facingWallId);
  }, [walls, works, selectedId, facingWallId]);

  useImperativeHandle(
    ref,
    () => ({
      setView: (view) => director.current?.setView(view),
      restore: (view, eye) => director.current?.restore(view, eye),
      eyeLevel: () => director.current?.eyeLevel ?? false,
    }),
    [],
  );

  return (
    <section ref={region} aria-label={label} className="scene" tabIndex={0}>
      <div ref={stage} className="scene-stage" />
      <div ref={layer} className="scene-markers" />
      <div className="scene-readouts">
        <p ref={readout} className="scene-readout">
          Plan view
        </p>
      </div>
      {flat && <p className="scene-notice">{NO_WEBGL}</p>}
      {children}
    </section>
  );
});
