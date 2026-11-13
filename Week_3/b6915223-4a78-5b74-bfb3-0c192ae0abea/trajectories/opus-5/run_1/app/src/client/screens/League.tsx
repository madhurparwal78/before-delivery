import { useCallback, useEffect, useState } from 'react';
import type { LeagueView } from '../../shared/types.ts';
import { api } from '../api.ts';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { useApp } from '../state.tsx';
import { StandingsTable } from '../components/Standings.tsx';

export const League = ({ leagueId }: { leagueId: string }) => {
  const announce = useAnnounce();
  const { me, onStandings } = useApp();
  const [league, setLeague] = useState<LeagueView | null>(null);
  const [pending, setPending] = useState<'copy' | 'code' | null>(null);

  const refresh = useCallback(async () => {
    setLeague(await api.league(leagueId));
  }, [leagueId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onStandings(() => void refresh()), [onStandings, refresh]);

  if (league === null) return <p className="empty">Loading league…</p>;

  const isAdmin = league.code !== null;

  const copyCode = async (): Promise<void> => {
    setPending('copy');
    try {
      await navigator.clipboard.writeText(league.code ?? '');
      announce('League updates', `Join code ${league.code ?? ''} copied.`);
    } finally {
      setPending(null);
    }
  };

  const newCode = async (): Promise<void> => {
    setPending('code');
    try {
      const result = await api.newJoinCode(leagueId);
      await refresh();
      announce('League updates', `New join code ${result.code}. The old code no longer works.`);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="page">
      <h1>{league.name}</h1>
      {isAdmin && (
        <div className="code-row">
          <span className="join-code mono">{league.code}</span>
          <button type="button" disabled={pending === 'copy'} onClick={() => void copyCode()}>
            {pending === 'copy' ? 'Copying…' : 'Copy join code'}
          </button>
          <button type="button" disabled={pending === 'code'} onClick={() => void newCode()}>
            {pending === 'code' ? 'Replacing…' : 'New join code'}
          </button>
        </div>
      )}
      <div className="table-frame">
        <StandingsTable label="Standings" rows={league.standings} leagueId={leagueId} />
      </div>
      <p className="hint">{me === null ? '' : `Signed in as ${me.team_name}.`}</p>
      <LiveRegion name="League updates" />
    </section>
  );
};
