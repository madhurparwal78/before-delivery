// Coin photograph viewers. One projection rule (`project`) maps original-image coordinates onto the
// displayed photograph, so markers, captions and both photographs of a comparison always line up.

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { F } from "../shared/feedback";
import type { Photo } from "../shared/types";
import { limits, reducedMotion } from "./config";
import { useDesk } from "./desk";

export function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The displayed box of an image fitted (contain) into a frame. */
function fitRect(frame: { width: number; height: number }, image: { width: number; height: number }) {
  const scale = Math.min(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

/** Original-image coordinates to frame pixels, through the same fit that draws the photograph. */
export function project(frame: { width: number; height: number }, image: { width: number; height: number }, x: number, y: number) {
  const box = fitRect(frame, image);
  return { left: box.left + (x / image.width) * box.width, top: box.top + (y / image.height) * box.height };
}

const RETRY_EVENT = "flan-retry-images";

/** Fetches a stored photograph and re-encodes it `width` pixels wide. */
async function scaledCopy(url: string, width: number): Promise<Blob> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`photograph answered ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: width, resizeQuality: "high" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("photograph not encoded")))));
}

/**
 * A stored photograph; on a failed load the viewer shows F_IMAGE_WAIT with "Retry image".
 * `displayWidth` is for a site that never shows the photograph larger than that many CSS pixels and never zooms it:
 * the image then holds a copy at twice that width. Until the copy is ready the img stays in place with no src, so
 * its name and box do not change.
 */
export function CoinImage({ photo, alt, onState, displayWidth }: { photo: Pick<Photo, "id">; alt: string; onState?: (failed: boolean) => void; displayWidth?: number }) {
  const { photoUrl, revoked } = useDesk();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<{ source: string; url: string } | null>(null);
  const source = `${photoUrl(photo.id)}${attempt ? `?retry=${attempt}` : ""}`;
  useEffect(() => {
    if (!displayWidth || revoked) return;
    let live = true;
    let url: string | undefined;
    scaledCopy(source, displayWidth * 2).then(
      (blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setCopy({ source, url });
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setCopy(null);
    };
  }, [source, displayWidth, revoked]);
  useEffect(() => onState?.(failed), [failed, onState]);
  useEffect(() => {
    if (!failed) return;
    const retry = () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    };
    window.addEventListener(RETRY_EVENT, retry);
    return () => window.removeEventListener(RETRY_EVENT, retry);
  }, [failed]);
  if (revoked) return null;
  return (
    <>
      {!failed && (
        <img
          key={attempt}
          className="coin-photo"
          src={displayWidth ? (copy?.source === source ? copy.url : undefined) : source}
          alt={alt}
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
      {failed && (
        <div className="note image-note">
          <p>{F.IMAGE_WAIT}</p>
          <button type="button" className="action-link" onClick={() => window.dispatchEvent(new Event(RETRY_EVENT))}>
            <RefreshCw aria-hidden="true" size={16} /> Retry image
          </button>
        </div>
      )}
    </>
  );
}

// --- zoom ---------------------------------------------------------------------------------------

interface ZoomView {
  zoom: number;
  /** Image point (0–1) at the frame centre. */
  cx: number;
  cy: number;
}

const clampCentre = (c: number, zoom: number) => Math.min(1 - 1 / (2 * zoom), Math.max(1 / (2 * zoom), c));

export function useZoom(focus: { x: number; y: number }) {
  const [view, setView] = useState<ZoomView>({ zoom: limits.FLAN_ZOOM_MIN, cx: 0.5, cy: 0.5 });
  /** Zooms keeping the image point under (fx, fy) — fractions of the frame — fixed. */
  const zoomAt = useCallback((next: number, fx: number, fy: number) => {
    setView((v) => {
      const zoom = Math.min(limits.FLAN_ZOOM_MAX, Math.max(limits.FLAN_ZOOM_MIN, next));
      const px = v.cx + (fx - 0.5) / v.zoom;
      const py = v.cy + (fy - 0.5) / v.zoom;
      return { zoom, cx: clampCentre(px - (fx - 0.5) / zoom, zoom), cy: clampCentre(py - (fy - 0.5) / zoom, zoom) };
    });
  }, []);
  /** Keyboard zoom keeps the diagnostic point (the mintmark) where it is on screen. */
  const zoomTo = useCallback(
    (next: number) => {
      setView((v) => {
        const fx = 0.5 + (focus.x - v.cx) * v.zoom;
        const fy = 0.5 + (focus.y - v.cy) * v.zoom;
        const zoom = Math.min(limits.FLAN_ZOOM_MAX, Math.max(limits.FLAN_ZOOM_MIN, next));
        return { zoom, cx: clampCentre(focus.x - (fx - 0.5) / zoom, zoom), cy: clampCentre(focus.y - (fy - 0.5) / zoom, zoom) };
      });
    },
    [focus.x, focus.y],
  );
  return { view, zoomAt, zoomTo };
}

/** A photograph frame under a shared zoom; two fingers pinch around their midpoint. */
export function ZoomFrame({ view, zoomAt, children, pinch = true }: { view: ZoomView; zoomAt: (z: number, fx: number, fy: number) => void; children: ReactNode; pinch?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(view.zoom);
  zoomRef.current = view.zoom;
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!pinch) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      start.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: zoomRef.current };
    }
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size !== 2 || !start.current || !frame.current) return;
    const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const box = frame.current.getBoundingClientRect();
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const fx = ((a.x + b.x) / 2 - box.left) / box.width;
    const fy = ((a.y + b.y) / 2 - box.top) / box.height;
    zoomAt(start.current.zoom * (distance / start.current.distance), fx, fy);
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) start.current = null;
  };
  const transform = `translate(${(0.5 - view.cx * view.zoom) * 100}%, ${(0.5 - view.cy * view.zoom) * 100}%) scale(${view.zoom})`;
  return (
    <div ref={frame} className="photo-frame zoom-frame" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="zoom-layer" style={{ transform }}>
        {children}
      </div>
    </div>
  );
}

const zoomText = (zoom: number) => `${zoom} times`;

export function ZoomSlider({ label, view, zoomTo }: { label: string; view: ZoomView; zoomTo: (z: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const span = limits.FLAN_ZOOM_MAX - limits.FLAN_ZOOM_MIN;
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = limits.FLAN_ZOOM_STEP;
    const moves: Record<string, number> = {
      ArrowRight: view.zoom + step,
      ArrowUp: view.zoom + step,
      ArrowLeft: view.zoom - step,
      ArrowDown: view.zoom - step,
      Home: limits.FLAN_ZOOM_MIN,
      End: limits.FLAN_ZOOM_MAX,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    zoomTo(Math.round(moves[event.key]! / step) * step);
  };
  const fromPointer = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    zoomTo(Math.round((limits.FLAN_ZOOM_MIN + fraction * span) / limits.FLAN_ZOOM_STEP) * limits.FLAN_ZOOM_STEP);
  };
  return (
    <div className="slider-row">
      <span className="slider-label" aria-hidden="true">{label}:</span>
      <div
        ref={track}
        className="slider"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={limits.FLAN_ZOOM_MIN}
        aria-valuemax={limits.FLAN_ZOOM_MAX}
        aria-valuenow={view.zoom}
        aria-valuetext={zoomText(view.zoom)}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          // Continuous events render in a later task; commit each move now so the value tracks the finger.
          if (e.currentTarget.hasPointerCapture(e.pointerId)) flushSync(() => fromPointer(e.clientX));
        }}
      >
        <span className="slider-fill" style={{ width: `${((view.zoom - limits.FLAN_ZOOM_MIN) / span) * 100}%` }} />
        <span className="slider-thumb" style={{ left: `${((view.zoom - limits.FLAN_ZOOM_MIN) / span) * 100}%` }} />
      </div>
      <span className="slider-value figures" aria-hidden="true">{zoomText(view.zoom)}</span>
    </div>
  );
}

// --- Slate rule wipe ------------------------------------------------------------------------------

interface WipeProps {
  tabs: [string, string];
  sliderLabel: string;
  value: number;
  onChange: (value: number) => void;
  first: ReactNode;
  second: ReactNode;
  /** Image-anchored overlay (markers, captions) drawn over the second photograph. */
  overlay?: (frame: { width: number; height: number }) => ReactNode;
}

export function Wipe({ tabs, sliderLabel, value, onChange, first, second, overlay }: WipeProps) {
  const frame = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const size = useBoxSize(frame);
  const secondCurrent = value >= 50;
  const set = (v: number) => onChange(Math.min(100, Math.max(0, Math.round(v))));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: value + 1,
      ArrowUp: value + 1,
      ArrowLeft: value - 1,
      ArrowDown: value - 1,
      PageUp: value + 10,
      PageDown: value - 10,
      Home: 0,
      End: 100,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    set(moves[event.key]!);
  };
  const fromPointer = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    set(((clientX - box.left) / box.width) * 100);
  };
  return (
    <div className="wipe">
      <div className="folder-pair" role="tablist" aria-label={`${tabs[0]} and ${tabs[1]} photographs`}>
        <button type="button" role="tab" className="folder-tab" aria-selected={!secondCurrent} onClick={() => set(0)}>
          {tabs[0]}
        </button>
        <button type="button" role="tab" className="folder-tab" aria-selected={secondCurrent} onClick={() => set(100)}>
          {tabs[1]}
        </button>
      </div>
      <div ref={frame} className="photo-frame wipe-frame">
        <div className="wipe-layer">{first}</div>
        <div className="wipe-layer" style={{ clipPath: `inset(0 ${100 - value}% 0 0)` }}>
          {second}
        </div>
        <div className="wipe-rule" style={{ left: `${value}%` }} aria-hidden="true" />
        {overlay && size.width > 0 && overlay(size)}
      </div>
      <div
        ref={track}
        className="slider wipe-track"
        role="slider"
        tabIndex={0}
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${tabs[1]} ${value} percent`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          // Continuous events render in a later task; commit each move now so the value tracks the finger.
          if (e.currentTarget.hasPointerCapture(e.pointerId)) flushSync(() => fromPointer(e.clientX));
        }}
      >
        <span className="slider-fill" style={{ width: `${value}%` }} />
        <span className="slider-thumb" style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}

