/**
 * The featured rail: dragged with the pointer or finger, gliding with decaying
 * speed on release and settling with one card's left edge at the rail's start.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DURATION_LONG, prefersReducedMotion } from '../lib/motion.js';
import { Link } from '../lib/router.jsx';

export interface RailCard {
  slug: string;
  title: string;
  location: string;
  coverUrl: string;
}

const DRAG_OPENS_THRESHOLD_PX = 6;
const FLICK_SPEED_PX_PER_MS = 0.5;
const FRICTION_PER_MS = 0.0035;

export function FeaturedRail({ cards }: { cards: readonly RailCard[] }): JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const animation = useRef<number>(0);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startOffset: number;
    lastX: number;
    lastAt: number;
    speed: number;
    moved: number;
  } | null>(null);
  const suppressOpen = useRef(false);

  /**
   * Each card's start measured inside the track. The track's own translation
   * cancels out, so these do not depend on the current offset.
   */
  const cardStarts = useCallback((): number[] => {
    const trackNode = track.current;
    if (!trackNode) return [0];
    const trackLeft = trackNode.getBoundingClientRect().left;
    return [...trackNode.children].map(
      (child) => child.getBoundingClientRect().left - trackLeft,
    );
  }, []);

  const maxOffset = useCallback((): number => {
    const trackNode = track.current;
    const viewportNode = viewport.current;
    if (!trackNode || !viewportNode) return 0;
    return Math.max(0, trackNode.scrollWidth - viewportNode.clientWidth);
  }, []);

  const settleTo = useCallback(
    (target: number) => {
      const starts = cardStarts();
      const limit = maxOffset();
      const clamped = Math.max(0, Math.min(target, limit));
      const nearest = starts.reduce(
        (best, start) => (Math.abs(start - clamped) < Math.abs(best - clamped) ? start : best),
        starts[0] ?? 0,
      );
      setOffset(Math.max(0, Math.min(nearest, limit)));
    },
    [cardStarts, maxOffset],
  );

  /** Carries a fast release at least one card past the nearest card. */
  const glide = useCallback(
    (fromOffset: number, speed: number, direction: number) => {
      window.cancelAnimationFrame(animation.current);
      const starts = cardStarts();
      const limit = maxOffset();

      if (prefersReducedMotion()) {
        settleTo(fromOffset);
        return;
      }

      let travel = (speed * speed) / (2 * FRICTION_PER_MS * Math.max(speed, 0.0001));
      travel = Math.min(travel, limit);
      let target = fromOffset + direction * travel;

      if (Math.abs(speed) > FLICK_SPEED_PX_PER_MS) {
        const nearest = starts.reduce(
          (best, start) =>
            Math.abs(start - fromOffset) < Math.abs(best - fromOffset) ? start : best,
          starts[0] ?? 0,
        );
        const nextIndex =
          starts.indexOf(nearest) + (direction > 0 ? 1 : -1);
        const beyond = starts[nextIndex];
        if (beyond !== undefined) {
          target = direction > 0 ? Math.max(target, beyond) : Math.min(target, beyond);
        }
      }

      const clampedTarget = Math.max(0, Math.min(target, limit));
      const settled = starts.reduce(
        (best, start) =>
          Math.abs(start - clampedTarget) < Math.abs(best - clampedTarget) ? start : best,
        starts[0] ?? 0,
      );
      const destination = Math.max(0, Math.min(settled, limit));

      const started = performance.now();
      const from = fromOffset;
      const step = (now: number): void => {
        const progress = Math.min(1, (now - started) / DURATION_LONG);
        const eased = 1 - Math.pow(1 - progress, 3);
        setOffset(from + (destination - from) * eased);
        if (progress < 1) animation.current = window.requestAnimationFrame(step);
      };
      animation.current = window.requestAnimationFrame(step);
    },
    [cardStarts, maxOffset, settleTo],
  );

  useEffect(() => () => window.cancelAnimationFrame(animation.current), []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    window.cancelAnimationFrame(animation.current);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: offset,
      lastX: event.clientX,
      lastAt: performance.now(),
      speed: 0,
      moved: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const now = performance.now();
    const delta = event.clientX - state.lastX;
    const elapsed = Math.max(1, now - state.lastAt);
    state.speed = delta / elapsed;
    state.lastX = event.clientX;
    state.lastAt = now;
    state.moved += Math.abs(delta);
    const next = state.startOffset - (event.clientX - state.startX);
    setOffset(Math.max(-40, Math.min(next, maxOffset() + 40)));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    suppressOpen.current = state.moved > DRAG_OPENS_THRESHOLD_PX;
    glide(offset, Math.abs(state.speed), state.speed > 0 ? -1 : 1);
  };

  const touch = useRef<{
    startX: number;
    startY: number;
    startOffset: number;
    dragging: boolean;
    lastX: number;
    lastAt: number;
    speed: number;
    moved: number;
  } | null>(null);

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>): void => {
    const point = event.touches[0];
    if (!point) return;
    window.cancelAnimationFrame(animation.current);
    touch.current = {
      startX: point.clientX,
      startY: point.clientY,
      startOffset: offset,
      dragging: false,
      lastX: point.clientX,
      lastAt: performance.now(),
      speed: 0,
      moved: 0,
    };
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>): void => {
    const state = touch.current;
    const point = event.touches[0];
    if (!state || !point) return;
    const dx = point.clientX - state.startX;
    const dy = point.clientY - state.startY;
    if (!state.dragging) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) {
        touch.current = null;
        return;
      }
      state.dragging = true;
    }
    const now = performance.now();
    const delta = point.clientX - state.lastX;
    state.speed = delta / Math.max(1, now - state.lastAt);
    state.lastX = point.clientX;
    state.lastAt = now;
    state.moved += Math.abs(delta);
    setOffset(Math.max(-40, Math.min(state.startOffset - dx, maxOffset() + 40)));
  };

  const onTouchEnd = (): void => {
    const state = touch.current;
    touch.current = null;
    if (!state || !state.dragging) return;
    suppressOpen.current = state.moved > DRAG_OPENS_THRESHOLD_PX;
    glide(offset, Math.abs(state.speed), state.speed > 0 ? -1 : 1);
  };

  const stepBy = (direction: number): void => {
    const starts = cardStarts();
    const current = starts.reduce(
      (best, start) => (Math.abs(start - offset) < Math.abs(best - offset) ? start : best),
      starts[0] ?? 0,
    );
    const index = starts.indexOf(current) + direction;
    const target = starts[Math.max(0, Math.min(index, starts.length - 1))] ?? 0;
    const limit = maxOffset();
    setOffset(Math.max(0, Math.min(target, limit)));
  };

  return (
    <div>
      <div
        className="rail-viewport"
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="rail-track"
          ref={track}
          style={{ transform: `translateX(${-offset}px)` }}
        >
          {cards.map((card) => (
            <Link
              key={card.slug}
              to={`/work/${card.slug}`}
              className="rail-card"
              onClick={(event) => {
                if (suppressOpen.current) {
                  suppressOpen.current = false;
                  event.preventDefault();
                }
              }}
              onFocus={(event) => {
                const node = event.currentTarget;
                const trackNode = track.current;
                if (!trackNode) return;
                const start = node.getBoundingClientRect().left - trackNode.getBoundingClientRect().left;
                setOffset(Math.max(0, Math.min(start, maxOffset())));
              }}
            >
              <img src={card.coverUrl} alt="" />
              <span className="rail-card-body">
                <span>{card.title}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <div className="rail-controls">
        <button type="button" onClick={() => stepBy(-1)}>
          Previous
        </button>
        <button type="button" onClick={() => stepBy(1)}>
          Next
        </button>
      </div>
    </div>
  );
}
