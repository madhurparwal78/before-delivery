import { AccessValue, Context, Policy } from '../types';

/** Team model setting, then the team default for the context, then the org model setting. */
export function resolveAccess(policy: Policy, teamId: string, slug: string, context: Context): AccessValue {
  const team = policy.teams.find((candidate) => candidate.id === teamId);
  const teamSetting = team?.model_access[slug]?.[context] ?? 'inherit';
  if (teamSetting !== 'inherit') return teamSetting;
  const teamDefault = team?.context_defaults[context] ?? 'inherit';
  if (teamDefault !== 'inherit') return teamDefault;
  return policy.org_model_access[slug]?.[context] ?? 'allowed';
}
