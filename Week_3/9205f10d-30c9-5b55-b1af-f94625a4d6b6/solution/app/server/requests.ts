import { AGENCY_ZONE, parseIsoDate, weekMonday } from "../shared/agencyTime.js";
import type { PoolClient } from "pg";
import type { User } from "./auth.js";
import { pool, transaction } from "./db.js";
import { type FieldErrors, invalidTransition, validation } from "./errors.js";
import { type Context, type Router, ok } from "./http.js";
import { projectRequest, projectRequests, readable } from "./projection.js";
import { type RequestRecord, addHistory, loadRequest, loadRequests, lockRequest } from "./requestStore.js";
import {
  CREDENTIAL_TYPES,
  type CredentialType,
  DEFAULT_CREDENTIAL,
  DEFAULT_ROTATION_MINUTES,
  REQUEST_STATUSES,
  SETTINGS,
  type Setting,
  defaultTeamSize,
} from "./rules.js";
import { Fields, agencyStart } from "./validate.js";

interface RequestInput {
  setting: Setting;
  startsAt: Date;
  durationMinutes: number;
  consumerName: string;
  locationAddress: string;
  city: string;
  notes: string;
  requiredCredential: CredentialType;
}

/** Validates the create fields; with `partial`, only the fields present in the body. */
function requestInput(body: Record<string, unknown>, partial: boolean): Partial<RequestInput> {
  const fields = new Fields(body);
  const wanted = (name: string) => !partial || fields.has(name);
  const input: Partial<RequestInput> = {};
  if (wanted("setting")) input.setting = fields.oneOf("setting", SETTINGS, "Choose Medical, Education or Legal.");
  if (wanted("starts_at")) input.startsAt = agencyStart(fields, "starts_at");
  if (wanted("duration_minutes")) {
    input.durationMinutes = fields.integer("duration_minutes", 30, 480, "Enter a whole number of minutes from 30 to 480.");
  }
  if (wanted("consumer_name")) {
    input.consumerName = fields.text("consumer_name", 1, 120, "Enter the Deaf consumer's name, up to 120 characters.");
  }
  if (wanted("location_address")) {
    input.locationAddress = fields.text("location_address", 1, 200, "Enter the street address, up to 200 characters.");
  }
  if (wanted("city")) input.city = fields.text("city", 1, 80, "Enter the city, up to 80 characters.");
  if (fields.value("notes") !== undefined && fields.value("notes") !== null) {
    input.notes = fields.text("notes", 0, 2000, "Keep notes to 2,000 characters or fewer.");
  }
  if (fields.value("required_credential") !== undefined && fields.value("required_credential") !== null) {
    input.requiredCredential = fields.oneOf("required_credential", CREDENTIAL_TYPES, "Choose NIC, CDI, SC:L or EIPA.");
  }
  if (!fields.ok) throw validation(fields.errors);
  return input;
}

async function list(ctx: Context) {
  ctx.allow("coordinator", "billing_admin", "client_scheduler");
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (n: string) => string, value: unknown) => {
    params.push(value);
    where.push(clause(`$${params.length}`));
  };
  if (ctx.user.role === "client_scheduler") add((n) => `r.organisation_id = ${n}`, ctx.user.organisation?.id);
  const errors: FieldErrors = {};
  const week = ctx.url.searchParams.get("week");
  if (week !== null) {
    if (parseIsoDate(week)) {
      add((n) => `(r.starts_at AT TIME ZONE '${AGENCY_ZONE}')::date BETWEEN ${n}::date AND ${n}::date + 6`, weekMonday(week));
    } else errors.week = "Give the week as YYYY-MM-DD.";
  }
  const statuses = ctx.url.searchParams.getAll("status").flatMap((s) => s.split(",")).filter(Boolean);
  if (statuses.length > 0) {
    if (statuses.every((s) => REQUEST_STATUSES.some((known) => known === s))) add((n) => `r.status = ANY(${n})`, statuses);
    else errors.status = "Use the request statuses from the API.";
  }
  const q = ctx.url.searchParams.get("q");
  if (q) {
    add(
      (n) => `(position(lower(${n}) in lower(r.reference)) > 0 OR position(lower(${n}) in lower(r.consumer_name)) > 0)`,
      q,
    );
  }
  if (Object.keys(errors).length > 0) throw validation(errors);
  const records = await loadRequests(pool, where.length ? where.join(" AND ") : "true", params);
  return ok({ requests: await projectRequests(pool, ctx.user, records) });
}

