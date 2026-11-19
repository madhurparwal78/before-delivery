import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OrbitScene } from './orbitScene.js';
import type { RingPoint, RingTarget } from './orbitScene.js';
import { COPY } from '../copy.js';
import { formatInteger, formatPrice } from '../format.js';
import type { Book, Level, MarketKind } from '../api.js';

export const levelKey = (side: 'bid' | 'ask', price: number): string => `${side}:${price}`;

export interface OrbitLevel {
  key: string;
  side: 'bid' | 'ask';
  price: number;
  quantity: number;
}

/**
 * Book levels run top to bottom as on a ladder: asks from the highest price down to the best ask,
 * then bids from the best bid down.
 */
export function ladderLevels(book: Book | null): OrbitLevel[] {
  if (book === null) return [];
  const asks = [...book.asks].sort((left, right) => right.price - left.price);
  const bids = [...book.bids].sort((left, right) => right.price - left.price);
  return [
    ...asks.map((level: Level) => ({
      key: levelKey('ask', level.price),
      side: 'ask' as const,
      price: level.price,
      quantity: level.quantity,
    })),
    ...bids.map((level: Level) => ({
      key: levelKey('bid', level.price),
      side: 'bid' as const,
      price: level.price,
      quantity: level.quantity,
    })),
  ];
}

const MIN_RADIUS = 0.45;
const MAX_RADIUS = 1.6;
const FIRST_STEP = 0.32;
const STEP = 0.34;

/** Radius grows with resting quantity; height grows with distance from the mid price. */
function ringTargets(levels: readonly OrbitLevel[]): RingTarget[] {
  const largest = levels.reduce((most, level) => Math.max(most, level.quantity), 1);
  const asks = levels.filter((level) => level.side === 'ask').sort((a, b) => a.price - b.price);
  const bids = levels.filter((level) => level.side === 'bid').sort((a, b) => b.price - a.price);
  const radiusOf = (quantity: number): number =>
    MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(quantity / largest);
  return [
    ...asks.map((level, index) => ({
      level: level.key,
      side: 'ask' as const,
      radius: radiusOf(level.quantity),
      height: FIRST_STEP + index * STEP,
    })),
    ...bids.map((level, index) => ({
      level: level.key,
      side: 'bid' as const,
      radius: radiusOf(level.quantity),
      height: -(FIRST_STEP + index * STEP),
    })),
  ];
}

export const SCROLL_RANGE = 1200;
const SCROLL_MID = 600;
const TOP_DOWN = 90;
const ANGLED = 35;
const SIDE = 0;

/** Elevation falls 90 → 35 over the first 600 px, then 35 → 0 by 1200 px, the same both ways. */
export function elevationForScroll(scrollY: number): number {
  const clamped = Math.max(0, Math.min(scrollY, SCROLL_RANGE));
  if (clamped <= SCROLL_MID) {
    return TOP_DOWN + ((ANGLED - TOP_DOWN) * clamped) / SCROLL_MID;
  }
  return ANGLED + ((SIDE - ANGLED) * (clamped - SCROLL_MID)) / (SCROLL_RANGE - SCROLL_MID);
}

const YAW_PIXELS_PER_DEGREE = 6;
const YAW_CAP = 20;
const YAW_SPRING_TAU_MS = 90;
const CLICK_RADIUS_PX = 34;

export function supportsWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (
      canvas.getContext('webgl') !== null || canvas.getContext('experimental-webgl') !== null
    );
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const oneDecimal = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

export interface OrbitProps {
  kind: MarketKind;
  levels: OrbitLevel[];
  lastPrice: number | null;
  highlight: string;
  onSelect: (key: string) => void;
  /** The home orbit keeps a fixed 35-degree elevation; the market detail follows the scroll. */
  scrollCamera: boolean;
  label?: string;
}

export function Orbit(props: OrbitProps): React.JSX.Element {
  const flat = useMemo(() => prefersReducedMotion() || !supportsWebgl(), []);
  return (
    <div className="orbit-region" role="region" aria-label="Orderbook Orbit">
      <TradeNumeral kind={props.kind} lastPrice={props.lastPrice} flat={flat} />
      {flat ? <DepthLadder {...props} /> : <OrbitCanvas {...props} />}
      {props.label !== undefined ? <p className="label">{props.label}</p> : null}
      {props.levels.length === 0 ? <p className="empty-line">{COPY.emptyBook}</p> : null}
    </div>
  );
}

