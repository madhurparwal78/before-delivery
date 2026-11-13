// The sentence behind a failed or canceled job, taken from the lines the server logged (their texts are published).
import type { LogLine } from "./log-view.tsx";
import type { JobSummary } from "./types.ts";

const EXPIRED = /^Artifacts of .+ have expired\.$/;

function logged(lines: readonly LogLine[], wanted: (text: string) => boolean): string | null {
  return lines.find((line) => line.stream === "sys" && wanted(line.text))?.text ?? null;
}

export function failureText(job: Pick<JobSummary, "status" | "failure_reason">, lines: readonly LogLine[]): string | null {
  if (job.status === "canceled") {
    const reason = lines.filter((line) => line.stream === "sys" && !/^(section_(start|end) |Job finished: )/.test(line.text)).at(-1);
    return reason?.text ?? null;
  }
  if (job.status !== "failed") return null;
  if (job.failure_reason === "outdated_deployment") return logged(lines, (text) => text.startsWith("This deployment is outdated"));
  if (job.failure_reason === "system_failure") return logged(lines, (text) => text.startsWith("Artifact upload failed") || EXPIRED.test(text));
  if (job.failure_reason === "job_timeout") return logged(lines, (text) => text === "Job exceeded its time limit.");
  return null;
}
