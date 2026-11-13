// The duty dispatcher's board: the Keel Section pinned above Order queue, Moves and Pilot turn list.
import { useCallback, useEffect, useRef, useState } from "react";
import { signedMetres } from "../../shared/numerals";
import { instantOfLocal, minuteOfDay, portStamp } from "../../shared/portTime";
import type { Move, Pilot } from "../../shared/types";
import { get } from "../api";
import { serverNow } from "../clock";
import { usePort } from "../port";
import { navigate, replaceQuery, useLocation } from "../router";
import { KeelSection } from "../section/KeelSection";
import { usePlanner } from "../section/planner";
import { WaypointTable } from "../section/WaypointTable";
import { Shell } from "../ui/Chrome";
import { clockOf, shortStamp, statusText } from "../ui/format";
import { LiveRegion, useLive } from "../ui/live";
import { anyPanelOpen, Panel } from "../ui/Panel";
import { AssignPanel, type AssignTarget } from "./AssignPanel";

const REFRESH_MS = 10_000;
const SEARCH_PAUSE_MS = 250;

const queueInstant = (move: Move): number => {
  const [date, time] = move.boarding_at.split("T") as [string, string];
  return instantOfLocal(date, minuteOfDay(time) ?? 0) ?? 0;
};
const refNumber = (ref: string): number => Number(ref.replace(/\D/g, ""));

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);

