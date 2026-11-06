// The HTTP API: every published route under one error shape and precedence.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, newSessionToken } from "./db.js";
import type { Config } from "./config.js";
import { Storage } from "./storage.js";
import { KillBill } from "./killbill.js";
import type { Outbound } from "./outbound.js";
import { Mailer } from "./mailer.js";
import { ApiError } from "./jobs.js";
import { submitJob, cancelJob, jobRowFrom, type Deps as JobDeps, type SubmitRequest } from "./jobs.js";
import {
  resolveAccess, rateAt, balances, periodFor, periodSpend, meterFor, projectJob,
  payloadVisibleTo, catalogue, modelDef, type MemberRow, type Role, type Context, type JobRow,
} from "./domain.js";
import {
  uploadAsset, readAsset, projectAsset, projectAssetRestrictedUpload, deleteAsset,
  lineage, searchAssets, fetchImageAsAsset, canReadAsset, assetRow, type AssetDeps,
} from "./assets.js";
import { addEndpoint, deliverPending, enableEndpoint, endpointRow, onJobFinal, type EndpointRow } from "./webhooks.js";
import { createTopUp, retryPendingTopUps, topupRow, validateCredits, type TopUpDeps, type TopUpRow } from "./topups.js";
import { getPolicy, savePolicy } from "./policy.js";
import { resolveLocal, formatCredits, formatWholeCredits, formatLongDate, unitString } from "../shared/index.js";
import { scryptSync, timingSafeEqual } from "node:crypto";

export const JSON_BODY_LIMIT = 65_536;
export const SESSION_COOKIE = "dispatch_session";

export interface AppState {
  pool: Pool;
  cfg: Config;
  storage: Storage;
  killbill: KillBill;
  outbound: Outbound;
  mailer: Mailer;
  storageState: { up: boolean; checkedAt: Date };
  billingState: { up: boolean; checkedAt: Date };
  recentReplays: Map<string, { job_id: string; at: Date }[]>;
}

export function createState(pool: Pool, cfg: Config, storage: Storage, killbill: KillBill, outbound: Outbound, mailer: Mailer): AppState {
  return {
    pool, cfg, storage, killbill, outbound, mailer,
    storageState: { up: true, checkedAt: new Date(0) },
    billingState: { up: true, checkedAt: new Date(0) },
    recentReplays: new Map(),
  };
}

export function jobDeps(state: AppState): JobDeps {
  return {
    resolveAccess: (teamId, slug, context) => resolveAccess(state.pool, teamId, slug, context),
    rateAt: (slug, at) => rateAt(state.pool, slug, at),
    availableMicro: async (teamId) => (await balances(state.pool, teamId)).available,
    periodFor: (teamId) => periodFor(state.pool, teamId),
    periodSpend: async (teamId, period) => ({ spendMicro: (await periodSpend(state.pool, teamId, period)).spendMicro }),
    storageUp: () => Promise.resolve(state.storageState.up),
    checkAddress: async (url) => {
      try {
        await state.outbound.checkAddress(url);
        return true;
      } catch {
        return false;
      }
    },
    fetchImage: (url, teamId, uploader) =>
      fetchImageAsAsset(state.pool, state.cfg, assetDeps(state), url, teamId, uploader),
    visibleAsset: async (assetId, caller) => {
      const row = await state.pool.one<Record<string, unknown>>(`SELECT * FROM assets WHERE id = $1`, [assetId]);
      if (!row) return null;
      const asset = assetRow(row);
      const readable = await canReadAsset(state.pool, asset, caller);
      return readable ? asset : null;
    },
    onHardCapRefusal: (teamId, period) => onHardCapRefusal(state, teamId, period),
  };
}

export function assetDeps(state: AppState): AssetDeps {
  return {
    storage: state.storage,
    outbound: state.outbound,
    storageUp: () => Promise.resolve(state.storageState.up),
  };
}

export function topupDeps(state: AppState): TopUpDeps {
  return {
    killbill: state.killbill,
    billingUp: () => Promise.resolve(state.billingState.up),
    onPaid: async (topup) => {
      const row = await state.pool.one<{ team_name: string; email: string }>(
        `SELECT tm.name AS team_name, mem.email FROM topups t JOIN teams tm ON tm.id = t.team_id JOIN members mem ON mem.id = t.created_by WHERE t.id = $1`,
        [topup.id],
      );
      if (row) {
        state.mailer.send(
          row.email,
          `Top-up receipt: ${formatWholeCredits(topup.credits)} credits for ${row.team_name}`,
          `Your top-up of ${formatWholeCredits(topup.credits)} credits for ${row.team_name} is paid.\n\nAmount: ${topup.amount_usd} USD\nKill Bill invoice: ${topup.kb_invoice_id ?? ""}\n`,
        );
      }
    },
  };
}

