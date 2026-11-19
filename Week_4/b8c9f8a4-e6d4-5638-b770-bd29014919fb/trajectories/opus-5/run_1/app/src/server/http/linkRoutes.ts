import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { ERRORS } from '../../shared/copy';
import { maskRegistration } from '../../shared/format';
import { isGaugeable, panelById } from '../../shared/panels';
import type {
  CaptureItem,
  CaptureResult,
  LinkView,
  LinkViewFindingDto,
  OfferDto,
} from '../../shared/types';
import { config } from '../config';
import { query, queryOne, transaction, type Tx } from '../db';
import { MICRONS_MAX, MICRONS_MIN } from '../domain/bands';
import { listingClosed, notFound, refuse, validationFailure } from '../domain/errors';
import { roundAnchor } from '../domain/findings';
import { acceptsOffersAndClaims } from '../domain/listing';
import { buildPanels, findCarRow, type CarRow } from '../repo/cars';
import { requireIdempotencyKey, withIdempotency } from '../repo/idempotency';
import {
  findLinkByToken,
  heroOfVersion,
  linkStatusOf,
  loadNewestOffer,
  loadSeenRows,
  offerDtoOf,
  refuseLink,
  seenStateOf,
  wrongRole,
  type LinkRow,
} from '../repo/links';
import { contentHashOfFrozen, loadVersion, versionDto } from '../repo/versions';
import { recordAlert, sendRecordedAlert } from '../repo/alerts';
import { claimSlot, listLinkSlots, offerDto, releaseSlot } from '../services/offers';
import { applyRereadStatuses } from '../services/publishing';
import { getObject, objectKeys } from '../services/storage';
import { asRecord } from './validate';

export const linkRouter = Router();

interface Resolved {
  link: LinkRow;
  car: CarRow;
  now: Date;
}

const resolve = async (request: Request): Promise<Resolved> => {
  const token = String(request.params.token);
  const link = await findLinkByToken(token);
  if (link === null) throw refuse(404, 'link_not_found', 'We could not find that link');
  const now = new Date();
  const status = linkStatusOf(link, now);
  if (status !== 'active') refuseLink(status);
  const car = await findCarRow(link.car_id);
  if (car === null) throw refuse(404, 'link_not_found', 'We could not find that link');
  return { link, car, now };
};

const requireBuyer = (link: LinkRow): void => {
  if (link.role !== 'buyer') wrongRole();
};

const requireInspector = (link: LinkRow): void => {
  if (link.role !== 'inspector') wrongRole();
};

const buildLinkView = async ({ link, car, now }: Resolved): Promise<LinkView> => {
  const panels = await buildPanels(car.id, { includeNames: link.role === 'inspector', includeInspector: true });
  const carBlock = {
    name: car.name,
    maskedRegistration: maskRegistration(car.registration),
    askingPounds: car.asking_pounds,
    viewingArea: car.viewing_area,
    story: car.story,
    listingStatus: car.listing_status,
    firstUsedDate: null as string | null,
  };

  if (link.role === 'inspector') {
    return {
      role: 'inspector',
      name: link.name,
      status: 'active',
      expiresAt: link.expires_at.toISOString(),
      serverNow: now.toISOString(),
      car: carBlock,
      panels: panels.panels,
    };
  }

  const version = car.current_version === null ? null : await loadVersion(car.id, car.current_version);
  const seenRows = await loadSeenRows(link.id);
  const state = seenStateOf(version, seenRows);
  const hero = heroOfVersion(version);
  carBlock.firstUsedDate = version?.record?.firstUsedDate ?? null;

  const findings: LinkViewFindingDto[] = (version?.findings ?? []).map((finding) => {
    const seenAt = state.seenAt.get(finding.id) ?? null;
    return {
      id: finding.id,
      position: finding.position,
      panelId: finding.panelId,
      panelLabel: finding.panelLabel,
      u: finding.u,
      v: finding.v,
      title: finding.title,
      wording: finding.wording,
      severity: finding.severity,
      material: finding.material,
      band: finding.band,
      photoId: finding.photoId,
      seen: seenAt !== null,
      seenAt,
      changedSinceSeen: state.changedSinceSeen.has(finding.id),
    };
  });

  const seenFindingIds = new Set(seenRows.map((row) => row.finding_id));
  const removed = await query<{ finding_id: string; title: string; removed_in_version: number }>(
    'SELECT finding_id, title, removed_in_version FROM removed_finding WHERE car_id = $1 ORDER BY removed_in_version ASC',
    [car.id],
  );

  const invoices = await query<{ label: string }>(
    "SELECT label FROM upload WHERE car_id = $1 AND kind = 'invoice' AND label IS NOT NULL ORDER BY created_at ASC",
    [car.id],
  );

  const offer = await loadNewestOffer(link.id);

  return {
    role: 'buyer',
    name: link.name,
    status: 'active',
    expiresAt: link.expires_at.toISOString(),
    serverNow: now.toISOString(),
    car: carBlock,
    version: version === null ? null : { number: version.number, publishedAt: version.published_at.toISOString() },
    heroFindingId: hero?.id ?? null,
    findings,
    removedFindings: removed
      .filter((row) => seenFindingIds.has(row.finding_id))
      .map((row) => ({ id: row.finding_id, title: row.title, removedInVersion: row.removed_in_version })),
    progress: { seen: state.seen, total: state.total, materialUnseen: state.materialUnseen },
    panels: panels.panels,
    record: version?.record ?? null,
    versionsRead: state.versionsRead,
    slots: await listLinkSlots(car.id, link.id),
    invoices: invoices.map((row) => ({ label: row.label })),
    offer: offer === null ? null : offerDtoOf(offer, now),
  };
};

