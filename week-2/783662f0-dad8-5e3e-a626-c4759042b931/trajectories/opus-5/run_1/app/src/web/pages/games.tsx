import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { gamesFound, moveCounter, replayStep } from '../../shared/copy.js';
import { cardName } from '../../shared/domain.js';
import type { GameHistoryRow, GameRecord } from '../../shared/types.js';
import { get } from '../api.js';
import { Link } from '../router.js';
import { Status } from '../ui.js';
import { ChessBoardView, FourBoardView, replayPositionAt } from '../boards.js';

export function GamesPage({ slug }: { slug: string }): ReactNode {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<GameHistoryRow[]>([]);
  const [total, setTotal] = useState(0);

  const reload = useCallback(
    async (text: string) => {
      const answer = await get<{ games: GameHistoryRow[]; total: number }>(
        `/api/servers/${slug}/games?q=${encodeURIComponent(text)}`,
      );
      setRows(answer.games);
      setTotal(answer.total);
    },
    [slug],
  );

  useEffect(() => {
    void reload(search);
  }, [reload, search]);

  return (
    <div className="page">
      <h1>Game history</h1>
      <label htmlFor="game-search">Search games</label>
      <input
        id="game-search"
        type="search"
        role="searchbox"
        aria-label="Search games"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Status name="Search results" text={gamesFound(total)} />
      <ul aria-label="Games" className="stack">
        {rows.map((row) => (
          <li key={row.id} className="card">
            <Link to={`/s/${slug}/games/${row.id}`}>
              {`${row.table_name}: ${row.players.join(' vs ')}`}
            </Link>
            <p>{row.result_text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface MoveRow {
  n: number;
  move: string;
  copy: string;
}

export function ReplayPage({ slug, gameId }: { slug: string; gameId: string }): ReactNode {
  const [game, setGame] = useState<GameRecord | null>(null);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [at, setAt] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const board = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void get<GameRecord>(`/api/games/${gameId}`).then((record) => {
      setGame(record);
      void get<{ moves: MoveRow[] }>(`/api/games/${gameId}/moves`).then((answer) => {
        setMoves(answer.moves);
        /* The viewer opens on the final position. */
        setAt(answer.moves.length);
      });
    });
  }, [gameId]);

  const total = moves.length;

  const step = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), Math.max(1, total));
      setAt(clamped);
      const row = moves[clamped - 1];
      if (row !== undefined) setAnnouncement(replayStep(clamped, total, row.copy));
    },
    [moves, total],
  );

  const position = game === null ? null : replayPositionAt(game, at);

  return (
    <div className="page">
      <h1>Replay</h1>
      <div className="replay-layout">
        <div
          role="region"
          aria-label="Replay board"
          ref={board}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              step(at - 1);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              step(at + 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              step(1);
            } else if (event.key === 'End') {
              event.preventDefault();
              step(total);
            }
          }}
        >
          {game !== null && position !== null ? (
            game.game === 'chess' && 'fen' in position ? (
              <ChessBoardView fen={position.fen} />
            ) : game.game === 'four' && 'rows' in position ? (
              <FourBoardView rows={position.rows} />
            ) : (
              <CardReplayView game={game} at={at} />
            )
          ) : null}
        </div>
        <div className="stack">
          <div className="row">
            <button type="button" onClick={() => step(1)}>
              First move
            </button>
            <button type="button" onClick={() => step(at - 1)}>
              Previous move
            </button>
            <button type="button" onClick={() => step(at + 1)}>
              Next move
            </button>
            <button type="button" onClick={() => step(total)}>
              Last move
            </button>
          </div>
          <p className="move-number mono">{moveCounter(at, total)}</p>
          <Status name="Replay announcements" text={announcement} />
          <div role="region" aria-label="Result" className="card">
            <p>{game?.result?.text ?? ''}</p>
            <ul>
              {(game?.seats ?? []).map((seat) => {
                const line = game?.result?.settlement.find(
                  (entry) => entry.character_id === seat.character?.id,
                );
                const amount = line?.amount ?? 0;
                return (
                  <li key={seat.seat} className="mono">
                    {`${seat.character?.name ?? ''}: ${
                      amount === 0 ? '0' : amount > 0 ? `+${amount}` : `-${Math.abs(amount)}`
                    }`}
                  </li>
                );
              })}
            </ul>
          </div>
          <p>
            <Link to={`/s/${slug}/games`}>Back to history</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Once the hand has ended every read shows the dealt hands and the tricks. */
function CardReplayView({ game, at }: { game: GameRecord; at: number }): ReactNode {
  const played = game.moves.slice(0, at);
  return (
    <div className="stack">
      <div role="region" aria-label="Current trick">
        <h3>Current trick</h3>
        <ul className="hand">
          {played.slice(Math.floor((at - 1) / 4) * 4, at).map((card, index) => (
            <li key={`${card}-${index}`}>{cardName(card)}</li>
          ))}
        </ul>
      </div>
      {(game.hands ?? []).map((hand, seat) => (
        <div key={seat}>
          <h3>{game.seats[seat]?.character?.name ?? `Seat ${seat + 1}`}</h3>
          <ul className="hand">
            {hand
              .filter((card) => !played.includes(card))
              .map((card) => (
                <li key={card}>{cardName(card)}</li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
