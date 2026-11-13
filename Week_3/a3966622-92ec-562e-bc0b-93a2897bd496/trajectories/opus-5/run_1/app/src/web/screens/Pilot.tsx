import { useCallback, useEffect, useState } from 'react';
import { NoReply, send } from '../api.ts';
import { LADDER_REFUSED_HEADING, NO_REPLY, clearanceCell, marginFromMm } from '../format.ts';
import { useInterval, useKeyedControl, useViewportWidth } from '../hooks.ts';
import { useNavigation } from '../main.tsx';
import { KeelSection } from '../parts/KeelSection.tsx';
import { LadderReportDialog } from '../parts/LadderReportDialog.tsx';
import { Panel } from '../parts/Panel.tsx';
import { WaypointTable } from '../parts/WaypointTable.tsx';
import type { Move, Plan, PortReply, SessionUser } from '../types.ts';

export function PilotScreen({ user }: { user: SessionUser }): JSX.Element {
  const navigation = useNavigation();
  const [move, setMove] = useState<Move | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sectionPlan, setSectionPlan] = useState<Plan | null>(null);
  const [assignments, setAssignments] = useState<Move[]>([]);
  const [tideVersion, setTideVersion] = useState(1);
  const [announcement, setAnnouncement] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const control = useKeyedControl();
  const compact = useViewportWidth() < 768;

  const load = useCallback(async (): Promise<void> => {
    const [job, moves, port] = await Promise.all([
      send<{ move: Move | null; plan: Plan | null }>('GET', '/api/me/next-job').catch(() => null),
      send<{ moves: Move[] }>('GET', '/api/moves').catch(() => null),
      send<PortReply>('GET', '/api/port').catch(() => null),
    ]);
    if (job !== null && job.ok) {
      setMove(job.data.move);
      setPlan(job.data.plan);
    }
    if (moves !== null && moves.ok) setAssignments(moves.data.moves);
    if (port !== null && port.ok) setTideVersion(port.data.tide_version);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(() => {
    void load();
  }, 30_000);

  const statusAction = (to: 'Pilot away' | 'On board' | 'Completed'): void => {
    if (move === null || control.pending) return;
    const key = control.keyFor(JSON.stringify([move.ref, to]));
    control.setPending(true);
    setAnnouncement('Saving...');
    void (async () => {
      try {
        const reply = await send<Move>(
          'POST',
          `/api/moves/${encodeURIComponent(move.ref)}/transitions`,
          { body: { to }, key },
        );
        control.replyReceived();
        if (reply.ok) {
          setMove(reply.data);
          setAnnouncement(
            to === 'Completed'
              ? 'Move completed. Charges post when the billing provider confirms.'
              : `Status now ${reply.data.status}`,
          );
          await load();
          return;
        }
        setAnnouncement("This action is not available for the move's current status.");
      } catch (cause) {
        if (cause instanceof NoReply) setAnnouncement(NO_REPLY);
      } finally {
        control.setPending(false);
      }
    })();
  };

  const jobs = (
    <section className="pane" aria-label="Jobs">
      <h2>My assignments</h2>
      <div className="rows">
        {assignments.map((entry) => (
          <div key={entry.ref} className="row">
            <span className="ref">{entry.ref}</span>
            <span>{entry.vessel.name}</span>
            <span>{entry.detained ? 'On board - detained' : entry.status}</span>
            <a href={`/moves/${entry.ref}`}>{`Open ${entry.ref}`}</a>
          </div>
        ))}
        {assignments.length === 0 && <p className="dim">No assignments</p>}
      </div>
    </section>
  );

  return (
    <>
      <KeelSection
        move={move}
        canCommit={false}
        tideVersion={tideVersion}
        onCommitted={setMove}
        onPlan={setSectionPlan}
      />
      <div className="waypoint-strip">
        {compact ? (
          <>
            <button type="button" onClick={() => setSheetOpen(true)}>
              Waypoints
            </button>
            <button type="button" onClick={() => setJobsOpen(true)}>
              Jobs
            </button>
          </>
        ) : (
          <WaypointTable plan={sectionPlan ?? plan} />
        )}
      </div>
      <div className="panes">
        <section className="pane pane-moves" aria-label="Next job">
          <h2>Next job</h2>
          {move === null ? (
            <p className="dim">No job assigned</p>
          ) : (
            <>
              <h3>{`${move.ref} ${move.vessel.name}`}</h3>
              {move.status === 'Refused at ladder' && <h2>{LADDER_REFUSED_HEADING}</h2>}
              <div className="rows">
                <div className="row">
                  <span>{move.detained ? 'On board - detained' : move.status}</span>
                  <span className="mono">{`Boarding ${move.boarding_at.replace('T', ' ')} port time`}</span>
                  <span className="mono">{`Draught ${move.draught.metres} m / ${move.draught.feet}`}</span>
                </div>
                {(plan?.waypoints ?? []).map((waypoint) => (
                  <div key={waypoint.id} className="row">
                    <span>{waypoint.name}</span>
                    <span className="mono">{clearanceCell(waypoint.clearance_mm)}</span>
                    <span className={waypoint.margin_mm < 0 ? 'mono negative' : 'mono'}>
                      {`${marginFromMm(waypoint.margin_mm)} m`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="keel-controls">
                {move.status === 'Pilot assigned' && (
                  <button type="button" onClick={() => statusAction('Pilot away')}>
                    Confirm pilot away
                  </button>
                )}
                {move.status === 'Pilot away' && (
                  <button type="button" onClick={() => statusAction('On board')}>
                    Confirm boarding
                  </button>
                )}
                {move.status === 'On board' && (
                  <button type="button" onClick={() => statusAction('Completed')}>
                    Complete move
                  </button>
                )}
                {(move.status === 'Pilot away' || move.status === 'On board') && (
                  <button type="button" onClick={() => setReportOpen(true)}>
                    File ladder report
                  </button>
                )}
                <button type="button" onClick={() => navigation.navigate(`/moves/${move.ref}`)}>
                  {`Open ${move.ref}`}
                </button>
              </div>
              <div role="status" aria-label="Move announcements" className="announce">
                {announcement}
              </div>
            </>
          )}
        </section>
        {!compact && jobs}
      </div>
      {compact && (
        <Panel open={jobsOpen} label="Jobs" kind="drawer" onClose={() => setJobsOpen(false)}>
          <button type="button" onClick={() => setJobsOpen(false)}>
            Close jobs
          </button>
          {jobs}
        </Panel>
      )}
      {compact && (
        <Panel open={sheetOpen} label="Waypoints" kind="sheet" onClose={() => setSheetOpen(false)}>
          <button type="button" onClick={() => setSheetOpen(false)}>
            Close waypoints
          </button>
          <WaypointTable plan={sectionPlan ?? plan} />
        </Panel>
      )}
      {move !== null && (
        <LadderReportDialog
          move={move}
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          onFiled={() => {
            setReportOpen(false);
            void load();
          }}
        />
      )}
      <p className="dim">{`Signed in as ${user.name}`}</p>
    </>
  );
}