/** The once-per-period hard cap email. */
export async function onHardCapRefusal(state: AppState, teamId: string, period: { startsAt: Date; endsAt: Date; label: string }): Promise<void> {
  const existing = await state.pool.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM budget_notices WHERE team_id = $1 AND kind = 'hard' AND period_start = $2`,
    [teamId, period.startsAt],
  );
  if ((existing?.n ?? 0) > 0) return;
  await state.pool.exec(
    `INSERT INTO budget_notices (team_id, kind, period_start) VALUES ($1,'hard',$2) ON CONFLICT DO NOTHING`,
    [teamId, period.startsAt],
  );
  const team = await state.pool.one<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [teamId]);
  const org = await state.pool.one<{ timezone: string }>(`SELECT timezone FROM orgs WHERE id = 'org'`);
  const endDate = formatLongDate(period.endsAt, org?.timezone ?? "UTC");
  const recipients = await state.pool.many<{ email: string }>(
    `SELECT email FROM members WHERE role IN ('admin','finance') OR (role = 'member' AND team_id = $1)`,
    [teamId],
  );
  for (const r of recipients) {
    state.mailer.send(
      r.email,
      `Hard cap reached: ${team?.name ?? teamId}, ${period.label}`,
      `${team?.name ?? teamId} reached its hard cap for ${period.label}. New jobs are throttled until ${endDate}.\n`,
    );
  }
}

/** The once-per-period soft cap email, sent when spend first reaches the soft cap. */
export async function maybeSoftCapEmail(state: AppState, teamId: string): Promise<void> {
  const period = await periodFor(state.pool, teamId);
  const spend = await periodSpend(state.pool, teamId, period);
  if (spend.spendMicro < period.softCapMicro) return;
  const existing = await state.pool.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM budget_notices WHERE team_id = $1 AND kind = 'soft' AND period_start = $2`,
    [teamId, period.startsAt],
  );
  if ((existing?.n ?? 0) > 0) return;
  await state.pool.exec(
    `INSERT INTO budget_notices (team_id, kind, period_start) VALUES ($1,'soft',$2) ON CONFLICT DO NOTHING`,
    [teamId, period.startsAt],
  );
  const team = await state.pool.one<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [teamId]);
  const recipients = await state.pool.many<{ email: string }>(
    `SELECT email FROM members WHERE role IN ('admin','finance')`,
  );
  for (const r of recipients) {
    state.mailer.send(
      r.email,
      `Soft cap passed: ${team?.name ?? teamId}, ${period.label}`,
      `${team?.name ?? teamId} passed its soft cap for ${period.label}.\n\nPeriod spend: ${formatCredits(spend.spendMicro)} credits\nSoft cap: ${formatCredits(period.softCapMicro)} credits\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Request plumbing

export interface Auth {
  member: MemberRow;
  context: Context;
}

export function json(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

export function errorBody(e: ApiError): Record<string, unknown> {
  const err: Record<string, unknown> = { code: e.code, message: e.message };
  if (e.fields && Object.keys(e.fields).length > 0) err.fields = e.fields;
  const out: Record<string, unknown> = { error: err };
  if (e.extra) Object.assign(out, e.extra);
  return out;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (c: Buffer) => {
      size += c.byteLength;
      if (size > limit) {
        if (!settled) {
          settled = true;
          reject(new ApiError(413, "payload_too_large", "That request body is too large."));
        }
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", () => {
      if (!settled) {
        settled = true;
        reject(new ApiError(400, "malformed_json", "That request body could not be read."));
      }
    });
  });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Send the request as application/json.");
  }
  const raw = await readBody(req, JSON_BODY_LIMIT);
  if (raw.byteLength === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, "malformed_json", "That request body is not valid JSON.");
  }
}

export async function authenticate(state: AppState, req: IncomingMessage): Promise<Auth | null> {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const key = auth.slice("Bearer ".length).trim();
    const row = await state.pool.one<MemberRow>(
      `SELECT id, name, email, role, team_id FROM members WHERE api_key = $1`,
      [key],
    );
    if (!row) throw new ApiError(401, "unauthenticated", "That API key is not valid.");
    return { member: row, context: "api" };
  }
  const cookies = parseCookies(req.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const row = await state.pool.one<MemberRow>(
      `SELECT m.id, m.name, m.email, m.role, m.team_id FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`,
      [token],
    );
    if (row) return { member: row, context: "playground" };
  }
  return null;
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Cross-origin cookie writes are refused. */
export function checkSameOrigin(req: IncomingMessage, publicUrl: string, method: string): void {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.origin;
  if (!origin) return;
  const own = new URL(publicUrl).origin;
  if (origin !== own) {
    throw new ApiError(403, "cross_origin", "Cross-origin writes are not allowed.");
  }
}

export function requireRole(auth: Auth, roles: Role[]): void {
  if (!roles.includes(auth.member.role)) {
    throw new ApiError(403, "forbidden", "Your role may not do that.");
  }
}

/** Members act on their own team; org roles pass a team query. */
export function targetTeam(auth: Auth, query: URLSearchParams): string {
  if (auth.member.role === "member") {
    const team = auth.member.team_id;
    if (!team) throw new ApiError(403, "forbidden", "Your role may not do that.");
    return team;
  }
  const team = query.get("team") ?? "";
  if (!team) throw new ApiError(404, "not_found", "Choose a team.");
  return team;
}

function memberProjection(member: MemberRow): Record<string, unknown> {
  return { id: member.id, name: member.name, email: member.email, role: member.role, team_id: member.team_id };
}

async function memberName(state: AppState, id: string): Promise<string> {
  if (id === "seed") return "Seed";
  const row = await state.pool.one<{ name: string }>(`SELECT name FROM members WHERE id = $1`, [id]);
  return row?.name ?? id;
}

async function checkPasscode(state: AppState, email: string, passcode: string): Promise<MemberRow | null> {
  const row = await state.pool.one<{ id: string; name: string; email: string; role: Role; team_id: string | null; passcode_hash: string }>(
    `SELECT id, name, email, role, team_id, passcode_hash FROM members WHERE email = $1`,
    [email],
  );
  if (!row) return null;
  const [scheme, salt, hash] = row.passcode_hash.split(":");
  if (scheme !== "scrypt") return null;
  const given = scryptSync(passcode, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, team_id: row.team_id };
}

function recordReplay(state: AppState, teamId: string, jobId: string): void {
  const list = state.recentReplays.get(teamId) ?? [];
  list.push({ job_id: jobId, at: new Date() });
  state.recentReplays.set(teamId, list);
}

function recentReplays(state: AppState, teamId: string): { job_id: string; at: Date }[] {
  const cutoff = Date.now() - 10_000;
  const list = (state.recentReplays.get(teamId) ?? []).filter((r) => r.at.getTime() >= cutoff);
  state.recentReplays.set(teamId, list);
  return list;
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function rateEffectiveAt(state: AppState, rateId: string): Promise<Date> {
  const row = await state.pool.one<{ effective_at: Date }>(`SELECT effective_at FROM rates WHERE id = $1`, [rateId]);
  return row?.effective_at ?? new Date(0);
}

// ---------------------------------------------------------------------------
// The API dispatcher

export async function handleApi(
  state: AppState,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  query: URLSearchParams,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const parts = pathname.split("/").filter((p) => p.length > 0);

  try {
    // Health answers whenever the process is up, whatever the dependencies.
    if (method === "GET" && pathname === "/api/health") {
      json(res, 200, { status: "ok" });
      return true;
    }

    // Cross-origin cookie writes are refused before anything else.
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      checkSameOrigin(req, state.cfg.publicUrl, method);
    }

    if (method === "POST" && pathname === "/api/session") {
      const body = (await readJson(req)) as { email?: unknown; passcode?: unknown };
      const email = typeof body.email === "string" ? body.email : "";
      const passcode = typeof body.passcode === "string" ? body.passcode : "";
      const member = await checkPasscode(state, email, passcode);
      if (!member) throw new ApiError(401, "unauthenticated", "That email and passcode do not match.");
      const token = newSessionToken();
      await state.pool.exec(`INSERT INTO sessions (token, member_id) VALUES ($1,$2)`, [token, member.id]);
      json(res, 200, { member: memberProjection(member) }, {
        "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
      return true;
    }

    // Everything below requires authentication.
    const auth = await authenticate(state, req);
    if (!auth) throw new ApiError(401, "unauthenticated", "Sign in first.");
    const member = auth.member;

    if (method === "DELETE" && pathname === "/api/session") {
      const cookies = parseCookies(req.headers.cookie ?? "");
      const token = cookies[SESSION_COOKIE];
      if (token) await state.pool.exec(`DELETE FROM sessions WHERE token = $1`, [token]);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (method === "GET" && pathname === "/api/me") {
      json(res, 200, { member: memberProjection(member) });
      return true;
    }

    if (method === "GET" && pathname === "/api/system") {
      const checkedAt = state.storageState.checkedAt > state.billingState.checkedAt
        ? state.storageState.checkedAt
        : state.billingState.checkedAt;
      json(res, 200, {
        storage: state.storageState.up ? "up" : "down",
        billing: state.billingState.up ? "up" : "down",
        checked_at: iso(checkedAt),
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/teams") {
      const teams = member.role === "member"
        ? await state.pool.many(`SELECT id, name FROM teams WHERE id = $1`, [member.team_id])
        : await state.pool.many(`SELECT id, name FROM teams ORDER BY id`);
      json(res, 200, { teams });
      return true;
    }

    if (method === "GET" && pathname === "/api/models") {
      const models = [];
      for (const def of catalogue()) {
        const current = await rateAt(state.pool, def.slug, new Date());
        const effective = await rateEffectiveAt(state, current.id);
        const access = member.role === "member"
          ? {
              api: await resolveAccess(state.pool, member.team_id, def.slug, "api"),
              playground: await resolveAccess(state.pool, member.team_id, def.slug, "playground"),
            }
          : null;
        models.push({
          slug: def.slug,
          name: def.name,
          modality: def.modality,
          unit: def.unit,
          unit_label: def.unit_label,
          input_schema: def.fields,
          current_rate: { id: current.id, micro_per_unit: current.micro_per_unit, effective_at: iso(effective) },
          access,
        });
      }
      json(res, 200, { models });
      return true;
    }

    if (parts.length === 3 && parts[1] === "models" && method === "GET") {
      const def = catalogue().find((m) => m.slug === parts[2]);
      if (!def) throw new ApiError(404, "not_found", "That model does not exist.");
      const current = await rateAt(state.pool, def.slug, new Date());
      const effective = await rateEffectiveAt(state, current.id);
      const access = member.role === "member"
        ? {
            api: await resolveAccess(state.pool, member.team_id, def.slug, "api"),
            playground: await resolveAccess(state.pool, member.team_id, def.slug, "playground"),
          }
        : null;
      json(res, 200, {
        model: {
          slug: def.slug,
          name: def.name,
          modality: def.modality,
          unit: def.unit,
          unit_label: def.unit_label,
          input_schema: def.fields,
          current_rate: { id: current.id, micro_per_unit: current.micro_per_unit, effective_at: iso(effective) },
          access,
        },
      });
      return true;
    }

    if (parts.length === 4 && parts[1] === "models" && parts[3] === "rates" && method === "GET") {
      const def = catalogue().find((m) => m.slug === parts[2]);
      if (!def) throw new ApiError(404, "not_found", "That model does not exist.");
      const rows = await state.pool.many<{ id: string; micro_per_unit: bigint; effective_at: Date; effective_at_local: string; created_by: string }>(
        `SELECT id, micro_per_unit, effective_at, effective_at_local, created_by FROM rates WHERE model_slug = $1 ORDER BY effective_at ASC, id ASC`,
        [def.slug],
      );
      const now = new Date();
      const current = await rateAt(state.pool, def.slug, now);
      json(res, 200, {
        rates: await Promise.all(rows.map(async (r) => ({
          id: r.id,
          micro_per_unit: Number(r.micro_per_unit),
          effective_at: iso(r.effective_at),
          effective_at_local: r.effective_at_local,
          status: r.effective_at > now ? "scheduled" : r.id === current.id ? "current" : "past",
          created_by: { id: r.created_by, name: await memberName(state, r.created_by) },
        })))
      });
      return true;
    }

    if (parts.length === 4 && parts[1] === "models" && parts[3] === "rates" && method === "POST") {
      requireRole(auth, ["finance"]);
      const def = catalogue().find((m) => m.slug === parts[2]);
      if (!def) throw new ApiError(404, "not_found", "That model does not exist.");
      const body = (await readJson(req)) as { micro_per_unit?: unknown; effective_at_local?: unknown };
      const fields: Record<string, string> = {};
      const micro = body.micro_per_unit;
      if (typeof micro !== "number" || !Number.isInteger(micro) || micro < 1 || micro > 1_000_000_000_000) {
        fields.micro_per_unit = "Enter a rate from 0.000001 to 1000000 credits per unit.";
      }
      const local = body.effective_at_local;
      if (typeof local !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) {
        fields.effective_at_local = "Use the format YYYY-MM-DDTHH:MM:SS.";
      }
      const org = await state.pool.one<{ timezone: string }>(`SELECT timezone FROM orgs WHERE id = 'org'`);
      const zone = org?.timezone ?? "UTC";
      let instant: Date | null = null;
      if (!fields.effective_at_local) {
        instant = resolveLocal(local as string, zone);
        if (!instant) {
          fields.effective_at_local = `That time does not exist in ${zone} because clocks move forward.`;
        } else if (instant.getTime() <= Date.now()) {
          fields.effective_at_local = "Choose a moment in the future.";
        }
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", fields);
      }
      const seq = await state.pool.one<{ nextval: number }>(`SELECT nextval('rate_seq')`);
      const id = `r_${seq?.nextval}`;
      await state.pool.exec(
        `INSERT INTO rates (id, model_slug, micro_per_unit, effective_at, effective_at_local, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, def.slug, micro, instant, local, member.id],
      );
      json(res, 201, {
        rate: {
          id,
          micro_per_unit: micro,
          effective_at: iso(instant as Date),
          effective_at_local: local,
          status: "scheduled",
          created_by: { id: member.id, name: member.name },
        },
      });
      return true;
    }

    if (parts.length === 5 && parts[1] === "models" && parts[3] === "rates" && method === "DELETE") {
      requireRole(auth, ["finance"]);
      const def = catalogue().find((m) => m.slug === parts[2]);
      if (!def) throw new ApiError(404, "not_found", "That model does not exist.");
      const row = await state.pool.one<{ id: string; effective_at: Date }>(
        `SELECT id, effective_at FROM rates WHERE id = $1 AND model_slug = $2`,
        [parts[4], def.slug],
      );
      if (!row) throw new ApiError(404, "not_found", "That rate does not exist.");
      if (row.effective_at.getTime() <= Date.now()) {
        throw new ApiError(409, "rate_already_effective", "That rate is already in effect and cannot be withdrawn.");
      }
      await state.pool.exec(`DELETE FROM rates WHERE id = $1`, [row.id]);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (method === "POST" && pathname === "/api/jobs") {
      requireRole(auth, ["member"]);
      const teamId = member.team_id;
      if (!teamId) throw new ApiError(403, "forbidden", "Your role may not do that.");
      const rawKey = req.headers["idempotency-key"];
      let key: string | null = null;
      if (Array.isArray(rawKey)) key = rawKey[0] ?? null;
      else if (rawKey !== undefined) key = rawKey;
      if (key !== null && !/^[ -~]{1,255}$/.test(key)) {
        throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key of 1 to 255 visible characters.");
      }
      if (auth.context === "api" && (key === null || key === "")) {
        throw new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key with every API job submission.");
      }
      if (key === "") key = null;
      const body = (await readJson(req)) as { model?: unknown; input?: unknown; priority?: unknown };
      if (typeof body.model !== "string") {
        throw new ApiError(404, "not_found", "That model does not exist.");
      }
      const input = body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : {};
      const priority = body.priority === "high" || body.priority === "low" ? body.priority : "normal";
      const submit: SubmitRequest = {
        teamId, submitter: member, model: body.model, input,
        priority, idempotencyKey: key, context: auth.context,
      };
      const outcome = await submitJob(state.pool, submit, jobDeps(state));
      if (outcome.replayed) {
        recordReplay(state, teamId, outcome.jobId);
        json(res, 201, outcome.responseBody, { "Idempotent-Replayed": "true" });
      } else {
        json(res, 201, outcome.responseBody);
      }
      await maybeSoftCapEmail(state, teamId);
      return true;
    }

    if (method === "GET" && pathname === "/api/jobs") {
      const teamId = jobsTeamFor(auth, query);
      const status = query.get("status");
      const limitRaw = Number(query.get("limit") ?? 50);
      const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 50;
      const cursor = query.get("cursor");
      const page = await listJobs(state, member, teamId, status, limit, cursor);
      json(res, 200, { jobs: page.jobs, next_cursor: page.nextCursor });
      return true;
    }

    if (method === "GET" && pathname === "/api/jobs.csv") {
      const teamId = jobsTeamFor(auth, query);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      res.end(await jobsCsv(state, member, teamId));
      return true;
    }

    if (parts.length === 3 && parts[1] === "jobs" && method === "GET") {
      const job = await jobForCaller(state, member, parts[2]);
      json(res, 200, { job });
      return true;
    }

    if (parts.length === 4 && parts[1] === "jobs" && parts[3] === "cancel" && method === "POST") {
      const job = await jobRowForCaller(state, member, parts[2]);
      if (member.role === "member" && member.team_id !== job.team_id) {
        throw new ApiError(404, "not_found", "That job does not exist.");
      }
      if (member.role !== "member" && member.role !== "admin") {
        throw new ApiError(403, "forbidden", "Your role may not do that.");
      }
      const result = await cancelJob(state.pool, parts[2]);
      if (!result.alreadyCancelled) await onJobFinal(state.pool, parts[2]);
      const projection = await projectJobFor(state, member, result.job);
      json(res, 200, { job: projection });
      return true;
    }

    if (method === "GET" && pathname === "/api/queue") {
      const teamId = targetTeam(auth, query);
      const lanes = [];
      const allQueued = await queueJobs(state, member, teamId, null, ["queued"]);
      const positions = new Map<string, number>(allQueued.map((q) => [q.id as string, q.queue_position as number]));
      for (const def of catalogue()) {
        const queued = allQueued.filter((q) => q.model === def.slug);
        const running = await queueJobs(state, member, teamId, def.slug, ["leased", "running"]);
        lanes.push({ model: def.slug, queued, running });
      }
      void positions;
      json(res, 200, { lanes });
      return true;
    }

    if (method === "POST" && pathname === "/api/uploads") {
      requireRole(auth, ["member"]);
      const teamId = member.team_id;
      if (!teamId) throw new ApiError(403, "forbidden", "Your role may not do that.");
      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
        throw new ApiError(415, "unsupported_media_type", "Use a PNG, JPEG or WebP image.");
      }
      const body = await readBody(req, 10_000_000);
      const asset = await uploadAsset(state.pool, state.cfg, assetDeps(state), teamId, member, body, contentType);
      json(res, 201, { asset: await projectAsset(state.pool, assetDeps(state), asset, member) });
      return true;
    }

    if (method === "GET" && pathname === "/api/assets") {
      const rows = await searchAssets(state.pool, member, {
        q: query.get("q") ?? undefined,
        kind: query.get("kind") ?? undefined,
        model: query.get("model") ?? undefined,
        team: query.get("team") ?? undefined,
      });
      const assets = [];
      for (const asset of rows) {
        assets.push(await projectAssetRestrictedUpload(state.pool, assetDeps(state), asset, member));
      }
      json(res, 200, { assets });
      return true;
    }

    if (parts.length === 3 && parts[1] === "assets" && method === "GET") {
      const asset = await readAsset(state.pool, parts[2], member);
      const projected = await projectAssetRestrictedUpload(state.pool, assetDeps(state), asset, member);
      json(res, 200, { asset: projected });
      return true;
    }

    if (parts.length === 3 && parts[1] === "assets" && method === "DELETE") {
      const asset = await readAsset(state.pool, parts[2], member);
      requireRole(auth, ["compliance", "admin"]);
      await deleteAsset(state.pool, assetDeps(state), parts[2], member);
      void asset;
      res.writeHead(204);
      res.end();
      return true;
    }

    if (parts.length === 4 && parts[1] === "assets" && parts[3] === "lineage" && method === "GET") {
      const out = await lineage(state.pool, assetDeps(state), parts[2], member);
      json(res, 200, out);
      return true;
    }

    if (parts.length === 4 && parts[1] === "teams" && parts[3] === "meter" && method === "GET") {
      const teamId = await meterTeamFor(state, member, parts[2]);
      json(res, 200, await meterFor(state.pool, teamId, recentReplays(state, teamId)));
      return true;
    }

    if (parts.length === 4 && parts[1] === "teams" && parts[3] === "ledger" && method === "GET") {
      requireRole(auth, ["finance", "admin"]);
      const teamId = parts[2];
      const team = await state.pool.one(`SELECT id FROM teams WHERE id = $1`, [teamId]);
      if (!team) throw new ApiError(404, "not_found", "That team does not exist.");
      json(res, 200, await ledgerJson(state, teamId));
      return true;
    }

    if (parts.length === 4 && parts[1] === "teams" && parts[3] === "ledger.csv" && method === "GET") {
      requireRole(auth, ["finance", "admin"]);
      const teamId = parts[2];
      const team = await state.pool.one(`SELECT id FROM teams WHERE id = $1`, [teamId]);
      if (!team) throw new ApiError(404, "not_found", "That team does not exist.");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
      res.end(await ledgerCsv(state, teamId));
      return true;
    }

    if (method === "POST" && pathname === "/api/topups") {
      requireRole(auth, ["finance"]);
      const body = (await readJson(req)) as { team_id?: unknown; credits?: unknown };
      const teamId = typeof body.team_id === "string" ? body.team_id : "";
      const team = teamId ? await state.pool.one(`SELECT id FROM teams WHERE id = $1`, [teamId]) : null;
      if (!team) throw new ApiError(404, "not_found", "That team does not exist.");
      const credits = validateCredits(body.credits);
      const outcome = await createTopUp(state.pool, topupDeps(state), teamId, credits, member);
      if (outcome.topup.status === "failed") {
        json(res, 502, { error: { code: "billing_rejected", message: "Billing declined the top-up; no credits were added." } });
      } else if (outcome.status === 202) {
        json(res, 202, { topup: topupProjection(outcome.topup) });
      } else {
        json(res, 201, { topup: topupProjection(outcome.topup) });
      }
      return true;
    }

    if (method === "GET" && pathname === "/api/topups") {
      requireRole(auth, ["finance", "admin"]);
      const team = query.get("team");
      const rows = team
        ? await state.pool.many(`SELECT * FROM topups WHERE team_id = $1 ORDER BY created_at DESC, id DESC`, [team])
        : await state.pool.many(`SELECT * FROM topups ORDER BY created_at DESC, id DESC`);
      json(res, 200, { topups: rows.map((r) => topupProjection(topupRow(r))) });
      return true;
    }

    if (method === "GET" && pathname === "/api/policy") {
      requireRole(auth, ["admin", "finance"]);
      json(res, 200, { policy: await getPolicy(state.pool) });
      return true;
    }

    if (method === "PUT" && pathname === "/api/policy") {
      requireRole(auth, ["admin"]);
      const body = await readJson(req);
      const saved = await savePolicy(state.pool, body, member, { onSaved: async () => undefined });
      json(res, 200, { policy: saved });
      return true;
    }

    if (method === "GET" && pathname === "/api/policy/versions") {
      requireRole(auth, ["admin", "finance"]);
      const rows = await state.pool.many<{ version: number; saved_by: string; saved_at: Date }>(
        `SELECT version, saved_by, saved_at FROM policy_versions ORDER BY version DESC`,
      );
      json(res, 200, {
        versions: await Promise.all(rows.map(async (r) => ({
          version: r.version,
          saved_by: { id: r.saved_by, name: await memberName(state, r.saved_by) },
          saved_at: iso(r.saved_at),
        }))),
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/webhook-endpoints") {
      requireRole(auth, ["member"]);
      const teamId = member.team_id;
      if (!teamId) throw new ApiError(403, "forbidden", "Your role may not do that.");
      const body = (await readJson(req)) as { url?: unknown };
      if (typeof body.url !== "string" || body.url === "") {
        throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", { url: "Enter the endpoint URL." });
      }
      const added = await addEndpoint(state.pool, state.outbound, teamId, body.url, member);
      json(res, 201, {
        endpoint: {
          id: added.endpoint.id,
          team_id: added.endpoint.team_id,
          url: added.endpoint.url,
          state: added.endpoint.state,
          consecutive_failures: added.endpoint.consecutive_failures,
          created_by: { id: member.id, name: member.name },
          created_at: iso(added.endpoint.created_at),
          secret: added.secret,
        },
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/webhook-endpoints") {
      if (member.role === "member") {
        const teamId = member.team_id;
        if (!teamId) throw new ApiError(403, "forbidden", "Your role may not do that.");
        const rows = await state.pool.many(`SELECT * FROM webhook_endpoints WHERE team_id = $1 ORDER BY created_at`, [teamId]);
        json(res, 200, {
          endpoints: await Promise.all(rows.map(async (r) => endpointProjection(endpointRow(r), await memberName(state, endpointRow(r).created_by)))),
        });
        return true;
      }
      requireRole(auth, ["admin"]);
      const team = query.get("team");
      const rows = team
        ? await state.pool.many(`SELECT * FROM webhook_endpoints WHERE team_id = $1 ORDER BY created_at`, [team])
        : await state.pool.many(`SELECT * FROM webhook_endpoints ORDER BY created_at`);
      json(res, 200, {
        endpoints: await Promise.all(rows.map(async (r) => endpointProjection(endpointRow(r), await memberName(state, endpointRow(r).created_by)))),
      });
      return true;
    }

    if (parts.length === 4 && parts[1] === "webhook-endpoints" && parts[3] === "enable" && method === "POST") {
      requireRole(auth, ["admin"]);
      const endpoint = await enableEndpoint(state.pool, parts[2]);
      json(res, 200, { endpoint: endpointProjection(endpoint, await memberName(state, endpoint.created_by)) });
      return true;
    }

    if (parts.length === 3 && parts[1] === "webhook-endpoints" && method === "DELETE") {
      const row = await state.pool.one<Record<string, unknown>>(`SELECT * FROM webhook_endpoints WHERE id = $1`, [parts[2]]);
      if (!row) throw new ApiError(404, "not_found", "That endpoint does not exist.");
      const endpoint = endpointRow(row);
      if (member.role === "member") {
        if (member.team_id !== endpoint.team_id) throw new ApiError(404, "not_found", "That endpoint does not exist.");
      } else {
        requireRole(auth, ["admin"]);
      }
      await state.pool.exec(`DELETE FROM webhook_endpoints WHERE id = $1`, [parts[2]]);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (parts.length === 4 && parts[1] === "webhook-endpoints" && parts[3] === "deliveries" && method === "GET") {
      const row = await state.pool.one<Record<string, unknown>>(`SELECT * FROM webhook_endpoints WHERE id = $1`, [parts[2]]);
      if (!row) throw new ApiError(404, "not_found", "That endpoint does not exist.");
      const endpoint = endpointRow(row);
      if (member.role === "member") {
        if (member.team_id !== endpoint.team_id) throw new ApiError(404, "not_found", "That endpoint does not exist.");
      } else {
        requireRole(auth, ["admin"]);
      }
      const deliveries = await state.pool.many<Record<string, unknown>>(
        `SELECT d.*, e.job_id AS evt_job_id, e.event_type AS evt_type FROM webhook_deliveries d
         JOIN webhook_events e ON e.id = d.event_id
         WHERE d.endpoint_id = $1 ORDER BY d.attempted_at DESC, d.id DESC`,
        [parts[2]],
      );
      json(res, 200, {
        deliveries: deliveries.map((d) => ({
          event_id: d.event_id,
          event_type: d.evt_type,
          job_id: d.evt_job_id,
          attempt: Number(d.attempt),
          attempted_at: iso(d.attempted_at as Date),
          status_code: d.status_code === null ? null : Number(d.status_code),
          outcome: d.outcome,
          next_attempt_at: d.next_attempt_at === null ? null : iso(d.next_attempt_at as Date),
        })),
      });
      return true;
    }

    return false;
  } catch (e) {
    if (e instanceof ApiError) {
      json(res, e.status, errorBody(e));
      return true;
    }
    json(res, 500, { error: { code: "internal_error", message: "Something went wrong." } });
    return true;
  }
}

function jobsTeamFor(auth: Auth, query: URLSearchParams): string {
  if (auth.member.role === "member") {
    const team = auth.member.team_id;
    if (!team) throw new ApiError(403, "forbidden", "Your role may not do that.");
    return team;
  }
  const team = query.get("team") ?? "";
  if (!team) throw new ApiError(404, "not_found", "Choose a team.");
  return team;
}

async function meterTeamFor(state: AppState, member: MemberRow, teamId: string): Promise<string> {
  if (member.role === "member") {
    if (member.team_id !== teamId) throw new ApiError(404, "not_found", "That team does not exist.");
    return teamId;
  }
  const team = await state.pool.one(`SELECT id FROM teams WHERE id = $1`, [teamId]);
  if (!team) throw new ApiError(404, "not_found", "That team does not exist.");
  return teamId;
}

async function jobRowForCaller(state: AppState, member: MemberRow, jobId: string): Promise<JobRow> {
  const row = await state.pool.one<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
     JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id WHERE j.id = $1`,
    [jobId],
  );
  if (!row) throw new ApiError(404, "not_found", "That job does not exist.");
  const job = jobRowFrom(row);
  if (member.role === "member" && member.team_id !== job.team_id) {
    throw new ApiError(404, "not_found", "That job does not exist.");
  }
  return job;
}

async function jobForCaller(state: AppState, member: MemberRow, jobId: string): Promise<Record<string, unknown>> {
  const job = await jobRowForCaller(state, member, jobId);
  return projectJobFor(state, member, job);
}

async function projectJobFor(state: AppState, member: MemberRow, job: JobRow): Promise<Record<string, unknown>> {
  const visible = await payloadVisibleTo(state.pool, job, member);
  let queuePos: number | null = null;
  if (job.status === "queued") {
    const pos = await state.pool.one<{ pos: number }>(
      `SELECT count(*)::int + 1 AS pos FROM jobs q2 WHERE q2.team_id = $2 AND q2.status = 'queued'
       AND ((CASE q2.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END) < $3
            OR (q2.priority = $4 AND q2.submitted_at < $5)
            OR (q2.priority = $4 AND q2.submitted_at = $5 AND q2.id < $1))`,
      [job.id, job.team_id, priorityRank(job.priority), job.priority, job.submitted_at],
    );
    queuePos = pos?.pos ?? null;
  }
  const projection = projectJob(job, visible, queuePos);
  const outputs = await state.pool.many<{ asset_id: string }>(`SELECT asset_id FROM job_outputs WHERE job_id = $1 ORDER BY n`, [job.id]);
  projection.outputs = outputs.map((o) => o.asset_id);
  return projection;
}

function priorityRank(priority: string): number {
  switch (priority) {
    case "high": return 0;
    case "normal": return 1;
    default: return 2;
  }
}

async function listJobs(
  state: AppState,
  member: MemberRow,
  teamId: string,
  status: string | null,
  limit: number,
  cursor: string | null,
): Promise<{ jobs: Record<string, unknown>[]; nextCursor: string | null }> {
  const params: unknown[] = [teamId];
  let where = `WHERE j.team_id = $1`;
  if (status) {
    params.push(status);
    where += ` AND j.status = $${params.length}`;
  }
  if (cursor) {
    const cursorRow = await state.pool.one<{ submitted_at: Date; id: string }>(
      `SELECT submitted_at, id FROM jobs WHERE id = $1`,
      [cursor],
    );
    if (cursorRow) {
      params.push(cursorRow.submitted_at, cursorRow.id);
      where += ` AND (j.submitted_at < $${params.length - 1} OR (j.submitted_at = $${params.length - 1} AND j.id < $${params.length}))`;
    }
  }
  params.push(limit + 1);
  const rows = await state.pool.many<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
     JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id
     ${where} ORDER BY j.submitted_at DESC, j.id DESC LIMIT $${params.length}`,
    params,
  );
  let nextCursor: string | null = null;
  let page = rows;
  if (rows.length > limit) {
    page = rows.slice(0, limit);
    nextCursor = (page[page.length - 1] as { id: string }).id;
  }
  const jobs = [];
  for (const row of page) {
    jobs.push(await projectJobFor(state, member, jobRowFrom(row)));
  }
  return { jobs, nextCursor };
}

async function queueJobs(state: AppState, member: MemberRow, teamId: string, slug: string | null, statuses: string[]): Promise<Record<string, unknown>[]> {
  // Dispatch order: priority, then submission time, then job number.
  const rows = await state.pool.many<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
     JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id
     WHERE j.team_id = $1 AND ($2::text IS NULL OR j.model_slug = $2) AND j.status = ANY($3)
     ORDER BY CASE j.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, j.submitted_at ASC, j.id ASC`,
    [teamId, slug, statuses],
  );
  // Positions are 1-based among the team's queued jobs in dispatch order.
  const teamPositions = new Map<string, number>();
  if (slug === null) {
    const queuedRows = await state.pool.many<{ id: string }>(
      `SELECT id FROM jobs WHERE team_id = $1 AND status = 'queued'
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, submitted_at ASC, id ASC`,
      [teamId],
    );
    queuedRows.forEach((r, i) => teamPositions.set(r.id, i + 1));
  }
  const out = [];
  for (const row of rows) {
    const job = jobRowFrom(row);
    const projection = await projectJobFor(state, member, job);
    if (job.status === "queued" && teamPositions.has(job.id)) {
      projection.queue_position = teamPositions.get(job.id) ?? null;
    }
    out.push(projection);
  }
  return out;
}

function topupProjection(t: TopUpRow): Record<string, unknown> {
  return {
    id: t.id,
    team_id: t.team_id,
    credits: t.credits,
    amount_usd: t.amount_usd,
    status: t.status,
    pending_reason: t.pending_reason,
    failure_reason: t.failure_reason,
    kb_account_id: t.kb_account_id,
    kb_invoice_id: t.kb_invoice_id,
    kb_payment_id: t.kb_payment_id,
    created_by: t.created_by,
    created_at: iso(t.created_at),
    paid_at: t.paid_at ? iso(t.paid_at) : null,
  };
}

function endpointProjection(e: EndpointRow, createdByName: string): Record<string, unknown> {
  return {
    id: e.id,
    team_id: e.team_id,
    url: e.url,
    state: e.state,
    consecutive_failures: e.consecutive_failures,
    created_by: { id: e.created_by, name: createdByName },
    created_at: iso(e.created_at),
  };
}

async function ledgerJson(state: AppState, teamId: string): Promise<Record<string, unknown>> {
  const b = await balances(state.pool, teamId);
  const movements = await state.pool.many<{ id: string; kind: string; created_at: Date; job_id: string | null; topup_id: string | null; kb_invoice_id: string | null }>(
    `SELECT id, kind, created_at, job_id, topup_id, kb_invoice_id FROM ledger_movements WHERE team_id = $1 ORDER BY created_at ASC, id ASC`,
    [teamId],
  );
  const out = [];
  for (const m of movements) {
    const entries = await state.pool.many<{ account: string; amount_micro: bigint }>(
      `SELECT account, amount_micro FROM ledger_entries WHERE movement_id = $1`,
      [m.id],
    );
    out.push({
      id: m.id,
      kind: m.kind,
      created_at: iso(m.created_at),
      job_id: m.job_id,
      topup_id: m.topup_id,
      kb_invoice_id: m.kb_invoice_id,
      entries: entries.map((e) => ({ account: e.account, amount_micro: Number(e.amount_micro) })),
    });
  }
  return {
    balances: {
      granted_micro: b.granted,
      available_micro: b.available,
      reserved_micro: b.reserved,
      settled_micro: b.settled,
    },
    movements: out,
  };
}

async function ledgerCsv(state: AppState, teamId: string): Promise<string> {
  const rows = await state.pool.many<{ id: string; kind: string; created_at: Date; job_id: string | null; topup_id: string | null; kb_invoice_id: string | null; account: string; amount_micro: bigint }>(
    `SELECT m.id, m.kind, m.created_at, m.job_id, m.topup_id, m.kb_invoice_id, e.account, e.amount_micro
     FROM ledger_movements m JOIN ledger_entries e ON e.movement_id = m.id
     WHERE m.team_id = $1 ORDER BY m.created_at ASC, m.id ASC, e.account ASC`,
    [teamId],
  );
  const lines = ["movement_id,kind,created_at,job_id,topup_id,kb_invoice_id,account,amount_micro"];
  for (const r of rows) {
    lines.push([r.id, r.kind, iso(r.created_at), r.job_id ?? "", r.topup_id ?? "", r.kb_invoice_id ?? "", r.account, String(r.amount_micro)].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

async function jobsCsv(state: AppState, member: MemberRow, teamId: string): Promise<string> {
  const rows = await state.pool.many<Record<string, unknown>>(
    `SELECT j.*, mem.name AS submitted_by_name, r.micro_per_unit::bigint AS rate_micro FROM jobs j
     JOIN members mem ON mem.id = j.submitted_by JOIN rates r ON r.id = j.rate_id
     WHERE j.team_id = $1 ORDER BY j.submitted_at DESC, j.id DESC`,
    [teamId],
  );
  const lines = ["job_id,team,model,status,submitted_by,submitted_at,finished_at,unit,billed_units,rate_micro_per_unit,charged_micro,prompt"];
  for (const row of rows) {
    const job = jobRowFrom(row);
    const visible = await payloadVisibleTo(state.pool, job, member);
    const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
    const prompt = visible ? String(input.prompt ?? input.text ?? "") : "";
    const billed = job.billed_num !== null && job.billed_den !== null ? unitString({ num: job.billed_num, den: job.billed_den }) : "";
    lines.push(
      [job.id, job.team_id, job.model_slug, job.status, job.submitted_by, iso(job.submitted_at), job.finished_at ? iso(job.finished_at) : "",
       modelDef(job.model_slug).unit, billed, job.micro_per_unit, job.charged_micro ?? "", prompt]
        .map(csvCell).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export { sweepExpiry, deliverPending, retryPendingTopUps };

import { sweepExpiry } from "./assets.js";
