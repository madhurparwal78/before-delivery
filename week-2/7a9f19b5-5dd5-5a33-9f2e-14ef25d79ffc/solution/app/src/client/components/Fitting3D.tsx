// React wrappers around the Three.js views. Each falls back to a still line drawing when WebGL is unavailable.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LightState } from "../../shared/dial";
import { useDial } from "../lib/dial";
import { fittingKind, type FittingKind } from "../lib/format";
import { useReducedMotion } from "../lib/hooks";
import { webglContext } from "../three/fittings";
import { thumbnail } from "../three/thumbnails";
import { FittingViewer, type ViewerOptions } from "../three/viewer";
import { FittingDrawing } from "./Drawings";

interface StageProps {
  /** Null until the product has loaded; the stage is drawn straight away and the model joins it. */
  productName: string | null;
  code: string | null;
  finish: string;
  beam: number;
  cct: number;
  interactive?: boolean;
  /** The home scene keeps its dark gallery ambience in every lighting state. */
  fixedLight?: LightState;
  className?: string;
}

type StageState = "loading" | "ready" | "fallback";

/** The product viewer canvas: `img "<name> 3D model"` carrying data-yaw, data-beam, data-cct and data-idle. */
export function FittingStage({ productName, code, finish, beam, cct, interactive = true, fixedLight, className }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<FittingViewer | null>(null);
  const [state, setState] = useState<StageState>("loading");
  const dial = useDial();
  const light = fixedLight ?? dial.light;
  const reducedMotion = useReducedMotion();
  const kind = code ? fittingKind(code) : null;
  const options: ViewerOptions = { kind, finish, beam, cct, light, reducedMotion, interactive };
  const latest = useRef(options);
  latest.current = options;

  // The renderer starts in the first layout pass so the stage has drawn before the page finishes loading.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = webglContext(element);
    if (!context) {
      setState("fallback");
      return;
    }
    viewer.current = new FittingViewer(element, context, latest.current);
    setState("loading");
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    viewer.current?.update(latest.current);
    if (viewer.current && kind) setState("ready");
  }, [kind, finish, beam, cct, light, reducedMotion]);

  if (state === "fallback") {
    return (
      <div className={`stage stage--drawing ${className ?? ""}`}>
        {kind && <FittingDrawing kind={kind} finish={finish} beam={beam} cct={cct} label={`${productName} drawing`} className="stage__drawing" />}
      </div>
    );
  }
  return (
    <div className={`stage ${className ?? ""}`}>
      <canvas
        ref={canvas}
        className="stage__canvas"
        role={state === "ready" ? "img" : undefined}
        aria-label={state === "ready" ? `${productName} 3D model` : undefined}
        data-beam={beam}
        data-cct={cct}
      />
      {interactive && state === "ready" && <p className="stage__hint">Drag to turn</p>}
    </div>
  );
}

/** A still thumbnail of the 3D model for a card; the line drawing shows until it is ready, or without WebGL. */
export function FittingThumb({ code, finish, beam, cct }: { code: string; finish: string; beam: number; cct: number }) {
  const kind: FittingKind = fittingKind(code);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(thumbnail(kind, finish, beam, cct));
  }, [kind, finish, beam, cct]);
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" className="thumb__image" /> : <FittingDrawing kind={kind} finish={finish} beam={beam} cct={cct} className="thumb__image" />}
    </div>
  );
}
