import { get } from "../api";
import { useLoad } from "../hooks";
import { Link } from "../router";
import { Screen } from "../shell/Page";
import { formatRange } from "../../shared/money";
import { WORK_PATTERNS, nameOf } from "../../shared/reference";
import type { JobSummary } from "../../shared/api";

export function Saved() {
  const saved = useLoad(() => get<{ jobs: JobSummary[] }>("/api/saved-jobs"), []);
  const jobs = saved.data?.jobs;
  return (
    <Screen title="Saved jobs">
      <h1 className="page-title">Saved jobs</h1>
      {jobs && jobs.length === 0 ? (
        <div className="empty">
          <p>You have not saved any jobs yet.</p>
          <Link to="/jobs" className="btn">Search lab jobs</Link>
        </div>
      ) : null}
      <ul className="items" aria-label="Saved jobs">
        {(jobs ?? []).map((job) => (
          <li key={job.id} data-id={job.id}>
            <Link className="item-title" to={`/jobs/${job.id}`}>{`${job.title} at ${job.company_name}`}</Link>
            <p className="meta figure">{job.city_name} · {nameOf(WORK_PATTERNS, job.remote)} · {formatRange(job.pay_low, job.pay_high)}</p>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
