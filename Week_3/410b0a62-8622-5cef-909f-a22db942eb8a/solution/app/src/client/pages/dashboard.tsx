import type { AthleteRow } from '../../shared/types.js';
import { COMPLIANCE_LABELS } from '../../shared/compliance.js';
import { dayLabel } from '../../shared/dates.js';
import { formatTss } from '../../shared/format.js';
import { get } from '../api.js';
import { useLoaded } from '../hooks.js';
import { Link } from '../router.js';
import { EmptyMark, Skeleton } from '../ui.js';

export function Dashboard() {
  const { data } = useLoaded(() => get<{ athletes: AthleteRow[] }>('/api/athletes').then((body) => body.athletes), []);
  return (
    <section className="wrap page">
      <h1 className="page-title">Athletes</h1>
      {data === null && <Skeleton lines={4} className="skeleton-table" />}
      {data && data.length === 0 && (
        <div className="empty">
          <EmptyMark kind="list" />
          <p className="empty-line">No athletes linked yet</p>
          <Link to="/inbox" className="pill pill-navy">
            Open the inbox
          </Link>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="table-wrap" role="region" aria-label="Athletes table scroller" tabIndex={0}>
          <table aria-label="Athletes" className="data-table">
            <thead>
              <tr>
                <th scope="col">Athlete</th>
                <th scope="col">Planned</th>
                <th scope="col">Completed</th>
                <th scope="col">Latest session</th>
                <th scope="col">Compliance</th>
              </tr>
            </thead>
            <tbody>
              {data.map((athlete) => {
                const latest = athlete.latest;
                const done = latest?.completed ?? null;
                return (
                  <tr key={athlete.id} data-athlete-id={athlete.id}>
                    <th scope="row">
                      <Link to={`/athletes/${athlete.id}`}>{athlete.name}</Link>
                      <span className="cell-note">{athlete.tz}</span>
                    </th>
                    <td data-planned-tss={formatTss(athlete.week.planned_tss)}>{formatTss(athlete.week.planned_tss)}</td>
                    <td data-completed-tss={formatTss(athlete.week.completed_tss)}>{formatTss(athlete.week.completed_tss)}</td>
                    {latest && done ? (
                      <>
                        <td data-tss={formatTss(done.tss ?? 0)}>{`${done.title} · ${dayLabel(done.date)} · ${formatTss(done.tss ?? 0)} TSS`}</td>
                        <td data-compliance={latest.compliance}>
                          <span className={`state-chip state-${latest.compliance}`}>{COMPLIANCE_LABELS[latest.compliance]}</span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>No sessions yet</td>
                        <td>—</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
