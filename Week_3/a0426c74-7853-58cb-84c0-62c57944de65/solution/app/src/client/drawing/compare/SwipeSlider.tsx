import type { KeyboardEvent, PointerEvent } from 'react';
import { SWIPE_MAX, clampSwipe, swipeFromPointer } from '../../../shared/rules.ts';
import '../../styles/drawing/compare.css';

const SMALL_STEP = 1;
const LARGE_STEP = 10;

/** `slider "Compare swipe"`: the share of the sheet, in whole percent, drawn from the later version (left of the divider). */
export function SwipeSlider({ value, onChange }: { value: number; onChange: (percent: number) => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = {
      ArrowRight: value + SMALL_STEP,
      ArrowLeft: value - SMALL_STEP,
      PageUp: value + LARGE_STEP,
      PageDown: value - LARGE_STEP,
      Home: 0,
      End: SWIPE_MAX,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    onChange(clampSwipe(target));
  }

  function moveTo(event: PointerEvent<HTMLDivElement>): void {
    const track = event.currentTarget.getBoundingClientRect();
    onChange(swipeFromPointer(event.clientX - track.left, track.width));
  }

  return (
    <div
      className="swipe"
      role="slider"
      aria-label="Compare swipe"
      aria-valuemin={0}
      aria-valuemax={SWIPE_MAX}
      aria-valuenow={value}
      aria-valuetext={`${value}% newer version`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(event);
      }}
    >
      <span className="swipe__rail" />
      <span className="swipe__thumb" style={{ left: `${value}%` }} />
    </div>
  );
}
