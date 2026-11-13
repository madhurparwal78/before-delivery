// `group "Pipeline graph"`: one button per job at the position the API computed, one curved path per need.
//   Arrow keys move focus along the needs (Right: first job that needs this one, Left: this job's first need, Up and Down:
//   the neighbouring row of the same layer); Enter opens the job page with focus on its log.
import type { JSX } from "preact";
import { navigate, requestFocusOnArrival } from "../../router.ts";
import { statusTone } from "../../ui/index.ts";
import { edgePath, GRAPH_ORIGIN, NODE_HEIGHT, NODE_WIDTH } from "../../../shared/pipeline-layout.ts";
import { jobPath, latestJobs } from "./job-facts.ts";
import type { JobSummary } from "./types.ts";

function graphLabel(job: JobSummary): string {
  return `Job ${job.name}, stage ${job.stage}, ${job.status}, needs ${job.needs.length > 0 ? job.needs.join(" and ") : "nothing"}`;
}

/** Where an arrow key leads from `job`, or null when nothing is there. */
function neighbour(jobs: readonly JobSummary[], job: JobSummary, key: string): JobSummary | null {
  if (key === "ArrowRight") {
    const followers = jobs.filter((other) => other.needs.includes(job.name));
    return followers.reduce<JobSummary | null>((first, other) => (first === null || other.row < first.row ? other : first), null);
  }
  if (key === "ArrowLeft") {
    for (const need of job.needs) {
      const found = jobs.find((other) => other.name === need);
      if (found) return found;
    }
    return null;
  }
  const layer = jobs.filter((other) => other.layer === job.layer).sort((a, b) => a.row - b.row);
  const at = layer.indexOf(job);
  return layer[key === "ArrowUp" ? at - 1 : at + 1] ?? null;
}

const ARROWS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]);

export function PipelineGraph({ project, jobs }: { project: number; jobs: readonly JobSummary[] }) {
  const drawn = latestJobs(jobs);
  const byName = new Map(drawn.map((job) => [job.name, job] as const));
  const width = Math.max(0, ...drawn.map((job) => job.x)) + NODE_WIDTH + GRAPH_ORIGIN;
  const height = Math.max(0, ...drawn.map((job) => job.y)) + NODE_HEIGHT + GRAPH_ORIGIN;
  const edges = drawn.flatMap((job) =>
    job.needs.flatMap((need) => {
      const from = byName.get(need);
      return from ? [{ from: need, to: job.name, d: edgePath(from, job) }] : [];
    }),
  );

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!ARROWS.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    const button = target instanceof Element ? target.closest<HTMLButtonElement>("button[data-job]") : null;
    if (!button) return;
    event.preventDefault();
    const current = byName.get(button.dataset.job ?? "");
    const next = current ? neighbour(drawn, current, event.key) : null;
    if (!next) return;
    for (const candidate of event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-job]")) {
      if (candidate.dataset.job === next.name) candidate.focus();
    }
  };

  const open = (job: JobSummary) => {
    const path = jobPath(project, job.id);
    requestFocusOnArrival(path);
    navigate(path);
  };

  return (
    <div role="group" aria-label="Pipeline graph" class="sp-graph" onKeyDown={onKeyDown}>
      <div class="sp-graph__canvas" style={{ width: `${width}px`, height: `${height}px` }}>
        <svg class="sp-graph__edges" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
          {edges.map((edge) => (
            <path key={`${edge.from}>${edge.to}`} class="sp-graph__edge" d={edge.d} data-from={edge.from} data-to={edge.to} fill="none" />
          ))}
        </svg>
        {drawn.map((job) => (
          <button
            key={job.id}
            type="button"
            class={`sp-node sp-node--${statusTone(job.status)}`}
            style={{ left: `${job.x}px`, top: `${job.y}px` }}
            aria-label={graphLabel(job)}
            data-job={job.name}
            data-status={job.status}
            data-x={job.x}
            data-y={job.y}
            data-layer={job.layer}
            data-row={job.row}
            data-flash={job.id}
            onClick={() => open(job)}
          >
            <span class="sp-node__name">{job.name}</span>
            {/* Drawn from data-status in CSS, so the button's visible text (the job name) stays part of its aria-label. */}
            <span class="sp-node__status" data-status={job.status} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
