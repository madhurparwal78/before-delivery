// The org policy: reads, numbered saves and the version list. A save based on an older version is 412.

import { allow, authenticate } from "../auth";
import { pool, rows, single, tx } from "../db";
import {
  currentPolicy, type Context, type OrgAccess, type PayloadVisibility, type Policy, type TeamAccess, type TeamPolicy,
} from "../domain/policy";
import { fail, invalid } from "../errors";
import { json, route } from "../http";
import { isTimeZone } from "../../shared/tz";
import { nudgeDispatcher } from "../workers/dispatcher";

const ORG_ACCESS: readonly OrgAccess[] = ["allowed", "blocked"];
const TEAM_ACCESS: readonly TeamAccess[] = ["allowed", "blocked", "inherit"];
const CONTEXTS: readonly Context[] = ["api", "playground"];
const RETENTION: ReadonlyArray<Policy["retention_days"]> = [7, 30, 90];
const VISIBILITY: readonly PayloadVisibility[] = ["team", "restricted"];
const CAP_MAX = 10_000_000;

type Body = Record<string, unknown>;
type Errors = Record<string, string>;
const isObject = (value: unknown): value is Body => value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = <T>(choices: readonly T[], value: unknown): T | undefined => choices.find((c) => c === value);
const whole = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

/** `{"api","playground"}` with each value one of `allowed`; records a message per bad context. */
function contexts<T extends string>(value: unknown, allowed: readonly T[], path: string, errors: Errors): Record<Context, T> {
  const given = isObject(value) ? value : {};
  const out = {} as Record<Context, T>;
  for (const context of CONTEXTS) {
    const choice = oneOf(allowed, given[context]);
    if (choice === undefined) errors[`${path}.${context}`] = `Choose ${allowed.join(", ")}.`;
    else out[context] = choice;
  }
  return out;
}

/** One `contexts` entry for every catalogue model, and no others. */
function accessMap<T extends string>(value: unknown, slugs: string[], allowed: readonly T[], path: string, errors: Errors):
Record<string, Record<Context, T>> {
  if (!isObject(value) || Object.keys(value).length !== slugs.length || !slugs.every((s) => s in value)) {
    errors[path] = "Give an api and playground setting for every catalogue model, and no others.";
    return {};
  }
  return Object.fromEntries(slugs.map((slug) => [slug, contexts(value[slug], allowed, `${path}.${slug}`, errors)]));
}

function teamSettings(team: Body, known: { id: string; name: string }, path: string, slugs: string[], errors: Errors): TeamPolicy {
  const concurrency = whole(team.concurrency, 1, 20);
  if (concurrency === undefined) errors[`${path}.concurrency`] = "Use a concurrency from 1 to 20.";
  const visibility = oneOf(VISIBILITY, team.payload_visibility);
  if (visibility === undefined) errors[`${path}.payload_visibility`] = "Choose team or restricted.";
  const soft = whole(team.soft_cap_credits, 0, CAP_MAX);
  const hard = whole(team.hard_cap_credits, 0, CAP_MAX);
  if (soft === undefined) errors[`${path}.soft_cap_credits`] = "Use whole credits from 0 to 10,000,000.";
  if (hard === undefined) errors[`${path}.hard_cap_credits`] = "Use whole credits from 0 to 10,000,000.";
  if (soft !== undefined && hard !== undefined && soft > hard) errors[`${path}.soft_cap_credits`] = "The soft cap must be at or below the hard cap.";
  return {
    id: known.id,
    name: known.name,
    concurrency: concurrency ?? 0,
    payload_visibility: visibility ?? "team",
    soft_cap_credits: soft ?? 0,
    hard_cap_credits: hard ?? 0,
    context_defaults: contexts(team.context_defaults, TEAM_ACCESS, `${path}.context_defaults`, errors),
    model_access: accessMap(team.model_access, slugs, TEAM_ACCESS, `${path}.model_access`, errors),
  };
}

/** A whole policy object as published; any message recorded makes it a 422, including unknown teams or models. */
function parsePolicy(body: unknown, teams: Array<{ id: string; name: string }>, slugs: string[]): Omit<Policy, "version"> {
  if (!isObject(body)) invalid({ policy: "Send the whole policy object." });
  const errors: Errors = {};
  const timezone = typeof body.timezone === "string" && isTimeZone(body.timezone) ? body.timezone : undefined;
  if (timezone === undefined) errors.timezone = "Choose an IANA time zone.";
  const retention = oneOf(RETENTION, body.retention_days);
  if (retention === undefined) errors.retention_days = "Choose 7, 30 or 90 days.";
  const orgAccess = accessMap(body.org_model_access, slugs, ORG_ACCESS, "org_model_access", errors);
  const given = Array.isArray(body.teams) ? body.teams.filter(isObject) : [];
  const ids = given.map((t) => t.id);
  if (!Array.isArray(body.teams) || body.teams.length !== teams.length || given.length !== teams.length
    || !teams.every((t) => ids.includes(t.id))) {
    errors.teams = "Give a settings group for every team, and no others.";
  }
  const settings = teams.map((known) => {
    const index = ids.indexOf(known.id);
    return teamSettings(index >= 0 ? given[index] : {}, known, `teams.${index}`, slugs, errors);
  });
  if (Object.keys(errors).length || timezone === undefined || retention === undefined) invalid(errors);
  return { timezone, retention_days: retention, org_model_access: orgAccess, teams: settings };
}

route("GET", "/api/policy", "none", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "admin", "finance");
  return json(200, { policy: await currentPolicy(pool) });
});

route("PUT", "/api/policy", "json", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "admin");
  const teams = await rows<{ id: string; name: string }>(pool, "SELECT id, name FROM teams ORDER BY position");
  const slugs = (await rows<{ slug: string }>(pool, "SELECT slug FROM models ORDER BY position")).map((m) => m.slug);
  const policy = parsePolicy(req.json, teams, slugs);
  const based = isObject(req.json) ? req.json.version : undefined;
  const saved = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('policy_versions'))");
    const { version } = await single<{ version: number }>(client, "SELECT max(version) AS version FROM policy_versions");
    if (based !== version) fail("policy_version_stale", { current_version: version });
    await client.query("INSERT INTO policy_versions (version, policy, saved_by, saved_at) VALUES ($1, $2, $3, now())",
      [version + 1, JSON.stringify(policy), caller.id]);
    return currentPolicy(client);
  });
  nudgeDispatcher();
  return json(200, { policy: saved });
});

route("GET", "/api/policy/versions", "none", async (req) => {
  const caller = await authenticate(req);
  allow(caller, "admin", "finance");
  const versions = await rows<{ version: number; saved_by: string | null; saver_name: string | null; saved_at: Date }>(pool,
    `SELECT v.version, v.saved_by, m.name AS saver_name, v.saved_at FROM policy_versions v
     LEFT JOIN members m ON m.id = v.saved_by ORDER BY v.version DESC`);
  return json(200, {
    versions: versions.map((v) => ({
      version: v.version,
      saved_by: v.saved_by ? { id: v.saved_by, name: v.saver_name } : null,
      saved_at: v.saved_at.toISOString(),
    })),
  });
});
