import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CARS,
  LAYOUTS,
  LAYOUT_IDS,
  type BoardMode,
  type CarClass,
  type LayoutId,
} from '../../shared/catalogue.js';
import {
  formatDelta,
  formatRaceTime,
  formatSpeed,
  formatThousands,
  type Units,
} from '../../shared/format.js';
import { apiGet } from '../api.js';
import { Page } from '../components/Page.js';
import { copy } from '../copy.js';
import { useInlineNav, useReducedMotion, useWideEnoughToRace } from '../hooks.js';
import { raceAddress } from '../race-address.js';
import { navigate, useLocation } from '../router.js';
import { usePush } from '../store.js';
import type { BoardBody, BoardRow } from '../types.js';

const MODES: { value: BoardMode; label: string }[] = [
  { value: 'time-trial', label: 'Time trial' },
  { value: 'circuit', label: 'Circuit' },
  { value: 'drift', label: 'Drift' },
];
const CLASSES: CarClass[] = ['D', 'C', 'B'];

interface Filters {
  layoutId: LayoutId;
  mode: BoardMode;
  className: CarClass;
  units: Units;
}

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const layoutId = params.get('map');
  const mode = params.get('mode');
  const className = params.get('class');
  const units = params.get('units');
  return {
    layoutId: layoutId === 'quarry-switchbacks' ? 'quarry-switchbacks' : 'saltflat-ring',
    mode: mode === 'circuit' || mode === 'drift' ? mode : 'time-trial',
    className: className === 'C' || className === 'B' ? className : 'D',
    units: units === 'mph' ? 'mph' : 'kmh',
  };
}

function filterAddress(filters: Filters): string {
  return `/boards?map=${filters.layoutId}&mode=${filters.mode}&class=${filters.className}&units=${filters.units}`;
}

function carName(carId: string): string {
  return CARS.find((car) => car.carId === carId)?.name ?? carId;
}

function rowValue(row: BoardRow): string {
  return row.unit === 'points' ? `${formatThousands(row.value)} pts` : formatRaceTime(row.value);
}

/** Recomputes every rank and gap in board order. */
function renumber(rows: BoardRow[], mode: BoardMode): BoardRow[] {
  const sorted = [...rows].sort((a, b) =>
    mode === 'drift' ? b.value - a.value : a.value - b.value,
  );
  const first = sorted[0];
  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    gapMs: mode === 'drift' || index === 0 || first === undefined ? null : row.value - first.value,
  }));
}

