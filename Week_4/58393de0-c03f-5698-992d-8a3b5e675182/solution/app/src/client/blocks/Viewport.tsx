import { useEffect, useRef } from "react";
import type { DesignObject } from "../../shared/types";
import { TopView, hasWebGL } from "../render";
import { ViewportScene } from "./ViewportScene";

const FILL = { position: "relative", width: "100%", height: "100%", overflow: "hidden" } as const;
const CANVAS = { display: "block", width: "100%", height: "100%", touchAction: "pan-y" } as const;

function ViewportGl({ objects }: { objects: DesignObject[] }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ViewportScene | null>(null);
  const latest = useRef(objects);
  latest.current = objects;

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, CANVAS);
    element.appendChild(canvas);
    const created = new ViewportScene(canvas);
    created.setObjects(latest.current);
    created.draw();
    scene.current = created;
    return () => {
      created.dispose();
      canvas.remove();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.setObjects(objects);
  }, [objects]);

  return <div ref={host} style={FILL} />;
}

/** The output objects in 3D, or a flat top-view drawing when the page has no WebGL. */
export function Viewport({ objects }: { objects: DesignObject[] }) {
  return hasWebGL() ? <ViewportGl objects={objects} /> : <TopView objects={objects} />;
}
