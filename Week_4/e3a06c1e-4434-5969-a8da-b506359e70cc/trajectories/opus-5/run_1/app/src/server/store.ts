import { query, queryOne } from './db/pool.js';
import { buildQuota, currentPeriod, openSessionSeconds } from './domain/quota.js';
import type {
  BillingState,
  CloseReason,
  KeyView,
  Plan,
  ProjectView,
  Quota,
  Role,
  SessionKind,
  SessionSource,
  SessionState,
  SessionView,
} from '../shared/types.js';

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  kb_account_id: string | null;
  kb_subscription_id: string | null;
}

export interface MemberRow {
  id: string;
  org_id: string;
  name: string;
  email: string;
  role: Role;
  joined_at: Date;
}

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  monthly_quota_minutes: number;
}

export interface SessionRow {
  id: string;
  project_id: string;
  org_id: string;
  kind: SessionKind;
  source: SessionSource;
  label: string;
  state: SessionState;
  close_reason: CloseReason | null;
  channels: number;
  audio_ms: number;
  frame: number;
  peak_bin: number;
  plan: Plan;
  key_id: string | null;
  started_at: Date;
  live_at: Date | null;
  ended_at: Date | null;
  billable_seconds: number | null;
  billing_state: BillingState;
  received_samples: number;
  spectrum_count: number;
  has_sidecar: boolean;
  transcript_written: boolean;
  wer: number | null;
  flagged_segments: number;
}

export interface ApiKeyRow {
  id: string;
  project_id: string;
  name: string;
  prefix: string;
  created_at: Date;
  revoked_at: Date | null;
}

export const SESSION_COLUMNS = `s.id, s.project_id, s.org_id, s.kind, s.source, s.label, s.state, s.close_reason,
  s.channels, s.audio_ms, s.frame, s.peak_bin, s.plan, s.key_id, s.started_at, s.live_at, s.ended_at,
  s.billable_seconds, s.billing_state, s.received_samples, s.spectrum_count, s.has_sidecar,
  s.transcript_written, s.wer,
  (select count(*)::int from segments g where g.session_id = s.id and g.flagged) as flagged_segments`;

export const loadOrg = (orgId: string): Promise<OrgRow | null> =>
  queryOne<OrgRow>(
    'select id, name, slug, plan, kb_account_id, kb_subscription_id from orgs where id = $1',
    [orgId],
  );

export const loadProject = (projectId: string): Promise<ProjectRow | null> =>
  queryOne<ProjectRow>(
    'select id, org_id, name, monthly_quota_minutes from projects where id = $1',
    [projectId],
  );

export const loadSession = (sessionId: string): Promise<SessionRow | null> =>
  queryOne<SessionRow>(`select ${SESSION_COLUMNS} from sessions s where s.id = $1`, [sessionId]);

export const isOpen = (state: SessionState): boolean => state === 'connecting' || state === 'live';

interface UsageRow {
  project_id: string;
  state: SessionState;
  audio_ms: number;
  channels: number;
  billable_seconds: number | null;
  billing_state: BillingState;
}

export interface ProjectUsage {
  readonly usedSeconds: number;
  readonly sessions: number;
  readonly pendingSessions: number;
}

const emptyUsage: ProjectUsage = { usedSeconds: 0, sessions: 0, pendingSessions: 0 };

/**
 * `used_seconds` is derived from the stored sessions on every read: the billable
 * seconds of sessions that ended in the period, plus accrued audio of open ones.
 */
export const projectUsage = async (projectIds: readonly string[], now: Date): Promise<Map<string, ProjectUsage>> => {
  const result = new Map<string, ProjectUsage>();
  for (const id of projectIds) result.set(id, emptyUsage);
  if (projectIds.length === 0) return result;
  const period = currentPeriod(now);
  const rows = await query<UsageRow>(
    `select project_id, state, audio_ms, channels, billable_seconds, billing_state
       from sessions
      where project_id = any($1::uuid[])
        and (state in ('connecting','live') or (ended_at >= $2 and ended_at < $3))`,
    [[...projectIds], period.start, period.resets],
  );
  for (const row of rows) {
    const current = result.get(row.project_id) ?? emptyUsage;
    const billable = row.billing_state === 'pending' || row.billing_state === 'confirmed';
    result.set(row.project_id, {
      usedSeconds:
        current.usedSeconds +
        (isOpen(row.state) ? openSessionSeconds(row.audio_ms, row.channels) : row.billable_seconds ?? 0),
      sessions: current.sessions + (billable ? 1 : 0),
      pendingSessions: current.pendingSessions + (row.billing_state === 'pending' ? 1 : 0),
    });
  }
  return result;
};

export const quotaFor = async (project: ProjectRow, now: Date): Promise<Quota> => {
  const usage = await projectUsage([project.id], now);
  return buildQuota(project.monthly_quota_minutes, (usage.get(project.id) ?? emptyUsage).usedSeconds, currentPeriod(now), now);
};

export const projectView = (project: ProjectRow, usage: ProjectUsage, now: Date): ProjectView => ({
  id: project.id,
  name: project.name,
  sessions: usage.sessions,
  quota: buildQuota(project.monthly_quota_minutes, usage.usedSeconds, currentPeriod(now), now),
});

export const projectViews = async (projects: readonly ProjectRow[], now: Date): Promise<ProjectView[]> => {
  const usage = await projectUsage(
    projects.map((project) => project.id),
    now,
  );
  return projects.map((project) => projectView(project, usage.get(project.id) ?? emptyUsage, now));
};

export const sessionView = (row: SessionRow, now: Date): SessionView => ({
  id: row.id,
  project_id: row.project_id,
  kind: row.kind,
  source: row.source,
  label: row.label,
  state: row.state,
  close_reason: row.close_reason,
  channels: row.channels,
  sample_rate: 16000,
  audio_ms: row.audio_ms,
  frame: row.frame,
  plan: row.plan,
  key_id: row.key_id,
  started_at: row.started_at.toISOString(),
  live_at: row.live_at === null ? null : row.live_at.toISOString(),
  ended_at: row.ended_at === null ? null : row.ended_at.toISOString(),
  billable_seconds: row.billable_seconds,
  billing_state: row.billing_state,
  flagged_segments: row.flagged_segments,
  wer: row.wer,
  server_time: now.toISOString(),
});

export const keyView = (row: ApiKeyRow): KeyView => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  created_at: row.created_at.toISOString(),
  revoked_at: row.revoked_at === null ? null : row.revoked_at.toISOString(),
});

export const loadProjectsForOrg = (orgId: string): Promise<ProjectRow[]> =>
  query<ProjectRow>(
    'select id, org_id, name, monthly_quota_minutes from projects where org_id = $1 order by name',
    [orgId],
  );

export const loadProjectsForMember = (memberId: string): Promise<ProjectRow[]> =>
  query<ProjectRow>(
    `select p.id, p.org_id, p.name, p.monthly_quota_minutes
       from projects p
       join member_projects mp on mp.project_id = p.id
      where mp.member_id = $1
      order by p.name`,
    [memberId],
  );