/** Counts from the old last price to the new one, ending on the exact new price. */
function TradeNumeral(props: {
  kind: MarketKind;
  lastPrice: number | null;
  flat: boolean;
}): React.JSX.Element {
  const [shown, setShown] = useState<number | null>(props.lastPrice);
  const previous = useRef<number | null>(props.lastPrice);

  useEffect(() => {
    const target = props.lastPrice;
    const from = previous.current;
    previous.current = target;
    if (target === null || from === null || from === target || props.flat) {
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min((now - start) / 600, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setShown(progress === 1 ? target : Math.round(from + (target - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [props.lastPrice, props.flat]);

  return (
    <span className="trade-numeral" role="region" aria-label="Last trade">
      {shown === null ? '—' : formatPrice(props.kind, shown)}
    </span>
  );
}

function OrbitCanvas(props: OrbitProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<OrbitScene | null>(null);
  const pointsRef = useRef<RingPoint[]>([]);
  const [elevation, setElevation] = useState(props.scrollCamera ? elevationForScroll(0) : ANGLED);
  const [yaw, setYaw] = useState(0);
  const [settled, setSettled] = useState(true);
  const [rings, setRings] = useState<RingPoint[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let scene: OrbitScene;
    try {
      scene = new OrbitScene(canvas, {
        fixedElevation: props.scrollCamera ? null : ANGLED,
        onPoints: (points) => {
          pointsRef.current = points;
          setRings((current) =>
            current.length === points.length &&
            current.every(
              (item, index) =>
                item.level === points[index]?.level &&
                item.x === points[index]?.x &&
                item.y === points[index]?.y,
            )
              ? current
              : points,
          );
        },
        onSettled: setSettled,
      });
    } catch {
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [props.scrollCamera]);

  useEffect(() => {
    sceneRef.current?.setRings(ringTargets(props.levels));
  }, [props.levels]);

  useEffect(() => {
    sceneRef.current?.setHighlight(props.highlight);
  }, [props.highlight]);

  useEffect(() => {
    sceneRef.current?.setElevation(elevation);
  }, [elevation]);

  useEffect(() => {
    sceneRef.current?.setYaw(yaw);
  }, [yaw]);

  useEffect(() => {
    if (!props.scrollCamera) return;
    const onScroll = (): void => setElevation(elevationForScroll(window.scrollY));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [props.scrollCamera]);

  const dragRef = useRef<{ pointerId: number; startX: number } | null>(null);
  const springRef = useRef(0);

  const releaseYaw = useCallback(() => {
    dragRef.current = null;
    const start = performance.now();
    const from = springRef.current;
    const run = (now: number): void => {
      const factor = Math.exp(-(now - start) / YAW_SPRING_TAU_MS);
      const next = from * factor;
      if (Math.abs(next) < 0.05) {
        springRef.current = 0;
        setYaw(0);
        return;
      }
      springRef.current = next;
      setYaw(next);
      requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX - springRef.current * YAW_PIXELS_PER_DEGREE };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const degrees = (event.clientX - drag.startX) / YAW_PIXELS_PER_DEGREE;
    const capped = Math.max(-YAW_CAP, Math.min(degrees, YAW_CAP));
    springRef.current = capped;
    setYaw(capped);
  };

  /** Clicking or tapping a ring selects the matching option. */
  const onClick = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let closest: RingPoint | null = null;
    let distance = CLICK_RADIUS_PX;
    for (const point of pointsRef.current) {
      const candidate = Math.hypot(point.x - x, point.y - y);
      if (candidate <= distance) {
        distance = candidate;
        closest = point;
      }
    }
    if (closest !== null) props.onSelect(closest.level);
  };

  return (
    <canvas
      ref={canvasRef}
      className="orbit-canvas"
      role="img"
      aria-label="Orderbook Orbit"
      data-elevation={oneDecimal(elevation)}
      data-yaw={oneDecimal(yaw)}
      data-settled={settled ? 'true' : 'false'}
      data-highlight={props.highlight}
      data-rings={JSON.stringify(rings.map((ring) => ({ level: ring.level, x: ring.x, y: ring.y })))}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releaseYaw}
      onPointerCancel={releaseYaw}
      onClick={onClick}
    />
  );
}

/** With reduced motion or without WebGL, a flat two-column depth ladder replaces the orbit. */
function DepthLadder(props: OrbitProps): React.JSX.Element {
  const largest = props.levels.reduce((most, level) => Math.max(most, level.quantity), 1);
  const bids = props.levels.filter((level) => level.side === 'bid');
  const asks = props.levels.filter((level) => level.side === 'ask');

  const row = (level: OrbitLevel, side: 'bid' | 'ask'): React.JSX.Element => (
    <li key={level.key} onClick={() => props.onSelect(level.key)}>
      <span className={`ladder__bar ladder__bar--${side}`} style={{ width: `${Math.max(8, (level.quantity / largest) * 100)}px` }} />
      <span>
        {formatPrice(props.kind, level.price)}, {formatInteger(level.quantity)} resting
      </span>
    </li>
  );

  return (
    <div className="ladder" role="region" aria-label="Depth ladder">
      <div>
        <h4>Bids</h4>
        <ul aria-label="Bids">{bids.map((level) => row(level, 'bid'))}</ul>
      </div>
      <div>
        <h4>Asks</h4>
        <ul aria-label="Asks">{asks.map((level) => row(level, 'ask'))}</ul>
      </div>
    </div>
  );
}
