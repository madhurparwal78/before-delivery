import '../styles/stage.css';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { SceneEngine, type RendererKind } from './engine';
import type { Prepared, SceneState } from './display';
import type { AssetLoader } from './assets';

export interface SurfaceHandle {
  /** Draws a state and remembers it for resizes. */
  draw: (state: SceneState) => void;
  readonly prepared: Prepared | null;
  readonly host: HTMLElement | null;
}

interface SurfaceProps {
  /** Ask for a WebGL2 stage for the solids; the 2D canvas is used when it is unavailable or not wanted. */
  webgl: boolean;
  loader: AssetLoader;
  className?: string;
  onKind?: (kind: RendererKind) => void;
}

/** Hosts one `SceneEngine` in a box that fills its parent and follows its size. */
export const SceneSurface = forwardRef<SurfaceHandle, SurfaceProps>(function SceneSurface({ webgl, loader, className, onKind }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<SceneEngine | null>(null);
  const last = useRef<SceneState | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const [kind, setKind] = useState<RendererKind | null>(null);

  const draw = (state: SceneState): void => {
    last.current = state;
    const current = engine.current;
    if (current && size.current.width > 0) current.render(state, size.current.width, size.current.height, window.devicePixelRatio || 1);
  };

  useLayoutEffect(() => {
    const element = host.current as HTMLDivElement;
    const created = new SceneEngine(element, webgl, loader);
    engine.current = created;
    setKind(created.kind);
    onKind?.(created.kind);
    const observer = new ResizeObserver(() => {
      size.current = { width: element.clientWidth, height: element.clientHeight };
      if (last.current) draw(last.current);
    });
    observer.observe(element);
    const unsubscribe = loader.subscribe(() => {
      if (last.current) draw(last.current);
    });
    return () => {
      observer.disconnect();
      unsubscribe();
      created.destroy();
      engine.current = null;
    };
    // The engine is created once per surface; `draw` reads refs only.
  }, [webgl, loader]);

  useImperativeHandle(ref, () => ({ draw, get prepared() { return engine.current?.prepared ?? null; }, get host() { return host.current; } }));

  return <div ref={host} className={`scene-host ${className ?? ''}`} data-renderer={kind ?? undefined} />;
});
