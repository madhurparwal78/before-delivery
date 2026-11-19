import { maskRegistration } from '../../shared/format';
import type { BlockerReason, FindingDto, ListingStatus, PanelDto, RecordDto } from '../../shared/types';
import { query, transaction, tryAdvisoryLock, type Tx } from '../db';
import { publishBlockers } from '../domain/blockers';
import { illegalTransition, publishBlocked, refuse } from '../domain/errors';
import { isLegalTransition } from '../domain/listing';
import {
  buildPanels,
  loadFindingDtos,
  loadWorkingRecord,
  lockCarRow,
  type CarRow,
} from '../repo/cars';
import { contentHashOfFrozen, loadVersion, loadVersionIn } from '../repo/versions';
import { renderPdf } from './gotenberg';
import { conditionReportHtml, handoverRecordHtml } from './reportHtml';
import { objectKeys, putConfirmed, removeObject } from './storage';

export interface PublishResult {
  version: number;
  listingStatus: 'live';
  reportSha256: string;
  changedFindingIds: string[];
}

interface FrozenContent {
  findings: FindingDto[];
  panels: PanelDto[];
  record: RecordDto | null;
}

const loadFrozenContent = async (carId: string): Promise<FrozenContent> => {
  const [findings, panels, record] = await Promise.all([
    loadFindingDtos(carId),
    buildPanels(carId, { includeNames: false, includeInspector: false }),
    loadWorkingRecord(carId),
  ]);
  return { findings, panels: panels.panels, record };
};

/** The material content of a record, which is what a republish is judged against. */
const recordFingerprint = (record: RecordDto | null): string =>
  record === null
    ? ''
    : JSON.stringify({ tape: record.tape, advisories: record.advisories, openAdvisories: record.openAdvisories });

const contentFingerprint = (content: FrozenContent): string =>
  JSON.stringify({
    findings: content.findings,
    panels: content.panels,
    record: recordFingerprint(content.record),
  });

const nextVersionNumber = async (tx: Tx, carId: string): Promise<number> => {
  const row = await tx.queryOne<{ next: number }>(
    'SELECT coalesce(max(number), 0) + 1 AS next FROM car_version WHERE car_id = $1',
    [carId],
  );
  if (row === null) throw new Error('The version number query returned no row');
  return Number(row.next);
};

const enterRendering = async (carId: string): Promise<{ car: CarRow; priorStatus: ListingStatus }> =>
  transaction(async (tx) => {
    const car = await lockCarRow(tx, carId);
    if (car === null) throw refuse(404, 'not_found', 'That car file could not be found');
    if (car.listing_status === 'rendering') {
      throw refuse(409, 'publish_in_progress', 'A publish is already running for this car');
    }
    if (!isLegalTransition(car.listing_status, 'rendering')) throw illegalTransition();

    const content = await loadFrozenContent(carId);
    const reasons: BlockerReason[] = publishBlockers({
      findingCount: content.findings.length,
      pulledAt: content.record === null ? null : new Date(content.record.pulledAt),
      advisories: content.record?.advisories ?? [],
      now: new Date(),
    });
    if (reasons.length > 0) throw publishBlocked(reasons);

    if (car.current_version !== null) {
      const current = await loadVersion(carId, car.current_version);
      if (
        current !== null &&
        contentFingerprint({ findings: current.findings, panels: current.panels, record: current.record }) ===
          contentFingerprint(content)
      ) {
        throw refuse(409, 'no_changes', 'Nothing has changed since the current version');
      }
    }

    await tx.query("UPDATE car SET listing_status = 'rendering', prior_status = $2 WHERE id = $1", [
      carId,
      car.listing_status,
    ]);
    return { car, priorStatus: car.listing_status };
  });

const leaveRendering = async (carId: string, priorStatus: ListingStatus): Promise<void> => {
  await query('UPDATE car SET listing_status = $2, prior_status = NULL WHERE id = $1', [carId, priorStatus]);
};

/**
 * The frozen version, the rendered report and its stored object land together, or
 * the listing returns to where it was with nothing visible to a buyer.
 */
