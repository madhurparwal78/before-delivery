// `GET /api/jobs/<id>/log/stream`: a server-sent event per log line, then `end` with the job status (DP-27).
import { config } from "../config.ts";
import { db } from "../db.ts";
import { STREAMED, type Ctx, type Reply } from "../http.ts";
import { watchJob } from "./jobstore.ts";
import { loadJob } from "./rows.ts";
import { isFinished } from "./status.ts";

const SAFETY_POLL_MS = 500;

export function streamJobLog(ctx: Ctx, jobId: number): Reply {
  const { req, res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  let sent = 0;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  const stop = (): void => {
    if (closed) return;
    closed = true;
    unwatch();
    clearInterval(heartbeat);
    clearInterval(poll);
  };

  const pump = async (): Promise<void> => {
    if (closed) return;
    const job = await loadJob(db, jobId);
    if (job === undefined) {
      stop();
      res.end();
      return;
    }
    const rows = await db.q<{ n: number; stream: string; text: string }>(
      "SELECT n, stream, text FROM ci_job_lines WHERE job_id = $1 AND n > $2 ORDER BY n",
      [jobId, sent],
    );
    for (const row of rows) {
      res.write(`event: line\ndata: ${row.n} ${row.stream} ${row.text}\n\n`);
      sent = row.n;
    }
    if (isFinished(job.status) && sent >= job.log_lines) {
      res.write(`event: end\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
      stop();
      res.end();
    }
  };

  const schedule = (): void => {
    queue = queue.then(pump).catch(() => undefined);
  };

  const unwatch = watchJob(jobId, schedule);
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, Math.max(config.sseHeartbeatMs, 100));
  const poll = setInterval(schedule, SAFETY_POLL_MS);
  req.on("close", stop);
  schedule();
  return STREAMED;
}
