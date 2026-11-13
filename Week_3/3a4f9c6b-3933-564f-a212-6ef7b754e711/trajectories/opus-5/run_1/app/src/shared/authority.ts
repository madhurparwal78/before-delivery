import type { ProjectRole } from './types.js';

/**
 * The authority table. Every member may read a project; these are the actions that need a
 * particular role, and the server refuses anything outside the row whatever the screen shows.
 */
const AUTHORITY = {
  ingest_bundle: ['service_developer', 'platform_engineer'],
  request_promotion: ['service_developer', 'platform_engineer'],
  start_promotion: ['service_developer', 'platform_engineer'],
  retry_window: ['service_developer', 'platform_engineer'],
  approve: ['release_manager'],
  reject: ['release_manager'],
  break_freeze: ['oncall_sre'],
  rollback: ['oncall_sre'],
  edit_stage_defaults: ['platform_engineer'],
  manage_windows: ['platform_engineer'],
  schedule_freeze_version: ['platform_engineer'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type Action = keyof typeof AUTHORITY;

export function mayPerform(role: ProjectRole, action: Action): boolean {
  return (AUTHORITY[action] as readonly ProjectRole[]).includes(role);
}
