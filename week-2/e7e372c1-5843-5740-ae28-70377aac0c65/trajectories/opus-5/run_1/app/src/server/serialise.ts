/** The published JSON shapes for restatements. */
import { toIso } from '../shared/nytime';
import { ROW_KEYS } from '../shared/labels';
import { RestatementRecord } from './restatementStore';

export interface RestatementPayload {
  id: string;
  version: number;
  week_ending: string;
  state: string;
  supersedes: string | null;
  correction_reason: string | null;
  rows: Record<string, string | null>;
  share_events: { id: string; kind: string; shares: string; effective_date: string }[];
  accession: string | null;
  exhibit_page: number | null;
  exhibit: { status: string; sha256: string; bytes: number; key: string | null } | null;
  prepared_by: { id: string; name: string };
  cleared_by: { id: string; name: string } | null;
  released_by: { id: string; name: string } | null;
  return_note: string | null;
  release_at: string | null;
  published_at: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export function restatementPayload(record: RestatementRecord): RestatementPayload {
  const rows: Record<string, string | null> = {};
  for (const key of ROW_KEYS) rows[key] = record.rows[key];
  return {
    id: record.id,
    version: record.version,
    week_ending: record.weekEnding,
    state: record.state,
    supersedes: record.supersedes,
    correction_reason: record.correctionReason,
    rows,
    share_events: record.shareEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      shares: event.shares,
      effective_date: event.effectiveDate,
    })),
    accession: record.accession,
    exhibit_page: record.exhibitPage,
    exhibit: record.exhibit,
    prepared_by: record.preparedBy,
    cleared_by: record.clearedBy,
    released_by: record.releasedBy,
    return_note: record.returnNote,
    release_at: record.releaseAtMs === null ? null : toIso(record.releaseAtMs),
    published_at: record.publishedAtMs === null ? null : toIso(record.publishedAtMs),
    superseded_by: record.supersededBy,
    created_at: toIso(record.createdAtMs),
    updated_at: toIso(record.updatedAtMs),
  };
}
