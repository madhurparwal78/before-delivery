import { useEffect, useRef, useState } from 'react';
import { useStage } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { StageRenderer, type MotionMode } from '../stage/renderer.js';

/**
 * One fixed full-bleed venue stage, mounted across every route and never
 * reloaded between screens.
 */
export function Stage(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<StageRenderer | null>(null);
  const { state, patch } = useStage();
  const reducedMotion = useReducedMotion();
  const [motion, setMotion] = useState<MotionMode>('animated');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const renderer = new StageRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setReducedMotion(reducedMotion);
    setMotion(renderer.motionMode);
    renderer.resize();

    const onResize = (): void => renderer.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      renderer.destroy();
      rendererRef.current = null;
    };
    // The renderer is created once; motion changes are applied below.
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setReducedMotion(reducedMotion);
    setMotion(renderer.motionMode);
    renderer.update(state);
  }, [reducedMotion, state]);

  // Pointer movement tilts the camera a little, settling quickly.
  useEffect(() => {
    if (reducedMotion) return undefined;
    const onPointer = (event: PointerEvent): void => {
      patch({
        pointerX: (event.clientX / window.innerWidth) * 2 - 1,
        pointerY: (event.clientY / window.innerHeight) * 2 - 1,
      });
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => window.removeEventListener('pointermove', onPointer);
  }, [patch, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className="stage"
      role="img"
      aria-label="Venue stage"
      data-scene={state.scene}
      data-motion={motion}
      {...(state.scene === 'landing' ? { 'data-keyframe': String(state.keyframe) } : {})}
      data-room-width={state.roomWidthM === null ? '' : String(state.roomWidthM)}
      data-room-depth={state.roomDepthM === null ? '' : String(state.roomDepthM)}
      data-silhouette={state.silhouette}
      data-dust={String(state.dust)}
    />
  );
}
