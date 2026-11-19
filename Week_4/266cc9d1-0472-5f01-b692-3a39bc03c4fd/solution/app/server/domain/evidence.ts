// The evidence pack written at submit: the frozen set, its findings and the active assets.
import type { Db } from "../db.js";
import { activeAssets, filesOf } from "./assets.js";
import type { Finding } from "./finding.js";

export function evidenceKey(tenantId: string, corridorId: string, setId: string): string {
  return `tenants/${tenantId}/corridors/${corridorId}/findings-sets/${setId}/evidence.json`;
}

export async function buildEvidence(
  db: Db,
  set: { id: string; corridorId: string; revision: number; submittedAt: Date },
  frozen: { finding_count: number; violation_count: number },
  findings: Finding[],
): Promise<Buffer> {
  const active = await activeAssets(db, set.corridorId);
  const assets = [];
  for (const [kind, id] of Object.entries(active)) {
    if (id === null) continue;
    const files = await filesOf(db, id);
    assets.push({ id, kind, files: files.map((f) => ({ path: f.path, size_bytes: f.size_bytes, sha256: f.sha256 })) });
  }
  const pack = {
    set_id: set.id,
    corridor_id: set.corridorId,
    revision: set.revision,
    submitted_at: set.submittedAt.toISOString(),
    frozen,
    findings: findings.map((f) => ({
      label: f.label,
      ecef_m: f.ecef_m,
      lon_deg: f.lon_deg,
      lat_deg: f.lat_deg,
      ground_height_m: f.ground_height_m,
      terrain_level: f.terrain_level,
      canopy_top_height_m: f.canopy_top_height_m,
      canopy_radius_m: f.canopy_radius_m,
      chainage_m: f.chainage_m,
      span_label: f.span.label,
      clearance_m: f.clearance_m,
      status: f.status,
      comment: f.comment,
    })),
    assets,
  };
  return Buffer.from(JSON.stringify(pack, null, 2), "utf8");
}
