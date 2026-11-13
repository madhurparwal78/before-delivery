// Writing a job row, appending to its log, sealing the log, and telling log streams that something changed.
import { EventEmitter } from "node:events";
import type { Param, Tx } from "../db.ts";
import { storage, StorageUnavailable } from "../s3.ts";
import type { CiContext } from "./context.ts";
import type { JobRow } from "./rows.ts";

export type JobPatch = Partial<Omit<JobRow, "id" | "pipeline_id" | "project_id" | "name" | "spec">>;

const JSON_COLUMNS: ReadonlySet<string> = new Set(["emitted", "play_variables"]);

export async function updateJob(tx: Tx, id: number, patch: JobPatch): Promise<JobRow> {
  const sets: string[] = [];
  const params: Param[] = [id];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    params.push(JSON_COLUMNS.has(column) ? JSON.stringify(value) : value);
    sets.push(`${column} = $${params.length}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`);
  }
  return tx.one<JobRow>(`UPDATE ci_jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
}

const bus = new EventEmitter();
bus.setMaxListeners(0);

/** Runs `listener` after each committed change of the job's log or status; returns the unsubscribe function. */
export function watchJob(jobId: number, listener: () => void): () => void {
  const event = String(jobId);
  bus.on(event, listener);
  return () => {
    bus.off(event, listener);
  };
}

export function announceJobChange(ctx: CiContext, jobId: number): void {
  ctx.afterCommit(() => {
    bus.emit(String(jobId));
  });
}

type Stream = "out" | "sys";

/** Lines collected during one job turn; `flush` writes them and sends one `job_log` message. */
export class JobLog {
  private readonly lines: string[] = [];
  private readonly rows: { n: number; stream: Stream; text: string }[] = [];
  private next: number;
  private readonly jobId: number;

  constructor(job: Pick<JobRow, "id" | "log_lines">) {
    this.jobId = job.id;
    this.next = job.log_lines + 1;
  }

  add(stream: Stream, text: string): void {
    const clean = text.replace(/\r?\n/g, " ");
    this.rows.push({ n: this.next, stream, text: clean });
    this.lines.push(`${this.next} ${stream} ${clean}`);
    this.next += 1;
  }

  sys(text: string): void {
    this.add("sys", text);
  }

  out(text: string): void {
    this.add("out", text);
  }

  get count(): number {
    return this.next - 1;
  }

  async flush(ctx: CiContext, job: Pick<JobRow, "id">): Promise<void> {
    if (this.rows.length === 0) return;
    await ctx.tx.q(
      "INSERT INTO ci_job_lines (job_id, n, stream, text) SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[])",
      [this.jobId, this.rows.map((row) => row.n), this.rows.map((row) => row.stream), this.rows.map((row) => row.text)],
    );
    await ctx.tx.q("UPDATE ci_jobs SET log_lines = $2 WHERE id = $1", [this.jobId, this.count]);
    await ctx.emit("job_log", { job_id: this.jobId, lines: [...this.lines] });
    announceJobChange(ctx, job.id);
    this.rows.length = 0;
    this.lines.length = 0;
  }
}

export async function logLines(q: Pick<Tx, "q">, jobId: number): Promise<string[]> {
  const rows = await q.q<{ n: number; stream: string; text: string }>("SELECT n, stream, text FROM ci_job_lines WHERE job_id = $1 ORDER BY n", [jobId]);
  return rows.map((row) => `${row.n} ${row.stream} ${row.text}`);
}

/** Uploads the finished log to file storage; false (and nothing recorded) when storage refuses. */
export async function uploadLog(tx: Tx, jobId: number): Promise<boolean> {
  const lines = await logLines(tx, jobId);
  try {
    await storage.put(`logs/${jobId}.log`, lines.map((line) => `${line}\n`).join(""), "text/plain; charset=utf-8");
    return true;
  } catch (error) {
    if (error instanceof StorageUnavailable) return false;
    throw error;
  }
}
