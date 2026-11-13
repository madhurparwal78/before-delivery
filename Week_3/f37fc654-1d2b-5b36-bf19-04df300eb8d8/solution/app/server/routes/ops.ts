// Platform endpoints: health, service status and the producer's jobs table.
import { SERVICE_NAMES } from "../../shared/copy.js";
import { requireCaller } from "../auth.js";
import { venueById } from "../commissions.js";
import { query } from "../db.js";
import { fail, ok, UUID, type Request, type Router } from "../http.js";
import { serviceStatus } from "../providers/status.js";

async function health() {
  return ok({ status: "ok" });
}

async function status() {
  const services = await serviceStatus();
  return ok({ services: Object.fromEntries(SERVICE_NAMES.map((name) => [name, services[name]])) });
}

const JOB_STATUSES = ["pending", "running", "done", "failed"];

async function jobs(req: Request) {
  const caller = await requireCaller(req);
  if (!caller.roles.includes("producer")) fail(403, "forbidden");
  const wanted = req.url.searchParams.get("status");
  const commissionId = req.url.searchParams.get("commissionId");
  const rows = await query<{
    id: string; kind: string; commission_id: string | null; status: string; attempts: number; last_error: string | null;
    created_at: Date; finished_at: Date | null; title: string | null; venue_id: string | null;
  }>(
    `SELECT j.id, j.kind, j.commission_id, j.status, j.attempts, j.last_error, j.created_at, j.finished_at, c.title, c.venue_id
     FROM jobs j LEFT JOIN commissions c ON c.id = j.commission_id
     WHERE ($1::text IS NULL OR j.status = $1) AND ($2::uuid IS NULL OR j.commission_id = $2)
     ORDER BY j.created_at DESC LIMIT 300`,
    [wanted && JOB_STATUSES.includes(wanted) ? wanted : null, commissionId && UUID.test(commissionId) ? commissionId : null],
  );
  return ok({
    jobs: rows.map((j) => ({
      id: j.id, kind: j.kind, commissionId: j.commission_id, commissionTitle: j.title, venueName: j.venue_id ? venueById(j.venue_id)?.name ?? null : null,
      status: j.status, attempts: j.attempts, lastError: j.last_error, createdAt: j.created_at.toISOString(), finishedAt: j.finished_at ? j.finished_at.toISOString() : null,
    })),
  });
}

export function registerOps(router: Router): void {
  router.add("GET", "/api/health", health);
  router.add("GET", "/api/status", status);
  router.add("GET", "/api/jobs", jobs);
}
