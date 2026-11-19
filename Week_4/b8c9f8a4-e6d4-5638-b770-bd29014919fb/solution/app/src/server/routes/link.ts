// Everything a named link can reach: the buyer's view of the car, their seen records, viewings
// and offers, and the inspector's capture queue. A link reaches only its own car and role.

import { randomUUID } from 'node:crypto';
import { lockKey, one, query, transaction, withWaitingLock } from '../db/pool.js';
import { fail } from '../http/errors.js';
import { asObject, readJson, type Context } from '../http/request.js';
import { sendBytes, sendJson } from '../http/respond.js';
import type { Router } from '../http/router.js';
import { Fields } from '../http/validate.js';
import { MESSAGE } from '../../shared/copy.js';
import { isGaugeable, panel } from '../../shared/panels.js';
import { MICRONS_MAX, MICRONS_MIN } from '../../shared/measures.js';
import { bodyHash, keepSuccess, replayOf, requireKey } from '../domain/idempotency.js';
import { linkByToken, requireRole, requireUsable, statusOf, type LinkRow } from '../domain/links.js';
import { requireLive } from '../domain/listing.js';
import { lapsesAt, offerJson, settleRereadState, effectiveStatus, type OfferRow } from '../domain/offers.js';
import { progressOf, seenHashes, versionFindings } from '../domain/seen.js';
import { raiseAlert } from '../services/alerts.js';
import { keys } from '../services/store.js';
import {
  currentVersion, loadCar, maskRegistration, panelsJson, type CarRow, type VersionRow,
} from '../domain/state.js';
import { fromStore } from './owner-uploads.js';
import { slotJson, type SlotRow } from './owner-people.js';
import { versionJson, versionOf } from './owner-publish.js';

interface Caller {
  link: LinkRow;
  car: CarRow;
}

async function caller(context: Context, role?: 'buyer' | 'inspector'): Promise<Caller> {
  const link = requireUsable(await linkByToken(context.params.token));
  if (role) requireRole(link, role);
  // A link belongs to a car file, and a car file is never deleted.
  const car = (await loadCar(link.car_id)) as CarRow;
  return { link, car };
}

async function slotsFor(car: CarRow, linkId: string): Promise<unknown[]> {
  const rows = await query<SlotRow>('SELECT * FROM slot WHERE car_id = $1 ORDER BY starts_at ASC', [car.id]);
  return Promise.all(rows.map((row) => slotJson(row, false, linkId)));
}

async function latestOffer(linkId: string): Promise<OfferRow | null> {
  return one<OfferRow>('SELECT * FROM offer WHERE link_id = $1 ORDER BY stamped_at DESC LIMIT 1', [linkId]);
}

async function versionsRead(carId: string, linkId: string): Promise<number[]> {
  const rows = await query<{ number: number }>(
    `SELECT DISTINCT vf.number FROM version_finding vf
     JOIN seen_record s ON s.finding_id = vf.finding_id AND s.content_hash = vf.content_hash
     WHERE vf.car_id = $1 AND s.link_id = $2 ORDER BY 1`,
    [carId, linkId],
  );
  return rows.map((row) => row.number);
}

async function removedFindings(car: CarRow, version: VersionRow, linkId: string): Promise<unknown[]> {
  const inCurrent = new Set((await versionFindings(car.id, version.number)).map((item) => item.finding_id));
  const seen = await query<{ finding_id: string }>(
    'SELECT DISTINCT finding_id FROM seen_record WHERE link_id = $1',
    [linkId],
  );
  const missing = seen.map((row) => row.finding_id).filter((id) => !inCurrent.has(id));
  if (missing.length === 0) return [];
  const versions = await query<VersionRow>('SELECT * FROM version WHERE car_id = $1 ORDER BY number ASC', [car.id]);
  const found: unknown[] = [];
  for (const id of missing) {
    let title = '';
    let removedInVersion = version.number;
    for (const row of versions) {
      const holds = row.snapshot.findings.find((item) => item.id === id);
      if (holds) {
        title = holds.title;
      } else if (title) {
        removedInVersion = row.number;
        break;
      }
    }
    // a seen finding was in some published version, so its title was found
    found.push({ id, title, removedInVersion });
  }
  return found;
}