export function Boards() {
  const location = useLocation();
  const filters = readFilters(location.search);
  const reduced = useReducedMotion();
  const wideEnough = useWideEnoughToRace();
  const inline = useInlineNav();
  const [board, setBoard] = useState<BoardBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [arrived, setArrived] = useState<string | null>(null);
  const requestToken = useRef('');
  const pendingPushes = useRef<BoardRow[]>([]);

  const key = `${filters.layoutId}|${filters.mode}|${filters.className}`;

  // Only the board for the newest filters may render.
  useEffect(() => {
    const token = `${key}|${Date.now()}|${Math.random()}`;
    requestToken.current = token;
    pendingPushes.current = [];
    setBoard(null);
    setLoading(true);
    void apiGet<BoardBody>(
      `/v1/boards?layoutId=${filters.layoutId}&mode=${filters.mode}&class=${filters.className}`,
    ).then((result) => {
      if (requestToken.current !== token) return;
      if (result.kind !== 'ok') {
        setLoading(false);
        return;
      }
      const rows = renumber(
        [...result.data.rows, ...pendingPushes.current].reduce<BoardRow[]>((all, row) => {
          const without = all.filter((entry) => entry.playerId !== row.playerId);
          return [...without, row];
        }, []),
        filters.mode,
      );
      pendingPushes.current = [];
      setBoard({ ...result.data, rows, mine: rows.find((row) => row.mine) ?? null });
      setLoading(false);
    });
  }, [key, filters.layoutId, filters.mode, filters.className]);

  usePush(
    useCallback(
      (push) => {
        if (push.type !== 'board') return;
        if (`${push.layoutId}|${push.mode}|${push.class}` !== key) return;
        if (requestToken.current === '' || loading) {
          pendingPushes.current.push(push.row);
          return;
        }
        setBoard((current) => {
          if (current === null) return current;
          const without = current.rows.filter((row) => row.playerId !== push.row.playerId);
          const rows = renumber([...without, push.row], current.mode).slice(0, 50);
          return { ...current, rows, mine: rows.find((row) => row.mine) ?? null };
        });
        setArrived(push.row.playerId);
      },
      [key, loading],
    ),
  );

  const update = (next: Partial<Filters>) => {
    navigate(filterAddress({ ...filters, ...next }));
  };

  return (
    <Page gutter={['Filters', 'Times']}>
      <h1>Leaderboards</h1>
      <div className="filters cell">
        <label className="filter-field">
          <span className="label">Map</span>
          <select
            aria-label="Map"
            value={filters.layoutId}
            onChange={(event) => update({ layoutId: event.target.value as LayoutId })}
          >
            {LAYOUT_IDS.map((layoutId) => (
              <option key={layoutId} value={layoutId}>
                {LAYOUTS[layoutId].name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="label">Mode</span>
          <select
            aria-label="Mode"
            value={filters.mode}
            onChange={(event) => update({ mode: event.target.value as BoardMode })}
          >
            {MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field">
          <span className="label">Class</span>
          <select
            aria-label="Class"
            value={filters.className}
            onChange={(event) => update({ className: event.target.value as CarClass })}
          >
            {CLASSES.map((className) => (
              <option key={className} value={className}>
                {className}
              </option>
            ))}
          </select>
        </label>
        <fieldset role="radiogroup" aria-label="Units" className="row">
          <legend className="label">Units</legend>
          {(['kmh', 'mph'] as Units[]).map((unit) => (
            <label className="choice" key={unit}>
              <input
                type="radio"
                name="board-units"
                aria-label={unit === 'kmh' ? 'km/h' : 'mph'}
                checked={filters.units === unit}
                onChange={() => update({ units: unit })}
              />
              {unit === 'kmh' ? 'km/h' : 'mph'}
            </label>
          ))}
        </fieldset>
      </div>

      {loading ? (
        <p className="cell">{copy.boardLoading}</p>
      ) : board === null || board.rows.length === 0 ? (
        <p className="cell">{copy.boardEmpty}</p>
      ) : (
        <table aria-label="Leaderboard">
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th>Driver</th>
              {inline && <th>Car</th>}
              <th className="num">{filters.mode === 'drift' ? 'Score' : 'Time'}</th>
              <th className="num">Gap</th>
              {inline && <th className="num">Top speed</th>}
              <th>Replay</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr
                key={row.playerId}
                className={!reduced && arrived === row.playerId ? 'board-row-new' : undefined}
              >
                <td className="num">{row.rank}</td>
                <td>{row.mine ? 'You' : row.name}</td>
                {inline && <td>{carName(row.carId)}</td>}
                <td className="num">{rowValue(row)}</td>
                <td className="num">{row.gapMs === null ? '' : formatDelta(row.gapMs)}</td>
                {inline && (
                  <td className="num">{formatSpeed(row.topSpeedMps, filters.units)}</td>
                )}
                <td>
                  {filters.mode === 'time-trial' && wideEnough && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        navigate(
                          raceAddress({
                            layoutId: filters.layoutId,
                            mode: 'time-trial',
                            ghostRunId: row.runId,
                          }),
                        )
                      }
                    >
                      Race this ghost
                    </button>
                  )}{' '}
                  <a href={`/v1/runs/${row.runId}/replay`}>Download replay</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="cell your-time" role="region" aria-label="Your time">
        {board?.mine
          ? `Rank ${board.mine.rank} · ${rowValue(board.mine)}`
          : ''}
      </div>
    </Page>
  );
}
