// Publishing: the frozen version, the rendered report and its stored object land together, or the
// listing returns to where it was with nothing visible to a buyer.

import { createHash } from 'node:crypto';
import { lockKey, query, transaction, withSessionLock } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { PANELS, panelOf } from '../../shared/panels.js';
import { conditionReportHtml } from '../render/report.js';
import { renderPdf, RenderError } from '../services/render.js';
import { keys, putObject, deleteObject, StorageError } from '../services/store.js';
import type { ConditionRecord } from './record.js';
import { contentHash, isMaterial, type FindingRow } from './findings.js';
import { requireMove } from './listing.js';
import { LIVE_OFFER, settleRereadState } from './offers.js';
import { progressOf, seenHashes, versionFindings } from './seen.js';
import {
  bandOfPanel, currentVersion, findingRows, loadCar, loadReadings, maskRegistration,
  panelsJson, publishBlockers, versionSignature, workingRecord, type CarRow,
} from './state.js';

interface PublishResult {
  version: number;
  listingStatus: 'live';
  reportSha256: string;
  changedFindingIds: string[];
}

async function buildSnapshot(car: CarRow): Promise<{
  snapshot: Record<string, unknown>;
  rows: FindingRow[];
  html: string;
  number: number;
}> {
  const rows = await findingRows(car.id);
  const readings = await loadReadings(car.id);
  const record = (await workingRecord(car.id)) as ConditionRecord; // publishCar refused a car with no pull
  const findings = rows.map((row, index) => ({
    id: row.id,
    revision: row.revision,
    position: index + 1,
    panelId: row.panel_id,
    panelLabel: panelOf(row.panel_id).label,
    u: Number(row.u),
    v: Number(row.v),
    title: row.title,
    wording: row.wording,
    severity: row.severity,
    material: isMaterial(row.severity),
    band: bandOfPanel(row.panel_id, readings),
    photoId: row.photo_id,
  }));
  const panels = (await panelsJson(car.id, { kind: 'owner' })).panels as { id: string; label: string }[];
  const number = (car.current_version ?? 0) + 1;
  const maskedRegistration = maskRegistration(car.registration);
  const snapshot = {
    name: car.name,
    askingPounds: car.asking_pounds,
    maskedRegistration,
    findings,
    panels: panels.map((item) => ({ ...item, inspector: [], inspectorFindings: [] })),
    record,
  };
  const html = conditionReportHtml({
    carName: car.name,
    maskedRegistration,
    version: number,
    publishedAt: new Date(),
    findings,
    readings: PANELS.map((panel) => ({
      label: panel.label,
      microns: readings.owner.get(panel.id)?.microns ?? null,
      band: bandOfPanel(panel.id, readings),
    })),
    record,
  });
  return { snapshot, rows, html, number };
}

/** Puts every live offer into or out of needs re-read after a new version lands. */
async function settleOffersAfterPublish(carId: string, version: number): Promise<void> {
  const frozen = await versionFindings(carId, version);
  const offers = await query<{ id: string; link_id: string }>(
    `SELECT id, link_id FROM offer WHERE car_id = $1 AND ${LIVE_OFFER}`,
    [carId],
  );
  for (const offer of offers) {
    const progress = progressOf(frozen, await seenHashes(offer.link_id));
    await transaction(async (tx) => settleRereadState(tx, offer.id, progress.materialUnseen));
  }
}

export async function publishCar(carId: string): Promise<PublishResult> {
  const result = await withSessionLock(lockKey('publish', carId), async (): Promise<PublishResult> => {
    const car = (await loadCar(carId)) as CarRow; // callers hold an existing car; car files are never deleted
    requireMove(car.listing_status, 'rendering');
    const blockers = await publishBlockers(car);
    if (blockers.length > 0) {
      fail(409, 'publish_blocked', 'This car cannot be published yet.', { reasons: blockers });
    }
    const signature = await versionSignature(car);
    const previous = await currentVersion(car);
    if (previous && previous.signature === signature) {
      fail(409, 'no_changes', 'Nothing has changed since the current version.');
    }

    const { snapshot, rows, html, number } = await buildSnapshot(car);
    const priorStatus = car.listing_status;
    await query('UPDATE car SET listing_status = $2, prior_status = $3 WHERE id = $1', [carId, 'rendering', priorStatus]);

    let stored = false;
    try {
      const pdf = await renderPdf(html);
      const reportSha256 = createHash('sha256').update(pdf).digest('hex');
      await putObject(keys.report(carId, number), pdf, 'application/pdf');
      stored = true;

      const previousHashes = new Map(
        previous ? (await versionFindings(carId, previous.number)).map((item) => [item.finding_id, item.content_hash]) : [],
      );
      const changedFindingIds = rows
        .filter((row) => previousHashes.has(row.id) && previousHashes.get(row.id) !== contentHash(row))
        .map((row) => row.id);

      await transaction(async (tx) => {
        await tx.query(
          'INSERT INTO version (car_id, number, report_sha256, signature, snapshot) VALUES ($1, $2, $3, $4, $5)',
          [carId, number, reportSha256, signature, JSON.stringify(snapshot)],
        );
        for (const [index, row] of rows.entries()) {
          await tx.query(
            `INSERT INTO version_finding (car_id, number, finding_id, content_hash, position, material)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [carId, number, row.id, contentHash(row), index + 1, isMaterial(row.severity)],
          );
        }
        await tx.query(
          "UPDATE car SET listing_status = 'live', prior_status = NULL, current_version = $2 WHERE id = $1",
          [carId, number],
        );
      });
      await settleOffersAfterPublish(carId, number);
      return { version: number, listingStatus: 'live', reportSha256, changedFindingIds };
    } catch (error) {
      await query('UPDATE car SET listing_status = $2, prior_status = NULL WHERE id = $1', [carId, priorStatus]);
      if (stored) await deleteObject(keys.report(carId, number)).catch(() => undefined);
      if (error instanceof RenderError) fail(503, 'report_render_failed', 'The report could not be rendered.');
      if (error instanceof StorageError) fail(503, 'report_store_failed', 'The report could not be stored.');
      throw error;
    }
  });
  if (result === 'busy') fail(409, 'publish_in_progress', 'This car is already being published.');
  return result;
}
