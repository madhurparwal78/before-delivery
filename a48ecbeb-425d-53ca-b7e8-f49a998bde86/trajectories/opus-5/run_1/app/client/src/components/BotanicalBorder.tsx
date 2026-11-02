import { useMemo, type ReactElement } from 'react';
import { seededRandom } from './canArt.js';

interface BotanicalBorderProps {
  /** The same seed always draws the same border. */
  seed: number;
  flip?: boolean;
}

const WIDTH = 1200;
const HEIGHT = 64;

/**
 * A section break drawn in code: a border of mate leaves and ceibo blossoms whose
 * leaves and petals are placed by a seeded pattern.
 */
export function BotanicalBorder({ seed, flip = false }: BotanicalBorderProps): ReactElement {
  const shapes = useMemo(() => {
    const random = seededRandom(seed * 2654435761);
    const leaves: Array<{ x: number; y: number; angle: number; size: number; tone: number }> = [];
    const blossoms: Array<{ x: number; y: number; size: number }> = [];
    for (let index = 0; index < 54; index += 1) {
      leaves.push({
        x: (index / 54) * WIDTH + random() * 18,
        y: HEIGHT / 2 + (random() - 0.5) * 26,
        angle: (random() - 0.5) * 120,
        size: 14 + random() * 16,
        tone: random(),
      });
    }
    for (let index = 0; index < 9; index += 1) {
      blossoms.push({
        x: (index / 9) * WIDTH + 40 + random() * 50,
        y: HEIGHT / 2 + (random() - 0.5) * 14,
        size: 7 + random() * 5,
      });
    }
    return { leaves, blossoms };
  }, [seed]);

  return (
    <svg
      className="botanical"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
    >
      <line
        x1="0"
        y1={HEIGHT / 2}
        x2={WIDTH}
        y2={HEIGHT / 2}
        stroke="rgba(154, 201, 161, 0.32)"
        strokeWidth="1"
      />
      {shapes.leaves.map((leaf, index) => (
        <g key={`leaf-${index}`} transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle})`}>
          <path
            d={`M0 0 Q${leaf.size * 0.45} ${-leaf.size * 0.34} ${leaf.size} 0 Q${leaf.size * 0.45} ${leaf.size * 0.34} 0 0 Z`}
            fill={leaf.tone > 0.55 ? 'rgba(111,170,120,0.55)' : 'rgba(63,125,76,0.62)'}
          />
          <line
            x1={leaf.size * 0.1}
            y1="0"
            x2={leaf.size * 0.9}
            y2="0"
            stroke="rgba(250,244,230,0.3)"
            strokeWidth="0.8"
          />
        </g>
      ))}
      {shapes.blossoms.map((blossom, index) => (
        <g key={`blossom-${index}`} transform={`translate(${blossom.x} ${blossom.y})`}>
          {[0, 1, 2, 3, 4].map((petal) => (
            <ellipse
              key={petal}
              cx={blossom.size * 0.62}
              cy="0"
              rx={blossom.size * 0.62}
              ry={blossom.size * 0.26}
              fill="rgba(216,30,54,0.78)"
              transform={`rotate(${petal * 72})`}
            />
          ))}
          <circle cx="0" cy="0" r={blossom.size * 0.24} fill="rgba(247,230,161,0.95)" />
        </g>
      ))}
    </svg>
  );
}