function QueueList({ queue, loadedRef, onPlan }: { queue: Move[] | null; loadedRef: string | null; onPlan: (move: Move) => void }) {
  return (
    <section className="pane" aria-label="Order queue">
      <h2>Order queue</h2>
      {queue === null ? (
        <p className="muted">Loading orders…</p>
      ) : queue.length === 0 ? (
        <p className="muted">No queued orders</p>
      ) : (
        <ul className="rows">
          {queue.map((m) => (
            <li key={m.ref} className={m.ref === loadedRef ? "row loaded" : "row"} aria-current={m.ref === loadedRef || undefined}>
              <button type="button" className="row-main" onClick={() => onPlan(m)}>
                <span className="sr-only">Plan </span>
                <span className="ref">{m.ref}</span> {m.vessel.name}
              </button>
              <span className="num row-meta">{shortStamp(m.boarding_at)}</span>
              <span className="num row-meta">{m.draught.metres} m</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TurnList({ pilots }: { pilots: Pilot[] | null }) {
  return (
    <section className="pane" aria-label="Pilot turn list" tabIndex={0}>
      <h2>Pilot turn list</h2>
      {pilots === null ? (
        <p className="muted">Loading pilots…</p>
      ) : (
        <ol className="rows">
          {pilots.map((p) => (
            <li key={p.id} className="row turn-row">
              <span className="num pos">{p.position}</span>
              <span className="pilot-name">{p.name}</span>
              <span className="pilot-class">Class {p.licence_class}</span>
              <span className={p.on_duty || p.rest_until ? "rest resting" : "rest"}>
                {p.on_duty ? "On duty" : p.rest_until ? <>Rest until <span className="num">{clockOf(p.rest_until)}</span></> : "Rested"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Board() {
  const { query } = useLocation();
  const port = usePort();
  const [loaded, setLoaded] = useState<Move | null>(null);
  const [queue, setQueue] = useState<Move[] | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [pilots, setPilots] = useState<Pilot[] | null>(null);
  const [search, setSearch] = useState(query.get("q") ?? "");
  const [refresh, setRefresh] = useState<{ ok: boolean; at: number } | null>(null);
  const [tableOpen, setTableOpen] = useState(true);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const sectionAnnouncements = useLive();
  const boardAnnouncements = useLive();
  const planner = usePlanner(loaded, sectionAnnouncements, setLoaded);
  const searchText = useRef(search);
  searchText.current = search;
  const searchSeq = useRef(0);
  const lastGood = useRef<number | null>(null);

  const load = useCallback((move: Move) => {
    setLoaded(move);
    replaceQuery({ move: move.ref });
  }, []);

  /** Re-reads moves, queue and turn list; never touches focus, panels, selection, typed text or the address. */
  const reread = useCallback(async () => {
    const q = searchText.current.trim();
    const [queued, listed, turn] = await Promise.all([
      get<{ moves: Move[] }>("/api/moves?status=Ordered"),
      get<{ moves: Move[] }>(`/api/moves${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      get<{ pilots: Pilot[] }>("/api/pilots"),
    ]);
    const at = serverNow() ?? 0;
    if (queued.kind === "ok") setQueue(queued.data.moves);
    if (listed.kind === "ok" && searchText.current.trim() === q) setMoves(listed.data.moves);
    if (turn.kind === "ok") setPilots(turn.data.pilots);
    const ok = queued.kind === "ok" && listed.kind === "ok" && turn.kind === "ok";
    if (ok) lastGood.current = at;
    setRefresh({ ok, at: ok ? at : (lastGood.current ?? at) });
    return { queue: queued.kind === "ok" ? queued.data.moves : [], listed: listed.kind === "ok" ? listed.data.moves : null };
  }, []);

  // First read: the board link's move, else the first queued order; an unknown ref falls back silently.
  const wantedMove = useRef(query.get("move"));
  const say = boardAnnouncements.say;
  useEffect(() => {
    const wanted = wantedMove.current;
    void (async () => {
      const first = await reread();
      if (searchText.current.trim() && first.listed) say(`${first.listed.length} moves shown`);
      if (wanted) {
        const found = await get<Move>(`/api/moves/${encodeURIComponent(wanted)}`);
        if (found.kind === "ok") {
          setLoaded(found.data);
          return;
        }
        replaceQuery({ move: null });
      }
      const head = first.queue[0];
      if (head) setLoaded(head);
    })();
    const timer = setInterval(() => void reread(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [reread, say]);

  const onSearch = (text: string): void => {
    setSearch(text);
    replaceQuery({ q: text.trim() ? text : null });
    const seq = ++searchSeq.current;
    window.setTimeout(async () => {
      if (seq !== searchSeq.current) return;
      const q = text.trim();
      const outcome = await get<{ moves: Move[] }>(`/api/moves${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (seq !== searchSeq.current || outcome.kind !== "ok") return;
      setMoves(outcome.data.moves);
      boardAnnouncements.say(`${outcome.data.moves.length} moves shown`);
    }, SEARCH_PAUSE_MS);
  };

  // Board shortcuts: n, k and a, whichever board control has focus, except while typing.
  const latest = useRef({ queue, loaded });
  latest.current = { queue, loaded };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || anyPanelOpen()) return;
      const { queue: q, loaded: current } = latest.current;
      if (event.key === "n" && q?.length) {
        const after = current
          ? q.find((m) => queueInstant(m) > queueInstant(current) || (queueInstant(m) === queueInstant(current) && refNumber(m.ref) > refNumber(current.ref)))
          : undefined;
        const next = after ?? q[0];
        if (next) load(next);
      } else if (event.key === "k") {
        document.querySelector<HTMLElement>('[role="slider"]')?.focus();
      } else if (event.key === "a" && current) {
        setAssigning({ ref: current.ref, version: current.version, vessel: current.vessel.name });
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [load]);

  // The clock reading is a numeral with a unit, so it sits in the monospaced face (.num); the words stay in the body face.
  const refreshText = refresh ? (
    refresh.ok ? (
      <>
        Board refreshed <span className="num">{portStamp(refresh.at).slice(11)} port time</span>
      </>
    ) : (
      <>
        Board refresh failed - showing data from <span className="num">{portStamp(refresh.at).slice(11)}</span>
      </>
    )
  ) : (
    ""
  );

  return (
    <Shell wide>
      <div className="board">
        <KeelSection planner={planner} port={port} canCommit />
        <div className="toolbar">
          <button type="button" className="ghost wide-only" aria-expanded={tableOpen} aria-controls="waypoint-strip" onClick={() => setTableOpen((o) => !o)}>
            Waypoint table
          </button>
          <button type="button" className="ghost narrow-only" onClick={() => setJobsOpen(true)}>
            Jobs
          </button>
          <button type="button" className="ghost narrow-only" onClick={() => setSheetOpen(true)}>
            Waypoints
          </button>
          <LiveRegion name="Section announcements" live={sectionAnnouncements} className="sr-only" />
        </div>
        <div id="waypoint-strip" className="waypoint-strip wide-only" hidden={!tableOpen} tabIndex={0} role="region" aria-label="Waypoint strip">
          <WaypointTable plan={planner.painted} rows={port?.waypoints.length ?? 1} />
        </div>
        <div className="panes">
          <div className="pane-queue wide-only">
            <QueueList queue={queue} loadedRef={loaded?.ref ?? null} onPlan={load} />
          </div>
          <section className="pane pane-moves" aria-label="Moves">
            <div className="pane-head">
              <h2>Moves</h2>
              <p className="refresh muted">{refreshText}</p>
            </div>
            <label className="search">
              <span className="sr-only">Search moves</span>
              <input type="search" placeholder="Search by reference, vessel or status" value={search} onChange={(e) => onSearch(e.target.value)} aria-label="Search moves" />
            </label>
            {moves === null ? (
              <p className="muted">Loading moves…</p>
            ) : moves.length === 0 ? (
              <p className="muted">No moves match</p>
            ) : (
              <ul className="rows">
                {moves.map((m) => (
                  <li key={m.ref} className={m.ref === loaded?.ref ? "row move-row loaded" : "row move-row"}>
                    <button type="button" className="row-main" onClick={() => navigate(`/moves/${encodeURIComponent(m.ref)}`)}>
                      <span className="sr-only">Open </span>
                      <span className="ref">{m.ref}</span>
                    </button>
                    <span className="row-vessel">{m.vessel.name}</span>
                    <span className="status-chip" data-status={m.status}>
                      {statusText(m)}
                    </span>
                    <span className="num row-meta">
                      {shortStamp(m.committed?.boarding_at ?? m.boarding_at)}
                    </span>
                    <span className={m.committed && m.committed.margin_mm < 0 ? "num row-meta short" : "num row-meta"}>
                      {m.committed ? `${signedMetres(m.committed.margin_mm)} m${m.committed.margin_mm < 0 ? " short" : ""}` : "not committed"}
                    </span>
                    {m.actions.includes("assign") ? (
                      <button type="button" className="ghost small" onClick={() => setAssigning({ ref: m.ref, version: m.version, vessel: m.vessel.name })}>
                        Assign<span className="sr-only"> pilot to {m.ref}</span>
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <LiveRegion name="Board announcements" live={boardAnnouncements} />
          </section>
          <div className="pane-turn wide-only">
            <TurnList pilots={pilots} />
          </div>
        </div>
      </div>
      <Panel open={jobsOpen} label="Jobs" variant="drawer" onClose={() => setJobsOpen(false)}>
        <header className="panel-head">
          <h2>Jobs</h2>
          <button type="button" className="ghost" onClick={() => setJobsOpen(false)}>
            Close jobs
          </button>
        </header>
        <div className="panel-body">
          <QueueList
            queue={queue}
            loadedRef={loaded?.ref ?? null}
            onPlan={(m) => {
              load(m);
              setJobsOpen(false);
            }}
          />
          <TurnList pilots={pilots} />
        </div>
      </Panel>
      <Panel open={sheetOpen} label="Waypoints" variant="sheet" onClose={() => setSheetOpen(false)}>
        <header className="panel-head">
          <h2>Waypoints</h2>
          <button type="button" className="ghost" onClick={() => setSheetOpen(false)}>
            Close waypoints
          </button>
        </header>
        <div className="panel-body table-scroll" tabIndex={0}>
          <WaypointTable plan={planner.painted} rows={port?.waypoints.length ?? 1} />
        </div>
      </Panel>
      <AssignPanel
        target={assigning}
        announcements={boardAnnouncements}
        onClose={() => setAssigning(null)}
        onAssigned={(move) => {
          setAssigning(null);
          if (move.ref === loaded?.ref) setLoaded(move);
          void reread();
        }}
        onStale={() => void reread()}
      />
    </Shell>
  );
}

