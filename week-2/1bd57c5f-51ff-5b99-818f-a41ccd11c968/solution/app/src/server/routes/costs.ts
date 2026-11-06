import { randomUUID } from "node:crypto";
import type { ChangeOrder } from "../../shared/domain";
import { parseAmount, parsePercent } from "../../shared/money";
import { isUuid, jobAccess, lockOpenJob, requireOpenJob, requireRole } from "../access";
import { maybeOne, one, pool, rows, transaction } from "../db";
import { fail, invalid } from "../errors";
import { touch } from "../events";
import { json, readJson, route } from "../http";
import { computeCosts } from "../costs";

const DESCRIPTION_MAX = 200;
const AS_OF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

const ORDER_COLUMNS = `id, description, amount, CASE WHEN approved_at IS NULL THEN 'pending' ELSE 'approved' END AS status,
  created_at, approved_at`;

route("GET", "/api/jobs/:jobId/costs", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead");
  const asOf = call.query.get("as_of");
  if (asOf !== null && (!AS_OF.test(asOf) || Number.isNaN(Date.parse(asOf)))) {
    invalid({ as_of: "Give the moment as a UTC ISO 8601 time, such as 2026-06-01T15:30:00Z." });
  }
  return json(200, await computeCosts(pool, access.job.id, asOf));
});

route("PUT", "/api/jobs/:jobId/contingency", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner");
  requireOpenJob(access);
  const percent = parsePercent(readJson(call).percent);
  if (!percent.ok) invalid({ percent: "Enter a percent from 0.00 to 25.00 with up to two decimals." });
  const saved = await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    touch(tx, access.job.id);
    return one<{ percent: string; effective_at: string }>(
      tx,
      "INSERT INTO contingency_settings (job_id, percent) VALUES ($1, $2) RETURNING percent, effective_at",
      [access.job.id, percent.value],
    );
  });
  return json(200, saved);
});

route("GET", "/api/jobs/:jobId/change-orders", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead");
  const orders = await rows<ChangeOrder>(pool, `SELECT ${ORDER_COLUMNS} FROM change_orders WHERE job_id = $1 ORDER BY position`, [access.job.id]);
  return json(200, { change_orders: orders });
});

route("POST", "/api/jobs/:jobId/change-orders", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  requireRole(access, "owner", "lead");
  requireOpenJob(access);
  const body = readJson(call);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount = parseAmount(body.amount);
  const errors: Record<string, string> = {};
  if (description.length < 1 || description.length > DESCRIPTION_MAX) errors.description = `Describe the change in 1 to ${DESCRIPTION_MAX} characters.`;
  if (!amount.ok) errors.amount = "Enter a non-zero amount from -99999.99 to 99999.99 with up to two decimals.";
  if (Object.keys(errors).length > 0 || !amount.ok) invalid(errors);
  const order = await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    touch(tx, access.job.id);
    return one<ChangeOrder>(
      tx,
      `INSERT INTO change_orders (id, job_id, description, amount) VALUES ($1, $2, $3, $4) RETURNING ${ORDER_COLUMNS}`,
      [randomUUID(), access.job.id, description, amount.value],
    );
  });
  return json(201, order);
});

route("POST", "/api/jobs/:jobId/change-orders/:orderId/approve", async (call) => {
  const access = await jobAccess(pool, call.auth.person, call.params.jobId!);
  const orderId = call.params.orderId;
  const known = isUuid(orderId) ? await maybeOne(pool, "SELECT 1 FROM change_orders WHERE id = $1 AND job_id = $2", [orderId, access.job.id]) : null;
  if (!known) fail("not_found");
  requireRole(access, "owner");
  const order = await transaction(async (tx) => {
    await lockOpenJob(tx, access.job.id);
    const approved = await maybeOne<ChangeOrder>(
      tx,
      `UPDATE change_orders SET approved_at = clock_timestamp() WHERE id = $1 AND approved_at IS NULL RETURNING ${ORDER_COLUMNS}`,
      [orderId],
    );
    if (!approved) fail("invalid_transition");
    touch(tx, access.job.id);
    return approved;
  });
  return json(200, order);
});
