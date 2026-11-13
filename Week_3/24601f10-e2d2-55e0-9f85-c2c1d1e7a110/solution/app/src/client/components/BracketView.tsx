import { useMemo, type ReactNode } from 'react';
import type { MatchView, StandingsView, TournamentView } from '../../shared/api.js';
import { buildRegions, phoneTabs } from '../bracketModel.js';
import type { Layout } from '../layout.js';
import type { TraceController } from '../trace.js';
import { PhoneRounds } from './PhoneRounds.js';
import { Region } from './Region.js';
import { Standings } from './Standings.js';

// The live bracket: regions on desk and tablet, one round at a time on a phone, standings underneath.
export function BracketView({ tournament, matches, standings, layout, whole, controller, onOpen }: {
  tournament: TournamentView;
  matches: MatchView[];
  standings: StandingsView | null;
  layout: Layout;
  whole: boolean;
  controller: TraceController;
  onOpen: (match: MatchView) => void;
}): ReactNode {
  const regions = useMemo(() => buildRegions(tournament.format, matches), [tournament.format, matches]);
  const tabs = useMemo(() => phoneTabs(regions), [regions]);
  return (
    <div className="bracket-view">
      {layout === 'phone' && !whole ? (
        <PhoneRounds tabs={tabs} regions={regions} format={tournament.format} current={tournament.current_round}
          controller={controller} onOpen={onOpen} />
      ) : (
        <div className="regions">
          {regions.map((region) => (
            <Region key={region.name} region={region} format={tournament.format} whole={whole} controller={controller} onOpen={onOpen}
              reveal={region.bracket === (tournament.current_round?.bracket ?? region.bracket)} />
          ))}
        </div>
      )}
      {standings ? <div className="standings-block"><Standings standings={standings} /></div> : null}
    </div>
  );
}