linkRouter.get('/:token', async (request: Request, response: Response) => {
  response.json(await buildLinkView(await resolve(request)));
});

linkRouter.post('/:token/seen', async (request: Request, response: Response) => {
  const resolved = await resolve(request);
  requireBuyer(resolved.link);
  const { link, car } = resolved;
  const body = asRecord(request.body);
  const findingId = typeof body.findingId === 'string' ? body.findingId : '';

  if (car.current_version === null) throw notFound();
  const version = await loadVersion(car.id, car.current_version);
  if (version === null) throw notFound();
  const finding = version.findings.find((candidate) => candidate.id === findingId);
  if (finding === undefined) throw notFound();

  const hash = contentHashOfFrozen(finding);
  const result = await transaction(async (tx) => {
    const inserted = await tx.queryOne<{ seen_at: Date }>(
      `INSERT INTO seen_record (link_id, finding_id, content_hash, version_number)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (link_id, finding_id, content_hash) DO NOTHING
       RETURNING seen_at`,
      [link.id, findingId, hash, version.number],
    );
    if (inserted !== null) {
      await applyRereadStatuses(tx, car.id, version.number);
      return { status: 201, seenAt: inserted.seen_at };
    }
    const existing = await tx.queryOne<{ seen_at: Date }>(
      'SELECT seen_at FROM seen_record WHERE link_id = $1 AND finding_id = $2 AND content_hash = $3',
      [link.id, findingId, hash],
    );
    if (existing === null) throw new Error('The seen record vanished');
    return { status: 200, seenAt: existing.seen_at };
  });

  const state = seenStateOf(version, await loadSeenRows(link.id));
  response.status(result.status).json({
    findingId,
    seenAt: result.seenAt.toISOString(),
    progress: { seen: state.seen, total: state.total, materialUnseen: state.materialUnseen },
  });
});

const streamStored = async (response: Response, key: string, contentType: string): Promise<void> => {
  let stored;
  try {
    stored = await getObject(key);
  } catch {
    throw refuse(503, 'storage_unavailable', 'The file store is not answering');
  }
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(stored.bytes.length));
  response.end(stored.bytes);
};

linkRouter.get('/:token/photos/:uploadId', async (request: Request, response: Response) => {
  const { car } = await resolve(request);
  const uploadId = String(request.params.uploadId);
  const upload = await queryOne<{ id: string }>(
    "SELECT id FROM upload WHERE id = $1 AND car_id = $2 AND kind = 'photo'",
    [uploadId, car.id],
  );
  if (upload === null) throw notFound();
  await streamStored(response, objectKeys.derivative(car.id, uploadId), 'image/jpeg');
});

linkRouter.get('/:token/report', async (request: Request, response: Response) => {
  const { car, link } = await resolve(request);
  requireBuyer(link);
  if (car.current_version === null) throw notFound();
  await streamStored(response, objectKeys.report(car.id, car.current_version), 'application/pdf');
});

const requireSeenInVersion = async (linkId: string, number: number): Promise<void> => {
  const row = await queryOne<{ one: number }>(
    'SELECT 1 AS one FROM seen_record WHERE link_id = $1 AND version_number = $2 LIMIT 1',
    [linkId, number],
  );
  if (row === null) throw notFound();
};

linkRouter.get('/:token/report/:number', async (request: Request, response: Response) => {
  const { car, link } = await resolve(request);
  requireBuyer(link);
  const number = Number(request.params.number);
  await requireSeenInVersion(link.id, number);
  await streamStored(response, objectKeys.report(car.id, number), 'application/pdf');
});

