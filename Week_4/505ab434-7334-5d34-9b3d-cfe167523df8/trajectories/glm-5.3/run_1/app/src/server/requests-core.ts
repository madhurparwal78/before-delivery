import { query, withTransaction, type Tx } from './db';
import type { Config } from './config';
import {
  APPLICATION_LABELS,
  type ApplicationClass,
  type ConditionKind,
  type Decision as DecisionKind,
  type Escalation,
  type RequestState,
} from '../shared/domain';

export interface RequestRow {
  id: string;
  requester_id: string;
  asset_id: string;
  variant_id: string | null;
  application_class: string;
  territories: string[];
  campaign_starts_on: string;
  campaign_ends_on: string;
  cited_rules: { identifier: string; version: number }[];
  note: string;
  state: string;
  escalation: Escalation;
  holder_id: string;
  submitted_at: Date | null;
  deadline: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function tierHours(applicationClass: ApplicationClass, cfg: Config): number {
  if (applicationClass === 'internal_comms' || applicationClass === 'social' || applicationClass === 'press_article') {
    return cfg.deadlineHoursStandard;
  }
  if (applicationClass === 'event' || applicationClass === 'film') return cfg.deadlineHoursExtended;
  return cfg.deadlineHoursLegal;
}

export function stageKinds(assetClass: string, applicationClass: ApplicationClass): ('brand' | 'legal')[] {
  const kinds: ('brand' | 'legal')[] = ['brand'];
  if (assetClass === 'mark') kinds.push('brand');
  if (applicationClass === 'co_brand' || applicationClass === 'merchandise' || applicationClass === 'partnership') {
    kinds.push('legal');
  }
  return kinds;
}

export function stageReason(kinds: ('brand' | 'legal')[], n: number, applicationClass: ApplicationClass): string {
  const total = kinds.length;
  if (kinds[n - 1] === 'legal') {
    return `Stage ${n} of ${total}: legal review (${APPLICATION_LABELS[applicationClass]}).`;
  }
  if (total === 3 && n === 1) {
    return `Stage ${n} of ${total}: first brand review (mark asset).`;
  }
  if (total === 3 && n === 2) {
    return `Stage ${n} of ${total}: second brand review (mark asset).`;
  }
  return `Stage ${n} of ${total}: brand review.`;
}

export interface ReviewerCandidate {
  id: string;
  displayName: string;
  openStages: number;
}

export async function eligibleReviewers(
  kind: 'brand' | 'legal',
  excludeIds: string[],
  requesterId: string,
): Promise<ReviewerCandidate[]> {
  const role = kind === 'brand' ? 'brand_reviewer' : 'legal_reviewer';
  const rows = await query<{ id: string; display_name: string; open_stages: string }>(
    `SELECT p.id, p.display_name,
            (SELECT COUNT(*) FROM request_stages rs
               JOIN requests r ON r.id = rs.request_id
              WHERE rs.assignee_id = p.id AND rs.decision IS NULL AND r.state = 'under_review')::text AS open_stages
       FROM principals p
      WHERE p.role = $1 AND p.id <> ALL($2)
      ORDER BY p.display_name`,
    [role, excludeIds],
  );
  return rows
    .map((r) => ({ id: r.id, displayName: r.display_name, openStages: Number(r.open_stages) }))
    .filter((r) => r.id !== requesterId);
}

export async function leastLoadedOwner(excludeIds: string[]): Promise<ReviewerCandidate | null> {
  const rows = await query<{ id: string; display_name: string; open_stages: string }>(
    `SELECT p.id, p.display_name,
            (SELECT COUNT(*) FROM request_stages rs
               JOIN requests r ON r.id = rs.request_id
              WHERE rs.assignee_id = p.id AND rs.decision IS NULL AND r.state = 'under_review')::text AS open_stages
       FROM principals p
      WHERE p.role = 'owner' AND p.id <> ALL($1)
      ORDER BY p.display_name`,
    [excludeIds],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, displayName: rows[0].display_name, openStages: Number(rows[0].open_stages) };
}

export function pickReviewer(candidates: ReviewerCandidate[]): ReviewerCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.openStages !== b.openStages) return a.openStages - b.openStages;
    return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0;
  });
  return sorted[0];
}

export async function nextRequestId(tx: Tx): Promise<string> {
  const rows = await tx.query<{ next: string }>(
    `SELECT 'REQ-' || lpad((COALESCE(MAX(substring(id from 5)::int), 0) + 1)::text, 4, '0') AS next
       FROM requests WHERE id LIKE 'REQ-%'`,
  );
  return rows.rows[0].next;
}

export async function nextGrantId(tx: Tx): Promise<string> {
  const rows = await tx.query<{ next: string }>(
    `SELECT 'GR-' || lpad((COALESCE(MAX(substring(id from 4)::int), 0) + 1)::text, 4, '0') AS next
       FROM grants WHERE id LIKE 'GR-%'`,
  );
  return rows.rows[0].next;
}

export async function nextProofId(tx: Tx): Promise<string> {
  const rows = await tx.query<{ next: string }>(
    `SELECT 'PRF-' || lpad((COALESCE(MAX(substring(id from 5)::int), 0) + 1)::text, 4, '0') AS next
       FROM proofs WHERE id LIKE 'PRF-%'`,
  );
  return rows.rows[0].next;
}

export async function nextConditionId(tx: Tx): Promise<string> {
  const rows = await tx.query<{ next: string }>(
    `SELECT 'CON-' || lpad((COALESCE(MAX(substring(id from 5)::int), 0) + 1)::text, 4, '0') AS next
       FROM conditions WHERE id LIKE 'CON-%'`,
  );
  return rows.rows[0].next;
}

export const CONDITION_KINDS: ConditionKind[] = [
  'clear_space',
  'no_recolour',
  'attribution',
  'proof_required',
  'territory',
  'expiry_override',
];

export function conditionText(kind: ConditionKind, value: string | null): string {
  switch (kind) {
    case 'clear_space':
      return `Keep clear space of ${value}x the symbol height on every side.`;
    case 'no_recolour':
      return `Do not recolour the mark.`;
    case 'attribution':
      return `Credit line: ${value}`;
    case 'proof_required':
      return `Upload final artwork for approval before use.`;
    case 'territory':
      return `Use only in: ${(value ?? '').split(',').map((c) => c.trim()).filter(Boolean).join(', ')}`;
    case 'expiry_override':
      return `Use ends on ${value}.`;
  }
}
