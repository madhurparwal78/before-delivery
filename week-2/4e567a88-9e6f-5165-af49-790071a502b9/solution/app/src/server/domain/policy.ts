// The org policy: one numbered version per save; the newest version is the policy in force.

import type { Db } from "../db";
import { single } from "../db";

export type Context = "api" | "playground";
export type OrgAccess = "allowed" | "blocked";
export type TeamAccess = OrgAccess | "inherit";
export type PayloadVisibility = "team" | "restricted";

export interface TeamPolicy {
  id: string;
  name: string;
  concurrency: number;
  payload_visibility: PayloadVisibility;
  soft_cap_credits: number;
  hard_cap_credits: number;
  context_defaults: Record<Context, TeamAccess>;
  model_access: Record<string, Record<Context, TeamAccess>>;
}

export interface Policy {
  version: number;
  timezone: string;
  retention_days: 7 | 30 | 90;
  org_model_access: Record<string, Record<Context, OrgAccess>>;
  teams: TeamPolicy[];
}

export async function currentPolicy(db: Db): Promise<Policy> {
  const row = await single<{ version: number; policy: Omit<Policy, "version"> }>(db,
    "SELECT version, policy FROM policy_versions ORDER BY version DESC LIMIT 1");
  return { version: row.version, ...row.policy };
}

export function teamPolicy(policy: Policy, teamId: string): TeamPolicy {
  // Every team is in every saved policy: a save that drops or adds a team is refused.
  return policy.teams.find((t) => t.id === teamId)!;
}
