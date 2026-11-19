import type { ReactNode } from 'react';
import { SECTIONS, type SectionCode } from '../../shared/hall';

const ARCS: Record<SectionCode, { readonly radius: number }> = {
  ST: { radius: 22 },
  CI: { radius: 36 },
  BA: { radius: 50 },
};

/** Three nested arcs, one per section, with the chosen one filled. */
export function HallKey({ section }: { readonly section: SectionCode }): ReactNode {
  const chosen = SECTIONS.find((candidate) => candidate.code === section);
  return (
    <svg className="hall-key" viewBox="0 0 120 64" role="img" aria-label={`Hall key: ${chosen?.name ?? ''}`}>
      <rect className="hall-key-stage" x="50" y="2" width="20" height="6" />
      {SECTIONS.map((candidate) => {
        const radius = ARCS[candidate.code].radius;
        return (
          <path
            key={candidate.code}
            className={`hall-key-arc${candidate.code === section ? ' hall-key-arc--chosen' : ''}`}
            d={`M ${60 - radius} 8 A ${radius} ${radius} 0 0 0 ${60 + radius} 8`}
          />
        );
      })}
    </svg>
  );
}
