import { useEffect, useState, type ReactNode } from 'react';
import type { PreviewMatch } from '../../shared/api.js';
import { api } from '../api.js';
import { slotName } from '../bracketModel.js';

const previewText = (m: PreviewMatch): string => {
  const upper = slotName(m.upper);
  const lower = slotName(m.lower);
  return `Match ${m.number}: ${upper === 'bye' ? `${lower} vs bye` : `${upper} vs ${lower}`}`;
};

// The round 1 preview follows every change to the field and its seeding.
export function Preview({ tournamentId, stamp }: { tournamentId: string; stamp: string }): ReactNode {
  const [matches, setMatches] = useState<PreviewMatch[]>([]);
  useEffect(() => {
    let current = true;
    void api.get<{ matches: PreviewMatch[] }>(`/api/tournaments/${tournamentId}/preview`).then((body) => {
      if (current) setMatches(body.matches);
    });
    return () => { current = false; };
  }, [tournamentId, stamp]);
  return (
    <section aria-label="Bracket preview" className="panel-block">
      <h2 className="block-title">Round 1 preview</h2>
      <ul aria-label="Round 1 preview" className="plain-list preview-list">
        {matches.map((m) => <li key={m.number}>{previewText(m)}</li>)}
      </ul>
    </section>
  );
}
