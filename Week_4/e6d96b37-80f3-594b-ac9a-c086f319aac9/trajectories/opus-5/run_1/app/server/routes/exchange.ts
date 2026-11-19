import { randomUUID } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { conflict, fieldCopy, invalid, notFound, stale, uploadTooLarge } from '../http/errors.ts';
import { executeCommand, type CommandContext } from '../http/precedence.ts';
import { readJsonBody, readMultipartBody, sendJson, sendNoContent } from '../http/request.ts';
import type { Router } from '../http/router.ts';
import { copyObject, objectKeys, putObject, sha256Hex } from '../providers/storage.ts';
import type { Sql } from '../providers/db.ts';
import { appendEvent, type AppendedEvent } from '../store/events.ts';
import { loadDesk } from '../store/state.ts';
import { namespaceNow } from '../domain/clock.ts';
import {
  basketOf,
  basketProblem,
  canFreeze,
  isExpired,
  statusAfterChangeBy,
  windowSecondsFor,
} from '../domain/offer.ts';
import { offerIneligibility } from '../domain/specimen.ts';
import { contentTypeOf, extensionOf, judgePhoto, refusalCopy } from '../domain/photo.ts';
import { deskVisibleTo, requireCommandId, requireExpectedVersion, requireString, requireStringList, viewerParty } from './common.ts';
import type { Offer, Party } from '../../shared/types.ts';

interface OfferRow {
  key: string;
  version: number;
  status: string;
  dealer_items: string[];
  counterpart_items: string[];
  accept_dealer: number | null;
  accept_counterpart: number | null;
  expires_at: Date | null;
}

async function lockOffer(sql: Sql, ns: string, key: string): Promise<OfferRow | null> {
  const found = await sql.query<OfferRow>(
    `SELECT key, version, status, dealer_items, counterpart_items,
            accept_dealer, accept_counterpart, expires_at
       FROM offers WHERE ns = $1 AND key = $2 FOR UPDATE`,
    [ns, key],
  );
  return found.rows[0] ?? null;
}

async function offerReply(sql: Sql, ns: string, role: Party, key: string): Promise<unknown> {
  const { state } = await loadDesk(ns, role, sql);
  const offer = state.offers[key];
  if (!offer) throw notFound();
  return { offer: { key, ...offer } };
}

/** Every specimen reserved or held anywhere other than this offer. */
async function reservedElsewhere(
  sql: Sql,
  ns: string,
  offerKey: string,
  keys: string[],
): Promise<boolean> {
  if (keys.length === 0) return false;
  const others = await sql.query<{ status: string; dealer_items: string[]; counterpart_items: string[] }>(
    `SELECT status, dealer_items, counterpart_items FROM offers
      WHERE ns = $1 AND key <> $2
        AND status IN ('sent','countered','accepted','dispatched','received','disputed')`,
    [ns, offerKey],
  );
  const taken = new Set<string>();
  for (const row of others.rows) {
    for (const key of [...row.dealer_items, ...row.counterpart_items]) taken.add(key);
  }
  const holds = await sql.query<{ specimen: string }>(
    'SELECT specimen FROM offer_holds WHERE ns = $1 AND offer <> $2',
    [ns, offerKey],
  );
  for (const row of holds.rows) taken.add(row.specimen);
  return keys.some((key) => taken.has(key));
}

async function anyManifestFrozen(sql: Sql, ns: string, offerKey: string): Promise<boolean> {
  const found = await sql.query(
    'SELECT 1 FROM manifests WHERE ns = $1 AND offer = $2 AND frozen = true',
    [ns, offerKey],
  );
  return (found.rowCount ?? 0) > 0;
}

/** Re-dates the response window after a change by `party`. */
async function restartWindow(sql: Sql, ns: string, party: Party): Promise<Date> {
  const now = await namespaceNow(sql, ns);
  return new Date(now.getTime() + windowSecondsFor(party) * 1000);
}

