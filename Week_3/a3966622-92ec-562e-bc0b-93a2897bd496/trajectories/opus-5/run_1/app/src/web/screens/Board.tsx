import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { send } from '../api.ts';
import { marginFromMm } from '../format.ts';
import { useInterval, useViewportWidth } from '../hooks.ts';
import { useNavigation } from '../main.tsx';
import { KeelSection } from '../parts/KeelSection.tsx';
import { AssignPanel } from '../parts/AssignPanel.tsx';
import { Panel } from '../parts/Panel.tsx';
import { WaypointTable } from '../parts/WaypointTable.tsx';
import type { Move, PilotRow, Plan, PortReply, SessionUser } from '../types.ts';

function boardingOf(move: Move): string {
  return move.committed?.boarding_at ?? move.boarding_at;
}

export function BoardScreen({ user }: { user: SessionUser }): JSX.Element {
  const navigation = useNavigation();
  const [moves, setMoves] = useState<Move[]>([]);
  const [pilots, setPilots] = useState<PilotRow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [query, setQuery] = useState(() => navigation.search.get('q') ?? '');
  const [loadedRef, setLoadedRef] = useState<string | null>(() => navigation.search.get('move'));
  const [refreshedAt, setRefreshedAt] = useState('');
  const [refreshFailedAt, setRefreshFailedAt] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [tideVersion, setTideVersion] = useState(1);
  const [stripOpen, setStripOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const width = useViewportWidth();
  const compact = width < 768;
  const announcedQuery = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    const [movesReply, pilotsReply, portReply] = await Promise.all([
      send<{ moves: Move[] }>('GET', '/api/moves').catch(() => null),
      send<{ pilots: PilotRow[] }>('GET', '/api/pilots').catch(() => null),
      send<PortReply>('GET', '/api/port').catch(() => null),
    ]);
    if (movesReply !== null && movesReply.ok) {
      setMoves(movesReply.data.moves);
      setRefreshedAt(
        (portReply !== null && portReply.ok ? portReply.data.now : '').slice(11, 19),
      );
      setRefreshFailedAt(null);
    } else {
      setRefreshFailedAt(refreshedAt);
    }
    if (pilotsReply !== null && pilotsReply.ok) setPilots(pilotsReply.data.pilots);
    if (portReply !== null && portReply.ok) setTideVersion(portReply.data.tide_version);
  }, [refreshedAt]);

  useEffect(() => {
    void refresh();
  }, []);

  useInterval(() => {
    void refresh();
  }, 10_000);

  /** The server lists moves in rising boarding instant with ties by ref, which is the queue order. */
  const queue = useMemo(() => moves.filter((move) => move.status === 'Ordered'), [moves]);

  const loaded = useMemo(() => {
    const chosen = moves.find((move) => move.ref === loadedRef);
    if (chosen !== undefined) return chosen;
    return queue[0] ?? null;
  }, [moves, loadedRef, queue]);

  /** An unknown ref loads the default first queued order and leaves no move in the address. */
  useEffect(() => {
    if (moves.length === 0) return;
    const wanted = navigation.search.get('move');
    if (wanted !== null && !moves.some((move) => move.ref === wanted)) {
      setLoadedRef(null);
      writeAddress(null, query);
      return;
    }
    if (loadedRef === null) {
      const first = queue[0];
      if (first !== undefined) setLoadedRef(first.ref);
    }
  }, [moves]);

  const writeAddress = useCallback(
    (ref: string | null, text: string) => {
      const params = new URLSearchParams();
      if (ref !== null) params.set('move', ref);
      if (text !== '') params.set('q', text);
      const search = params.toString();
      navigation.replace(`/board${search === '' ? '' : `?${search}`}`);
    },
    [navigation],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return moves;
    return moves.filter((move) =>
      `${move.ref} ${move.vessel.name} ${move.status}`.toLowerCase().includes(needle),
    );
  }, [moves, query]);

  useEffect(() => {
    if (announcedQuery.current || query === '' || moves.length === 0) return;
    announcedQuery.current = true;
    setAnnouncement(`${filtered.length} moves shown`);
  }, [filtered.length, moves.length, query]);

  const loadMove = useCallback(
    (ref: string) => {
      setLoadedRef(ref);
      writeAddress(ref, query);
    },
    [query, writeAddress],
  );

  const onMoveUpdated = useCallback((updated: Move) => {
    setMoves((current) =>
      current.some((move) => move.ref === updated.ref)
        ? current.map((move) => (move.ref === updated.ref ? updated : move))
        : [...current, updated],
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'n') {
        const sortsAfter = (move: Move): boolean =>
          loaded === null ||
          `${boardingOf(move)}${move.ref}` > `${boardingOf(loaded)}${loaded.ref}`;
        const next = queue.find(sortsAfter) ?? queue[0];
        if (next !== undefined) loadMove(next.ref);
      } else if (event.key === 'k') {
        handleRef.current?.focus();
      } else if (event.key === 'a') {
        if (loaded !== null) setAssignOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queue, loaded, loadMove]);

  const queuePane = (
    <section className="pane pane-queue" aria-label="Order queue">
      <h2>Order queue</h2>
      <div className="rows">
        {queue.map((move) => (
          <button
            key={move.ref}
            type="button"
            className="touch-row"
            onClick={() => loadMove(move.ref)}
          >
            {`Plan ${move.ref} ${move.vessel.name}`}
          </button>
        ))}
        {queue.length === 0 && <p className="dim">No queued orders</p>}
      </div>
    </section>
  );

  const turnPane = (
    <section className="pane pane-turn" aria-label="Pilot turn list">
      <h2>Pilot turn list</h2>
      <div className="rows">
        {pilots.map((pilot) => (
          <div key={pilot.id} className="row">
            <span className="mono">{pilot.position}</span>
            <span>{pilot.name}</span>
            <span className="mono">{`class ${pilot.licence_class}`}</span>
            <span className="dim">
              {pilot.on_duty
                ? 'on duty'
                : pilot.rest_until === null
                  ? 'rested'
                  : `rested from ${pilot.rest_until.slice(11, 16)}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <>
      <KeelSection
        move={loaded}
        canCommit={user.role === 'dispatcher'}
        tideVersion={tideVersion}
        onCommitted={onMoveUpdated}
        onPlan={setPlan}
        handleRef={handleRef}
      />
      {!compact && (
        <div className="waypoint-strip">
          <button
            type="button"
            aria-expanded={stripOpen}
            onClick={() => setStripOpen((open) => !open)}
          >
            Waypoint table
          </button>
          {stripOpen && <WaypointTable plan={plan} />}
        </div>
      )}
      {compact && (
        <div className="waypoint-strip">
          <button type="button" onClick={() => setSheetOpen(true)}>
            Waypoints
          </button>
          <button type="button" onClick={() => setJobsOpen(true)}>
            Jobs
          </button>
        </div>
      )}
      <div className="panes">
        {!compact && queuePane}
        <section className="pane pane-moves" aria-label="Moves">
          <h2>Moves</h2>
          <label>
            Search moves
            <input
              type="search"
              aria-label="Search moves"
              value={query}
              onChange={(event) => {
                const text = event.target.value;
                setQuery(text);
                writeAddress(loadedRef, text);
                const needle = text.trim().toLowerCase();
                const count =
                  needle === ''
                    ? moves.length
                    : moves.filter((move) =>
                        `${move.ref} ${move.vessel.name} ${move.status}`
                          .toLowerCase()
                          .includes(needle),
                      ).length;
                setAnnouncement(`${count} moves shown`);
              }}
            />
          </label>
          <div className="rows">
            {filtered.map((move) => (
              <div key={move.ref} className="row">
                <span className="ref">{move.ref}</span>
                <span>{move.vessel.name}</span>
                <span>{move.detained ? 'On board - detained' : move.status}</span>
                <span className="mono">{boardingOf(move).replace('T', ' ')}</span>
                <span className={(move.committed?.margin_mm ?? 0) < 0 ? 'mono negative' : 'mono'}>
                  {move.committed === null
                    ? 'no committed window'
                    : `${move.committed.pinch_waypoint} ${marginFromMm(move.committed.margin_mm)} m`}
                </span>
                <button type="button" onClick={() => navigation.navigate(`/moves/${move.ref}`)}>
                  {`Open ${move.ref}`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadMove(move.ref);
                    setAssignOpen(true);
                  }}
                >
                  {`Assign pilot to ${move.ref}`}
                </button>
              </div>
            ))}
          </div>
          <p className="dim mono">
            {refreshFailedAt === null
              ? `Board refreshed ${refreshedAt} port time`
              : `Board refresh failed - showing data from ${refreshFailedAt}`}
          </p>
        </section>
        {!compact && turnPane}
      </div>
      <div role="status" aria-label="Board announcements" className="announce">
        {announcement}
      </div>
      {compact && (
        <Panel open={jobsOpen} label="Jobs" kind="drawer" onClose={() => setJobsOpen(false)}>
          <button type="button" onClick={() => setJobsOpen(false)}>
            Close jobs
          </button>
          {queuePane}
          {turnPane}
        </Panel>
      )}
      {compact && (
        <Panel open={sheetOpen} label="Waypoints" kind="sheet" onClose={() => setSheetOpen(false)}>
          <button type="button" onClick={() => setSheetOpen(false)}>
            Close waypoints
          </button>
          <WaypointTable plan={plan} />
        </Panel>
      )}
      {loaded !== null && (
        <AssignPanel
          move={loaded}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          onAssigned={onMoveUpdated}
          announce={setAnnouncement}
        />
      )}
    </>
  );
}
