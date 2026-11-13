import { useLayoutEffect as useEffect, useState } from "preact/hooks";
import { OPS_TEXT } from "../../../shared/copy";
import type { CatalogueModel, OpsClaimRow, OpsStats } from "../../../shared/types";
import { get } from "../../api";
import { ClaimsTable } from "../../ClaimsTable";
import { startPending } from "../../messages";
import { refuse } from "../../ops";

export function Queue() {
  const [claims, setClaims] = useState<OpsClaimRow[] | null>(null);
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [stats, setStats] = useState<OpsStats | null>(null);

  useEffect(() => {
    const end = startPending("");
    void Promise.all([get<{ claims: OpsClaimRow[] }>("/api/ops/claims"), get<OpsStats>("/api/ops/stats"), get<{ models: CatalogueModel[] }>("/api/models")]).then(([list, counts, catalogue]) => {
      end();
      if (!list.data) return refuse(list);
      setClaims(list.data.claims);
      if (counts.data) setStats(counts.data);
      if (catalogue.data) setModels(catalogue.data.models);
    });
  }, []);

  return (
    <div class="stack">
      <h1 class="plate-title">Claims</h1>
      <p class="decided" role="status" aria-label="Decided claims">
        {stats ? OPS_TEXT.decided(stats.decided_claims, stats.decided_inside, stats.decided_outside) : ""}
      </p>
      <ClaimsTable claims={claims} models={models} />
    </div>
  );
}
