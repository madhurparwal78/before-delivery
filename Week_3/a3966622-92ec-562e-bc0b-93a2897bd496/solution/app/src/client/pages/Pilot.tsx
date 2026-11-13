// The harbour pilot's screen: the next job with its clearances and the Keel Section, status actions
// and the ladder report, built for a phone on deck.
import { useCallback, useEffect, useState } from "react";
import { signedMetres } from "../../shared/numerals";
import type { Move, Plan } from "../../shared/types";
import { get } from "../api";
import { usePort } from "../port";
import { navigate } from "../router";
import { KeelSection } from "../section/KeelSection";
import { usePlanner } from "../section/planner";
import { WaypointTable } from "../section/WaypointTable";
import { useUser } from "../session";
import { Shell } from "../ui/Chrome";
import { dateTimeOf, statusText } from "../ui/format";
import { LiveRegion, useLive } from "../ui/live";
import { MoveActions } from "../ui/MoveActions";
import { Panel } from "../ui/Panel";
import { LadderReportDialog } from "./LadderReportDialog";

const REREAD_MS = 30_000;

function Assignments({ jobs }: { jobs: Move[] | null }) {
  return (
    <section className="pane" aria-label="Current assignments">
      <h2>Current assignments</h2>
      {jobs === null ? (
        <p className="muted">Loading assignments…</p>
      ) : jobs.length === 0 ? (
        <p className="muted">No current assignments</p>
      ) : (
        <ul className="rows">
          {jobs.map((m) => (
            <li key={m.ref} className="row">
              <a href={`/moves/${encodeURIComponent(m.ref)}`} onClick={(e) => { e.preventDefault(); navigate(`/moves/${encodeURIComponent(m.ref)}`); }} className="ref">
                {m.ref}
              </a>
              <span>{m.vessel.name}</span>
              <span className="num row-meta">{dateTimeOf(m.boarding_at)}</span>
              <span className="status-chip" data-status={m.status}>
                {statusText(m)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PilotScreen() {
  const user = useUser();
  const port = usePort();
  const [job, setJob] = useState<{ move: Move | null; plan: Plan | null } | null>(null);
  const [jobs, setJobs] = useState<Move[] | null>(null);
  const [beat, setBeat] = useState(0);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);
  const [report, setReport] = useState<{ move: Move; open: boolean; seq: number } | null>(null);
  const sectionAnnouncements = useLive();
  const moveAnnouncements = useLive();
  const move = job?.move ?? null;
  const planner = usePlanner(move, sectionAnnouncements, (fresh) => setJob((j) => (j ? { ...j, move: fresh } : j)));

  const reread = useCallback(async () => {
    const [next, listed] = await Promise.all([get<{ move: Move | null; plan: Plan | null }>("/api/me/next-job"), get<{ moves: Move[] }>("/api/moves")]);
    if (next.kind === "ok") setJob(next.data);
    if (listed.kind === "ok") setJobs(listed.data.moves.filter((m) => m.pilot?.id === user.id && m.actions.length > 0));
    setBeat((b) => b + 1);
  }, [user.id]);

  useEffect(() => {
    void reread();
  }, [reread]);
  useEffect(() => {
    const timer = window.setTimeout(() => void reread(), REREAD_MS);
    return () => window.clearTimeout(timer);
  }, [beat, reread]);

  const plan = job?.plan ?? null;
  const pinch = plan?.waypoints.find((w) => w.id === plan.pinch.waypoint_id);

  return (
    <Shell wide>
      <div className="board">
        <KeelSection planner={planner} port={port} canCommit={false} />
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
        <div className="panes panes-two">
          <section className="pane" aria-label="Next job">
            <h2>Next job</h2>
            {job === null ? (
              <p className="muted">Loading your next job…</p>
            ) : move === null ? (
              <p className="muted">No job assigned to you right now</p>
            ) : (
              <>
                <p className="job-title">
                  <a href={`/moves/${encodeURIComponent(move.ref)}`} onClick={(e) => { e.preventDefault(); navigate(`/moves/${encodeURIComponent(move.ref)}`); }} className="ref">
                    {move.ref}
                  </a>{" "}
                  {move.vessel.name}
                </p>
                <dl className="facts">
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className="status-chip" data-status={move.status}>
                        {statusText(move)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Boarding</dt>
                    <dd>
                      <span className="num">{dateTimeOf(move.committed?.boarding_at ?? move.boarding_at)}</span> port time
                    </dd>
                  </div>
                  <div>
                    <dt>Draught</dt>
                    <dd>
                      <span className="num">{move.draught.metres} m</span> / <span className="num">{move.draught.feet}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Pinch</dt>
                    <dd className={plan && plan.pinch.margin_mm < 0 ? "num short" : "num"}>
                      {pinch && plan ? `${pinch.name} ${signedMetres(plan.pinch.margin_mm)} m` : "—"}
                    </dd>
                  </div>
                </dl>
                <MoveActions move={move} announcements={moveAnnouncements} onReply={() => void reread()} onNoReply={() => setBeat((b) => b + 1)} />
                {move.actions.includes("ladder_report") ? (
                  <div className="actions">
                    <button type="button" className="ghost" onClick={() => setReport((r) => ({ move, open: true, seq: (r?.seq ?? 0) + 1 }))}>
                      File ladder report
                    </button>
                  </div>
                ) : null}
              </>
            )}
            <LiveRegion name="Move announcements" live={moveAnnouncements} />
          </section>
          <div className="wide-only">
            <Assignments jobs={jobs} />
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
          <Assignments jobs={jobs} />
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
      {report ? (
        <LadderReportDialog
          key={report.seq}
          move={report.move}
          open={report.open}
          onClose={() => setReport((r) => (r ? { ...r, open: false } : r))}
          onFiled={() => void reread()}
        />
      ) : null}
    </Shell>
  );
}
