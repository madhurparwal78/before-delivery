// The Reference lap figure: the track outline, the marker, sector chips, the sweep's visuals.
import { useEffect, useRef, useState, type JSX } from 'react';
import type { Garage, GarageCar, Reference } from './api';
import { LAYOUTS, type LayoutId } from '../../shared/domain';
import { fmtCoins, fmtDelta, fmtTime } from './formats';
import { prefersReducedMotion } from './ui';

type SweepPhase = 'idle' | 'running' | 'done';

interface Chip { label: 'S1' | 'S2' | 'S3'; deltaMs: number | null }

/** The track outline as a line drawing from the layout's segments. */
function TrackOutline({ layoutId, markerAt, sectorColours }: {
  layoutId: string; markerAt: number; sectorColours: ('same' | 'gain' | 'loss')[];
}): JSX.Element {
  const layout = LAYOUTS[layoutId as LayoutId];
  const len = layout.length;
  const w = 300;
  const h = 90;
  const x = (m: number): number => (m / len) * w;
  // Three stacked rows: straight, corner, straight — a rally-stage strip.
  const rows: { y: number }[] = [{ y: 12 }, { y: 42 }, { y: 72 }];
  void rows;
  const colourOf = (i: number): string =>
    sectorColours[i] === 'gain' ? 'var(--green)' : sectorColours[i] === 'loss' ? 'var(--red)' : 'var(--ink)';
  const sectorEnds = layout.sectors;
  return (
    <svg viewBox={`-4 -4 ${w + 8} ${h + 8}`} width="100%" height={h + 8} style={{ display: 'block' }} aria-hidden="true">
      <rect x={0} y={4} width={w} height={10} fill="none" stroke="var(--rule)" />
      <line x1={0} y1={4} x2={x(sectorEnds[0])} y2={4} stroke={colourOf(0)} strokeWidth={2} />
      <line x1={x(sectorEnds[0])} y1={4} x2={x(sectorEnds[1])} y2={4} stroke={colourOf(1)} strokeWidth={2} />
      <line x1={x(sectorEnds[1])} y1={4} x2={x(sectorEnds[2])} y2={4} stroke={colourOf(2)} strokeWidth={2} />
      {layout.corners.map((c, i) => (
        <g key={i}>
          <rect x={x(c.start)} y={-2} width={x(c.end - c.start)} height={8} fill="var(--rule)" />
          <rect x={x(c.start)} y={10} width={x(c.end - c.start)} height={3} fill="var(--accent)" />
        </g>
      ))}
      <rect x={-2} y={-4} width={2} height={16} fill="var(--ink)" />
      <circle role="presentation" cx={x(markerAt * len)} cy={4} r={5} fill="var(--accent)" />
    </svg>
  );
}

export function ReferenceLapFigure({ garage, car, units, layoutId }: {
  garage: Garage; car: GarageCar; units: 'kmh' | 'mph'; layoutId: string;
}): JSX.Element {
  void garage; void car; void units;
  const ref = garage.latestReference;
  const [marker, setMarker] = useState(1);
  const [phase, setPhase] = useState<SweepPhase>('idle');
  const [chips, setChips] = useState<Chip[]>(
    ref ? ref.sectorDeltasMs.map((d, i) => ({ label: `S${i + 1}` as Chip['label'], deltaMs: d })) : []
  );
  const [shown, setShown] = useState<{ oldMs: number; newMs: number } | null>(
    ref ? { oldMs: ref.oldLapMs, newMs: ref.newLapMs } : null
  );
  const rafRef = useRef(0);

  // The sweep events, dispatched by the SweepController.
  useEffect(() => {
    const onStart = (): void => {
      if (prefersReducedMotion()) { setMarker(1); setPhase('done'); return; }
      setPhase('running');
      const t0 = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - t0) / 1200);
        // Starts fast and eases into the finish.
        const eased = 1 - Math.pow(1 - t, 2.2);
        setMarker(eased);
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };
    const onEnd = (): void => {
      cancelAnimationFrame(rafRef.current);
      setMarker(1);
      setPhase('done');
    };
    window.addEventListener('kerb-sweep-start', onStart);
    window.addEventListener('kerb-sweep-end', onEnd);
    return () => {
      window.removeEventListener('kerb-sweep-start', onStart);
      window.removeEventListener('kerb-sweep-end', onEnd);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // A later committed reference replaces the figure at once.
  useEffect(() => {
    if (ref) {
      setShown({ oldMs: ref.oldLapMs, newMs: ref.newLapMs });
      setChips(ref.sectorDeltasMs.map((d, i) => ({ label: `S${i + 1}` as Chip['label'], deltaMs: d })));
      if (phase === 'idle') setMarker(1);
    }
  }, [ref, phase]);

  const sectorColours: ('same' | 'gain' | 'loss')[] =
    phase === 'running'
      ? [marker > 0.34 ? 'gain' : 'same', marker > 0.67 ? 'gain' : 'same', marker >= 1 ? 'gain' : 'same']
      : ref ? ref.sectorDeltasMs.map(d => (d < 0 ? 'gain' : d > 0 ? 'loss' : 'same')) : ['same', 'same', 'same'];

  const summary = ref ? summaryOf(ref) : null;

  return (
    <figure aria-label="Reference lap" style={{ margin: '14px 0 0' }}>
      <figcaption style={{ marginBottom: 6 }}>
        <span className="label">Reference lap</span>
      </figcaption>
      <TrackOutline layoutId={layoutId} markerAt={marker} sectorColours={sectorColours} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {chips.map((c, i) => (
          <span key={c.label} className="mono rule-cell" data-chip={i}
                style={{ padding: '2px 8px', fontSize: '0.9em' }}>
            {c.label}{c.deltaMs !== null ? ` ${fmtDelta(c.deltaMs)}` : ''}
          </span>
        ))}
      </div>
      {shown && (
        <p style={{ margin: '8px 0 0' }}>
          Predicted lap{' '}
          <span className="mono">{fmtTime(shown.newMs)}</span>{' '}
          <span className="mono" style={{ textDecoration: 'line-through' }}>{fmtTime(shown.oldMs)}</span>
        </p>
      )}
      {ref && <p style={{ margin: '4px 0 0' }}>Cost −{fmtCoins(ref.price)} coins</p>}
      {summary && phase !== 'running' && <p style={{ margin: '4px 0 0' }}>{summary}</p>}
    </figure>
  );
}

export function summaryOf(ref: Reference): string {
  if (ref.deltaMs === 0) return 'No change on the reference lap';
  const sector = ref.sectorDeltasMs[0] === undefined ? 'S1' : sectorName(ref);
  return `${fmtDelta(ref.deltaMs)}, mostly ${sector}`;
}

function sectorName(ref: Reference): string {
  const abs = ref.sectorDeltasMs.map(d => Math.abs(d));
  let best = 0;
  for (let i = 1; i < 3; i++) if (abs[i] > abs[best]) best = i;
  return `S${best + 1}`;
}
