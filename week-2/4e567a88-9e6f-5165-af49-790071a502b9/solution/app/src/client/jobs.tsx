// The Jobs screen, the job detail dialog and the one cancel action every screen uses.

import { promptOf } from "../shared/schema";
import { useState } from "preact/hooks";
import { formatRate } from "../shared/money";
import { formatUnits, parseUnitsText } from "../shared/units";
import { ApiError, get, query, refreshAll, request, type Job, type JobStatus, type Member } from "./api";
import { Dialog } from "./dialog";
import { capitalised, credits, usePoll, when } from "./hooks";
import { CreditMeter } from "./meter";
import { modelNameOf, teamNameOf, useSession } from "./session";
import { Alert, ScreenHead, StateWord, TeamPicker } from "./ui";

const HIDDEN_PAYLOAD = "Hidden — restricted payload";
const IN_FLIGHT: JobStatus[] = ["queued", "leased", "running"];
const STATUSES: JobStatus[] = ["queued", "leased", "running", "succeeded", "failed", "cancelled"];

export function canCancel(me: Member, job: Pick<Job, "status" | "team_id">): boolean {
  return IN_FLIGHT.includes(job.status) && (me.role === "admin" || (me.role === "member" && me.team_id === job.team_id));
}

/** Cancels a job and reports through Notices; returns the error copy for an alert, or null. */
export async function cancelJob(id: string, notify: (text: string) => void): Promise<string | null> {
  notify("Cancelling…");
  try {
    const { data } = await request<{ job: Job }>("POST", `/api/jobs/${id}/cancel`);
    notify(`Job ${id} cancelled; ${credits(data.job.released_micro)} credits released.`);
    refreshAll();
    return null;
  } catch (error) {
    notify("");
    if (error instanceof ApiError && error.body.code === "job_not_cancellable") {
      return `Job ${id} already ${String(error.body.status)}; nothing to cancel.`;
    }
    return error instanceof ApiError ? error.message : "The job could not be cancelled. Try again.";
  }
}

const jobPrompt = (job: Job): string =>
  job.payload_visible && job.input ? promptOf(job.input) : HIDDEN_PAYLOAD;

/** What the job costs the team: its charge once settled, its reservation while in flight. */
function jobCost(job: Job): string {
  if (job.charged_micro !== null) return credits(job.charged_micro);
  return IN_FLIGHT.includes(job.status) ? credits(job.reserved_micro) : credits(0);
}

const jobUnits = (job: Job): string => formatUnits(parseUnitsText(job.billed_units ?? job.estimated_units), job.unit);

