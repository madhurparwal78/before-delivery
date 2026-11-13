import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { useShell } from '../shell';
import { RankedTable, type ShuffleRow } from '../shuffle';
import type { LeaderCategory, Leaderboard as Board, Program } from '../types';
import { AwardMarker, CutMarker, GridLines } from '../ui';

function finalRows(category: LeaderCategory): ShuffleRow[] {
  return category.rows.map((row) => ({
    id: String(row.entryNumber),
    entryNumber: row.entryNumber,
    rank: row.rank,
    score: row.score,
    cut: row.cut,
    cells: (view) => (
      <>
        <td class="rank-cell">{row.rank}</td>
        <td>
          <span>
            Entry {row.entryNumber} — {row.title}
          </span>
          <span class="fold-under">
            {row.studioName} · {category.name}
          </span>
          {view.delta}
        </td>
        <td class="fold-cell">{category.name}</td>
        <td class="score-cell">{view.score ?? '—'}</td>
        <td>
          <CutMarker cut={view.cut} />
          {row.award === null ? null : <AwardMarker award={row.award} />}
        </td>
      </>
    ),
  }));
}

function shortlistRows(category: LeaderCategory): ShuffleRow[] {
  const ordered = [...category.rows].sort(
    (a, b) => (a.previousRank ?? a.rank) - (b.previousRank ?? b.rank),
  );
  return ordered.map((row, index) => ({
    id: String(row.entryNumber),
    entryNumber: row.entryNumber,
    rank: index + 1,
    score: row.previousScore,
    cut: index + 1 <= category.cut ? 'above' : 'below',
    cells: (view) => (
      <>
        <td class="rank-cell">{index + 1}</td>
        <td>
          <span>
            Entry {row.entryNumber} — {row.title}
          </span>
          <span class="fold-under">
            {row.studioName} · {category.name}
          </span>
          {view.delta}
        </td>
        <td class="fold-cell">{category.name}</td>
        <td class="score-cell">{view.score ?? '—'}</td>
        <td>
          <CutMarker cut={view.cut} />
        </td>
      </>
    ),
  }));
}

function CategorySection({
  category,
  reveal,
  onAnnounce,
  onReplay,
}: {
  category: LeaderCategory;
  reveal: boolean;
  onAnnounce: (line: string) => void;
  onReplay: () => void;
}): JSX.Element {
  const [rows, setRows] = useState<ShuffleRow[]>(() =>
    reveal ? shortlistRows(category) : finalRows(category),
  );
  const staged = useRef(reveal);
  const lastState = useRef(category.state);

  useEffect(() => {
    if (category.state !== 'revealed') {
      lastState.current = category.state;
      return undefined;
    }
    const justRevealed = staged.current || lastState.current !== 'revealed';
    lastState.current = 'revealed';
    staged.current = false;
    if (!justRevealed) {
      setRows(finalRows(category));
      return undefined;
    }
    setRows(shortlistRows(category));
    const timer = window.setTimeout(() => setRows(finalRows(category)), 120);
    return () => window.clearTimeout(timer);
  }, [category]);

  return (
    <section class="span-12" aria-label={category.name} style="margin-bottom:2.5rem">
      <h2 class="category-header">{category.name}</h2>
      {category.state === 'embargoed' ? (
        <p class="hint">Reveals at {category.revealsLabel}</p>
      ) : category.state === 'pending' ? (
        <p class="hint">No results yet.</p>
      ) : (
        <>
          <div class="row-flex" style="justify-content:space-between;margin-bottom:0.4rem">
            <span class="hint">Finalist cut at {category.cut}</span>
            <button class="btn btn--quiet" type="button" onClick={onReplay}>
              Replay reveal for {category.name}
            </button>
          </div>
          <RankedTable
            label={`${category.name} standings`}
            cut={category.cut}
            cutLabel="Finalist cut"
            rows={rows}
            onAnnounce={onAnnounce}
            columns={
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Entry</th>
                <th scope="col" class="fold-cell">
                  Category
                </th>
                <th scope="col" class="score-cell">
                  Score
                </th>
                <th scope="col">Status</th>
              </tr>
            }
          />
        </>
      )}
    </section>
  );
}

export function Leaderboard(): JSX.Element {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [replayToken, setReplayToken] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const query = programId === null ? '' : `?programId=${encodeURIComponent(programId)}`;
    const body = await api<Board>('GET', `/api/public/leaderboard${query}`);
    setBoard(body);
  }, [programId]);

  useEffect(() => {
    void api<{ programs: Program[] }>('GET', '/api/programs').then((body) => setPrograms(body.programs));
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const soonest = (board?.categories ?? [])
    .filter((category) => category.state === 'embargoed' && category.revealsAt !== null)
    .map((category) => category.revealsAt as string)
    .sort()[0];

  useShell(
    board?.program?.name ?? 'Cutline Jury Desk',
    soonest ?? null,
    soonest === undefined ? 'Results published' : null,
  );

  return (
    <div class="grid">
      <GridLines />
      <div class="span-12">
        <label for="program-picker">Program</label>
        <select
          id="program-picker"
          aria-label="Program"
          value={board?.program?.id ?? ''}
          onChange={(event) => setProgramId((event.target as HTMLSelectElement).value)}
        >
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.name}
            </option>
          ))}
        </select>
      </div>
      <div class="span-12">
        <div role="status" aria-label="Standings updates" aria-live="polite">
          {announcement}
        </div>
      </div>
      {(board?.categories ?? []).map((category) => (
          <CategorySection
            key={`${category.id}:${replayToken[category.id] ?? 0}`}
            category={category}
            reveal={(replayToken[category.id] ?? 0) > 0}
            onAnnounce={setAnnouncement}
            onReplay={() =>
              setReplayToken((current) => ({ ...current, [category.id]: (current[category.id] ?? 0) + 1 }))
            }
          />
      ))}
    </div>
  );
}
