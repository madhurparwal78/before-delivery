// The SVG <pattern> fills of the mark colours: one definition per colour and pattern that the view uses, shared by the
// marks and the legend swatches. Ids carry a per-chart scope so two charts on a page never share a definition.
import { patternInk, patternTile, TILE_SIZE, type PatternName } from '../../shared/chart/palette.ts';

export interface Swatch {
  color: string;
  pattern: PatternName;
}

function idOf(scope: string, swatch: Swatch): string {
  return `${scope}-${swatch.pattern}-${swatch.color.replace(/\D+/g, '-')}`;
}

export function scaleId(scope: string): string {
  return `${scope}-scale`;
}

/** The `fill` of a mark or swatch: none for a null Color value, the colour for solid, else the pattern. */
export function fillOf(scope: string, swatch: Swatch): string {
  if (swatch.color === '') return 'none';
  return swatch.pattern === 'solid' ? `rgb(${swatch.color})` : `url(#${idOf(scope, swatch)})`;
}

function Tile({ swatch, id }: { swatch: Swatch; id: string }) {
  const ink = `rgb(${patternInk(swatch.color)})`;
  return (
    <pattern id={id} width={TILE_SIZE} height={TILE_SIZE} patternUnits="userSpaceOnUse">
      <rect width={TILE_SIZE} height={TILE_SIZE} fill={`rgb(${swatch.color})`} />
      {patternTile(swatch.pattern).map((shape, i) => {
        switch (shape.kind) {
          case 'circle':
            return shape.fill ? (
              <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={ink} />
            ) : (
              <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill="none" stroke={ink} strokeWidth="1.4" />
            );
          case 'rect':
            return <rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={ink} />;
          case 'line':
            return <line key={i} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={ink} strokeWidth={shape.width} />;
        }
      })}
    </pattern>
  );
}

export function PatternDefs({ scope, swatches, scale }: { scope: string; swatches: readonly Swatch[]; scale: [string, string] | null }) {
  const seen = new Map<string, Swatch>();
  for (const swatch of swatches) {
    if (swatch.color !== '' && swatch.pattern !== 'solid') seen.set(idOf(scope, swatch), swatch);
  }
  return (
    <defs>
      {[...seen].map(([id, swatch]) => (
        <Tile key={id} id={id} swatch={swatch} />
      ))}
      {scale ? (
        <linearGradient id={scaleId(scope)} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={`rgb(${scale[0]})`} />
          <stop offset="1" stopColor={`rgb(${scale[1]})`} />
        </linearGradient>
      ) : null}
    </defs>
  );
}
