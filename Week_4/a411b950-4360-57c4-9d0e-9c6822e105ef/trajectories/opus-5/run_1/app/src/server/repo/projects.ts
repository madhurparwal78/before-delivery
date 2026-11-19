import { query, type Queryable } from '../db/pool.ts';
import { CREDIT_LABELS, type CreditType, type Layer, LAYERS, type ProjectStatus, type Visibility } from '../../shared/projectStatus.ts';
import { linkStatus, type LinkStatus } from '../domain/linkStatus.ts';
import { objectIsPresent } from '../services/storage.ts';

export type ProjectRow = {
  id: string;
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: Visibility;
  position: number;
  threshold_bed: number;
  threshold_pulse: number;
  threshold_lead: number;
  threshold_stinger: number;
  status: ProjectStatus;
};

export type StemRow = {
  id: string;
  project_id: string;
  layer: Layer;
  format: 'wav' | 'ogg';
  bytes: number;
  duration_ms: number;
  object_key: string;
};

export const PROJECT_COLUMNS = `p.id, p.slug, p.title, p.credit_type, p.credit_line, p.role, p.blurb, p.tags,
  p.visibility, p.position, p.threshold_bed, p.threshold_pulse, p.threshold_lead, p.threshold_stinger, p.status`;

export type Thresholds = Record<Layer, number>;

export function thresholdsOf(project: ProjectRow): Thresholds {
  return {
    bed: project.threshold_bed,
    pulse: project.threshold_pulse,
    lead: project.threshold_lead,
    stinger: project.threshold_stinger,
  };
}

export type ConsoleProject = {
  id: string;
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: Visibility;
  position: number;
  thresholds: Thresholds;
  status: ProjectStatus;
  stems: Array<{ id: string; layer: Layer; format: 'wav' | 'ogg'; bytes: number; duration_ms: number }>;
};

export type Station = {
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_label: string;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  thresholds: Thresholds;
  playable: boolean;
  stems: Array<{ id: string; layer: Layer; url: string }>;
};

export async function readProjectById(id: string, client?: Queryable): Promise<ProjectRow | null> {
  const runner = client ?? { query };
  const result = await runner.query<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function readStems(projectIds: readonly string[], client?: Queryable): Promise<StemRow[]> {
  if (projectIds.length === 0) return [];
  const runner = client ?? { query };
  const result = await runner.query<StemRow>(
    `SELECT id, project_id, layer, format, bytes, duration_ms, object_key
       FROM stems WHERE project_id = ANY($1::uuid[])`,
    [[...projectIds]],
  );
  return result.rows;
}

export function groupStems(stems: readonly StemRow[]): Map<string, StemRow[]> {
  const grouped = new Map<string, StemRow[]>();
  for (const stem of stems) {
    const existing = grouped.get(stem.project_id) ?? [];
    existing.push(stem);
    grouped.set(stem.project_id, existing);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => LAYERS.indexOf(left.layer) - LAYERS.indexOf(right.layer));
  }
  return grouped;
}

export function toConsoleProject(project: ProjectRow, stems: readonly StemRow[]): ConsoleProject {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    credit_type: project.credit_type,
    credit_line: project.credit_line,
    role: project.role,
    blurb: project.blurb,
    tags: project.tags,
    visibility: project.visibility,
    position: project.position,
    thresholds: thresholdsOf(project),
    status: project.status,
    stems: stems.map((stem) => ({
      id: stem.id,
      layer: stem.layer,
      format: stem.format,
      bytes: stem.bytes,
      duration_ms: stem.duration_ms,
    })),
  };
}

/** A station is playable only when storage is reachable and all four stem objects exist. */
export async function stationIsPlayable(stems: readonly StemRow[]): Promise<boolean> {
  if (stems.length !== LAYERS.length) return false;
  try {
    for (const stem of stems) {
      if (!(await objectIsPresent(stem.object_key))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function toStation(
  project: ProjectRow,
  stems: readonly StemRow[],
  stemUrl: (stemId: string) => string,
): Promise<Station> {
  const playable = await stationIsPlayable(stems);
  return {
    slug: project.slug,
    title: project.title,
    credit_type: project.credit_type,
    credit_label: CREDIT_LABELS[project.credit_type],
    credit_line: project.credit_line,
    role: project.role,
    blurb: project.blurb,
    tags: project.tags,
    thresholds: thresholdsOf(project),
    playable,
    stems: playable ? stems.map((stem) => ({ id: stem.id, layer: stem.layer, url: stemUrl(stem.id) })) : [],
  };
}

export type LinkRow = {
  id: string;
  project_id: string;
  label: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
};

export type ConsoleLink = {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  status: LinkStatus;
};

export function toConsoleLink(link: LinkRow, now: Date): ConsoleLink {
  return {
    id: link.id,
    label: link.label,
    token: link.token,
    url: `/listen/${link.token}`,
    expires_at: link.expires_at.toISOString(),
    status: linkStatus(link, now),
  };
}

export async function readLinks(projectId: string): Promise<LinkRow[]> {
  const result = await query<LinkRow>(
    `SELECT id, project_id, label, token, expires_at, revoked_at
       FROM listening_links WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  );
  return result.rows;
}
