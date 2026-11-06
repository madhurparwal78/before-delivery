// Jobs (brief: Screens and layout › Jobs): every job with its number, car, title, status and total.
// The Status cell updates in place on re-reads while any shown job is sent, with no announcement.
import { useEffect, useState } from "react";
import type { Job } from "../../shared/api.js";
import { get } from "../api.js";
import { EstimateDialog } from "../EstimateDialog.js";
import { applyInPlace, usePoll } from "../hooks.js";
import { chf, estimateLabel } from "../labels.js";
import { useSession } from "../session.js";
import { Link } from "../Shell.js";
import { StatusRegion, useNote } from "../ui/Feedback.js";

export function Jobs(): JSX.Element {
  const { user } = useSession();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, say] = useNote();
  const workshop = user.role === "workshop_lead" || user.role === "house_manager";

  const load = async (firstLoad: boolean): Promise<Job[]> => (await get<{ jobs: Job[] }>("/api/jobs", firstLoad)).jobs;

  useEffect(() => {
    load(true).then(setJobs, () => undefined);
  }, []);

  usePoll(
    async () => {
      const fresh = await load(false);
      if (JSON.stringify(fresh) !== JSON.stringify(jobs)) applyInPlace(() => setJobs(fresh));
    },
    10_000,
    jobs?.some((job) => job.status === "sent") ?? false,
  );

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Jobs</h1>
        <StatusRegion name="Job updates" note={note} />
        {workshop ? (
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            New estimate
          </button>
        ) : null}
      </header>
      <table aria-label="Jobs" className="table">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col" className="hide-narrow">
              Car
            </th>
            <th scope="col" className="hide-narrow">
              Title
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="numeric">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {(jobs ?? []).map((job) => (
            <tr key={job.id}>
              <td>
                <Link to={`/jobs/${job.id}`} className="mono-text">
                  {job.number}
                </Link>
                <span className="sub show-narrow">{job.car.name}</span>
                <span className="sub show-narrow">{job.title}</span>
              </td>
              <td className="hide-narrow">{job.car.name}</td>
              <td className="hide-narrow">{job.title}</td>
              <td>{estimateLabel(job)}</td>
              <td className="numeric mono-text">{chf(job.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {jobs && jobs.length === 0 ? <p className="empty">No jobs yet.</p> : null}
      {creating ? (
        <EstimateDialog
          job={null}
          say={say}
          onClose={() => setCreating(false)}
          onSaved={(job) => {
            setCreating(false);
            setJobs([...(jobs ?? []), job]);
          }}
        />
      ) : null}
    </div>
  );
}
