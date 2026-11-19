import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from '../ui';
import { advancePreview, previewFrame, previewPlan, shownMs, SPEEDS, stepPreview, type PreviewCursor, type Speed, type Tag } from '../../shared/timeline';
import { Icon } from '../icons';

export interface PreviewProps {
  frameCount: number;
  durations: readonly number[];
  tags: readonly Tag[];
  /** Paints one frame (1-based) onto the preview canvas. */
  drawFrame: (canvas: HTMLCanvasElement, frame: number) => void;
  /** Changes whenever the artwork shown may have changed. */
  version: number;
  finished: (passes: number) => void;
  size: { width: number; height: number };
}

const START: PreviewCursor = { position: 0, pass: 1, finished: false };

/** The animation preview: plays the chosen sequence on browser timers, or steps under reduced motion. */
export function PreviewPanel({ frameCount, durations, tags, drawFrame, version, finished, size }: PreviewProps): JSX.Element {
  const reduced = reducedMotion();
  const [tagId, setTagId] = useState<number | null>(null);
  const [speed, setSpeed] = useState<Speed>('Normal');
  const [playing, setPlaying] = useState(!reduced);
  const [cursor, setCursor] = useState<PreviewCursor>(START);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tag = tags.find((t) => t.id === tagId) ?? null;
  const plan = previewPlan(tag, frameCount);
  const frame = Math.min(frameCount, Math.max(1, previewFrame(plan, cursor)));
  const autoplay = playing && !cursor.finished && !reduced;
  const scale = Math.max(1, Math.floor(Math.min(160 / size.width, 160 / size.height)));

  useLayoutEffect(() => {
    if (canvasRef.current) drawFrame(canvasRef.current, frame);
  }, [frame, version, drawFrame]);

  useLayoutEffect(() => {
    if (!autoplay) return;
    const timer = setTimeout(() => {
      const next = advancePreview(plan, cursor);
      setCursor(next);
      if (next.finished) {
        setPlaying(false);
        finished(next.pass);
      }
    }, shownMs(durations[frame - 1] ?? 100, speed));
    return () => clearTimeout(timer);
  }, [autoplay, cursor, speed, frame, tagId, plan.sequence.length]);

  const choose = (value: string): void => {
    setTagId(value === 'all' ? null : Number(value));
    setCursor(START);
  };

  const toggle = (): void => {
    if (cursor.finished) {
      setCursor(START);
      setPlaying(true);
    } else setPlaying(!playing);
  };

  return (
    <section class="panel lemon" aria-label="Preview">
      <h2 class="panel-title">Preview</h2>
      <div class="panel-body">
        <div class="preview-stage">
          <canvas
            ref={canvasRef}
            class="preview-canvas"
            width={size.width}
            height={size.height}
            style={{ width: `${size.width * scale}px`, height: `${size.height * scale}px` }}
            data-preview-frame={frame}
            data-preview-mode={autoplay ? 'autoplay' : 'step'}
            data-preview-pass={cursor.pass}
          />
        </div>
        <div class="row">
          <label class="field-label compact">
            Preview tag
            <select class="input" value={tagId ?? 'all'} onChange={(event) => choose((event.currentTarget as HTMLSelectElement).value)}>
              <option value="all">All frames</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label class="field-label compact">
            Preview speed
            <select class="input" value={speed} onChange={(event) => setSpeed((event.currentTarget as HTMLSelectElement).value as Speed)}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="row">
          <button type="button" class="pill" onClick={() => setCursor({ ...cursor, position: stepPreview(plan, cursor.position, -1), finished: false })}>
            <Icon name="left" />
            Previous frame
          </button>
          {!reduced && (
            <button type="button" class="pill" onClick={toggle}>
              {autoplay ? 'Pause preview' : 'Play preview'}
            </button>
          )}
          <button type="button" class="pill" onClick={() => setCursor({ ...cursor, position: stepPreview(plan, cursor.position, 1), finished: false })}>
            Next frame
            <Icon name="right" />
          </button>
        </div>
      </div>
    </section>
  );
}
