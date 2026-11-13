// `list "Stages"`: one outlined card per stage with its two-digit index, name and status.
import { StatusBadge } from "../../ui/index.ts";
import type { StageSummary } from "./types.ts";

function stageLabel(index: number, stage: StageSummary): string {
  return `Stage ${String(index + 1).padStart(2, "0")} ${stage.name}, ${stage.status}`;
}

export function StageCards({ stages }: { stages: readonly StageSummary[] }) {
  return (
    <ul role="list" aria-label="Stages" class="sp-stages">
      {stages.map((stage, index) => (
        <li key={stage.name} class="sp-stage" aria-label={stageLabel(index, stage)}>
          <span class="sp-stage__index">{String(index + 1).padStart(2, "0")}</span>
          <span class="sp-stage__name">{stage.name}</span>
          <StatusBadge status={stage.status} />
        </li>
      ))}
    </ul>
  );
}
