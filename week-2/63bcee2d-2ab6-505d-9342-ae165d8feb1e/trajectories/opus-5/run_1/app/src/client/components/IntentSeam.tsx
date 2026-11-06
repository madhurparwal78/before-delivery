/**
 * The Intent seam. The render fills the frame's left part and the latest site
 * photo the right part, split at round(s × W / 100). It moves by pointer at
 * once, by touch after 8 px of mostly-horizontal movement, and by Arrow,
 * Shift+Arrow, Home and End.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SNAG_STATE_LABELS,
  SNAG_STATE_SHAPES,
  type SnagState,
} from '../../shared/domain.js';
import { DURATION_MEDIUM, prefersReducedMotion, watchReducedMotion } from '../lib/motion.js';
import { Shape } from './Shapes.jsx';

export interface SeamSnag {
  id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  state: SnagState;
}

const TOUCH_SLOP_PX = 8;
const NEAR_SEAM = 2;

export function isNearSeam(snagS: number, seam: number): boolean {
  return Math.abs(snagS - seam) <= NEAR_SEAM;
}

export function IntentSeam({
  renderUrl,
  photoUrl,
  seam,
  onSeamChange,
  snags,
  activeSnagId,
  onSelectSnag,
  onMoveSnag,
  onOpenDropSheet,
  droppedSnagId,
  labelId,
}: {
  renderUrl: string;
  photoUrl: string;
  seam: number;
  onSeamChange: (next: number) => void;
  snags: readonly SeamSnag[];
  activeSnagId: string;
  onSelectSnag: (id: string) => void;
  onMoveSnag: (id: string, s: number, y: number) => void;
  onOpenDropSheet: () => void;
  droppedSnagId: string | null;
  labelId: string;
}): JSX.Element {
  const frame = useRef<HTMLDivElement | null>(null);
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  const pointerDrag = useRef<{ pointerId: number } | null>(null);
  const touchDrag = useRef<{
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const markerDrag = useRef<{ pointerId: number; id: string; moved: boolean } | null>(null);
  const movedMarker = useRef(false);

  useEffect(() => watchReducedMotion(setReduced), []);

  const seamFromClientX = useCallback((clientX: number): number => {
    const node = frame.current;
    if (!node) return 0;
    const box = node.getBoundingClientRect();
    const fraction = (clientX - box.left) / box.width;
    return Math.max(0, Math.min(100, Math.round(fraction * 100)));
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (markerDrag.current) return;
    pointerDrag.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeamChange(seamFromClientX(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const marker = markerDrag.current;
    if (marker && marker.pointerId === event.pointerId) {
      const node = frame.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const across = seamFromClientX(event.clientX);
      const down = Math.max(
        0,
        Math.min(100, Math.round(((event.clientY - box.top) / box.height) * 100)),
      );
      marker.moved = true;
      movedMarker.current = true;
      onMoveSnag(marker.id, across, down);
      return;
    }
    const state = pointerDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    onSeamChange(seamFromClientX(event.clientX));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (markerDrag.current?.pointerId === event.pointerId) markerDrag.current = null;
    if (pointerDrag.current?.pointerId === event.pointerId) pointerDrag.current = null;
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    const point = event.touches[0];
    if (!point) return;
    touchDrag.current = { startX: point.clientX, startY: point.clientY, dragging: false };
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>): void => {
    const state = touchDrag.current;
    const point = event.touches[0];
    if (!state || !point) return;
    const dx = point.clientX - state.startX;
    const dy = point.clientY - state.startY;
    if (!state.dragging) {
      if (Math.hypot(dx, dy) < TOUCH_SLOP_PX) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        touchDrag.current = null;
        return;
      }
      state.dragging = true;
    }
    event.preventDefault();
    onSeamChange(seamFromClientX(point.clientX));
  };

  const onTouchEnd = (): void => {
    touchDrag.current = null;
  };

  const onSliderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const step = event.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = seam - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = seam + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    else if (event.key === 'Enter') {
      event.preventDefault();
      onOpenDropSheet();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    onSeamChange(Math.max(0, Math.min(100, next)));
  };

  return (
    <div>
      <div
        className="seam-frame"
        role="group"
        aria-label="Intent seam"
        data-seam={String(seam)}
        data-active-snag-id={activeSnagId}
        ref={frame}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="seam-layer"
          style={{
            backgroundImage: `url(${photoUrl})`,
            clipPath: `inset(0 0 0 ${seam}%)`,
          }}
        />
        <div
          className="seam-layer"
          style={{
            backgroundImage: `url(${renderUrl})`,
            clipPath: `inset(0 ${100 - seam}% 0 0)`,
          }}
        />
        <div className="seam-line" style={{ left: `${seam}%` }} />

        {snags.map((snag) => {
          const near = isNearSeam(snag.s, seam);
          return (
            <button
              key={snag.id}
              type="button"
              className={`snag-marker ${
                droppedSnagId === snag.id && !reduced ? 'snag-marker-drop' : ''
              }`.trim()}
              style={{
                left: `${snag.s}%`,
                top: `${snag.y}%`,
                transitionDuration: reduced ? '0.01ms' : `${DURATION_MEDIUM}ms`,
              }}
              data-snag-id={snag.id}
              data-state={snag.state}
              data-near={near ? 'true' : 'false'}
              onPointerDown={(event) => {
                if (event.pointerType === 'touch') return;
                // No pointer capture: capturing would retarget the click away
                // from the marker, and the frame already sees bubbled moves.
                event.stopPropagation();
                markerDrag.current = { pointerId: event.pointerId, id: snag.id, moved: false };
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (movedMarker.current) {
                  movedMarker.current = false;
                  return;
                }
                onSelectSnag(snag.id);
              }}
            >
              {`Snag ${snag.number}`}
              <Shape name={SNAG_STATE_SHAPES[snag.state]} />
              {SNAG_STATE_LABELS[snag.state]}
            </button>
          );
        })}
      </div>

      <div className="seam-slider-row">
        <label htmlFor={labelId}>Seam</label>
        <input
          id={labelId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={seam}
          aria-valuetext={`Render ${seam}%, photo ${100 - seam}%`}
          onChange={(event) => onSeamChange(Number(event.target.value))}
          onKeyDown={onSliderKeyDown}
        />
      </div>

      {reduced ? (
        <div className="seam-presets">
          <button type="button" onClick={() => onSeamChange(100)}>
            Render
          </button>
          <button type="button" onClick={() => onSeamChange(50)}>
            Split
          </button>
          <button type="button" onClick={() => onSeamChange(0)}>
            Photo
          </button>
        </div>
      ) : null}
    </div>
  );
}