export function JobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const session = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePoll(async () => {
    if (!jobId) {
      setJob(null);
      setError(null);
      return;
    }
    const { job: fresh } = await get<{ job: Job }>(`/api/jobs/${jobId}`);
    setJob(fresh);
  }, 2000, [jobId]);

  const shown = job && job.id === jobId ? job : null;
  const rows: [string, string, boolean?][] = shown ? [
    ["Status", capitalised(shown.status)],
    ["Model", modelNameOf(session, shown.model)],
    ["Team", teamNameOf(session, shown.team_id)],
    ["Priority", capitalised(shown.priority)],
    ["Submitted by", shown.submitted_by.name],
    ["Submitted", when(shown.submitted_at), true],
    ["Started", when(shown.started_at), true],
    ["Finished", when(shown.finished_at), true],
    ["Attempts", String(shown.attempts), true],
    ["Estimated units", formatUnits(parseUnitsText(shown.estimated_units), shown.unit), true],
    ["Billed units", shown.billed_units === null ? "—" : formatUnits(parseUnitsText(shown.billed_units), shown.unit), true],
    ["Rate (credits per unit)", `${formatRate(BigInt(shown.rate.micro_per_unit))} · ${shown.rate.id}`, true],
    ["Reserved (credits)", credits(shown.reserved_micro), true],
    ["Charged (credits)", shown.charged_micro === null ? "—" : credits(shown.charged_micro), true],
    ["Released (credits)", credits(shown.released_micro), true],
    ["Cost (credits)", jobCost(shown), true],
    ...(shown.queue_position !== null ? [["Queue position", `#${shown.queue_position}`, true] as [string, string, boolean]] : []),
    ...(shown.waiting_reason ? [["Waiting", "Waiting for storage"] as [string, string]] : []),
    ...(shown.failure_reason ? [["Failure", shown.failure_reason] as [string, string]] : []),
    ["Outputs", shown.outputs.length ? shown.outputs.join(", ") : "—", true],
  ] : [];

  return (
    <Dialog open={jobId !== null} title={`Job ${jobId ?? ""}`} onClose={onClose} wide>
      {!shown ? <p class="muted">Loading…</p> : (
        <>
          <dl class="facts">
            {rows.map(([term, value, numeric]) => (
              <div key={term} class="facts__row">
                <dt>{term}</dt>
                <dd class={numeric ? "num" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          <h3 class="subhead">Input</h3>
          {shown.payload_visible && shown.input ? (
            <dl class="facts">
              {Object.entries(shown.input).map(([name, value]) => (
                <div key={name} class="facts__row">
                  <dt>{name}</dt>
                  <dd class={typeof value === "number" ? "num" : "prose"}>{String(value)}</dd>
                </div>
              ))}
              {shown.input_assets && shown.input_assets.length > 0 && (
                <div class="facts__row"><dt>Input assets</dt><dd class="num">{shown.input_assets.join(", ")}</dd></div>
              )}
            </dl>
          ) : <p class="hidden-payload">{HIDDEN_PAYLOAD}</p>}
          <Alert text={error} />
          <div class="dialog__actions">
            {canCancel(session.me, shown) && (
              <button type="button" class="btn btn--secondary" onClick={async () => {
                setError(await cancelJob(shown.id, session.notify));
              }}>Cancel job {shown.id}</button>
            )}
            <button type="button" class="btn" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export function JobsScreen() {
  const session = useSession();
  const { teamId } = session;
  const [status, setStatus] = useState("");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  usePoll(async () => {
    const { jobs: listed } = await get<{ jobs: Job[] }>(`/api/jobs${query({ team: teamId, status, limit: "200" })}`);
    setJobs(listed);
  }, 2000, [teamId, status]);

  return (
    <div class="screen">
      <ScreenHead title="Jobs">
        <TeamPicker id="jobs-team" />
        <div class="field field--inline">
          <label for="jobs-status">Status</label>
          <select id="jobs-status" value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{capitalised(s)}</option>)}
          </select>
        </div>
        <a class="btn btn--secondary" href={`/api/jobs.csv${query({ team: teamId })}`} download>Export CSV</a>
      </ScreenHead>
      <CreditMeter teamId={teamId} teamName={teamNameOf(session, teamId)} onOpenJob={setOpen} />
      <section class="panel">
        <div class="table-wrap" tabIndex={0} role="region" aria-label="Jobs table">
          <table class="table" aria-label="Jobs">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col" class="fold">Model</th>
                <th scope="col">Status</th>
                <th scope="col" class="fold">Submitted by</th>
                <th scope="col" class="fold">Submitted</th>
                <th scope="col" class="fold num-col">Units</th>
                <th scope="col" class="fold num-col">Rate</th>
                <th scope="col" class="num-col">Cost (credits)</th>
                <th scope="col" class="fold">Prompt</th>
              </tr>
            </thead>
            <tbody>
              {jobs === null && <tr><td colSpan={9} class="muted">Loading…</td></tr>}
              {jobs?.length === 0 && <tr><td colSpan={9} class="muted">No jobs yet.</td></tr>}
              {jobs?.map((job) => (
                <tr key={job.id}>
                  <td><button type="button" class="link-button num" onClick={() => setOpen(job.id)}>{job.id}</button></td>
                  <td class="fold">{modelNameOf(session, job.model)}</td>
                  <td><StateWord word={capitalised(job.status)} tone={job.status === "failed" ? "alert" : undefined} /></td>
                  <td class="fold">{job.submitted_by.name}</td>
                  <td class="fold num">{when(job.submitted_at)}</td>
                  <td class="fold num num-col">{jobUnits(job)}</td>
                  <td class="fold num num-col">{formatRate(BigInt(job.rate.micro_per_unit))}</td>
                  <td class="num num-col">{jobCost(job)}</td>
                  <td class={`fold prompt-cell${job.payload_visible ? "" : " hidden-payload"}`}>{jobPrompt(job)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <JobDialog jobId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
