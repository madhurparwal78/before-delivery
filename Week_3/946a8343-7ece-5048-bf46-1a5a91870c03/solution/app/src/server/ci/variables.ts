// Variable layering for a running job (DP-23): predefined < top-level < job < matching rule < project < run and play.
// The engine already folded top-level, job and rule variables into `spec.variables`.
import type { Queryable } from "../db.ts";
import type { JobRow, PipelineRow } from "./rows.ts";

export async function projectVariables(q: Queryable, projectId: number): Promise<Record<string, string>> {
  const rows = await q.q<{ key: string; value: string }>("SELECT key, value FROM project_variables WHERE project_id = $1", [projectId]);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function jobVariables(
  pipeline: Pick<PipelineRow, "predefined" | "run_variables">,
  job: Pick<JobRow, "id" | "name" | "stage" | "spec" | "play_variables">,
  project: Readonly<Record<string, string>>,
  environmentName: string | null = null,
): Record<string, string> {
  return {
    ...pipeline.predefined,
    CI_JOB_ID: String(job.id),
    CI_JOB_NAME: job.name,
    CI_JOB_STAGE: job.stage,
    CI_ENVIRONMENT_NAME: environmentName ?? "",
    ...job.spec.variables,
    ...project,
    ...pipeline.run_variables,
    ...job.play_variables,
  };
}
