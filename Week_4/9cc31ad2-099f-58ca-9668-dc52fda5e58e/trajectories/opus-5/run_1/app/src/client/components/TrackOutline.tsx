import { useEffect, useRef, useState } from 'react';
import { LAYOUTS, type LayoutId } from '../../shared/catalogue.js';

/** The loop every track outline is drawn on, measured in layout metres. */
const LOOP_PATH =
  'M 60,20 H 260 A 40,40 0 0 1 300,60 V 140 A 40,40 0 0 1 260,180 H 60 A 40,40 0 0 1 20,140 V 60 A 40,40 0 0 1 60,20 Z';

export type SectorTint = 'ink' | 'gain' | 'loss';

const TINTS: Record<SectorTint, string> = {
  ink: 'var(--ink)',
  gain: 'var(--gain)',
  loss: 'var(--loss)',
};

export function TrackOutline({
  layoutId,
  sectorTints,
  markerAt,
  height = 120,
}: {
  layoutId: LayoutId;
  sectorTints?: [SectorTint, SectorTint, SectorTint];
  markerAt?: number | null;
  height?: number;
}) {
  const layout = LAYOUTS[layoutId];
  const pathRef = useRef<SVGPathElement>(null);
  const [marker, setMarker] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || markerAt === null || markerAt === undefined) {
      setMarker(null);
      return;
    }
    const total = path.getTotalLength();
    const fraction = Math.min(Math.max(markerAt / layout.lengthM, 0), 1);
    const point = path.getPointAtLength(total * fraction);
    setMarker({ x: point.x, y: point.y });
  }, [markerAt, layout.lengthM]);

  return (
    <svg viewBox="0 0 320 200" height={height} width="100%" role="presentation" focusable="false">
      <path
        ref={pathRef}
        d={LOOP_PATH}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={3}
        pathLength={layout.lengthM}
      />
      {sectorTints?.map((tint, index) => {
        const sector = layout.sectors[index]!;
        return (
          <path
            key={index}
            d={LOOP_PATH}
            fill="none"
            stroke={TINTS[tint]}
            strokeWidth={7}
            pathLength={layout.lengthM}
            strokeDasharray={`${sector.end - sector.start} ${layout.lengthM}`}
            strokeDashoffset={-sector.start}
          />
        );
      })}
      <line x1={60} y1={10} x2={60} y2={30} stroke="var(--ink)" strokeWidth={3} />
      {layout.corners.map((corner) => (
        <path
          key={corner.start}
          d={LOOP_PATH}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1}
          pathLength={layout.lengthM}
          strokeDasharray={`${corner.end - corner.start} ${layout.lengthM}`}
          strokeDashoffset={-corner.start}
          opacity={0.6}
        />
      ))}
      {marker && (
        <circle
          cx={marker.x}
          cy={marker.y}
          r={7}
          fill="var(--accent)"
          role="img"
          aria-label="Reference marker"
        />
      )}
    </svg>
  );
}

export function TulipGlyphs() {
  const glyph = (className: string) => (
    <svg
      key={className}
      className={`tulip ${className}`}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 18 V10 H16" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
      <path d="M12 6 L16 10 L12 14" fill="none" stroke="var(--ink)" strokeWidth="1.4" />
      <circle cx="4" cy="18" r="1.4" fill="var(--ink)" />
    </svg>
  );
  return <>{['tulip-tl', 'tulip-tr', 'tulip-bl', 'tulip-br'].map(glyph)}</>;
}
