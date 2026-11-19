import { useEffect, useState } from 'react';
import type { AttendanceRow, AttendanceStatus, SummaryBody } from '../../shared/wire';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { Alert, NotFound, Skeleton } from '../ui/feedback';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  late_left_early: 'Late, left early',
  absent: 'Absent',
};

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'refused'; message: string } | { state: 'ready'; summary: SummaryBody; rows: AttendanceRow[] };

/** `2027-03-02T19:05:01` shows as `19:05:01`; an absent learner shows a dash. */
const clock = (wall: string | null): string => (wall === null ? '-' : wall.slice(11, 19));

export function SummaryPage({ sessionId }: { sessionId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    let current = true;
    const show = (next: Loaded) => {
      if (current) setLoaded(next);
    };
    Promise.all([api<SummaryBody>('GET', `/api/sessions/${sessionId}/summary`), api<{ rows: AttendanceRow[] }>('GET', `/api/sessions/${sessionId}/attendance`)]).then(
      ([summary, attendance]) => show({ state: 'ready', summary, rows: attendance.rows }),
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) navigate('/sign-in', true);
        else if (error instanceof ApiError && error.status === 404) show({ state: 'missing' });
        else show({ state: 'refused', message: error instanceof ApiError ? error.message : 'Something went wrong. Try again.' });
      },
    );
    return () => {
      current = false;
    };
  }, [sessionId]);

  if (loaded.state === 'missing') return <NotFound />;
  const counts = loaded.state === 'ready' ? loaded.summary.attendance : null;
  const lines: [string, number][] = counts
    ? [
        ['Present', counts.present],
        ['Late', counts.late],
        ['Left early', counts.leftEarly],
        ['Late, left early', counts.lateLeftEarly],
        ['Absent', counts.absent],
      ]
    : [];

  return (
    <main className="page">
      <h1>Session summary</h1>
      {loaded.state === 'loading' ? <Skeleton rows={4} label="Loading the summary" /> : null}
      {loaded.state === 'refused' ? <Alert>{loaded.message}</Alert> : null}
      {loaded.state === 'ready' ? (
        <>
          <ul className="counts" aria-label="Attendance counts">
            {lines.map(([label, count]) => (
              <li key={label}>
                {label} <span className="mono">{count}</span>
              </li>
            ))}
          </ul>

          <section className="panel" aria-labelledby="attendance-heading">
            <h2 id="attendance-heading">Attendance</h2>
            <div className="table-scroll" role="region" aria-label="Attendance table" tabIndex={0}>
              <table aria-label="Attendance">
                <thead>
                  <tr>
                    <th scope="col">Learner</th>
                    <th scope="col">Status</th>
                    <th scope="col">First joined</th>
                    <th scope="col">Last left</th>
                  </tr>
                </thead>
                <tbody>
                  {loaded.rows.map((row) => (
                    <tr key={row.learnerId}>
                      <td>{row.displayName}</td>
                      <td>{STATUS_LABEL[row.status]}</td>
                      <td className="mono">{clock(row.firstJoined)}</td>
                      <td className="mono">{clock(row.lastLeft)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" aria-labelledby="polls-heading">
            <h2 id="polls-heading">Polls</h2>
            {loaded.summary.polls.length === 0 ? (
              <p className="hint">No polls were run.</p>
            ) : (
              <ul className="ruled poll-summary" aria-label="Poll results">
                {loaded.summary.polls.map((poll) => (
                  <li key={poll.pollId}>
                    <p className="poll-question">{poll.question}</p>
                    <ul className="poll-options">
                      {poll.results.map((result) => (
                        <li key={result.option}>
                          {result.option} <span className="mono">{result.percent}%</span>
                          <span className="poll-count mono">
                            {result.count} of {poll.total}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel tallies" aria-label="Class tallies">
            <p>Hands taken: {loaded.summary.handsTaken}</p>
            <p>Breakout rounds: {loaded.summary.breakoutRounds}</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
