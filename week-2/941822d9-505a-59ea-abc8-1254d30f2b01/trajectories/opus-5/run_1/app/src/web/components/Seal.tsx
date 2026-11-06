import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatProviderDate } from '../lib/format.js';

export type SealState = 'open' | 'pending' | 'sealed' | 'revoked';

export interface SealModule {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly verified: boolean;
}

export interface SealProps {
  readonly state: SealState;
  readonly modules: readonly SealModule[];
  readonly hours: string;
  readonly serial?: string | null;
  readonly issuedOn?: string | null;
  readonly play?: boolean;
  readonly jump?: boolean;
  readonly onFinished?: () => void;
}

const CENTRE = 100;
const WEDGE_RADIUS = 62;
const RING_RADIUS = 94;
const RING_TEXT_RADIUS = 80;
const TOP_GAP_DEGREES = 14;

const FLIGHT_MS = 220;
const SWEEP_MS = 220;
const STAGGER_MS = 62.5;
const NUMERAL_MS = 900;
const RING_MS = 250;

function polar(radius: number, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: CENTRE + radius * Math.sin(radians), y: CENTRE - radius * Math.cos(radians) };
}

function wedgePath(from: number, to: number, radius: number): string {
  const sweep = Math.min(to - from, 359.9);
  if (sweep <= 0.01) return '';
  const start = polar(radius, from);
  const end = polar(radius, from + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${CENTRE} ${CENTRE} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function arcPath(radius: number, from: number, to: number): string {
  const start = polar(radius, from);
  const end = polar(radius, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${large} ${sweep} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface Layout {
  readonly module: SealModule;
  readonly from: number;
  readonly sweep: number;
  readonly order: number;
}

function layout(modules: readonly SealModule[]): Layout[] {
  const total = modules.reduce((sum, module) => sum + module.minutes, 0);
  let cursor = 0;
  let order = 0;
  return modules.map((module) => {
    const sweep = total === 0 ? 0 : (module.minutes / total) * 360;
    const from = cursor;
    cursor += sweep;
    const entry: Layout = { module, from, sweep, order: module.verified ? order : -1 };
    if (module.verified) order += 1;
    return entry;
  });
}

function flyChips(modules: readonly Layout[], seal: SVGSVGElement): void {
  const sealBox = seal.getBoundingClientRect();
  const target = { x: sealBox.left + sealBox.width / 2, y: sealBox.top + sealBox.height / 2 };
  for (const entry of modules) {
    if (entry.order < 0) continue;
    const source = document.querySelector<HTMLElement>(`[data-chip-for="${entry.module.id}"]`);
    if (source === null) continue;
    const box = source.getBoundingClientRect();
    const chip = source.cloneNode(true) as HTMLElement;
    chip.classList.add('seal-chip');
    chip.setAttribute('aria-hidden', 'true');
    chip.style.left = `${box.left}px`;
    chip.style.top = `${box.top}px`;
    chip.style.width = `${box.width}px`;
    chip.style.height = `${box.height}px`;
    document.body.append(chip);
    const animation = chip.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        {
          transform: `translate(${target.x - box.left - box.width / 2}px, ${target.y - box.top - box.height / 2}px) scale(0.4)`,
          opacity: 0.2,
        },
      ],
      { duration: FLIGHT_MS, delay: entry.order * STAGGER_MS, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
    );
    animation.finished.then(() => chip.remove()).catch(() => chip.remove());
  }
}

/**
 * The pressed terracotta mark: filled wedges for verified modules, hatched outlines for
 * the rest, the awarded hours in the centre and the serial and issue date in the ring.
 */
export function Seal({
  state,
  modules,
  hours,
  serial,
  issuedOn,
  play = false,
  jump = false,
  onFinished,
}: SealProps): ReactNode {
  const wedges = layout(modules);
  const verifiedCount = wedges.filter((entry) => entry.order >= 0).length;
  const totalMs = Math.max(0, (verifiedCount - 1) * STAGGER_MS) + FLIGHT_MS + SWEEP_MS + NUMERAL_MS + RING_MS;
  const animated = play && !prefersReducedMotion() && verifiedCount > 0;
  const [elapsed, setElapsed] = useState(animated ? 0 : Number.POSITIVE_INFINITY);
  const sealRef = useRef<SVGSVGElement>(null);
  const finished = useRef(false);
  const jumped = useRef(false);

  useEffect(() => {
    if (!animated) {
      onFinished?.();
      return;
    }
    const seal = sealRef.current;
    if (seal !== null) flyChips(wedges, seal);
    const started = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      if (jumped.current) return;
      const value = now - started;
      setElapsed(value);
      if (value < totalMs) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The press plays once per mount and is driven by time alone.
  }, [animated]);

  useEffect(() => {
    if (!jump) return;
    jumped.current = true;
    setElapsed(Number.POSITIVE_INFINITY);
  }, [jump]);

  useEffect(() => {
    if (elapsed >= totalMs && !finished.current) {
      finished.current = true;
      onFinished?.();
    }
  }, [elapsed, totalMs, onFinished]);

  const wedgeProgress = (entry: Layout): number => {
    if (entry.order < 0) return 1;
    if (!Number.isFinite(elapsed)) return 1;
    const start = entry.order * STAGGER_MS + FLIGHT_MS;
    return Math.min(1, Math.max(0, (elapsed - start) / SWEEP_MS));
  };

  const wedgesDone = Math.max(0, (verifiedCount - 1) * STAGGER_MS) + FLIGHT_MS + SWEEP_MS;
  const numeralProgress = Number.isFinite(elapsed)
    ? Math.min(1, Math.max(0, (elapsed - wedgesDone) / NUMERAL_MS))
    : 1;
  const ringProgress = Number.isFinite(elapsed)
    ? Math.min(1, Math.max(0, (elapsed - wedgesDone - NUMERAL_MS) / RING_MS))
    : 1;

  const awardedQuarters = Math.round(Number.parseFloat(hours) * 4);
  const shownQuarters = Math.floor(numeralProgress * awardedQuarters);
  const numeral =
    numeralProgress >= 1 ? Number.parseFloat(hours).toFixed(2) : (shownQuarters / 4).toFixed(2);

  const ringGap = state === 'pending';
  const ringLabel =
    serial === null || serial === undefined || issuedOn === null || issuedOn === undefined
      ? null
      : `${serial} · ${formatProviderDate(issuedOn)}`;
  const showRingText = !ringGap && ringLabel !== null && ringProgress > 0;

  return (
    <svg
      ref={sealRef}
      className="seal"
      viewBox="0 0 200 200"
      role="img"
      aria-label="Contact-hour seal"
      data-seal-state={state}
    >
      <defs>
        <pattern id="seal-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--terracotta-soft)" strokeWidth="1.6" />
        </pattern>
      </defs>

      {ringGap ? (
        <path
          d={arcPath(RING_RADIUS, TOP_GAP_DEGREES / 2, 360 - TOP_GAP_DEGREES / 2)}
          fill="none"
          stroke="var(--terracotta)"
          strokeWidth="1.6"
        />
      ) : (
        <circle cx={CENTRE} cy={CENTRE} r={RING_RADIUS} fill="none" stroke="var(--terracotta)" strokeWidth="1.6" />
      )}
      <circle cx={CENTRE} cy={CENTRE} r={RING_RADIUS - 6} fill="none" stroke="var(--terracotta)" strokeWidth="0.6" opacity="0.6" />

      {wedges.map((entry) => {
        const progress = wedgeProgress(entry);
        const sweep = entry.sweep * progress;
        const path = wedgePath(entry.from, entry.from + sweep, WEDGE_RADIUS);
        const label = entry.module.title.length > 15 ? `${entry.module.title.slice(0, 14)}…` : entry.module.title;
        const mid = entry.from + entry.sweep / 2;
        const labelPoint = polar(WEDGE_RADIUS - 17, mid);
        // Labels read outward from the centre and are flipped in the lower half so they stay upright.
        const labelAngle = mid > 90 && mid < 270 ? mid + 180 : mid;
        return (
          <g
            key={entry.module.id}
            data-module-id={entry.module.id}
            data-state={entry.module.verified ? 'verified' : 'unverified'}
            data-sweep={entry.sweep.toFixed(1)}
          >
            {path === '' ? null : (
              <path
                d={path}
                fill={entry.module.verified ? 'var(--terracotta)' : 'url(#seal-hatch)'}
                stroke={entry.module.verified ? 'var(--ground)' : 'var(--terracotta)'}
                strokeWidth={entry.module.verified ? 1 : 1.2}
              />
            )}
            {entry.module.verified ? null : (
              <text
                className="seal__label"
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                transform={`rotate(${labelAngle} ${labelPoint.x} ${labelPoint.y})`}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}

      <circle cx={CENTRE} cy={CENTRE} r={31} fill="var(--ground)" stroke="var(--terracotta)" strokeWidth="1" />
      <text
        className="seal__numeral"
        data-seal-numeral={numeral}
        x={CENTRE}
        y={CENTRE - 2}
        fontSize="23"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {numeral}
      </text>
      <text className="seal__label" x={CENTRE} y={CENTRE + 19} fontSize="5.6" textAnchor="middle">
        CONTACT HOURS
      </text>

      {ringGap ? (
        <text className="seal__pending" x={CENTRE} y={CENTRE - RING_RADIUS + 3} textAnchor="middle">
          Certificate PDF pending
        </text>
      ) : null}

      {showRingText ? (
        <g data-seal-ring={ringLabel} opacity={ringProgress}>
          <path id="seal-ring-top" d={arcPath(RING_TEXT_RADIUS, -62, 62)} fill="none" />
          <path id="seal-ring-bottom" d={arcPath(RING_TEXT_RADIUS - 2, 242, 118)} fill="none" />
          <text className="seal__ring-text">
            <textPath href="#seal-ring-top" startOffset="50%" textAnchor="middle">
              {serial}
            </textPath>
          </text>
          <text className="seal__ring-text">
            <textPath href="#seal-ring-bottom" startOffset="50%" textAnchor="middle">
              {issuedOn === null || issuedOn === undefined ? '' : formatProviderDate(issuedOn)}
            </textPath>
          </text>
        </g>
      ) : null}
    </svg>
  );
}
