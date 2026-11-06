// Cancellation policy versions (brief: Cancellation policy versions).
import type { Policy } from "../../shared/api";
import { FREE_WINDOW_MAX_HOURS } from "../../shared/kitchen";
import { kitchenIso } from "../../shared/time";
import { audit, lockFor, one, pool, rows, transaction, type Queryable } from "../db";
import { ApiError, FieldErrors } from "../errors";
import { route } from "../http";

interface PolicyRow {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: Date;
}

const policyView = (p: PolicyRow): Policy => ({
  version: p.version,
  free_window_hours: p.free_window_hours,
  late_fee_percent: p.late_fee_percent,
  effective_at: kitchenIso(p.effective_at.getTime()),
});

export async function currentPolicy(db: Queryable): Promise<PolicyRow> {
  return (await one<PolicyRow>(db, "SELECT * FROM policy_versions ORDER BY version DESC LIMIT 1")) as PolicyRow;
}

const wholeIn = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

export const policyRoutes = [
  route({
    method: "GET",
    path: "/api/cancellation-policy",
    roles: ["operator", "owner", "cook"],
    async handle() {
      const history = await rows<PolicyRow>(pool, "SELECT * FROM policy_versions ORDER BY version DESC");
      return { status: 200, json: { current: policyView(history[0]), history: history.map(policyView) } };
    },
  }),
  route({
    method: "PUT",
    path: "/api/cancellation-policy",
    roles: ["operator"],
    body: "json",
    async handle(ctx) {
      const { free_window_hours: free, late_fee_percent: late, based_on_version: basedOn } = ctx.json;
      const errors = new FieldErrors();
      if (!wholeIn(free, 0, FREE_WINDOW_MAX_HOURS)) errors.add("free_window_hours", `Enter whole hours from 0 to ${FREE_WINDOW_MAX_HOURS}.`);
      if (!wholeIn(late, 0, 100)) errors.add("late_fee_percent", "Enter a whole percent from 0 to 100.");
      if (!Number.isInteger(basedOn)) errors.add("based_on_version", "Say which version this change is based on.");
      errors.throwIfAny();
      const saved = await transaction(async (db) => {
        await lockFor(db, "cancellation-policy");
        const current = await currentPolicy(db);
        if (current.version !== basedOn) {
          throw new ApiError(412, "stale_version", `The policy changed since you opened it. Reload to see version ${current.version}.`, {
            current_version: current.version,
          });
        }
        const next = (await one<PolicyRow>(
          db,
          "INSERT INTO policy_versions (version, free_window_hours, late_fee_percent, effective_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [current.version + 1, free, late, new Date(ctx.nowMs)],
        )) as PolicyRow;
        await audit(db, ctx.user.id, "cancellation_policy", String(next.version), "saved", { free_window_hours: free, late_fee_percent: late });
        return next;
      });
      return { status: 201, json: policyView(saved) };
    },
  }),
];