export function registerExchangeRoutes(router: Router): void {
  /* -- send -------------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/send',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const dealerItems = requireStringList(body, 'dealer_items');
      const counterpartItems = requireStringList(body, 'counterpart_items');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, expectedVersion, dealerItems, counterpartItems },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          if (!state.offers[offerKey]) return false;
          // A key naming an invisible specimen is itself not found.
          return [...dealerItems, ...counterpartItems].every(
            (key) => state.specimens[key] !== undefined && state.specimens[key]?.owner !== 'outsider',
          );
        },
        permitted: () => session?.role === 'dealer',
        needsStepUp: true,
        commit: async (context) => {
          const { sql } = context;
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();
          if (isExpired(offer.status as Offer['status'])) throw conflict(F.OFFER_EXPIRED);
          // Sending a non-draft is stale.
          if (offer.status !== 'draft' || offer.version !== expectedVersion) throw stale();

          // Reservation is decided before eligibility, per the published order.
          if (await reservedElsewhere(sql, ns, offerKey, [...dealerItems, ...counterpartItems])) {
            throw conflict(F.OFFER_TAKEN);
          }

          const { state } = await loadDesk(ns, 'dealer', sql);
          for (const [party, items] of [
            ['dealer', dealerItems],
            ['counterpart', counterpartItems],
          ] as const) {
            for (const key of items) {
              const specimen = state.specimens[key];
              if (!specimen) throw notFound();
              if (specimen.owner !== party) throw notFound();
              if (specimen.attribution.register === 'pending') throw conflict(F.CATALOG_PENDING);
              if (offerIneligibility(specimen) !== null) throw conflict(F.IN_OFFER);
            }
          }

          const fieldErrors: Record<string, string> = {};
          for (const [field, items] of [
            ['dealer_items', dealerItems],
            ['counterpart_items', counterpartItems],
          ] as const) {
            const problem = basketProblem(items);
            if (problem === 'empty') fieldErrors[field] = fieldCopy.basketEmpty;
            if (problem === 'full') fieldErrors[field] = fieldCopy.basketFull;
          }
          if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);

          const expiresAt = await restartWindow(sql, ns, 'dealer');
          await sql.query(
            `UPDATE offers
                SET status = 'sent', version = version + 1,
                    dealer_items = $3, counterpart_items = $4,
                    accept_dealer = NULL, accept_counterpart = NULL, expires_at = $5
              WHERE ns = $1 AND key = $2`,
            [ns, offerKey, JSON.stringify(dealerItems), JSON.stringify(counterpartItems), expiresAt],
          );

          const event = await appendEvent(sql, ns, {
            type: 'offer.sent',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { offer: offerKey },
          });
          return { status: 200, body: await offerReply(sql, ns, 'dealer', offerKey), events: [event] };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- review holds ------------------------------------------------------ */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/holds',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const specimenKey = requireString(body, 'specimen');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, specimenKey },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined;
        },
        permitted: () => session?.role === 'counterpart',
        commit: async (context) => {
          const { sql } = context;
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();
          if (isExpired(offer.status as Offer['status'])) throw conflict(F.OFFER_EXPIRED);
          if (await reservedElsewhere(sql, ns, offerKey, [specimenKey])) {
            throw conflict(F.OFFER_TAKEN);
          }

          const now = await namespaceNow(sql, ns);
          await sql.query(
            `INSERT INTO offer_holds (ns, offer, specimen, party, placed_at, release_after)
             VALUES ($1,$2,$3,'counterpart',$4,NULL)
             ON CONFLICT (ns, offer, specimen) DO UPDATE SET release_after = NULL`,
            [ns, offerKey, specimenKey, now],
          );
          const event = await appendEvent(sql, ns, {
            type: 'hold.placed',
            actor: 'counterpart',
            commandId: context.commandId,
            payload: { offer: offerKey, specimen: specimenKey },
          });
          return { status: 201, body: { hold: { specimen: specimenKey } }, events: [event] };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'DELETE',
    path: '/api/desks/:ns/offers/:offer/holds/:key',
    handler: async ({ response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const specimenKey = params['key'] as string;

      await executeCommand<void, void>({
        session,
        ns,
        commandId: `hold-release-${offerKey}-${specimenKey}-${randomUUID()}`,
        fingerprintParts: { offerKey, specimenKey, release: true },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined;
        },
        permitted: () => session?.role === 'counterpart',
        commit: async (context) => {
          const { sql } = context;
          const removed = await sql.query(
            'DELETE FROM offer_holds WHERE ns = $1 AND offer = $2 AND specimen = $3',
            [ns, offerKey, specimenKey],
          );
          const events: AppendedEvent[] = [];
          if ((removed.rowCount ?? 0) > 0) {
            events.push(
              await appendEvent(sql, ns, {
                type: 'hold.released',
                actor: 'counterpart',
                commandId: context.commandId,
                payload: { offer: offerKey, specimen: specimenKey },
              }),
            );
          }
          return { status: 204, body: null, events };
        },
      });
      sendNoContent(response);
    },
  });

  /* -- replacement ------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/replace',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const remove = requireString(body, 'remove');
      const add = requireString(body, 'add');
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, expectedVersion, remove, add },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return (
            state.offers[offerKey] !== undefined &&
            state.specimens[add] !== undefined &&
            state.specimens[add]?.owner !== 'outsider'
          );
        },
        permitted: () => party !== null,
        commit: async (context) => {
          const { sql } = context;
          const acting = party as Party;
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();

          // A terminal or frozen state is answered before the version check.
          if (isExpired(offer.status as Offer['status'])) throw conflict(F.OFFER_EXPIRED);
          if (await anyManifestFrozen(sql, ns, offerKey)) throw conflict(F.DISPATCH_FROZEN);
          if (offer.version !== expectedVersion) throw stale();

          if (await reservedElsewhere(sql, ns, offerKey, [add])) throw conflict(F.OFFER_TAKEN);

          const { state } = await loadDesk(ns, 'dealer', sql);
          const replacement = state.specimens[add];
          if (!replacement) throw notFound();
          if (replacement.attribution.register === 'pending') throw conflict(F.CATALOG_PENDING);

          const side = basketOf(replacement.owner === 'dealer' ? 'dealer' : 'counterpart');
          const items = side === 'dealer_items' ? offer.dealer_items : offer.counterpart_items;
          if (!items.includes(remove)) throw notFound();
          const replaced = items.map((key) => (key === remove ? add : key));

          const expiresAt = await restartWindow(sql, ns, acting);
          await sql.query(
            `UPDATE offers
                SET ${side} = $3, version = version + 1, status = $4,
                    accept_dealer = NULL, accept_counterpart = NULL, expires_at = $5
              WHERE ns = $1 AND key = $2`,
            [ns, offerKey, JSON.stringify(replaced), statusAfterChangeBy(acting), expiresAt],
          );
          // Committing the replacement releases the review hold on the addition.
          await sql.query('DELETE FROM offer_holds WHERE ns = $1 AND offer = $2 AND specimen = $3', [
            ns,
            offerKey,
            add,
          ]);

          const event = await appendEvent(sql, ns, {
            type: 'offer.replaced',
            actor: acting,
            commandId: context.commandId,
            payload: { offer: offerKey, removed: remove, added: add, acceptances_cleared: true },
          });
          return { status: 200, body: await offerReply(sql, ns, acting, offerKey), events: [event] };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- acceptance -------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/accept',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, expectedVersion, accept: true },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined;
        },
        permitted: () => party !== null,
        needsStepUp: true,
        commit: async (context) => {
          const { sql } = context;
          const acting = party as Party;
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();
          if (isExpired(offer.status as Offer['status'])) throw conflict(F.OFFER_EXPIRED);
          if (offer.version !== expectedVersion) throw stale();

          // Accepting never bumps the offer version.
          const column = acting === 'dealer' ? 'accept_dealer' : 'accept_counterpart';
          await sql.query(`UPDATE offers SET ${column} = $3 WHERE ns = $1 AND key = $2`, [
            ns,
            offerKey,
            offer.version,
          ]);

          const other = acting === 'dealer' ? offer.accept_counterpart : offer.accept_dealer;
          const events = [
            await appendEvent(sql, ns, {
              type: 'offer.accepted',
              actor: acting,
              commandId: context.commandId,
              payload: { offer: offerKey, version: offer.version, party: acting },
            }),
          ];

          // When both acceptances name the current version the offer is
          // accepted, every item becomes outbound and no window runs.
          if (other === offer.version) {
            await sql.query(
              `UPDATE offers SET status = 'accepted', expires_at = NULL WHERE ns = $1 AND key = $2`,
              [ns, offerKey],
            );
            for (const manifestParty of ['dealer', 'counterpart'] as const) {
              const items =
                manifestParty === 'dealer' ? offer.dealer_items : offer.counterpart_items;
              await sql.query(
                `INSERT INTO manifests (ns, offer, party, version, ordering, frozen, evidence)
                 VALUES ($1,$2,$3,1,$4,false,'[]')
                 ON CONFLICT (ns, offer, party) DO NOTHING`,
                [ns, offerKey, manifestParty, JSON.stringify(items)],
              );
            }
          }
          return { status: 200, body: await offerReply(sql, ns, acting, offerKey), events };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- dispatch ---------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/manifests/:party/freeze',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const manifestParty = params['party'] as Party;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const order = requireStringList(body, 'order');
      const party = session ? viewerParty(session) : null;

      interface FrozenEvidence {
        specimen: string;
        label: string;
        object_key: string;
        sha256: string;
      }

      const result = await executeCommand<string[], FrozenEvidence[]>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, manifestParty, expectedVersion, order },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.manifests[`${offerKey}/${manifestParty}`] !== undefined;
        },
        // Only the sender may freeze their own manifest.
        permitted: () => party !== null && party === manifestParty,
        check: async ({ sql }) => {
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();
          const found = await sql.query<{ version: number; frozen: boolean; ordering: string[] }>(
            'SELECT version, frozen, ordering FROM manifests WHERE ns = $1 AND offer = $2 AND party = $3',
            [ns, offerKey, manifestParty],
          );
          const manifest = found.rows[0];
          if (!manifest) throw notFound();

          // The frozen check comes before the version check.
          if (manifest.frozen) throw conflict(F.DISPATCH_FROZEN);
          if (!canFreeze(offer.status as Offer['status'])) throw stale();
          if (manifest.version !== expectedVersion) throw stale();

          const items = manifestParty === 'dealer' ? offer.dealer_items : offer.counterpart_items;
          if (!order.every((key) => items.includes(key)) || order.length !== items.length) {
            throw invalid({ order: fieldCopy.order });
          }
          if (new Set(order).size !== order.length) throw invalid({ order: fieldCopy.order });
          return order;
        },
        // Each item's latest obverse photograph is copied into a new immutable
        // object; the manifest is frozen only once MinIO confirms every one.
        provide: async (checked) => {
          const { state, photoById } = await loadDesk(ns, 'dealer');
          const evidence: FrozenEvidence[] = [];
          for (const key of checked) {
            const obverse = [...photoById.values()]
              .filter((photo) => photo.specimen === key && photo.label === 'obverse')
              .pop();
            if (!obverse) throw notFound();
            const extension = obverse.object_key.split('.').pop() ?? 'png';
            const target = objectKeys.dispatchEvidence(
              ns,
              offerKey,
              manifestParty,
              key,
              obverse.sha256,
              extension,
            );
            const copied = await copyObject(obverse.object_key, target);
            if (!copied) throw notFound();
            evidence.push({
              specimen: key,
              label: 'dispatch',
              object_key: copied.objectKey,
              sha256: copied.sha256,
            });
          }
          const record = Buffer.from(
            JSON.stringify({ offer: offerKey, party: manifestParty, order: checked, evidence }),
            'utf8',
          );
          await putObject(
            objectKeys.manifestRecord(ns, offerKey, manifestParty),
            record,
            'application/json',
          );
          void state;
          return evidence;
        },
        commit: async (context, checked, evidence) => {
          const { sql } = context;
          await sql.query(
            `UPDATE manifests
                SET ordering = $4, frozen = true, evidence = $5, version = version + 1
              WHERE ns = $1 AND offer = $2 AND party = $3`,
            [ns, offerKey, manifestParty, JSON.stringify(checked), JSON.stringify(evidence)],
          );
          for (const item of evidence) {
            await sql.query(
              `INSERT INTO photos
                 (ns, id, specimen, label, object_key, sha256, width, height, content_type, created_seq)
               SELECT $1,$2,$3,'dispatch',$4,$5, p.width, p.height, p.content_type, p.created_seq
                 FROM photos p WHERE p.ns = $1 AND p.specimen = $3 AND p.label = 'obverse'
                 LIMIT 1
               ON CONFLICT (ns, id) DO NOTHING`,
              [ns, randomUUID(), item.specimen, item.object_key, item.sha256],
            );
          }

          const both = await sql.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM manifests
              WHERE ns = $1 AND offer = $2 AND frozen = true`,
            [ns, offerKey],
          );
          const becomesDispatched = Number(both.rows[0]?.count ?? 0) >= 2;
          if (becomesDispatched) {
            await sql.query(
              `UPDATE offers SET status = 'dispatched', version = version + 1, expires_at = NULL
                WHERE ns = $1 AND key = $2`,
              [ns, offerKey],
            );
          }

          const event = await appendEvent(sql, ns, {
            type: 'manifest.frozen',
            actor: manifestParty,
            commandId: context.commandId,
            payload: { offer: offerKey, party: manifestParty, dispatched: becomesDispatched },
          });
          const { state } = await loadDesk(ns, manifestParty, sql);
          return {
            status: 200,
            body: { manifest: state.manifests[`${offerKey}/${manifestParty}`] },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- arrivals ---------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/arrivals',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const { fields, files } = await readMultipartBody(request);
      const commandId = requireCommandId(fields as Record<string, unknown>);
      const specimenKey = fields['specimen'] ?? '';
      const photo = files.find((file) => file.field === 'photo');
      const party = session ? viewerParty(session) : null;

      interface ArrivalChecked {
        bytes: Buffer;
        width: number;
        height: number;
        contentType: string;
        extension: string;
      }

      const result = await executeCommand<ArrivalChecked, { objectKey: string; sha256: string }>({
        session,
        ns,
        commandId,
        fingerprintParts: {
          offerKey,
          specimenKey,
          photo: photo ? sha256Hex(photo.bytes) : null,
        },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined && state.specimens[specimenKey] !== undefined;
        },
        // The receiver of a specimen is the party who does not own it.
        permitted: async () => {
          if (!party) return false;
          const { state } = await loadDesk(ns, party);
          const specimen = state.specimens[specimenKey];
          return specimen !== undefined && specimen.owner !== party;
        },
        check: async () => {
          if (!photo) throw invalid({ photo: fieldCopy.photoMissing });
          const judged = judgePhoto(photo.bytes);
          if (judged.refusal === 'bytes') {
            throw uploadTooLarge({ photo: refusalCopy(judged.refusal) });
          }
          if (judged.refusal) throw invalid({ photo: refusalCopy(judged.refusal) });
          const shape = judged.shape as NonNullable<typeof judged.shape>;
          return {
            bytes: photo.bytes,
            width: shape.width,
            height: shape.height,
            contentType: contentTypeOf[shape.format],
            extension: extensionOf[shape.format],
          };
        },
        provide: async (checked) => {
          const digest = sha256Hex(checked.bytes);
          const key = objectKeys.arrivalPhoto(ns, offerKey, specimenKey, digest, checked.extension);
          const stored = await putObject(key, checked.bytes, checked.contentType);
          return { objectKey: stored.objectKey, sha256: stored.sha256 };
        },
        commit: async (context, checked, stored) => {
          const { sql } = context;
          const event = await appendEvent(sql, ns, {
            type: 'arrival.saved',
            actor: party as Party,
            commandId: context.commandId,
            payload: { offer: offerKey, specimen: specimenKey },
          });
          const photoId = randomUUID();
          await sql.query(
            `INSERT INTO photos
               (ns, id, specimen, label, object_key, sha256, width, height, content_type, created_seq)
             VALUES ($1,$2,$3,'arrival',$4,$5,$6,$7,$8,$9)`,
            [
              ns,
              photoId,
              specimenKey,
              stored.objectKey,
              stored.sha256,
              checked.width,
              checked.height,
              checked.contentType,
              event.sequence,
            ],
          );
          return {
            status: 201,
            body: {
              photo: {
                id: photoId,
                label: 'arrival',
                object_key: stored.objectKey,
                sha256: stored.sha256,
                width: checked.width,
                height: checked.height,
              },
            },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- receipts ---------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/receipts',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const matches = body['matches'];
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, expectedVersion, matches },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined;
        },
        permitted: () => party !== null,
        needsStepUp: true,
        commit: async (context) => {
          const { sql } = context;
          const acting = party as Party;
          const offer = await lockOffer(sql, ns, offerKey);
          if (!offer) throw notFound();
          if (isExpired(offer.status as Offer['status'])) throw conflict(F.OFFER_EXPIRED);
          if (offer.version !== expectedVersion) throw stale();

          if (typeof matches !== 'boolean') {
            throw invalid({ matches: fieldCopy.arrivalMissing });
          }

          // A receipt needs an arrival photograph for every item received.
          const received = acting === 'dealer' ? offer.counterpart_items : offer.dealer_items;
          const { state, photoById } = await loadDesk(ns, acting, sql);
          const withArrival = new Set(
            [...photoById.values()]
              .filter((photo) => photo.label === 'arrival')
              .map((photo) => photo.specimen),
          );
          if (!received.every((key) => withArrival.has(key))) {
            throw invalid({ matches: fieldCopy.arrivalMissing });
          }

          await sql.query(
            `INSERT INTO receipts (ns, offer, party, confirmed, matches)
             VALUES ($1,$2,$3,true,$4)
             ON CONFLICT (ns, offer, party) DO UPDATE SET confirmed = true, matches = EXCLUDED.matches`,
            [ns, offerKey, acting, matches],
          );

          const openDispute = Object.values(state.disputes).some(
            (dispute) => dispute.offer === offerKey && dispute.open,
          );
          const all = await sql.query<{ party: string; matches: boolean }>(
            'SELECT party, matches FROM receipts WHERE ns = $1 AND offer = $2 AND confirmed = true',
            [ns, offerKey],
          );
          const bothReceipts = all.rows.length === 2;
          const bothMatch = bothReceipts && all.rows.every((row) => row.matches);

          const events: AppendedEvent[] = [
            await appendEvent(sql, ns, {
              type: 'receipt.recorded',
              actor: acting,
              commandId: context.commandId,
              payload: { offer: offerKey, party: acting, matches },
            }),
          ];

          if (bothMatch && !openDispute) {
            events.push(...(await transferOwnership(context, offerKey, offer)));
          } else if (!openDispute) {
            await sql.query(
              `UPDATE offers SET status = 'received', version = version + 1 WHERE ns = $1 AND key = $2`,
              [ns, offerKey],
            );
          } else {
            await sql.query('UPDATE offers SET version = version + 1 WHERE ns = $1 AND key = $2', [
              ns,
              offerKey,
            ]);
          }

          const after = await loadDesk(ns, acting, sql);
          return {
            status: 200,
            body: {
              receipt: after.state.receipts[`${offerKey}/${acting}`],
              offer: after.state.offers[offerKey],
            },
            events,
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });
}

/**
 * Swapping the owners of every item and settling the offer, in the one
 * transaction that records the second matching receipt or approves a transfer.
 */
