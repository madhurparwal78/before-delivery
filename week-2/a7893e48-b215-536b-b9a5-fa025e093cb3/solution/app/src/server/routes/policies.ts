import { requireActor, requireRole } from "../auth.js";
import { all, newId, one, pool } from "../db.js";
import { ApiError, field, invalid, json, route } from "../http.js";
import { siteInScope } from "../scope.js";
import { isLocalDate, localDate, resolveLocal } from "../time.js";
import type { PolicyVersion } from "../views.js";

const versionJson = (version: PolicyVersion) => ({
  id: version.id, notice_hours: version.notice_hours, effective_from: version.effective_from,
  effective_at: version.effective_at.toISOString(), created_by_name: version.created_by_name, created_at: version.created_at.toISOString(),
});

route("GET", "/api/sites/:id/policies", async (request) => {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "manager");
  const versions = await all<PolicyVersion>(pool, "SELECT * FROM policy_versions WHERE site_id = $1 ORDER BY effective_from DESC", [site.id]);
  return json(200, { versions: versions.map(versionJson) });
});

route("POST", "/api/sites/:id/policies", async (request) => {
  const actor = await requireActor(request);
  const site = await siteInScope(pool, actor, request.params.id ?? "");
  requireRole(actor, "manager");
  const notice = field(request.body, "notice_hours");
  const effectiveFrom = field(request.body, "effective_from");
  if (isLocalDate(effectiveFrom) && (await one(pool, "SELECT 1 FROM policy_versions WHERE site_id = $1 AND effective_from = $2", [site.id, effectiveFrom]))) {
    throw new ApiError(409, "policy_date_taken");
  }
  const now = new Date();
  const fields: Record<string, string> = {};
  if (typeof notice !== "number" || !Number.isInteger(notice) || notice < 1 || notice > 168) fields.notice_hours = "Notice is 1 to 168 whole hours.";
  if (!isLocalDate(effectiveFrom)) fields.effective_from = "Use a date in the form YYYY-MM-DD.";
  else if (effectiveFrom < localDate(site.time_zone, now)) fields.effective_from = "Choose today or a later date.";
  if (Object.keys(fields).length > 0 || typeof notice !== "number" || !isLocalDate(effectiveFrom)) throw invalid(fields);
  const midnight = resolveLocal(site.time_zone, effectiveFrom, "00:00");
  const version: PolicyVersion = {
    id: newId("pv"), site_id: site.id, notice_hours: notice, effective_from: effectiveFrom,
    effective_at: midnight.getTime() > now.getTime() ? midnight : now, created_by_name: actor.name, created_at: now,
  };
  const inserted = await pool.query(
    `INSERT INTO policy_versions (id, site_id, notice_hours, effective_from, effective_at, created_by_name, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (site_id, effective_from) DO NOTHING`,
    [version.id, site.id, notice, effectiveFrom, version.effective_at, version.created_by_name, now]);
  if (inserted.rowCount === 0) throw new ApiError(409, "policy_date_taken");
  return json(201, { version: versionJson(version) });
});