/** A caption anchored to an image point; it fades in as the divider uncovers it and out as it covers it. */
export function Caption({ visible, left, top, children }: { visible: boolean; left: number; top: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (first.current) {
      first.current = false;
      element.style.opacity = visible ? "1" : "0";
      return;
    }
    const duration = reducedMotion() ? 0 : limits.FLAN_MOTION_MS;
    element.animate([{ opacity: visible ? 0 : 1 }, { opacity: visible ? 1 : 0 }], { duration, easing: "linear", fill: "forwards" });
  }, [visible]);
  return (
    <div ref={ref} className="caption" style={{ left, top }} aria-hidden={!visible}>
      {children}
    </div>
  );
}

// --- markers ------------------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/** A draggable marker in original-image coordinates: arrows move 1 unit, Shift+arrows 10. */
export function Marker({ label, point, image, frame, onMove }: { label: string; point: Point; image: { width: number; height: number }; frame: { width: number; height: number }; onMove: (p: Point) => void }) {
  const at = project(frame, image, point.x, point.y);
  const box = fitRect(frame, image);
  const clampPoint = (p: Point) => ({
    x: Math.min(image.width - 1, Math.max(0, Math.round(p.x))),
    y: Math.min(image.height - 1, Math.max(0, Math.round(p.y))),
  });
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    onMove(clampPoint({ x: point.x + d.x, y: point.y + d.y }));
  };
  const onDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY, point };
    const element = event.currentTarget;
    const move = (e: globalThis.PointerEvent) => {
      // A native listener: commit each move now so the coordinates and the saved draft track the finger.
      flushSync(() => onMove(clampPoint({
        x: origin.point.x + ((e.clientX - origin.x) / box.width) * image.width,
        y: origin.point.y + ((e.clientY - origin.y) / box.height) * image.height,
      })));
    };
    const up = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
  return (
    <button type="button" className="marker" aria-label={label} style={{ left: at.left, top: at.top }} onKeyDown={onKey} onPointerDown={onDown}>
      <span className="marker-ring" aria-hidden="true" />
    </button>
  );
}

/** G30 and G31: the focused marker's original-image coordinates, set numerically. */
export function CoordinateFields({ point, image, onSet }: { point: Point; image: { width: number; height: number }; onSet: (p: Point) => void }) {
  return (
    <div className="coordinates">
      <CoordinateField label="Image x" value={point.x} max={image.width - 1} onCommit={(x) => onSet({ ...point, x })} />
      <CoordinateField label="Image y" value={point.y} max={image.height - 1} onCommit={(y) => onSet({ ...point, y })} />
    </div>
  );
}

function CoordinateField({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  const id = `coord-${label.replace(/\s/g, "-").toLowerCase()}`;
  const commit = () => {
    editing.current = false;
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isInteger(parsed) || parsed < 0 || parsed > max) {
      setError(true);
      return;
    }
    setError(false);
    onCommit(parsed);
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}:</label>
      <input
        id={id}
        aria-label={label}
        type="number"
        inputMode="numeric"
        className="figures"
        min={0}
        max={max}
        step={1}
        value={text}
        aria-invalid={error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          editing.current = true;
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      {error && (
        <p id={`${id}-error`} className="field-error">
          {F.COORD}
        </p>
      )}
    </div>
  );
}