export function registerLink(router: Router): void {
  router.get('/api/link/:token', async (context) => {
    const { link, car } = await caller(context);
    const now = new Date();
    const base = {
      role: link.role,
      name: link.name,
      status: statusOf(link, now),
      expiresAt: link.expires_at.toISOString(),
      serverNow: now.toISOString(),
    };
    const version = (await currentVersion(car)) as VersionRow; // a link is only issued on a published car, and current_version is never cleared
    const carBlock = {
      name: car.name,
      maskedRegistration: maskRegistration(car.registration),
      askingPounds: car.asking_pounds,
      viewingArea: car.viewing_area,
      story: car.story,
      listingStatus: car.listing_status,
      firstUsedDate: version.snapshot.record.firstUsedDate,
    };
    const panels = (await panelsJson(car.id, { kind: 'link', linkId: link.id, role: link.role })).panels;
    if (link.role === 'inspector') {
      sendJson(context.response, 200, { ...base, car: carBlock, panels });
      return;
    }
    const frozen = await versionFindings(car.id, version.number);
    const seen = await seenHashes(link.id);
    const seenAtRows = await query<{ finding_id: string; content_hash: string; seen_at: Date }>(
      'SELECT finding_id, content_hash, seen_at FROM seen_record WHERE link_id = $1',
      [link.id],
    );
    const stamps = new Map(seenAtRows.map((row) => [`${row.finding_id}:${row.content_hash}`, row.seen_at]));
    const findings = frozen.map((item) => {
      const detail = version.snapshot.findings.find((row) => row.id === item.finding_id);
      const isSeen = seen.get(item.finding_id)?.has(item.content_hash) ?? false;
      const everSeen = (seen.get(item.finding_id)?.size ?? 0) > 0;
      return {
        ...(detail as NonNullable<typeof detail>),
        id: item.finding_id,
        position: item.position,
        seen: isSeen,
        // stamps was read after seen, and seen rows are never deleted
        seenAt: isSeen ? (stamps.get(`${item.finding_id}:${item.content_hash}`) as Date).toISOString() : null,
        changedSinceSeen: !isSeen && everSeen,
      };
    });
    const hero = heroOfVersion(findings);
    const offer = await latestOffer(link.id);
    const invoices = await query<{ label: string }>(
      "SELECT label FROM upload WHERE car_id = $1 AND kind = 'invoice' ORDER BY created_at ASC",
      [car.id],
    );
    sendJson(context.response, 200, {
      ...base,
      car: carBlock,
      version: { number: version.number, publishedAt: version.published_at.toISOString() },
      heroFindingId: hero ? hero.id : null,
      findings,
      removedFindings: await removedFindings(car, version, link.id),
      progress: progressOf(frozen, seen),
      panels,
      record: version.snapshot.record,
      versionsRead: await versionsRead(car.id, link.id),
      slots: await slotsFor(car, link.id),
      invoices: invoices.map((row) => ({ label: row.label })),
      offer: offer ? offerJson(offer, now) : null,
    });
  });

  router.post('/api/link/:token/seen', async (context) => {
    const { link, car } = await caller(context, 'buyer');
    const body = asObject(readJson(context));
    const version = (await currentVersion(car)) as VersionRow; // a link is only issued on a published car, and current_version is never cleared
    const frozen = await versionFindings(car.id, version.number);
    const target = frozen.find((item) => item.finding_id === body.findingId);
    if (!target) fail(404, 'not_found', 'That finding is not in the current version.');
    const existing = await one<{ seen_at: Date }>(
      'SELECT seen_at FROM seen_record WHERE link_id = $1 AND finding_id = $2 AND content_hash = $3',
      [link.id, target.finding_id, target.content_hash],
    );
    let status = 200;
    let seenAt: Date;
    if (existing) {
      seenAt = existing.seen_at;
    } else {
      const written = await one<{ seen_at: Date }>(
        `INSERT INTO seen_record (link_id, finding_id, content_hash) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING seen_at`,
        [link.id, target.finding_id, target.content_hash],
      );
      if (written) {
        status = 201;
        seenAt = written.seen_at;
      } else {
        // the insert hit a conflict, so the row exists, and seen rows are never deleted
        const again = (await one<{ seen_at: Date }>(
          'SELECT seen_at FROM seen_record WHERE link_id = $1 AND finding_id = $2 AND content_hash = $3',
          [link.id, target.finding_id, target.content_hash],
        )) as { seen_at: Date };
        seenAt = again.seen_at;
      }
    }
    const progress = progressOf(frozen, await seenHashes(link.id));
    const offer = await latestOffer(link.id);
    if (offer) await transaction(async (tx) => settleRereadState(tx, offer.id, progress.materialUnseen));
    sendJson(context.response, status, {
      findingId: target.finding_id,
      seenAt: seenAt.toISOString(),
      progress,
    });
  });

  router.get('/api/link/:token/photos/:uploadId', async (context) => {
    const { car } = await caller(context);
    const upload = await one<{ id: string; kind: string }>(
      'SELECT id, kind FROM upload WHERE id = $1 AND car_id = $2',
      [/^[0-9a-fA-F-]{36}$/.test(context.params.uploadId) ? context.params.uploadId : randomUUID(), car.id],
    );
    if (!upload || upload.kind !== 'photo') fail(404, 'not_found', 'That photo is not on this car.');
    const object = await fromStore(keys.derivative(car.id, upload.id));
    sendBytes(context.response, 200, object.body, 'image/jpeg');
  });

  router.get('/api/link/:token/report', async (context) => {
    const { car } = await caller(context);
    const version = (await currentVersion(car)) as VersionRow; // a link is only issued on a published car, and current_version is never cleared
    const object = await fromStore(keys.report(car.id, version.number));
    sendBytes(context.response, 200, object.body, 'application/pdf');
  });

  router.get('/api/link/:token/report/:number', async (context) => {
    const { link, car } = await caller(context);
    const version = await readableVersion(car, link, context.params.number);
    const object = await fromStore(keys.report(car.id, version.number));
    sendBytes(context.response, 200, object.body, 'application/pdf');
  });

  router.get('/api/link/:token/versions/:number', async (context) => {
    const { link, car } = await caller(context);
    sendJson(context.response, 200, versionJson(await readableVersion(car, link, context.params.number)));
  });

  router.get('/api/link/:token/handover', async (context) => {
    const { link, car } = await caller(context, 'buyer');
    if (car.listing_status !== 'sold') fail(409, 'listing_not_sold', 'This car is not sold.');
    // a sold car was sold on its accepted offer, and an accepted offer never changes status
    const accepted = (await one<OfferRow>(
      "SELECT * FROM offer WHERE car_id = $1 AND status = 'accepted' LIMIT 1",
      [car.id],
    )) as OfferRow;
    if (accepted.link_id !== link.id) fail(403, 'not_the_buyer', 'That record belongs to the buyer.');
    const object = await fromStore(keys.handover(car.id));
    sendBytes(context.response, 200, object.body, 'application/pdf');
  });

  router.post('/api/link/:token/offers', async (context) => {
    const { link, car } = await caller(context, 'buyer');
    const body = asObject(readJson(context));
    const scope = `offer:${link.id}`;
    const hash = bodyHash({ path: context.path, body });
    const header = context.request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (key) {
      const replay = await replayOf(scope, key, hash);
      if (replay) {
        sendJson(context.response, replay.status, replay.response);
        return;
      }
    }
    const safeKey = requireKey(header);
    requireLive(car.listing_status);
    const version = (await currentVersion(car)) as VersionRow; // a link is only issued on a published car, and current_version is never cleared
    const frozen = await versionFindings(car.id, version.number);
    const seen = await seenHashes(link.id);
    const unseen = frozen
      .filter((item) => item.material && !(seen.get(item.finding_id)?.has(item.content_hash) ?? false))
      .map((item) => item.finding_id);
    if (unseen.length > 0) {
      fail(409, 'material_findings_unseen', MESSAGE.materialUnseen, { unseen });
    }
    // One buyer's offers run one at a time, so requests that arrive together with one key make one offer.
    const outcome = await withWaitingLock(lockKey('offer', link.id), async () => {
      const replay = await replayOf(scope, safeKey, hash);
      if (replay) return { stored: replay, fresh: false };
      const existing = await latestOffer(link.id);
      if (existing && (effectiveStatus(existing) === 'open' || effectiveStatus(existing) === 'needs_reread')) {
        fail(409, 'offer_exists', MESSAGE.offerExists);
      }
      const fields = new Fields();
      const amountPounds = fields.whole('amountPounds', body.amountPounds, 1, 10000000);
      fields.done();
      const stampedAt = new Date();
      const row = await one<OfferRow>(
        `INSERT INTO offer (id, car_id, link_id, amount_pounds, status, stamped_at, lapses_at)
         VALUES ($1, $2, $3, $4, 'open', $5, $6) RETURNING *`,
        [randomUUID(), car.id, link.id, amountPounds, stampedAt, lapsesAt(stampedAt)],
      );
      const made = offerJson(row as OfferRow);
      const stored = await keepSuccess(scope, safeKey, hash, 201, made);
      // under the lock with no replay, this insert is the first for the key
      return { stored, fresh: true };
    });
    if (outcome.fresh) await raiseAlert(car.id, 'new_offer');
    sendJson(context.response, outcome.stored.status, outcome.stored.response);
  });

  router.post('/api/link/:token/slots/:slotId/claim', async (context) => {
    const { link, car } = await caller(context, 'buyer');
    const body = asObject(readJson(context));
    const scope = `claim:${link.id}`;
    // The slot is part of what was asked for, so the same key on another slot is a conflict.
    const hash = bodyHash({ path: context.path, body });
    const header = context.request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (key) {
      const replay = await replayOf(scope, key, hash);
      if (replay) {
        sendJson(context.response, replay.status, replay.response);
        return;
      }
    }
    const slot = await one<SlotRow>('SELECT * FROM slot WHERE id = $1 AND car_id = $2', [
      /^[0-9a-fA-F-]{36}$/.test(context.params.slotId) ? context.params.slotId : randomUUID(),
      car.id,
    ]);
    if (!slot) fail(404, 'not_found', 'That viewing slot is not on this car.');
    const safeKey = requireKey(header);
    requireLive(car.listing_status);
    if (slot.starts_at.getTime() <= Date.now()) fail(409, 'slot_past', 'That viewing has already started.');
    // One buyer's claims run one at a time, so requests that arrive together with one key make one claim and one alert.
    const outcome = await withWaitingLock(lockKey('claim', link.id), async () => {
      const replay = await replayOf(scope, safeKey, hash);
      if (replay) return { stored: replay, fresh: false };
      const held = await one<{ id: string }>(
        'SELECT id FROM slot WHERE car_id = $1 AND holder_link_id = $2',
        [car.id, link.id],
      );
      if (held && held.id !== slot.id) fail(409, 'already_holding_slot', MESSAGE.alreadyHolding);
      const taken = await one<SlotRow>(
        `UPDATE slot SET holder_link_id = $2 WHERE id = $1 AND (holder_link_id IS NULL OR holder_link_id = $2)
         RETURNING *`,
        [slot.id, link.id],
      );
      if (!taken) fail(409, 'slot_taken', MESSAGE.slotTaken);
      const made = await slotJson(taken, false, link.id);
      const stored = await keepSuccess(scope, safeKey, hash, 201, made);
      // under the lock with no replay, this insert is the first for the key
      return { stored, fresh: !held };
    });
    if (outcome.fresh) await raiseAlert(car.id, 'viewing_claim');
    sendJson(context.response, outcome.stored.status, outcome.stored.response);
  });

  router.post('/api/link/:token/slots/:slotId/release', async (context) => {
    const { link, car } = await caller(context, 'buyer');
    readJson(context);
    const released = await one<SlotRow>(
      'UPDATE slot SET holder_link_id = NULL WHERE id = $1 AND car_id = $2 AND holder_link_id = $3 RETURNING *',
      [/^[0-9a-fA-F-]{36}$/.test(context.params.slotId) ? context.params.slotId : randomUUID(), car.id, link.id],
    );
    if (!released) fail(403, 'not_slot_holder', 'You are not holding that viewing.');
    sendJson(context.response, 200, await slotJson(released, false, link.id));
  });

  router.post('/api/link/:token/capture', async (context) => {
    const { link } = await caller(context, 'inspector');
    const body = asObject(readJson(context));
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || items.length < 1 || items.length > 100 || typeof body.batchId !== 'string') {
      fail(422, 'validation', 'Send 1 to 100 capture items.', { errors: { items: 'Send 1 to 100 capture items.' } });
    }
    const results = [];
    for (const raw of items) {
      results.push(await applyCaptureItem(link.id, asObject(raw)));
    }
    sendJson(context.response, 200, { batchId: body.batchId, results });
  });
}

