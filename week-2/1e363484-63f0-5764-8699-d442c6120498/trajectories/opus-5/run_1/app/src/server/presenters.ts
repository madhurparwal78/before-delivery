import { percent, tonnes, type Dec } from '../domain/decimal';
import type { Contribution, Derived } from '../domain/derivation';
import { formatTimestamp } from '../domain/time';
import type { FigureRecord, LedgerEntry, MovedReading, Rederivation, Summary } from './figures';
import type { Project } from './projects';
import type { ProjectRole } from './db/seed-data';

export type BlockedReason = 'below_coverage_floor' | 'overlaps_sealed' | 'already_sealed' | 'role';

function contributionJson(contribution: Contribution): Record<string, unknown> {
  return {
    sensor_id: contribution.sensorId,
    kind: contribution.kind,
    area_m2: Number(contribution.areaM2),
    qualifying_half_hours: contribution.qualifyingHalfHours,
    half_hours: contribution.halfHours,
    co2_tco2e: tonnes(contribution.co2),
    ch4_tco2e: tonnes(contribution.ch4),
    net_tco2e: tonnes(contribution.net),
  };
}

export function summaryJson(summary: Summary): Record<string, unknown> {
  return {
    sealed_net_tco2e: tonnes(summary.sealedNet),
    buffer_tco2e: tonnes(summary.buffer),
    intact_count: summary.intactCount,
    broken_count: summary.brokenCount,
    superseded_count: summary.supersededCount,
  };
}

export function figureJson(
  figure: FigureRecord,
  options: { checkedAtMs?: number; rederived?: Rederivation } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: figure.id,
    project: figure.projectSlug,
    start: formatTimestamp(figure.startMs),
    end: formatTimestamp(figure.endMs),
    sensor_ids: [...figure.sensorIds],
    status: figure.status,
    supersedes: figure.supersedes,
    superseded_by: figure.supersededBy,
    coverage_pct: percent(figure.coveragePct),
    floor_pct: percent(figure.floorPct),
    net_tco2e: tonnes(figure.net),
    co2_tco2e: tonnes(figure.co2),
    ch4_tco2e: tonnes(figure.ch4),
    buffer_pct: percent(figure.bufferPct),
    buffer_tco2e: tonnes(figure.buffer),
    credited_tco2e: tonnes(figure.credited),
    readings_count: figure.readingsCount,
    fingerprint: figure.fingerprint,
    sealed_at: formatTimestamp(figure.sealedAtMs),
    sealed_by: figure.sealedBy,
    checked_at: formatTimestamp(options.checkedAtMs ?? figure.checkedAtMs),
    contributions: figure.contributions.map(contributionJson),
    evidence: { readings_key: figure.readingsKey, derivation_key: figure.derivationKey },
  };
  if (options.rederived !== undefined) {
    body.rederived = {
      fingerprint: options.rederived.fingerprint,
      coverage_pct: percent(options.rederived.coveragePct),
      net_tco2e: tonnes(options.rederived.net),
      matches: options.rederived.matches,
    };
  }
  return body;
}

export function previewJson(
  derived: Derived,
  floorPct: Dec,
  bufferPct: Dec,
  verdict: { sealable: boolean; blockedReason: BlockedReason | null; blockingFigureId: string | null },
): Record<string, unknown> {
  return {
    start: formatTimestamp(derived.startMs),
    end: formatTimestamp(derived.endMs),
    sensor_ids: [...derived.sensorIds],
    coverage_pct: percent(derived.coveragePct),
    floor_pct: percent(floorPct),
    net_tco2e: tonnes(derived.net),
    co2_tco2e: tonnes(derived.co2),
    ch4_tco2e: tonnes(derived.ch4),
    buffer_pct: percent(bufferPct),
    buffer_tco2e: tonnes(derived.bufferTco2e),
    credited_tco2e: tonnes(derived.creditedTco2e),
    readings_count: derived.readingsCount,
    fingerprint: derived.fingerprint,
    contributions: derived.contributions.map(contributionJson),
    sealable: verdict.sealable,
    blocked_reason: verdict.blockedReason,
    blocking_figure_id: verdict.blockingFigureId,
  };
}

export function ledgerEntryJson(entry: LedgerEntry): Record<string, unknown> {
  return {
    id: entry.id,
    figure_id: entry.figureId,
    kind: entry.kind,
    tco2e: tonnes(entry.tco2e),
    reverses: entry.reverses,
    recorded_at: formatTimestamp(entry.recordedAtMs),
  };
}

export function movedReadingJson(moved: MovedReading): Record<string, unknown> {
  return {
    sensor_id: moved.sensorId,
    interval_start: formatTimestamp(moved.intervalStartMs),
    old: moved.old === null ? null : { fc: moved.old.fc, fch4: moved.old.fch4, qc: moved.old.qc },
    new: { fc: moved.next.fc, fch4: moved.next.fch4, qc: moved.next.qc },
    revised_at: formatTimestamp(moved.revisedAtMs),
    batch_id: moved.batchId,
  };
}

export function projectListJson(
  project: Project,
  role: ProjectRole,
  summary: Summary,
): Record<string, unknown> {
  return {
    slug: project.slug,
    name: project.name,
    kind: project.kind,
    floor_pct: percent(project.floorPct),
    buffer_pct: percent(project.bufferPct),
    role,
    summary: summaryJson(summary),
  };
}