linkRouter.get('/:token/versions/:number', async (request: Request, response: Response) => {
  const { car, link } = await resolve(request);
  requireBuyer(link);
  const number = Number(request.params.number);
  await requireSeenInVersion(link.id, number);
  const version = await loadVersion(car.id, number);
  if (version === null) throw notFound();
  response.json(versionDto(version));
});

linkRouter.get('/:token/handover', async (request: Request, response: Response) => {
  const { car, link } = await resolve(request);
  requireBuyer(link);
  if (car.listing_status !== 'sold') throw refuse(409, 'listing_not_sold', 'This car is not sold');
  const winner = await queryOne<{ link_id: string }>(
    "SELECT link_id FROM offer WHERE car_id = $1 AND status = 'accepted'",
    [car.id],
  );
  if (winner === null || winner.link_id !== link.id) {
    throw refuse(403, 'not_the_buyer', 'This handover record belongs to another buyer');
  }
  await streamStored(response, objectKeys.handover(car.id), 'application/pdf');
});

/** The offer gate: a live listing, every material finding of the current version seen, and no other live offer. */
const checkOfferGate = async (tx: Tx, car: CarRow, linkId: string): Promise<void> => {
  if (!acceptsOffersAndClaims(car.listing_status)) throw listingClosed();
  if (car.current_version === null) throw listingClosed();
  const version = await loadVersion(car.id, car.current_version);
  if (version === null) throw listingClosed();

  const unseen: string[] = [];
  for (const finding of version.findings) {
    if (!finding.material) continue;
    const seen = await tx.queryOne<{ one: number }>(
      'SELECT 1 AS one FROM seen_record WHERE link_id = $1 AND finding_id = $2 AND content_hash = $3',
      [linkId, finding.id, contentHashOfFrozen(finding)],
    );
    if (seen === null) unseen.push(finding.id);
  }
  if (unseen.length > 0) {
    throw refuse(409, 'material_findings_unseen', 'Read every material finding before making an offer', { unseen });
  }
};

linkRouter.post('/:token/offers', async (request: Request, response: Response) => {
  const resolved = await resolve(request);
  requireBuyer(resolved.link);
  const { car, link } = resolved;
  const key = requireIdempotencyKey(
    typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined,
  );
  const body = asRecord(request.body);
  const amountPounds = body.amountPounds;
  let alertId: string | null = null;

  const result = await withIdempotency<OfferDto>(
    `link-offer:${link.id}`,
    key,
    { amountPounds: amountPounds ?? null },
    async (tx) => {
      await checkOfferGate(tx, car, link.id);

      const existing = await tx.queryOne<{ id: string }>(
        "SELECT id FROM offer WHERE link_id = $1 AND status IN ('open','needs_reread') AND lapses_at > now() LIMIT 1",
        [link.id],
      );
      if (existing !== null) throw refuse(409, 'offer_exists', 'You already have an offer on this car');

      if (
        typeof amountPounds !== 'number' ||
        !Number.isInteger(amountPounds) ||
        amountPounds < 1 ||
        amountPounds > 10_000_000
      ) {
        throw validationFailure({ amountPounds: 'Enter a whole number of pounds from 1 to 10000000' });
      }

      const now = new Date();
      const lapsesAt = new Date(now.getTime() + config.offerLapseSeconds * 1000);
      const id = randomUUID();
      await tx.query(
        `INSERT INTO offer (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
         VALUES ($1, $2, $3, $4, 'open', $5, $6)`,
        [id, car.id, link.id, amountPounds, now, lapsesAt],
      );
      alertId = await recordAlert(tx, car.id, 'new_offer');

      const row = await tx.queryOne<{
        id: string;
        car_id: string;
        link_id: string;
        amount_pounds: number;
        status: OfferDto['status'];
        stamped_at: Date;
        lapses_at: Date;
      }>('SELECT id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at FROM offer WHERE id = $1', [id]);
      if (row === null) throw notFound();
      return { status: 201, response: offerDto(row, now) };
    },
  );

  if (!result.replayed && alertId !== null) await sendRecordedAlert(alertId, 'new_offer');
  response.status(result.status).json(result.response);
});

linkRouter.post('/:token/slots/:slotId/claim', async (request: Request, response: Response) => {
  const resolved = await resolve(request);
  requireBuyer(resolved.link);
  const key = requireIdempotencyKey(
    typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined,
  );
  const result = await claimSlot(
    {
      carId: resolved.car.id,
      linkId: resolved.link.id,
      slotId: String(request.params.slotId),
      idempotencyKey: key,
    },
    async () => {
      if (!acceptsOffersAndClaims(resolved.car.listing_status)) throw listingClosed();
    },
  );
  response.status(result.status).json(result.response);
});

