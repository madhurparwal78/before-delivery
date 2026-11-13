// The project settings that the settings page, seeding, the project export and merge checks all name.

export const VISIBILITIES = ["private", "internal", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const MERGE_METHODS = ["merge_commit", "squash", "fast_forward", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const FLAG_SETTINGS = ["merge_trains", "pipelines_must_succeed", "reset_approvals_on_push", "author_can_approve", "auto_resolve_outdated"] as const;
export type FlagSetting = (typeof FLAG_SETTINGS)[number];

export type ProjectSettings = Record<FlagSetting, boolean> & { merge_method: MergeMethod };

export function isMergeMethod(value: unknown): value is MergeMethod {
  return MERGE_METHODS.some((method) => method === value);
}

export function isFlagSetting(value: unknown): value is FlagSetting {
  return FLAG_SETTINGS.some((flag) => flag === value);
}
