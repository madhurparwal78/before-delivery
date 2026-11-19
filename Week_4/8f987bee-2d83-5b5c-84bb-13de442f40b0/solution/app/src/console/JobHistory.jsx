import { local } from "./format.js";
import { Discs } from "../components/Icons.jsx";
import StatusChip from "./StatusChip.jsx";

// The "Job history" table: newest first, one row per job id.
export default function JobHistory({ jobs, hasMore, onLoadOlder }) {
  return (
    <section className="panel" aria-labelledby="history-title">
      <h2 id="history-title" className="panel-title">Job history</h2>
      <div className="table-frame" role="region" tabIndex={0} aria-label="Job history table">
        <table className="data" aria-label="Job history">
          <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col">Records</th><th scope="col">Reason</th></tr></thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <th scope="row" className="code">Job {job.id.slice(0, 8)}</th>
                <td><StatusChip status={job.status} /></td>
                <td className="num">{job.status === "pending" ? "" : local(job.started_at)}</td>
                <td className="num">{job.records_committed.toLocaleString("en-US")}</td>
                <td>{job.status === "failed" ? job.failure_reason : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && <p className="empty"><Discs />No jobs yet. Press Sync now to run the first one.</p>}
      </div>
      <div className="panel-foot">
        {hasMore && <button type="button" className="btn btn-outline" onClick={onLoadOlder}>Load older jobs</button>}
        <p role="status" aria-label="Job history status" className="status-line">{`Showing ${jobs.length} jobs`}</p>
      </div>
    </section>
  );
}