export async function transferOwnership(
  context: CommandContext,
  offerKey: string,
  offer: { dealer_items: string[]; counterpart_items: string[] },
): Promise<AppendedEvent[]> {
  const { sql, ns } = context;
  for (const [from, to, items] of [
    ['dealer', 'counterpart', offer.dealer_items],
    ['counterpart', 'dealer', offer.counterpart_items],
  ] as const) {
    void from;
    for (const key of items) {
      await sql.query(
        'UPDATE specimens SET owner = $3, version = version + 1 WHERE ns = $1 AND key = $2',
        [ns, key, to],
      );
      await sql.query('UPDATE tray_cells SET specimen = NULL WHERE ns = $1 AND specimen = $2', [
        ns,
        key,
      ]);
      await sql.query('UPDATE album_holes SET specimen = NULL WHERE ns = $1 AND specimen = $2', [
        ns,
        key,
      ]);
    }
  }
  await sql.query(
    `UPDATE offers SET status = 'transferred', version = version + 1, expires_at = NULL
      WHERE ns = $1 AND key = $2`,
    [ns, offerKey],
  );
  return [
    await appendEvent(sql, ns, {
      type: 'ownership.transferred',
      actor: 'system',
      commandId: context.commandId,
      payload: { offer: offerKey },
    }),
  ];
}

