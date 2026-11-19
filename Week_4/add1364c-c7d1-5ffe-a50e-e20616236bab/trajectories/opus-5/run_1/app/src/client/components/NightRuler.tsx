import { useCallback, useEffect, useRef } from 'react';
import { officeDateWithYear } from '../format.js';

export type Night = { value: number; date: string; offset: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function markLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/**
 * A slider over the next 60 office midnights. The handle follows mouse, touch
 * and pen drags, snaps to a midnight on release, and never scrolls the page.
 */
export function NightRuler(props: {
  nights: readonly Night[];
  value: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  const rail = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const live = useRef(props.value);
  live.current = props.value;

  // A value change away from the pointer brings the handle into view; a drag never scrolls.
  useEffect(() => {
    if (dragging.current) return;
    handle.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }, [props.value]);

  const chosen = props.nights[props.value - 1];
  const valueText =
    chosen === undefined ? '' : `${officeDateWithYear(chosen.date)}, 00:00 ${chosen.offset}`;

  const fromPointer = useCallback(
    (clientX: number): number => {
      const node = rail.current;
      if (node === null || props.nights.length === 0) return live.current;
      const box = node.getBoundingClientRect();
      const share = (clientX - box.left) / Math.max(1, box.width);
      const value = Math.round(share * (props.nights.length - 1)) + 1;
      return Math.min(props.nights.length, Math.max(1, value));
    },
    [props.nights.length],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!dragging.current) return;
      event.preventDefault();
      props.onChange(fromPointer(event.clientX));
    };
    const onUp = (event: PointerEvent): void => {
      if (!dragging.current) return;
      dragging.current = false;
      props.onChange(fromPointer(event.clientX));
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [fromPointer, props]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const last = props.nights.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      props.onChange(Math.min(last, props.value + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      props.onChange(Math.max(1, props.value - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      props.onChange(1);
    } else if (event.key === 'End') {
      event.preventDefault();
      props.onChange(last);
    }
  };

  const share = props.nights.length <= 1 ? 0 : (props.value - 1) / (props.nights.length - 1);

  return (
    <section className="night-ruler" aria-label="Lockset turns at midnight">
      <h2>Lockset turns at midnight</h2>
      <div className="ruler-track">
        <div
          className="ruler-rail"
          ref={rail}
          style={{ '--rail-width': `${Math.max(100, props.nights.length * 44)}px` } as React.CSSProperties}
        >
          <div
            role="slider"
            tabIndex={0}
            className="ruler-handle"
            ref={handle}
            aria-label="Night ruler"
            aria-valuemin={1}
            aria-valuemax={props.nights.length}
            aria-valuenow={props.value}
            aria-valuetext={valueText}
            style={{ left: `${share * 100}%` }}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => {
              dragging.current = true;
              (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
              event.preventDefault();
            }}
          >
            <span aria-hidden="true">|</span>
          </div>
          <div className="ruler-marks" aria-hidden="true">
            {props.nights.map((night) => (
              <span className="ruler-mark" key={night.value}>
                {markLabel(night.date)}
                <br />
                {night.offset}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="ruler-value">{valueText}</p>
    </section>
  );
}
