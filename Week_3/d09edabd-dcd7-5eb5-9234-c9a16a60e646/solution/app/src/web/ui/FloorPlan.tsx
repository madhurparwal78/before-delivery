import type { DrawPlacement, RoomDims } from '../three/roomView';

interface Props {
  dims: RoomDims;
  placements: (DrawPlacement & { entry?: boolean })[];
  selectedId?: string | null;
  labels?: boolean;
  label?: string;
  onSelect?: (id: string) => void;
}

const FILL: Record<DrawPlacement['kind'], string> = { door: '#c9a227', box: '#b5713a', cylinder: '#1f7a8c', prop: '#7a4fb0' };

/** A flat top-down floor plan to scale (front wall at the bottom): the stage without WebGL, and card thumbnails. */
export function FloorPlan({ dims, placements, selectedId, labels = true, label = 'Floor plan', onSelect }: Props) {
  const { widthMm: w, depthMm: d } = dims;
  const pad = Math.max(w, d) * 0.04;
  const type = Math.max(w, d) * 0.028;
  return (
    <svg className="floor-plan" viewBox={`${-pad} ${-pad} ${w + pad * 2} ${d + pad * 2}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={w} height={d} fill="#232a38" stroke="#56627a" strokeWidth={Math.max(w, d) * 0.006} />
      {Array.from({ length: Math.floor(w / 1000) }, (_, i) => (
        <line key={`v${i}`} x1={(i + 1) * 1000} y1={0} x2={(i + 1) * 1000} y2={d} stroke="#2e3647" strokeWidth={Math.max(w, d) * 0.002} />
      ))}
      {Array.from({ length: Math.floor(d / 1000) }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={(i + 1) * 1000} x2={w} y2={(i + 1) * 1000} stroke="#2e3647" strokeWidth={Math.max(w, d) * 0.002} />
      ))}
      {placements.map((p) => {
        const cx = p.xMm;
        const cy = d - p.zMm;
        const selected = p.id === selectedId;
        return (
          <g key={p.id} transform={`translate(${cx} ${cy}) rotate(${-p.rotationDeg})`} data-placement={p.id} onClick={onSelect ? () => onSelect(p.id) : undefined}>
            {p.kind === 'cylinder' ? (
              <ellipse rx={p.widthMm / 2} ry={p.depthMm / 2} fill={FILL.cylinder} stroke={selected ? '#3b82f6' : '#0d1118'} strokeWidth={selected ? type * 0.4 : type * 0.15} />
            ) : (
              <rect x={-p.widthMm / 2} y={-p.depthMm / 2} width={p.widthMm} height={p.depthMm} fill={FILL[p.kind]} stroke={selected ? '#3b82f6' : '#0d1118'} strokeWidth={selected ? type * 0.4 : type * 0.15} />
            )}
            {p.kind === 'door' && p.entry ? <path d={`M ${-p.widthMm / 2} ${-p.depthMm / 2 - type * 1.6} L ${p.widthMm / 2} ${-p.depthMm / 2 - type * 1.6}`} stroke="#e8572e" strokeWidth={type * 0.5} strokeLinecap="round" /> : null}
          </g>
        );
      })}
      {labels
        ? placements.map((p) => (
            <text key={`t${p.id}`} x={p.xMm} y={d - p.zMm + type * 0.35} textAnchor="middle" fontSize={type} fill="#e6e9ef" fontFamily="Inter, sans-serif" fontWeight={600} pointerEvents="none">
              {p.kind === 'door' && p.entry ? `${p.label} (entry)` : p.label}
            </text>
          ))
        : null}
    </svg>
  );
}