export const publishCar = async (carId: string): Promise<PublishResult> => {
  const { car, priorStatus } = await enterRendering(carId);
  const content = await loadFrozenContent(carId);
  const version = await transaction((tx) => nextVersionNumber(tx, carId));

  let pdf: Buffer;
  try {
    pdf = await renderPdf(
      conditionReportHtml({
        carName: car.name,
        version,
        maskedRegistration: maskRegistration(car.registration),
        findings: content.findings,
        panels: content.panels,
        record: content.record,
      }),
    );
  } catch (error) {
    await leaveRendering(carId, priorStatus);
    throw error;
  }

  const key = objectKeys.report(carId, version);
  let reportSha256: string;
  try {
    reportSha256 = await putConfirmed(key, pdf, 'application/pdf');
  } catch {
    await removeObject(key).catch(() => undefined);
    await leaveRendering(carId, priorStatus);
    throw refuse(503, 'report_store_failed', 'The report could not be stored');
  }

  try {
    return await transaction(async (tx) => {
      const previous = car.current_version === null ? null : await loadVersion(carId, car.current_version);
      const previousHashes = new Map(
        (previous?.findings ?? []).map((finding) => [finding.id, contentHashOfFrozen(finding)] as const),
      );
      const changedFindingIds = content.findings
        .filter((finding) => previousHashes.get(finding.id) !== contentHashOfFrozen(finding))
        .map((finding) => finding.id);

      await tx.query(
        `INSERT INTO car_version (car_id, number, published_at, report_sha256, findings, panels, record, open_advisories)
         VALUES ($1, $2, now(), $3, $4, $5, $6, $7)`,
        [
          carId,
          version,
          reportSha256,
          JSON.stringify(content.findings),
          JSON.stringify(content.panels),
          content.record === null ? null : JSON.stringify(content.record),
          content.record?.openAdvisories ?? 0,
        ],
      );

      const keptIds = new Set(content.findings.map((finding) => finding.id));
      for (const finding of previous?.findings ?? []) {
        if (keptIds.has(finding.id)) continue;
        await tx.query(
          `INSERT INTO removed_finding (car_id, finding_id, title, removed_in_version)
           VALUES ($1, $2, $3, $4) ON CONFLICT (car_id, finding_id) DO NOTHING`,
          [carId, finding.id, finding.title, version],
        );
      }

      await tx.query(
        "UPDATE car SET listing_status = 'live', prior_status = NULL, current_version = $2 WHERE id = $1",
        [carId, version],
      );

      await applyRereadStatuses(tx, carId, version);

      return { version, listingStatus: 'live' as const, reportSha256, changedFindingIds };
    });
  } catch (error) {
    await removeObject(key).catch(() => undefined);
    await leaveRendering(carId, priorStatus);
    throw error;
  }
};

/**
 * An amendment that clears seen status on a material finding puts that buyer's live
 * offer into needs re-read, and a buyer who has seen them all again returns to open.
 */
export const applyRereadStatuses = async (tx: Tx, carId: string, versionNumber: number): Promise<void> => {
  const version = await tx.queryOne<{ findings: FindingDto[] }>(
    'SELECT findings FROM car_version WHERE car_id = $1 AND number = $2',
    [carId, versionNumber],
  );
  if (version === null) throw new Error(`Version ${versionNumber} is missing`);

  const materialHashes = version.findings
    .filter((finding) => finding.material)
    .map((finding) => ({ id: finding.id, hash: contentHashOfFrozen(finding) }));

  const offers = await tx.query<{ id: string; link_id: string; status: string }>(
    "SELECT id, link_id, status FROM offer WHERE car_id = $1 AND status IN ('open','needs_reread')",
    [carId],
  );

  for (const offer of offers) {
    let unseen = 0;
    for (const material of materialHashes) {
      const seen = await tx.queryOne<{ one: number }>(
        'SELECT 1 AS one FROM seen_record WHERE link_id = $1 AND finding_id = $2 AND content_hash = $3',
        [offer.link_id, material.id, material.hash],
      );
      if (seen === null) unseen += 1;
    }
    const wanted = unseen > 0 ? 'needs_reread' : 'open';
    if (wanted !== offer.status) {
      await tx.query('UPDATE offer SET status = $2 WHERE id = $1', [offer.id, wanted]);
    }
  }
};

export interface CompleteResult {
  listingStatus: 'sold';
  handoverSha256: string;
}

/**
 * Completing the sale renders and stores one handover record, and only then moves the
 * listing to sold. Of simultaneous completions exactly one proceeds.
 */
export const completeSale = async (carId: string): Promise<CompleteResult> =>
  transaction(async (tx) => {
    if (!(await tryAdvisoryLock(tx, `open-bonnet:complete:${carId}`))) throw illegalTransition();

    const car = await lockCarRow(tx, carId);
    if (car === null) throw refuse(404, 'not_found', 'That car file could not be found');
    if (!isLegalTransition(car.listing_status, 'sold')) throw illegalTransition();
    const version = car.current_version;
    if (version === null) throw illegalTransition();

    const offer = await tx.queryOne<{ amount_pounds: number; link_id: string; buyer_name: string }>(
      `SELECT o.amount_pounds, o.link_id, l.name AS buyer_name
       FROM offer o JOIN named_link l ON l.id = o.link_id
       WHERE o.car_id = $1 AND o.status = 'accepted'`,
      [carId],
    );
    if (offer === null) throw illegalTransition();

    const seen = await tx.query<{ finding_id: string; seen_at: Date }>(
      'SELECT finding_id, seen_at FROM seen_record WHERE link_id = $1 ORDER BY seen_at ASC',
      [offer.link_id],
    );

    const frozen = await loadVersionIn(tx, carId, version);
    const titleOf = new Map((frozen?.findings ?? []).map((finding) => [finding.id, finding.title] as const));

    const pdf = await renderPdf(
      handoverRecordHtml({
        carName: car.name,
        version,
        maskedRegistration: maskRegistration(car.registration),
        amountPounds: offer.amount_pounds,
        buyerName: offer.buyer_name,
        seenRecords: seen
          .filter((row) => titleOf.has(row.finding_id))
          .map((row) => ({ title: titleOf.get(row.finding_id) as string, seenAt: row.seen_at.toISOString() })),
      }),
    );

    const key = objectKeys.handover(carId);
    let handoverSha256: string;
    try {
      handoverSha256 = await putConfirmed(key, pdf, 'application/pdf');
    } catch {
      await removeObject(key).catch(() => undefined);
      throw refuse(503, 'report_store_failed', 'The handover record could not be stored');
    }

    await tx.query("UPDATE car SET listing_status = 'sold' WHERE id = $1", [carId]);
    return { listingStatus: 'sold' as const, handoverSha256 };
  });
