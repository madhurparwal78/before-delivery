import { formatTimestamp, localClock, utcOffset } from '../shared/clock.js';
import { deriveOptics, resolveOptics } from '../shared/optics.js';
import {
  packetPageContent,
  packetPageCss,
  type CoverPage,
  type PacketPage,
  type RowPage,
} from '../shared/packet-page.js';
import { parseStrokeFile } from '../shared/strokes.js';
import type { Account, Kit, StrokeFile } from '../shared/types.js';
import { inlineFontCss } from './assets.js';
import type { PacketRecord } from './packet-store.js';
import type { ProgramRecord } from './programs.js';
import type { ObservationRow } from './records.js';
import { getObject, strokesKey } from './storage.js';

function invariant<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`a checked packet row always has ${what}`);
  return value;
}

export function rowPage(
  row: ObservationRow,
  edition: number,
  kit: Kit,
  sketch: StrokeFile | null,
): RowPage {
  const parts = invariant(resolveOptics(kit, row.optics), 'optics in the observer kit');
  const derived = deriveOptics(parts);
  const observedAt = invariant(row.observed_at, 'a UT time');
  const stamp = formatTimestamp(observedAt);
  return {
    kind: 'row',
    designation: row.designation,
    object_name: row.object_name,
    ut_date: stamp.slice(0, 10),
    ut_time: stamp.slice(11, 16),
    local_time: localClock(observedAt, row.time_zone),
    local_offset: utcOffset(observedAt, row.time_zone),
    time_zone: row.time_zone,
    site_name: row.site_name,
    seeing: invariant(row.seeing, 'seeing'),
    transparency_nelm: invariant(row.transparency_nelm, 'a transparency'),
    telescope_name: parts.telescope.name,
    aperture_mm: parts.telescope.aperture_mm,
    eyepiece_name: parts.eyepiece.name,
    barlow_name: parts.barlow ? parts.barlow.name : null,
    magnification: derived.magnification,
    true_field_arcmin: derived.true_field_arcmin,
    exit_pupil_mm: derived.exit_pupil_mm,
    orientation_sentence: derived.orientation.sentence,
    train: row.optics.train,
    edition,
    is_globular: row.kind === 'globular',
    concentration_class: row.concentration_class,
    is_double_star: row.kind === 'double_star',
    pair: row.pair,
    description: row.description,
    sketch,
  };
}

export function coverPage(
  record: PacketRecord,
  program: ProgramRecord,
  account: Account,
  rowCount: number,
): CoverPage {
  return {
    kind: 'cover',
    number: record.number,
    program_name: program.name,
    display_name: account.display_name,
    email: account.email,
    row_count: rowCount,
    coordinator_name: program.coordinator_name,
  };
}

export async function readSnapshotSketch(
  accountId: string,
  observationId: string,
  sha256: string | null,
): Promise<StrokeFile | null> {
  if (!sha256) return null;
  const bytes = await getObject(strokesKey(accountId, observationId, sha256));
  return parseStrokeFile(Buffer.from(bytes).toString('utf8'));
}

/** The whole packet document handed to the renderer. */
export async function packetDocument(pages: PacketPage[]): Promise<string> {
  const css = await inlineFontCss();
  const body = pages
    .map((page) => `<div class="lowlamp-page">${packetPageContent(page)}</div>`)
    .join('');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<style>${css}</style>` +
    '<style>html,body{margin:0;padding:0;background:#ffffff}' +
    '.lowlamp-page{page-break-after:always;break-after:page}' +
    '.lowlamp-page:last-child{page-break-after:auto;break-after:auto}' +
    `${packetPageCss()}</style>` +
    `</head><body>${body}</body></html>`
  );
}