function heroOfVersion(findings: { id: string; severity: string; position: number }[]): { id: string } | null {
  const rank: Record<string, number> = { cosmetic: 0, moderate: 1, serious: 2 };
  let best: { id: string; severity: string; position: number } | null = null;
  for (const item of findings) {
    if (!best || rank[item.severity] > rank[best.severity]
      || (rank[item.severity] === rank[best.severity] && item.position < best.position)) {
      best = item;
    }
  }
  return best;
}

async function readableVersion(car: CarRow, link: LinkRow, text: string): Promise<VersionRow> {
  const version = await versionOf(car.id, text);
  const held = await one<{ found: number }>(
    `SELECT 1 AS found FROM version_finding vf
     JOIN seen_record s ON s.finding_id = vf.finding_id AND s.content_hash = vf.content_hash
     WHERE vf.car_id = $1 AND vf.number = $2 AND s.link_id = $3 LIMIT 1`,
    [car.id, version.number, link.id],
  );
  const current = car.current_version;
  if (!held && version.number !== current) fail(404, 'not_found', 'That version is not one you have read.');
  return version;
}

type CaptureState = 'applied' | 'duplicate' | 'conflict' | 'rejected';

async function applyCaptureItem(
  linkId: string,
  item: Record<string, unknown>,
): Promise<{ clientId: string; state: CaptureState; errors?: Record<string, string> }> {
  const clientId = typeof item.clientId === 'string' ? item.clientId : '';
  if (!clientId) return { clientId, state: 'rejected', errors: { clientId: 'Send a client id.' } };
  const fields = new Fields();
  const kind = fields.choice('kind', item.kind, ['reading', 'finding'] as const);
  const panelId = typeof item.panelId === 'string' ? item.panelId : '';
  const found = panel(panelId);
  if (!found) fields.add('panelId', 'That is not one of the car’s panels.');
  const capturedAt = typeof item.capturedAt === 'string' ? new Date(item.capturedAt) : new Date(Number.NaN);
  if (Number.isNaN(capturedAt.getTime())) fields.add('capturedAt', 'Send when it was captured.');
  let microns: number | null = null;
  let u: number | null = null;
  let v: number | null = null;
  let wording: string | null = null;
  if (kind === 'reading') {
    if (found && !isGaugeable(panelId)) fields.add('panelId', MESSAGE.plastic);
    const value = item.microns;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < MICRONS_MIN || value > MICRONS_MAX) {
      fields.add('microns', MESSAGE.microns);
    } else {
      microns = value;
    }
  } else {
    u = fields.fraction('u', item.u);
    v = fields.fraction('v', item.v);
    wording = fields.text('wording', item.wording, 1, 600);
  }
  if (fields.bad) return { clientId, state: 'rejected', errors: fields.errors };

  const payloadHash = bodyHash({ kind, panelId, microns, u, v, wording, capturedAt: capturedAt.toISOString() });
  const written = await one<{ payload_hash: string }>(
    `INSERT INTO capture_item (link_id, client_id, payload_hash, kind, panel_id, microns, u, v, wording, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (link_id, client_id) DO NOTHING RETURNING payload_hash`,
    [linkId, clientId, payloadHash, kind, panelId, microns, u, v, wording, capturedAt],
  );
  if (written) return { clientId, state: 'applied' };
  const existing = await one<{ payload_hash: string }>(
    'SELECT payload_hash FROM capture_item WHERE link_id = $1 AND client_id = $2',
    [linkId, clientId],
  );
  // the insert hit a conflict, so the row exists, and capture rows are never deleted
  if ((existing as { payload_hash: string }).payload_hash === payloadHash) return { clientId, state: 'duplicate' };
  return { clientId, state: 'conflict' };
}
