import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { COPY, seasonStarted } from '../../shared/copy.js';
import { GAME_NAMES, type GameKind } from '../../shared/domain.js';
import type { LeaderboardEntry, ServerObject } from '../../shared/types.js';
import { get, post } from '../api.js';
import { Dialog, Status } from '../ui.js';
import { useServerStream } from '../stream.js';

const TABS: readonly GameKind[] = ['chess', 'four', 'tricks'];

export function LeaderboardsPage({
  slug,
  server,
}: {
  slug: string;
  server: ServerObject | null;
}): ReactNode {
  const [tab, setTab] = useState<GameKind>('chess');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [season, setSeason] = useState(server?.season ?? 1);
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const reload = useCallback(async () => {
    const answer = await get<{ season: number; entries: LeaderboardEntry[] }>(
      `/api/servers/${slug}/leaderboards/${tab}`,
    );
    setSeason(answer.season);
    setEntries(answer.entries);
  }, [slug, tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* The table updates in place within the push delay after a settlement. */
  useServerStream(slug, (event) => {
    if (event.kind !== 'leaderboard') return;
    const payload = event.payload as { game: GameKind; season: number; entries: LeaderboardEntry[] };
    if (payload.game !== tab) return;
    setSeason(payload.season);
    setEntries(payload.entries);
  });

  return (
    <div className="page leaderboard-page">
      <h1>Leaderboards</h1>
      <h2>{`Season ${season}`}</h2>
      <div role="tablist" aria-label="Game" className="row">
        {TABS.map((game, index) => (
          <button
            key={game}
            type="button"
            role="tab"
            id={`tab-${game}`}
            aria-selected={tab === game}
            aria-controls="leaderboard-panel"
            tabIndex={tab === game ? 0 : -1}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            onClick={() => setTab(game)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const step = event.key === 'ArrowRight' ? 1 : -1;
              const nextIndex = (index + step + TABS.length) % TABS.length;
              setTab(TABS[nextIndex]);
              tabRefs.current[nextIndex]?.focus();
            }}
          >
            {GAME_NAMES[game]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="leaderboard-panel" aria-labelledby={`tab-${tab}`}>
        <table aria-label="Leaderboard">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Character</th>
              <th scope="col">Wins</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3}>{COPY.emptyLeaderboard}</td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.character_id}>
                  <td className="mono">{entry.rank}</td>
                  <td>{entry.name}</td>
                  <td className="mono">{entry.wins}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {server !== null && server.role === 'owner' ? (
        <button type="button" onClick={() => setConfirming(true)}>
          Start new season
        </button>
      ) : null}
      <Status name="Leaderboard status" text={status} />
      {confirming ? (
        <Dialog label="Start a new season?" onClose={() => setConfirming(false)}>
          <h2>Start a new season?</h2>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => {
                void post<{ season: number }>(`/api/servers/${slug}/seasons`, {}).then(
                  async (answer) => {
                    setConfirming(false);
                    setStatus(seasonStarted(answer.season));
                    setSeason(answer.season);
                    setEntries([]);
                    await reload();
                  },
                );
              }}
            >
              Start season
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep season
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
