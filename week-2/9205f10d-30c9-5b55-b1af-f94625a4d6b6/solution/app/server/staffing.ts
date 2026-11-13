import type { PoolClient } from "pg";
import { many, transaction } from "./db.js";
import { openSeatEmail } from "./emails.js";
import { invalidTransition, validation } from "./errors.js";
import { type Context, type Router, ok } from "./http.js";
import { flushEmails, queueEmail } from "./mail.js";
import { projectRequest, readable } from "./projection.js";
import { type RequestRecord, addHistory, confirmedSeats, loadRequest, lockRequest } from "./requestStore.js";
import { CLAIMABLE, defaultTeamSize, eligibleSql, overlapSql } from "./rules.js";
import { noticeFullyStaffed, settleStatus } from "./seats.js";
import { Fields } from "./validate.js";

const LIVE: readonly RequestRecord["status"][] = [...CLAIMABLE, "staffed"];

/** Runs a coordinator's change on a request held locked, after the not_found and role checks. */
async function asCoordinator<T>(ctx: Context, change: (client: PoolClient, record: RequestRecord) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    const record = readable(ctx.user, await lockRequest(client, ctx.params.id ?? ""));
    ctx.allow("coordinator");
    return change(client, record);
  });
}

const TEAM_LABEL = { 1: "Solo", 2: "Team of two" } as const;

/** Raising to two opens the missing label; lowering to one removes an open seat (B when both are open). */
async function resizeTeam(client: PoolClient, record: RequestRecord, teamSize: 1 | 2): Promise<void> {
  if (teamSize === 2) {
    const missing = record.seats.some((s) => s.label === "A") ? "B" : "A";
    await client.query("INSERT INTO seats (request_id, label) VALUES ($1, $2)", [record.id, missing]);
    return;
  }
  await client.query(
    `DELETE FROM seats WHERE id = (
       SELECT id FROM seats WHERE request_id = $1 AND interpreter_id IS NULL ORDER BY label DESC LIMIT 1)`,
    [record.id],
  );
}

async function saveStaffing(ctx: Context) {
  const projected = await asCoordinator(ctx, async (client, record) => {
    if (!LIVE.includes(record.status)) throw invalidTransition("Only a submitted, half-staffed or staffed job can be restaffed.");
    const body = ctx.json();
    const fields = new Fields(body);
    let size: 1 | 2 = record.teamSize === 1 ? 1 : 2;
    if (body.team_size === 1 || body.team_size === 2) size = body.team_size;
    else if (fields.has("team_size")) fields.fail("team_size", "Choose a team of 1 or 2.");
    if (size === 1 && confirmedSeats(record).length === 2) {
      throw invalidTransition("Both seats are confirmed, so the team can't shrink to one.");
    }
    const rotation = fields.has("rotation_minutes")
      ? fields.integer("rotation_minutes", 20, 30, "Set the rotation interval from 20 to 30 minutes.")
      : undefined;
    const differsFromDefault = size !== defaultTeamSize(record.durationMinutes);
    const reason =
      differsFromDefault && (fields.has("team_size") || fields.has("team_reason"))
        ? fields.text("team_reason", 10, 500, "Give a reason of 10 to 500 characters for changing the team size.")
        : undefined;
    if (!fields.ok) throw validation(fields.errors);

    if (size !== record.teamSize) {
      await resizeTeam(client, record, size);
      const status = await settleStatus(client, record.id);
      await client.query("UPDATE requests SET team_size = $2, team_reason = $3 WHERE id = $1", [
        record.id,
        size,
        differsFromDefault ? reason : null,
      ]);
      await addHistory(client, record.id, ctx.user.displayName, "team_changed", differsFromDefault ? `${TEAM_LABEL[size]}: ${reason}` : `${TEAM_LABEL[size]} (default)`);
      if (status === "staffed" && record.status !== "staffed") {
        await noticeFullyStaffed(client, readable(ctx.user, await loadRequest(client, record.id)));
      }
    } else if (reason !== undefined && reason !== record.teamReason) {
      await client.query("UPDATE requests SET team_reason = $2 WHERE id = $1", [record.id, reason]);
      await addHistory(client, record.id, ctx.user.displayName, "team_changed", `${TEAM_LABEL[size]}: ${reason}`);
    }
    if (rotation !== undefined && rotation !== record.rotationMinutes) {
      await client.query("UPDATE requests SET rotation_minutes = $2 WHERE id = $1", [record.id, rotation]);
      await addHistory(client, record.id, ctx.user.displayName, "rotation_changed", `${record.rotationMinutes} to ${rotation} minutes`);
    }
    return projectRequest(client, ctx.user, readable(ctx.user, await loadRequest(client, record.id)));
  });
  flushEmails();
  return ok(projected);
}

async function broadcast(ctx: Context) {
  const emailed = await asCoordinator(ctx, async (client, record) => {
    if (!CLAIMABLE.includes(record.status)) throw invalidTransition("Only a job with an open seat can be broadcast.");
    ctx.json();
    const recipients = await many<{ email: string }>(
      client,
      `SELECT p.email FROM people p, requests r
       WHERE r.id = $1 AND p.role = 'interpreter' AND ${eligibleSql("p.id", "r")} AND NOT ${overlapSql("p.id", "r")}
       ORDER BY p.email`,
      [record.id],
    );
    const openSeats = record.seats.length - confirmedSeats(record).length;
    for (const { email } of recipients) await queueEmail(client, openSeatEmail(email, record, openSeats));
    await addHistory(client, record.id, ctx.user.displayName, "broadcast", `Emailed ${recipients.length} eligible interpreters`);
    return recipients.length;
  });
  flushEmails();
  return ok({ emailed });
}

async function complete(ctx: Context) {
  const projected = await asCoordinator(ctx, async (client, record) => {
    if (record.status !== "half-staffed" && record.status !== "staffed") {
      throw invalidTransition("Only a half-staffed or staffed job can be marked completed.");
    }
    const fields = new Fields(ctx.json());
    const actual = fields.integer("actual_minutes", 1, 720, "Enter the actual minutes as a whole number from 1 to 720.");
    if (actual === undefined) throw validation(fields.errors);
    await client.query("UPDATE requests SET status = 'completed', actual_minutes = $2 WHERE id = $1", [record.id, actual]);
    await addHistory(client, record.id, ctx.user.displayName, "completed", `${actual} actual minutes`);
    return projectRequest(client, ctx.user, readable(ctx.user, await loadRequest(client, record.id)));
  });
  return ok(projected);
}

export function registerStaffing(router: Router): void {
  router.on("PATCH", "/api/requests/:id/staffing", saveStaffing);
  router.on("POST", "/api/requests/:id/broadcast", broadcast);
  router.on("POST", "/api/requests/:id/complete", complete);
}
