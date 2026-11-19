// Stage routing: which stages a request needs, who holds each one, and the stage wording (brief: Business rules / Routing).
import type { Tx } from "./db.ts";
import { applicationOf, type AssetClass, type StageKind } from "../shared/domain.ts";

/** Stage kinds in order: brand, a second brand stage for marks, then legal where the application needs it. */
export function planStages(assetClass: AssetClass, applicationClass: string): StageKind[] {
  const kinds: StageKind[] = ["brand"];
  if (assetClass === "mark") kinds.push("brand");
  if (applicationOf(applicationClass)!.legalStage) kinds.push("legal");
  return kinds;
}

type Step = "brand" | "first_brand" | "second_brand" | "legal";

function stepOf(kinds: readonly StageKind[], n: number, assetClass: AssetClass): Step {
  if (kinds[n - 1] === "legal") return "legal";
  if (assetClass !== "mark") return "brand";
  return kinds.slice(0, n).filter((k) => k === "brand").length === 1 ? "first_brand" : "second_brand";
}

export function stageLabel(kinds: readonly StageKind[], n: number, assetClass: AssetClass): string {
  const labels: Record<Step, string> = { brand: "Brand review", first_brand: "First brand review", second_brand: "Second brand review", legal: "Legal review" };
  return labels[stepOf(kinds, n, assetClass)];
}

export function stageReason(kinds: readonly StageKind[], n: number, assetClass: AssetClass, applicationLabel: string): string {
  const step = stepOf(kinds, n, assetClass);
  const wording: Record<Step, string> = {
    brand: "brand review.",
    first_brand: "first brand review (mark asset).",
    second_brand: "second brand review (mark asset).",
    legal: `legal review (${applicationLabel}).`,
  };
  return `Stage ${n} of ${kinds.length}: ${wording[step]}`;
}

interface Assignment {
  assigneeId: string;
  escalated: boolean;
}

/** The principal of one of the roles with the fewest open stages (ties by display name), skipping excluded ids. */
async function leastLoaded(tx: Tx, role: string, requesterId: string, excluded: readonly string[]): Promise<string | undefined> {
  const row = await tx.one<{ id: string }>(
    `SELECT p.id FROM principals p
      WHERE p.role = $1 AND p.id <> $2 AND NOT (p.id = ANY($3))
      ORDER BY (SELECT count(*) FROM request_stages s JOIN requests r ON r.id = s.request_id
                 WHERE s.assignee_id = p.id AND s.decision IS NULL AND r.state = 'under_review'),
               p.display_name COLLATE "C"
      LIMIT 1`,
    [role, requesterId, excluded],
  );
  return row?.id;
}

/** Least-loaded eligible reviewer; the owner with the fewest open stages when nobody is eligible. */
export async function chooseAssignee(tx: Tx, kind: StageKind, requesterId: string, earlierDeciders: readonly string[]): Promise<Assignment> {
  const eligible = await leastLoaded(tx, kind === "legal" ? "legal_reviewer" : "brand_reviewer", requesterId, kind === "brand" ? earlierDeciders : []);
  if (eligible) return { assigneeId: eligible, escalated: false };
  return { assigneeId: await chooseOwner(tx), escalated: true };
}

/** The owner with the fewest open stages: nobody eligible, or a missed deadline. */
export async function chooseOwner(tx: Tx): Promise<string> {
  return (await leastLoaded(tx, "owner", "", []))!;
}