async function create(ctx: Context) {
  ctx.allow("client_scheduler");
  const input = requestInput(ctx.json(), false) as RequestInput;
  const organisation = ctx.user.organisation;
  const record = await transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO requests (reference, organisation_id, setting, required_credential, starts_at, duration_minutes,
                             consumer_name, location_address, city, notes, status)
       VALUES ('CR-' || nextval('request_reference_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
       RETURNING id`,
      [
        organisation?.id,
        input.setting,
        input.requiredCredential ?? DEFAULT_CREDENTIAL[input.setting],
        input.startsAt,
        input.durationMinutes,
        input.consumerName,
        input.locationAddress,
        input.city,
        input.notes ?? "",
      ],
    );
    const id = rows[0]?.id ?? "";
    await addHistory(client, id, ctx.user.displayName, "created");
    return loadRequest(client, id);
  });
  return ok(await projectRequest(pool, ctx.user, readable(ctx.user, record)), 201);
}

async function read(ctx: Context) {
  const record = readable(ctx.user, await loadRequest(pool, ctx.params.id ?? ""));
  return ok(await projectRequest(pool, ctx.user, record));
}

const COLUMNS: Record<keyof RequestInput, string> = {
  setting: "setting",
  startsAt: "starts_at",
  durationMinutes: "duration_minutes",
  consumerName: "consumer_name",
  locationAddress: "location_address",
  city: "city",
  notes: "notes",
  requiredCredential: "required_credential",
};

async function edit(ctx: Context) {
  return lockedDraft(ctx, async (client, id, user) => {
    const input = requestInput(ctx.json(), true);
    const entries = (Object.keys(COLUMNS) as (keyof RequestInput)[]).filter((key) => input[key] !== undefined);
    if (entries.length > 0) {
      await client.query(
        `UPDATE requests SET ${entries.map((key, i) => `${COLUMNS[key]} = $${i + 2}`).join(", ")} WHERE id = $1`,
        [id, ...entries.map((key) => input[key])],
      );
    }
    return projectRequest(client, user, readable(user, await loadRequest(client, id)));
  });
}

async function submit(ctx: Context) {
  return lockedDraft(ctx, async (client, id, user, record) => {
    ctx.json();
    if (record.startsAt.getTime() <= Date.now()) {
      throw validation({ starts_at: "This start time has passed. Edit the draft and choose a later time." });
    }
    const labels = defaultTeamSize(record.durationMinutes) === 2 ? ["A", "B"] : ["A"];
    for (const label of labels) await client.query("INSERT INTO seats (request_id, label) VALUES ($1, $2)", [id, label]);
    await client.query("UPDATE requests SET status = 'submitted', team_size = $2, rotation_minutes = $3 WHERE id = $1", [
      id,
      labels.length,
      DEFAULT_ROTATION_MINUTES,
    ]);
    await addHistory(client, id, user.displayName, "submitted", `Seat ${labels.join(" and seat ")} open`);
    return projectRequest(client, user, readable(user, await loadRequest(client, id)));
  });
}

/** Runs a client scheduler's change on one of their drafts, holding the request locked. */
async function lockedDraft(
  ctx: Context,
  change: (client: PoolClient, id: string, user: User, record: RequestRecord) => Promise<Record<string, unknown>>,
) {
  const projected = await transaction(async (client) => {
    const record = readable(ctx.user, await lockRequest(client, ctx.params.id ?? ""));
    ctx.allow("client_scheduler");
    if (record.status !== "draft") throw invalidTransition("Only a draft can be edited or submitted.");
    return change(client, record.id, ctx.user, record);
  });
  return ok(projected);
}

export function registerRequests(router: Router): void {
  router.on("GET", "/api/requests", list);
  router.on("POST", "/api/requests", create);
  router.on("GET", "/api/requests/:id", read);
  router.on("PATCH", "/api/requests/:id", edit);
  router.on("POST", "/api/requests/:id/submit", submit);
}
