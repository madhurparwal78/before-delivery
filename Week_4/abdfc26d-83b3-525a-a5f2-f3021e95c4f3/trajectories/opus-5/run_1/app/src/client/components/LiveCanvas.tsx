import { useEffect, useRef, useState } from 'react';
import { noWebglNotice } from '../../shared/copy.js';
import { useOnScreen, useReducedMotion } from '../lib/hooks.js';
import {
  createShaderCanvas,
  drawStillFallback,
  webglAvailable,
  type CompileReport,
  type ShaderCanvasHandle,
  type ShaderUniform,
} from '../lib/shaderCanvas.js';

export interface LiveCanvasProps {
  readonly fragmentSource: string;
  readonly uniforms: readonly ShaderUniform[];
  readonly seed: number;
  readonly className?: string;
  /** Forces one still frame at `time`, as the editor does at its playhead. */
  readonly stillAt?: number | null;
  readonly onCompile?: (report: CompileReport) => void;
}

/**
 * A piece canvas that runs its shader in real time, pauses while fully
 * off-screen, shows one still frame under reduced motion, and falls back to a
 * Canvas 2D frame without WebGL.
 */
export function LiveCanvas({
  fragmentSource,
  uniforms,
  seed,
  className,
  stillAt = null,
  onCompile,
}: LiveCanvasProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ShaderCanvasHandle | null>(null);
  const [hasWebgl] = useState(webglAvailable);
  const reducedMotion = useReducedMotion();
  const onScreen = useOnScreen(wrapperRef, '120px');

  // Reduced motion shows the base piece at time zero; the editor pins its playhead.
  const still = stillAt !== null || reducedMotion;
  const stillTime = stillAt ?? 0;
  const hue = uniforms.find((uniform) => uniform.name === 'uHue')?.value ?? 0.55;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!hasWebgl) {
      const paint = (): void => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        drawStillFallback(canvas, seed, hue);
      };
      paint();
      window.addEventListener('resize', paint);
      return () => window.removeEventListener('resize', paint);
    }

    const handle = createShaderCanvas(canvas, {
      fragmentSource,
      uniforms: [...uniforms],
      seed,
      still,
      time: stillTime,
    });
    handleRef.current = handle;
    onCompile?.(handle.report());
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragmentSource, hasWebgl]);

  useEffect(() => {
    if (!hasWebgl) {
      const canvas = canvasRef.current;
      if (canvas) drawStillFallback(canvas, seed, hue);
      return;
    }
    handleRef.current?.update({ uniforms: [...uniforms], seed, still, time: stillTime });
  }, [uniforms, seed, still, stillTime, hasWebgl, hue]);

  useEffect(() => {
    handleRef.current?.setVisible(onScreen);
  }, [onScreen]);

  return (
    <div className={`live-canvas ${className ?? ''}`} ref={wrapperRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {!hasWebgl && <p className="live-canvas__fallback">{noWebglNotice}</p>}
    </div>
  );
}
