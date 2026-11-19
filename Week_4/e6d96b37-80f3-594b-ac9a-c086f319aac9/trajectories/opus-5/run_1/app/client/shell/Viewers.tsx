import { useCallback, useEffect, useRef, useState } from 'react';
import { photoUrl } from '../lib/api.ts';
import { F } from '../../shared/feedback.ts';

/**
 * The shared coin viewers: the zoom slider, the Slate rule wipe and the
 * registered markers. Zoom, wipe and marker movement follow the input
 * directly, with no easing or settle, in every motion setting.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.25;

/** A zoom slider's value text is "<zoom> times". */
export const zoomText = (zoom: number): string =>
  `${Number.isInteger(zoom) ? zoom : zoom.toFixed(2).replace(/0$/, '')} times`;

export interface ZoomSliderProps {
  label: string;
  zoom: number;
  onZoom: (next: number) => void;
}

export function ZoomSlider({ label, zoom, onZoom }: ZoomSliderProps): JSX.Element {
  const clamp = (value: number): number =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
  return (
    <div
      className="slider target"
      role="slider"
      aria-label={label}
      tabIndex={0}
      aria-valuemin={ZOOM_MIN}
      aria-valuemax={ZOOM_MAX}
      aria-valuenow={zoom}
      aria-valuetext={zoomText(zoom)}
      onKeyDown={(event) => {
        const keys: Record<string, number | undefined> = {
          ArrowRight: clamp(zoom + ZOOM_STEP),
          ArrowUp: clamp(zoom + ZOOM_STEP),
          ArrowLeft: clamp(zoom - ZOOM_STEP),
          ArrowDown: clamp(zoom - ZOOM_STEP),
          Home: ZOOM_MIN,
          End: ZOOM_MAX,
        };
        const next = keys[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onZoom(next);
      }}
    >
      <span className="slider-track">
        <span
          className="slider-thumb"
          style={{ left: `${((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%` }}
        />
      </span>
      <span className="slider-value">{zoomText(zoom)}</span>
    </div>
  );
}

/**
 * A photograph that can be pinch-zoomed around the pinch point: the image
 * point under the fingers stays under them, and the slider value follows.
 */
export interface CoinImageProps {
  ns: string;
  photoId: string | null;
  alt: string;
  zoom?: number;
  onZoom?: (next: number) => void;
  /** Markers anchored to original-image coordinates. */
  markers?: { id: string; x: number; y: number; text: string; current?: boolean }[];
  width: number;
  height: number;
  onRetry?: () => void;
  /** A click reports the original-image coordinate it landed on. */
  onPick?: (x: number, y: number) => void;
}

export function CoinImage({
  ns,
  photoId,
  alt,
  zoom = 1,
  onZoom,
  markers = [],
  width,
  height,
  onRetry,
  onPick,
}: CoinImageProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => setFailed(false), [photoId]);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length !== 2 || !onZoom) return;
    const [a, b] = [event.touches[0] as Touch, event.touches[1] as Touch];
    pinch.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
  }, [onZoom, zoom]);

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (event.touches.length !== 2 || !pinch.current || !onZoom) return;
      event.preventDefault();
      const [a, b] = [event.touches[0] as Touch, event.touches[1] as Touch];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, (pinch.current.zoom * distance) / pinch.current.distance),
      );
      onZoom(next);
    },
    [onZoom],
  );

  if (!photoId || failed) {
    // A failed photograph keeps the notes and offers a retry (C07).
    return (
      <div className="viewer-missing note">
        <p>{F.IMAGE_WAIT}</p>
        <button
          type="button"
          className="teal-action target"
          onClick={() => {
            setFailed(false);
            onRetry?.();
          }}
        >
          Retry image
        </button>
      </div>
    );
  }

  return (
    <div
      className="coin-frame"
      ref={frame}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => {
        pinch.current = null;
      }}
      onClick={(event) => {
        if (!onPick || !frame.current) return;
        const box = frame.current.getBoundingClientRect();
        // Clicks report the original-image pixel they landed on.
        const x = Math.round(((event.clientX - box.left) / box.width) * width);
        const y = Math.round(((event.clientY - box.top) / box.height) * height);
        onPick(Math.min(width - 1, Math.max(0, x)), Math.min(height - 1, Math.max(0, y)));
      }}
    >
      <div className="coin-zoom" style={{ transform: `scale(${zoom})` }}>
        <img
          className="coin-image"
          src={photoUrl(ns, photoId)}
          alt={alt}
          onError={() => setFailed(true)}
        />
        {markers.map((marker) => (
          <span
            key={marker.id}
            className={marker.current ? 'marker marker-current' : 'marker'}
            // Anchored to original-image coordinates, so the marker stays on
            // its feature at every zoom, divider position and viewport width.
            style={{
              left: `${(marker.x / width) * 100}%`,
              top: `${(marker.y / height) * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
          >
            <span className="marker-ring" aria-hidden="true" />
            {marker.text ? <span className="marker-caption">{marker.text}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The Slate rule wipe. The second photograph is revealed from the coin's left
 * edge up to the divider and the first shows to its right. Below 50 percent
 * the first tab is current; at 50 and above the second is, swapping instantly
 * as the divider crosses the midpoint.
 */
export interface WipeProps {
  label: string;
  tabs: [string, string];
  value: number;
  onValue: (next: number) => void;
  first: JSX.Element;
  second: JSX.Element;
}

export function SlateWipe({ label, tabs, value, onValue, first, second }: WipeProps): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const currentTab = value < 50 ? 0 : 1;
  const clamp = (next: number): number => Math.min(100, Math.max(0, Math.round(next)));

  const trackTo = useCallback(
    (clientX: number) => {
      const box = track.current?.getBoundingClientRect();
      if (!box) return;
      // Dragging tracks the finger directly, with no inertia.
      onValue(clamp(((clientX - box.left) / box.width) * 100));
    },
    [onValue],
  );

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (dragging.current) trackTo(event.clientX);
    };
    const up = (): void => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [trackTo]);

  return (
    <div className="wipe">
      <div className="tab-wipe" role="tablist" aria-label="Comparison">
        {tabs.map((tab, at) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className="folder-tab target"
            aria-selected={currentTab === at}
            onClick={() => onValue(at === 0 ? 0 : 100)}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="wipe-stage" ref={track}>
        <div className="wipe-first">{first}</div>
        <div className="wipe-second" style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}>
          {second}
        </div>
        <div
          className="wipe-divider slider target"
          role="slider"
          aria-label={label}
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={`${tabs[1]} ${value} percent`}
          style={{ left: `${value}%` }}
          onPointerDown={(event) => {
            dragging.current = true;
            trackTo(event.clientX);
          }}
          onKeyDown={(event) => {
            const keys: Record<string, number | undefined> = {
              ArrowRight: clamp(value + 1),
              ArrowUp: clamp(value + 1),
              ArrowLeft: clamp(value - 1),
              ArrowDown: clamp(value - 1),
              PageUp: clamp(value + 10),
              PageDown: clamp(value - 10),
              Home: 0,
              End: 100,
            };
            const next = keys[event.key];
            if (next === undefined) return;
            event.preventDefault();
            onValue(next);
          }}
        />
      </div>
      <p className="wipe-value">{`${tabs[1]} ${value} percent`}</p>
    </div>
  );
}

/**
 * The numeric coordinate fields (G30 and G31). Resizing, zooming, rotating and
 * moving the divider never change what these hold.
 */
export function MarkerCoordinates({
  x,
  y,
  width,
  height,
  onChange,
  error,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  onChange: (x: number, y: number) => void;
  error?: string;
}): JSX.Element {
  return (
    <div className="coordinates">
      <label className="field">
        <span className="field-label">Image x:</span>
        <input
          className="target"
          type="number"
          role="spinbutton"
          aria-label="Image x"
          value={x}
          min={0}
          max={width - 1}
          onChange={(event) => onChange(Number(event.target.value), y)}
        />
      </label>
      <label className="field">
        <span className="field-label">Image y:</span>
        <input
          className="target"
          type="number"
          role="spinbutton"
          aria-label="Image y"
          value={y}
          min={0}
          max={height - 1}
          onChange={(event) => onChange(x, Number(event.target.value))}
        />
      </label>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/** A marker that can be dragged or nudged with the arrows. */
export function MarkerHandle({
  label,
  x,
  y,
  width,
  height,
  onMove,
}: {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  onMove: (x: number, y: number) => void;
}): JSX.Element {
  const clamp = (nx: number, ny: number): [number, number] => [
    Math.min(width - 1, Math.max(0, Math.round(nx))),
    Math.min(height - 1, Math.max(0, Math.round(ny))),
  ];
  return (
    <button
      type="button"
      className="marker-handle target"
      aria-label={label}
      onKeyDown={(event) => {
        // Arrows move one original-image unit, Shift with an arrow moves ten.
        const step = event.shiftKey ? 10 : 1;
        const moves: Record<string, [number, number] | undefined> = {
          ArrowLeft: [x - step, y],
          ArrowRight: [x + step, y],
          ArrowUp: [x, y - step],
          ArrowDown: [x, y + step],
        };
        const next = moves[event.key];
        if (!next) return;
        event.preventDefault();
        onMove(...clamp(next[0], next[1]));
      }}
    >
      {label} ({x}, {y})
    </button>
  );
}
