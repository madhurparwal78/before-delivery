// Server-clock deadline: artifacts past their expiry lose their object and their link (DP-26).
import { now } from "../clock.ts";
import { db, withTx } from "../db.ts";
import { StorageUnavailable, storage } from "../s3.ts";
import { artifactObject } from "./files.ts";
import { loadJob } from "./rows.ts";

interface DueArtifact {
  readonly job_id: number;
  readonly path: string;
}

export async function expireArtifacts(): Promise<void> {
  const due = await db.q<{ project_id: number }>(
    `SELECT DISTINCT j.project_id FROM ci_artifacts a JOIN ci_jobs j ON j.id = a.job_id
      WHERE NOT a.expired AND a.expires_at IS NOT NULL AND a.expires_at <= $1`,
    [now()],
  );
  for (const { project_id: projectId } of due) {
    await withTx(async (tx) => {
      await tx.lockProject(projectId);
      const rows = await tx.q<DueArtifact>(
        `SELECT a.job_id, a.path FROM ci_artifacts a JOIN ci_jobs j ON j.id = a.job_id
          WHERE j.project_id = $1 AND NOT a.expired AND a.expires_at IS NOT NULL AND a.expires_at <= $2 ORDER BY a.job_id, a.path`,
        [projectId, now()],
      );
      const touched = new Set<number>();
      for (const row of rows) {
        try {
          await storage.delete(artifactObject(row.job_id, row.path));
        } catch (error) {
          if (error instanceof StorageUnavailable) continue;
          throw error;
        }
        await tx.q("UPDATE ci_artifacts SET expired = true WHERE job_id = $1 AND path = $2", [row.job_id, row.path]);
        touched.add(row.job_id);
      }
      for (const jobId of touched) {
        const job = await loadJob(tx, jobId);
        if (job !== undefined) await tx.emit(projectId, "job", { pipeline_id: job.pipeline_id, job_id: job.id, name: job.name, status: job.status });
      }
    });
  }
}
