import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { announce } from '../app.js';
import { useReducedMotion } from '../lib/router.js';

export type GaugeBag = { sku: string; name: string; height: number; width: number; depth: number; weight: number; colour: string };
type Airline = { code: string; name: string; height_cm: number; width_cm: number; depth_cm: number; weight_kg: number };

/** The frame the bag is measured against, with wheels and handle counted. */
async function loadAirlines(): Promise<Airline[]> {
  return api.get<Airline[]>('/api/airlines');
}

/** cm → px at the 1280-wide layout; other widths scale in proportion. */
function pxPerCm(): number {
  const width = window.innerWidth;
  const reference = 1280;
  return (2.4 * width) / reference;
}

export function GateGauge(props: {
  airline: string;
  airlines?: Airline[];
  bags: GaugeBag[];
  selectedSku: string;
  onAirlineChange: (code: string) => void;
  onSelectBag?: (sku: string) => void;
  showPicker?: boolean;
}): JSX.Element {
  const [airlines, setAirlines] = useState<Airline[]>(props.airlines ?? []);
  const [verdict, setVerdict] = useState<{ fits: boolean; verdict: string; overhang_cm: { height: number; width: number; depth: number }; max_overhang_cm: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [state, setState] = useState<'idle' | 'dragging' | 'settling' | 'settled'>('idle');
  const [settledAt, setSettledAt] = useState<'inside' | 'edge' | null>(null);
  const [dims, setDims] = useState({ height: 0, width: 0, depth: 0, weight: 0 });
  const [targetDims, setTargetDims] = useState({ height: 0, width: 0, depth: 0, weight: 0 });
  const reduced = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ start: number; startPos: number } | null>(null);

  const airline = airlines.find((a) => a.code === props.airline) ?? airlines[0];
  const bag = props.bags.find((b) => b.sku === props.selectedSku) ?? props.bags[0];

  useEffect(() => {
    if (props.airlines !== undefined) return;
    void loadAirlines().then(setAirlines);
  }, []);

  useEffect(() => {
    if (bag === undefined || airline === undefined) return;
    setTargetDims({ height: bag.height, width: bag.width, depth: bag.depth, weight: bag.weight });
    if (reduced) {
      setDims({ height: bag.height, width: bag.width, depth: bag.depth, weight: bag.weight });
    } else {
      const timer = setTimeout(() => setDims({ height: bag.height, width: bag.width, depth: bag.depth, weight: bag.weight }), 420);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [bag?.sku, airline?.code, reduced]);

  useEffect(() => {
    if (bag === undefined) return;
    const params = new URLSearchParams({ sku: bag.sku, airline: props.airline });
    void api.get<{ fits: boolean; verdict: string; overhang_cm: { height: number; width: number; depth: number }; max_overhang_cm: number }>(`/api/fit?${params.toString()}`)
      .then((v) => {
        setVerdict(v);
        announce('fit-verdict', v.verdict);
        // A settle at rest: inside the frame when it fits, touching the edge otherwise.
        settleTo(v.fits ? 'inside' : 'edge');
      })
      .catch(() => undefined);
  }, [bag?.sku, props.airline]);

  const settleTo = (where: 'inside' | 'edge'): void => {
    if (reduced) {
      setPosition(where === 'inside' ? 20 : 20 - (bag?.width ?? 0));
      setState('settled');
      setSettledAt(where);
      return;
    }
    setState('settling');
    setSettledAt(where);
    const target = where === 'inside' ? 20 : 20 - (bag?.width ?? 0);
    // One small overshoot, then rest, within 700 ms of page-clock time.
    const overshoot = target + (where === 'inside' ? 2 : -2);
    let phase = 0;
    const timer = setInterval(() => {
      phase += 1;
      if (phase === 1) setPosition(overshoot);
      if (phase >= 3) {
        setPosition(target);
        setState('settled');
        clearInterval(timer);
      }
    }, 200);
  };

  // The bag starts 20 cm left of the frame; slider value is cm moved toward it.
  const maxPosition = 20 + (airline?.width_cm ?? 40);
  const sliderValueText = position <= 0 ? 'Outside the frame'
    : position < 20 ? 'Touching the frame'
    : 'Inside the frame';

  const onPointerDown = (e: PointerEvent): void => {
    dragState.current = { start: e.clientX, startPos: position };
    setState('dragging');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (dragState.current === null) return;
    const scale = pxPerCm();
    const delta = (e.clientX - dragState.current.start) / scale;
    const next = Math.max(0, Math.min(maxPosition, dragState.current.startPos + delta));
    setPosition(next);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (dragState.current === null) return;
    dragState.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    settleTo(verdict?.fits ? 'inside' : 'edge');
  };

  const bagWidthPx = dims.width * pxPerCm();
  const bagHeightPx = dims.height * pxPerCm();
  const frameWidthPx = (airline?.width_cm ?? 40) * pxPerCm();
  const frameHeightPx = (airline?.height_cm ?? 55) * pxPerCm();
  const bagLeftPx = (20 - position) * pxPerCm();

  if (airline === undefined || bag === undefined) return <></>;

  return (
    <div role="group" aria-label="Gate Gauge" class="gate-gauge"
      data-motion-ms={reduced ? '0' : '420'} data-state={state} data-settled={settledAt}>
      <div class="gauge-controls">
        <fieldset>
          <legend>Airline</legend>
          <div role="radiogroup" aria-label="Airline" class="radios">
            {airlines.map((a) => (
              <label key={a.code} class={`radio ${a.code === props.airline ? 'selected' : ''}`}>
                <input type="radio" name={`airline-${props.bags[0].sku}`} value={a.code} checked={a.code === props.airline}
                  onChange={() => props.onAirlineChange(a.code)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {props.showPicker === true && props.bags.length > 1 ? (
          <fieldset>
            <legend>Bag to fit</legend>
            <div role="radiogroup" aria-label="Bag to fit" class="radios">
              {props.bags.map((b) => (
                <label key={b.sku} class={`radio ${b.sku === props.selectedSku ? 'selected' : ''}`}>
                  <input type="radio" name="bag-to-fit" value={b.sku} checked={b.sku === props.selectedSku}
                    onChange={() => props.onSelectBag?.(b.sku)} />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
      <div
        ref={trackRef}
        class="gauge-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={`--bag-left: ${bagLeftPx}px; --bag-width: ${bagWidthPx}px; --bag-height: ${bagHeightPx}px; --frame-width: ${frameWidthPx}px; --frame-height: ${frameHeightPx}px;`}
      >
        <div class="bag-silhouette" aria-hidden="true" />
        <div class="frame-outline" aria-hidden="true">
          <p class="frame-label">{airline.name}</p>
        </div>
      </div>
      <input
        type="range"
        role="slider"
        aria-label="Bag position"
        class="gauge-slider"
        min={0}
        max={Math.round(maxPosition)}
        step={1}
        value={Math.round(position)}
        aria-valuetext={sliderValueText}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            setPosition((p) => Math.min(maxPosition, p + 1));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            setPosition((p) => Math.max(0, p - 1));
          } else if (e.key === 'Home') {
            e.preventDefault();
            setPosition(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            setPosition(maxPosition);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            settleTo(verdict?.fits ? 'inside' : 'edge');
          }
        }}
      />
      <p role="status" aria-live="polite" id="fit-verdict-region" class={`verdict ${verdict?.fits === false ? 'over' : 'fits'}`}>
        {verdict?.verdict ?? ''}
      </p>
      <ul role="list" aria-label="Bag dimensions" class="bag-dims">
        <li>Height {dims.height} cm</li>
        <li>Width {dims.width} cm</li>
        <li>Depth {dims.depth} cm</li>
        <li>Weight {dims.weight} kg</li>
      </ul>
    </div>
  );
}
