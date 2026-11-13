import { useCallback, useEffect, useState } from 'react';
import type { HistoryView } from '../../shared/types.ts';
import { api } from '../api.ts';
import { LiveRegion } from '../live.tsx';
import { useApp } from '../state.tsx';
import { HistoryTable } from '../components/HistoryTable.tsx';
import { usePlayerNames } from './History.tsx';

export const MemberHistory = ({
  leagueId,
  managerId,
}: {
  leagueId: string;
  managerId: string;
}) => {
  const { onStandings } = useApp();
  const names = usePlayerNames();
  const [history, setHistory] = useState<HistoryView | null>(null);

  const refresh = useCallback(async () => {
    setHistory(await api.memberHistory(leagueId, managerId));
  }, [leagueId, managerId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onStandings(() => void refresh()), [onStandings, refresh]);

  if (history === null) return <p className="empty">Loading member history…</p>;

  return (
    <section className="page">
      <h1>{history.team_name}</h1>
      <HistoryTable
        rows={history.rows}
        names={names}
        snapshotHref={(gameweek) =>
          `/api/leagues/${leagueId}/members/${managerId}/snapshots/${gameweek}`
        }
      />
      <LiveRegion name="History updates" />
    </section>
  );
};
