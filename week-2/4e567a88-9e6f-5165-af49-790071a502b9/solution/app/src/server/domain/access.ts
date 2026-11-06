// Model access by context: the team's model setting, then the team's default, then the org's setting.

import type { Context, OrgAccess, Policy } from "./policy";
import { teamPolicy } from "./policy";

export function resolveAccess(policy: Policy, teamId: string, model: string, context: Context): OrgAccess {
  const team = teamPolicy(policy, teamId);
  const own = team.model_access[model][context];
  if (own !== "inherit") return own;
  const fallback = team.context_defaults[context];
  if (fallback !== "inherit") return fallback;
  return policy.org_model_access[model][context];
}
