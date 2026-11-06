// Org policy: get, optimistic-locked save, versions.
import type { Pool } from "./db.js";
import { ApiError } from "./jobs.js";
import { currentPolicyJson } from "./schema.js";
import type { MemberRow } from "./domain.js";

export interface PolicySaveDeps {
  onSaved(): Promise<void>;
}

interface PolicyShape {
  version: number;
  timezone: string;
  retention_days: number;
  org_model_access: Record<string, { api: string; playground: string }>;
  teams: {
    id: string;
    name: string;
    concurrency: number;
    payload_visibility: string;
    soft_cap_credits: number;
    hard_cap_credits: number;
    context_defaults: { api: string; playground: string };
    model_access: Record<string, { api: string; playground: string }>;
  }[];
}

const ZONES = supportedZones();
function supportedZones(): string[] {
  // Common IANA zones surfaced in the Admin screen's time-zone combobox.
  return [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Warsaw",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
}

export function listZones(): string[] {
  return ZONES;
}

/** Validate a policy body and apply it atomically as a new numbered version. */
export async function savePolicy(
  pool: Pool,
  policy: unknown,
  savedBy: MemberRow,
  deps: PolicySaveDeps,
): Promise<unknown> {
  const p = policy as PolicyShape;
  if (!p || typeof p !== "object" || typeof p.version !== "number" || !Array.isArray(p.teams)) {
    throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", { version: "The policy version is missing." });
  }
  const current = await pool.one<{ max: number }>(`SELECT max(version)::int AS max FROM policy_versions`);
  const currentVersion = current?.max ?? 1;
  if (p.version !== currentVersion) {
    throw new ApiError(412, "policy_version_stale", "Someone saved a newer policy. Reload to see it before saving again.", undefined, {
      current_version: currentVersion,
    });
  }
  const fields: Record<string, string> = {};
  if (typeof p.timezone !== "string" || !ZONES.includes(p.timezone)) fields.timezone = "Choose a time zone.";
  if (![7, 30, 90].includes(Number(p.retention_days))) fields.retention_days = "Choose 7, 30 or 90 days.";
  const modelSlugs = (await pool.many<{ slug: string }>(`SELECT slug FROM models`)).map((m) => m.slug);
  const teamIds = (await pool.many<{ id: string }>(`SELECT id FROM teams`)).map((t) => t.id);
  const orgSlugs = Object.keys(p.org_model_access ?? {});
  for (const slug of orgSlugs) {
    if (!modelSlugs.includes(slug)) fields[`org_model_access.${slug}`] = "Unknown model.";
  }
  for (const t of p.teams) {
    if (!teamIds.includes(t.id)) fields[`teams.${t.id}`] = "Unknown team.";
    const concurrency = Number(t.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      fields[`teams.${t.id}.concurrency`] = "Enter a number from 1 to 20.";
    }
    if (t.payload_visibility !== "team" && t.payload_visibility !== "restricted") {
      fields[`teams.${t.id}.payload_visibility`] = "Choose Team or Restricted.";
    }
    const soft = Number(t.soft_cap_credits);
    const hard = Number(t.hard_cap_credits);
    if (!Number.isInteger(soft) || soft < 0 || soft > 10_000_000) {
      fields[`teams.${t.id}.soft_cap_credits`] = "Enter whole credits from 0 to 10,000,000.";
    }
    if (!Number.isInteger(hard) || hard < 0 || hard > 10_000_000) {
      fields[`teams.${t.id}.hard_cap_credits`] = "Enter whole credits from 0 to 10,000,000.";
    }
    if (soft > hard) {
      fields[`teams.${t.id}.soft_cap_credits`] = "The soft cap must be at or below the hard cap.";
    }
    const cd = t.context_defaults ?? { api: "inherit", playground: "inherit" };
    if (!["allowed", "blocked", "inherit"].includes(cd.api)) fields[`teams.${t.id}.context_defaults.api`] = "Choose Allowed, Blocked or Inherit.";
    if (!["allowed", "blocked", "inherit"].includes(cd.playground)) fields[`teams.${t.id}.context_defaults.playground`] = "Choose Allowed, Blocked or Inherit.";
    for (const slug of Object.keys(t.model_access ?? {})) {
      if (!modelSlugs.includes(slug)) fields[`teams.${t.id}.model_access.${slug}`] = "Unknown model.";
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "validation_failed", "Fix the highlighted fields.", fields);
  }

  // Apply and store the new version in one transaction.
  const appliedVersion = await pool.tx(async (tx) => {
    const again = await tx.one<{ max: number }>(`SELECT max(version)::int AS max FROM policy_versions`);
    const nowVersion = again?.max ?? 1;
    if (p.version !== nowVersion) {
      throw new ApiError(412, "policy_version_stale", "Someone saved a newer policy. Reload to see it before saving again.", undefined, {
        current_version: nowVersion,
      });
    }
    await tx.exec(`UPDATE orgs SET timezone = $1, retention_days = $2 WHERE id = 'org'`, [p.timezone, p.retention_days]);
    for (const t of p.teams) {
      await tx.exec(
        `UPDATE teams SET concurrency = $2, payload_visibility = $3, soft_cap_credits = $4, hard_cap_credits = $5,
         api_default = $6, playground_default = $7 WHERE id = $1`,
        [t.id, t.concurrency, t.payload_visibility, t.soft_cap_credits, t.hard_cap_credits,
         t.context_defaults.api, t.context_defaults.playground],
      );
    }
    await tx.exec(`DELETE FROM org_model_access`);
    for (const slug of modelSlugs) {
      const acc = p.org_model_access?.[slug] ?? { api: "allowed", playground: "allowed" };
      await tx.exec(
        `INSERT INTO org_model_access (model_slug, api, playground) VALUES ($1,$2,$3)`,
        [slug, acc.api === "blocked" ? "blocked" : "allowed", acc.playground === "blocked" ? "blocked" : "allowed"],
      );
    }
    await tx.exec(`DELETE FROM team_model_access`);
    for (const t of p.teams) {
      for (const slug of modelSlugs) {
        const acc = t.model_access?.[slug] ?? { api: "inherit", playground: "inherit" };
        await tx.exec(
          `INSERT INTO team_model_access (team_id, model_slug, api, playground) VALUES ($1,$2,$3,$4)`,
          [t.id, slug, acc.api, acc.playground],
        );
      }
    }
    const nextVersion = nowVersion + 1;
    await tx.exec(
      `INSERT INTO policy_versions (version, policy, saved_by) VALUES ($1,$2,$3)`,
      [nextVersion, JSON.stringify(p), savedBy.id],
    );
    return nextVersion;
  });

  void appliedVersion;
  await deps.onSaved();
  return currentPolicyJson(pool);
}

/** The current policy with its version number. */
export async function getPolicy(pool: Pool): Promise<unknown> {
  return currentPolicyJson(pool);
}