linkRouter.post('/:token/slots/:slotId/release', async (request: Request, response: Response) => {
  const resolved = await resolve(request);
  requireBuyer(resolved.link);
  response.json(await releaseSlot(resolved.car.id, resolved.link.id, String(request.params.slotId)));
});

const payloadHash = (item: Record<string, unknown>): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        kind: item.kind,
        panelId: item.panelId,
        microns: item.microns ?? null,
        u: item.u ?? null,
        v: item.v ?? null,
        wording: item.wording ?? null,
        capturedAt: item.capturedAt,
      }),
    )
    .digest('hex');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validateCaptureItem = (raw: Record<string, unknown>): Record<string, string> | null => {
  const errors: Record<string, string> = {};
  const panel = typeof raw.panelId === 'string' ? panelById(raw.panelId) : undefined;
  if (panel === undefined) errors.panelId = 'That is not a panel on this car';
  if (typeof raw.capturedAt !== 'string' || Number.isNaN(Date.parse(raw.capturedAt))) {
    errors.capturedAt = 'Send the capture time';
  }

  if (raw.kind === 'reading') {
    if (panel !== undefined && !isGaugeable(panel)) errors.panelId = ERRORS.plasticPanel;
    const microns = raw.microns;
    if (typeof microns !== 'number' || !Number.isInteger(microns) || microns < MICRONS_MIN || microns > MICRONS_MAX) {
      errors.microns = ERRORS.readingRange;
    }
  } else if (raw.kind === 'finding') {
    for (const field of ['u', 'v'] as const) {
      const value = raw[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        errors[field] = 'Enter a number from 0 to 1';
      }
    }
    if (typeof raw.wording !== 'string' || raw.wording.length < 1 || raw.wording.length > 600) {
      errors.wording = 'Enter between 1 and 600 characters';
    }
  } else {
    errors.kind = 'Choose reading or finding';
  }

  return Object.keys(errors).length === 0 ? null : errors;
};

linkRouter.post('/:token/capture', async (request: Request, response: Response) => {
  const resolved = await resolve(request);
  requireInspector(resolved.link);
  const body = asRecord(request.body);
  const batchId = typeof body.batchId === 'string' && UUID_PATTERN.test(body.batchId) ? body.batchId : null;
  const items = Array.isArray(body.items) ? (body.items as unknown[]) : null;
  if (batchId === null || items === null || items.length < 1 || items.length > 100) {
    throw validationFailure({ items: 'Send a batch of 1 to 100 items with a batch id' });
  }

  const results: CaptureResult[] = [];
  for (const entry of items) {
    const raw = asRecord(entry);
    const clientId = typeof raw.clientId === 'string' && UUID_PATTERN.test(raw.clientId) ? raw.clientId : null;
    if (clientId === null) {
      results.push({ clientId: String(raw.clientId ?? ''), state: 'rejected', errors: { clientId: 'Send a client id' } });
      continue;
    }
    const errors = validateCaptureItem(raw);
    if (errors !== null) {
      results.push({ clientId, state: 'rejected', errors });
      continue;
    }

    const item = raw as unknown as CaptureItem;
    const hash = payloadHash(raw);
    const state = await transaction(async (tx) => {
      const inserted = await tx.queryOne<{ client_id: string }>(
        `INSERT INTO capture_item (link_id, client_id, payload_hash, kind, panel_id, microns, u, v, wording, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (link_id, client_id) DO NOTHING
         RETURNING client_id`,
        [
          resolved.link.id,
          clientId,
          hash,
          item.kind,
          item.panelId,
          item.kind === 'reading' ? item.microns : null,
          item.kind === 'finding' ? roundAnchor(item.u) : null,
          item.kind === 'finding' ? roundAnchor(item.v) : null,
          item.kind === 'finding' ? item.wording : null,
          item.capturedAt,
        ],
      );
      if (inserted !== null) return 'applied' as const;
      const existing = await tx.queryOne<{ payload_hash: string }>(
        'SELECT payload_hash FROM capture_item WHERE link_id = $1 AND client_id = $2',
        [resolved.link.id, clientId],
      );
      if (existing === null) throw new Error('The capture row vanished');
      return existing.payload_hash === hash ? ('duplicate' as const) : ('conflict' as const);
    });
    results.push({ clientId, state });
  }

  response.json({ batchId, results });
});
