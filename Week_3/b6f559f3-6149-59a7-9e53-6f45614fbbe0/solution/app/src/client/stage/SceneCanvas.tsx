import '../styles/stage.css';
import { useEffect, useMemo, useRef } from 'react';
import { ARTBOARDS, type AssetInfo, type Breakpoint, type SceneDocument } from '../../shared/types';
import { framesIn } from '../../shared/format';
import { publicSettings } from '../api';
import { AssetLoader } from './assets';
import { NO_DYNAMICS, type SceneState } from './display';
import { useDeviceReducedMotion } from './motion';
import { SceneSurface, type SurfaceHandle } from './SceneSurface';
import { useDescribedAssets } from './useAssets';

interface SceneCanvasProps {
  document: SceneDocument;
  /** Defaults to the document's first scene. */
  sceneId?: string;
  /** Asset descriptions the evaluator needs; when omitted they are loaded through `assetUrl`. */
  assets?: ReadonlyMap<string, AssetInfo>;
  /** Defaults to desktop. */
  breakpoint?: Breakpoint;
  /** A fixed timeline frame. Omit to show frame 0, or to play the timeline once from frame 0 with `playOnce`. */
  frame?: number;
  playOnce?: boolean;
  /** Defaults to the device's `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Where an asset's bytes come from. Defaults to `/api/assets/<id>/original`. */
  assetUrl?: (assetId: string) => string;
  className?: string;
  'aria-label'?: string;
}

const defaultUrl = (id: string): string => `/api/assets/${id}/original`;

/**
 * A small, self-driving scene view for covers and demos. It draws on a 2D canvas only (no WebGL context), at the
 * artboard's aspect ratio, and fills the width of its parent.
 */
export function SceneCanvas(props: SceneCanvasProps) {
  const { document: doc, breakpoint = 'desktop', playOnce = false } = props;
  const deviceReduced = useDeviceReducedMotion();
  const reduced = props.reducedMotion ?? deviceReduced;
  const urlOf = props.assetUrl ?? defaultUrl;
  const loader = useMemo(() => new AssetLoader(urlOf), [urlOf]);
  const described = useDescribedAssets(doc, loader, props.assets === undefined);
  const assets = props.assets ?? described;
  const surface = useRef<SurfaceHandle>(null);
  const scene = doc.scenes.find((s) => s.id === props.sceneId) ?? doc.scenes[0];
  const board = ARTBOARDS[breakpoint];

  useEffect(() => {
    if (!scene) return;
    const draw = (frame: number): void =>
      surface.current?.draw({
        document: doc,
        scene,
        assets,
        breakpoint,
        frame,
        scroll: 0,
        reducedMotion: reduced,
        dynamics: NO_DYNAMICS,
        particleMax: publicSettings().particleMax,
        lightFocus: { x: 0.8, y: 0.9 },
      } satisfies SceneState);
    if (!playOnce || reduced || props.frame !== undefined) {
      draw(props.frame ?? 0);
      return;
    }
    const last = framesIn(scene.durationMs);
    let start: number | null = null;
    let handle = 0;
    const step = (now: number): void => {
      start ??= now;
      const frame = Math.min(Math.floor(((now - start) * 60) / 1000), last);
      draw(frame);
      if (frame < last) handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [doc, scene, assets, breakpoint, props.frame, playOnce, reduced, loader]);

  return (
    <div className={`scene-cover ${props.className ?? ''}`} role="img" aria-label={props['aria-label']} style={{ aspectRatio: `${board.width} / ${board.height}` }}>
      <SceneSurface ref={surface} webgl={false} loader={loader} />
    </div>
  );
}
