// Leaderboards: filters in the URL, newest filters win, live pushes, one row per player.
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, type BoardRow } from './api';
import { useApp, usePush } from './appState';
import { navigate } from './ui';
import { fmtTime, fmtDelta, fmtSpeed, fmtScore, fmtCoins } from './formats';
import { carById } from '../../shared/domain';

const LAYOUTS = [
  { id: 'saltflat-ring', name: 'Saltflat Ring' },
  { id: 'quarry-switchbacks', name: 'Quarry Switchbacks' }
];
const MODES = [
  { id: 'time-trial', name: 'Time trial' },
  { id: 'circuit', name: 'Circuit' },
  { id: 'drift', name: 'Drift' }
];
const CLASSES = ['D', 'C', 'B'];

export function boardAddress(layoutId: string, mode: string, cls: string, units: 'kmh' | 'mph'): string {
  return `/boards?map=${layoutId}&mode=${mode}&class=${cls}&units=${units}`;
}

export function parseBoardAddress(search: string): { layoutId: string; mode: string; cls: string; units: 'kmh' | 'mph' } {
  const q = new URLSearchParams(search);
  const layoutId = q.get('map') ?? 'saltflat-ring';
  const mode = q.get('mode') ?? 'time-trial';
  const cls = q.get('class') ?? 'D';
  const units = q.get('units') === 'mph' ? 'mph' : 'kmh';
  return {
    layoutId: LAYOUTS.some(l => l.id === layoutId) ? layoutId : 'saltflat-ring',
    mode: MODES.some(m => m.id === mode) ? mode : 'time-trial',
    cls: CLASSES.includes(cls) ? cls : 'D',
    units
  };
}

export default function BoardsScreen(): JSX.Element {
  const { me } = useApp();
  const [filters, setFilters] = useState(parseBoardAddress(window.location.search));
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [mine, setMine] = useState<BoardRow | null>(null);
  const [loading, setLoading] = useState(true);
  const filtersRef = useRef(filters);
  const loadTokenRef = useRef(0);

  filtersRef.current = filters;

  // Each filter change pushes a new address; Back and Forward restore it.
  useEffect(() => {
    const onPop = (): void => setFilters(parseBoardAddress(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setFilter = (patch: Partial<typeof filters>): void => {
    const next = { ...filtersRef.current, ...patch };
    setFilters(next);
    window.history.pushState({}, '', boardAddress(next.layoutId, next.mode, next.cls, next.units));
  };

  // The newest filters win: only the response for the newest filters may render.
  useEffect(() => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setRows(null);
    const current = filtersRef.current;
    if (current.units !== filters.units) {
      // Units alone never refetch a board.
      setLoading(false);
      return;
    }
    void api.board(current.layoutId, current.mode, current.cls).then(board => {
      if (loadTokenRef.current !== token) return; // a stale response, discarded
      setRows(board.rows);
      setMine(board.mine);
      setLoading(false);
    }).catch(() => {
      if (loadTokenRef.current !== token) return;
      setRows([]);
      setLoading(false);
    });
  }, [filters.layoutId, filters.mode, filters.cls, filters.units]);

  // A board push applies only when it matches the filters on screen.
  usePush((msg) => {
    if (msg.type !== 'board' || !msg.layoutId || !msg.mode || !msg.class || !msg.row) return;
    const f = filtersRef.current;
    if (msg.layoutId !== f.layoutId || msg.mode !== f.mode || msg.class !== f.cls) return;
    const row = msg.row as BoardRow;
    setRows(prev => {
      if (prev === null) return prev; // still loading: applied as soon as it renders
      let next = prev.filter(r => r.playerId !== row.playerId);
      next.push({ ...row, mine: row.playerId === me?.playerId });
      if (f.mode === 'drift') next.sort((a, b) => b.value - a.value);
      else next.sort((a, b) => a.value - b.value);
      next = next.slice(0, 50).map((r, i) => ({
        ...r,
        rank: i + 1,
        gapMs: f.mode === 'drift' ? null : (i === 0 ? 0 : r.value - next[0].value)
      }));
      if (row.playerId === me?.playerId) setMine(next.find(r => r.playerId === me.playerId) ?? null);
      return next;
    });
  });

  const isDrift = filters.mode === 'drift';
  const wide = window.innerWidth >= 1024;

  const valueOf = (r: BoardRow): string => isDrift ? fmtScore(r.value) : fmtTime(r.value);

  return (
    <main className="page" style={{ paddingTop: 20 }}>
      <h1>Leaderboards</h1>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Map</span>
          <select aria-label="Map" value={filters.layoutId} onChange={e => setFilter({ layoutId: e.target.value })}>
            {LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Mode</span>
          <select aria-label="Mode" value={filters.mode} onChange={e => setFilter({ mode: e.target.value })}>
            {MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Class</span>
          <select aria-label="Class" value={filters.cls} onChange={e => setFilter({ cls: e.target.value })}>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <fieldset className="field" style={{ margin: 0, display: 'flex', gap: 10 }}>
          <legend className="visually-hidden">Units</legend>
          <span className="label" style={{ margin: 0 }}>Units</span>
          <label><input type="radio" name="b-units" checked={filters.units === 'kmh'}
            onChange={() => setFilter({ units: 'kmh' })} /> km/h</label>
          <label><input type="radio" name="b-units" checked={filters.units === 'mph'}
            onChange={() => setFilter({ units: 'mph' })} /> mph</label>
        </fieldset>
      </div>

      {loading && rows === null ? (
        <p style={{ marginTop: 24 }}>Loading times…</p>
      ) : rows !== null && rows.length === 0 ? (
        <p style={{ marginTop: 24 }}>No verified times on this board yet.</p>
      ) : rows !== null ? (
        <table className="table" aria-label="Leaderboard" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Driver</th>
              {wide && <th scope="col">Car</th>}
              <th scope="col" className="num">{isDrift ? 'Score' : 'Time'}</th>
              <th scope="col" className="num">Gap</th>
              {wide && <th scope="col" className="num">Top speed</th>}
              <th scope="col">Replay</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.playerId} className={r.mine ? 'me-row' : undefined}>
                <td className="mono">{r.rank}</td>
                <td>{r.mine ? 'You' : r.name}</td>
                {wide && <td>{carById(r.carId)?.name ?? r.carId}</td>}
                <td className="num">{valueOf(r)}</td>
                <td className="num">{r.gapMs === null || r.rank === 1 ? '' : fmtDelta(r.gapMs)}</td>
                {wide && <td className="num">{fmtSpeed(r.topSpeedMps, filters.units)} {filters.units === 'kmh' ? 'km/h' : 'mph'}</td>}
                <td>
                  {!isDrift && wide && (
                    <button className="btn btn-quiet" style={{ minHeight: 32, minWidth: 44, padding: '4px 10px' }}
                            onClick={() => navigate(`/race?layout=${filters.layoutId}&mode=time-trial&ghost=${r.runId}`, '[data-focus="race-hud"]')}>
                      Race this ghost
                    </button>
                  )}{' '}
                  <a href={`/v1/runs/${r.runId}/replay`}>Download replay</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <section aria-label="Your time" style={{ marginTop: 16 }}>
        {mine && (
          <p>
            Your time: <span className="mono">{mine.rank}. {valueOf(mine)}</span>
          </p>
        )}
      </section>
    </main>
  );
}
