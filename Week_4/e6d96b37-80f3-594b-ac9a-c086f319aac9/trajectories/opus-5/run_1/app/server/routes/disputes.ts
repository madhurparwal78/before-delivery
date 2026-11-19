import { randomBytes, randomUUID } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { app, limits } from '../config.ts';
import { conflict, fieldCopy, forbidden, invalid, notFound, stale } from '../http/errors.ts';
import { executeCommand } from '../http/precedence.ts';
import { readJsonBody, sendJson, sendNoContent } from '../http/request.ts';
import type { Router } from '../http/router.ts';
import { objectKeys, putObject } from '../providers/storage.ts';
import type { Sql } from '../providers/db.ts';
import { appendEvent, type AppendedEvent } from '../store/events.ts';
import { loadDesk } from '../store/state.ts';
import { namespaceNow } from '../domain/clock.ts';
import { canOpenDispute, otherParty } from '../domain/offer.ts';
import { isInsidePhoto, noteTooLong } from '../domain/validation.ts';
import { transferOwnership } from './exchange.ts';
import {
  deskVisibleTo,
  requireCommandId,
  requireExpectedVersion,
  requireString,
  optionalString,
  viewerParty,
} from './common.ts';
import type { Party } from '../../shared/types.ts';

interface DisputeRow {
  key: string;
  offer: string;
  specimen: string;
  version: number;
  open: boolean;
  outcome: string | null;
  proposed_by: string | null;
  approvals: Party[];
}

async function lockDispute(sql: Sql, ns: string, key: string): Promise<DisputeRow | null> {
  const found = await sql.query<DisputeRow>(
    `SELECT key, offer, specimen, version, open, outcome, proposed_by, approvals
       FROM disputes WHERE ns = $1 AND key = $2 FOR UPDATE`,
    [ns, key],
  );
  return found.rows[0] ?? null;
}

async function disputeReply(sql: Sql, ns: string, role: Party, key: string): Promise<unknown> {
  const { state } = await loadDesk(ns, role, sql);
  const dispute = state.disputes[key];
  if (!dispute) throw notFound();
  return { dispute: { key, ...dispute } };
}

/** Both parties of a dispute may see and act on it. */
async function partyOfDispute(ns: string, disputeKey: string, party: Party | null): Promise<boolean> {
  if (!party) return false;
  const { state } = await loadDesk(ns, party);
  return state.disputes[disputeKey] !== undefined;
}

export function registerDisputeRoutes(router: Router): void {
  /* -- opening a dispute ------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/offers/:offer/disputes',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const offerKey = params['offer'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const specimenKey = requireString(body, 'specimen');
      const note = optionalString(body, 'note');
      const markers = Array.isArray(body['markers']) ? body['markers'] : [];
      const party = session ? viewerParty(session) : null;

      interface Checked {
        markers: { x: number; y: number; text: string }[];
        arrivalPhoto: string;
      }

      const result = await executeCommand<Checked, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { offerKey, expectedVersion, specimenKey, note, markers },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, session?.role ?? 'outsider');
          return state.offers[offerKey] !== undefined && state.specimens[specimenKey] !== undefined;
        },
        // Only the receiver of that specimen may open a dispute on it.
        permitted: async () => {
          if (!party) return false;
          const { state } = await loadDesk(ns, party);
          const specimen = state.specimens[specimenKey];
          return specimen !== undefined && specimen.owner !== party;
        },
        check: async ({ sql }) => {
          const found = await sql.query<{ version: number; status: string }>(
            'SELECT version, status FROM offers WHERE ns = $1 AND key = $2 FOR UPDATE',
            [ns, offerKey],
          );
          const offer = found.rows[0];
          if (!offer) throw notFound();
          if (offer.status === 'expired') throw conflict(F.OFFER_EXPIRED);
          if (offer.version !== expectedVersion) throw stale();
          if (!canOpenDispute(offer.status as 'dispatched')) throw stale();

          const { photoById } = await loadDesk(ns, party as Party, sql);
          const arrival = [...photoById.values()]
            .filter((photo) => photo.specimen === specimenKey && photo.label === 'arrival')
            .pop();
          if (!arrival) throw invalid({ markers: fieldCopy.arrivalMissing });

          const parsed: Checked['markers'] = [];
          for (const raw of markers) {
            const marker = (raw ?? {}) as Record<string, unknown>;
            const x = marker['x'];
            const y = marker['y'];
            const text = typeof marker['text'] === 'string' ? marker['text'] : '';
            if (typeof x !== 'number' || typeof y !== 'number' || !isInsidePhoto(x, y, arrival)) {
              throw invalid({ markers: fieldCopy.coord });
            }
            if (noteTooLong(text)) throw invalid({ markers: fieldCopy.textLong });
            parsed.push({ x, y, text });
          }
          if (noteTooLong(note)) throw invalid({ note: fieldCopy.textLong });
          return { markers: parsed, arrivalPhoto: arrival.object_key };
        },
        commit: async (context, checked) => {
          const { sql } = context;
          const disputeKey = `dispute-${offerKey}-${specimenKey}`;
          const event = await appendEvent(sql, ns, {
            type: 'dispute.opened',
            actor: party as Party,
            commandId: context.commandId,
            payload: { offer: offerKey, specimen: specimenKey, dispute: disputeKey },
          });

          // The dispute counts as open only once its evidence snapshot is
          // stored: markers plus the frozen dispatch and arrival object keys.
          const frozen = await sql.query<{ evidence: { specimen: string; object_key: string }[] }>(
            'SELECT evidence FROM manifests WHERE ns = $1 AND offer = $2',
            [ns, offerKey],
          );
          const dispatchKey =
            frozen.rows
              .flatMap((row) => row.evidence)
              .find((item) => item.specimen === specimenKey)?.object_key ?? null;
          await putObject(
            objectKeys.disputeSnapshot(ns, disputeKey, event.sequence),
            Buffer.from(
              JSON.stringify({
                dispute: disputeKey,
                offer: offerKey,
                specimen: specimenKey,
                note,
                markers: checked.markers,
                dispatch_object_key: dispatchKey,
                arrival_object_key: checked.arrivalPhoto,
              }),
              'utf8',
            ),
            'application/json',
          );

          await sql.query(
            `INSERT INTO disputes
               (ns, key, offer, specimen, version, open, note, approvals, created_seq)
             VALUES ($1,$2,$3,$4,1,true,$5,'[]',$6)
             ON CONFLICT (ns, key) DO UPDATE SET open = true, note = EXCLUDED.note`,
            [ns, disputeKey, offerKey, specimenKey, note, event.sequence],
          );
          let position = 0;
          for (const marker of checked.markers) {
            await sql.query(
              `INSERT INTO dispute_markers (ns, id, dispute, x, y, text, position)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [ns, randomUUID(), disputeKey, marker.x, marker.y, marker.text, position],
            );
            position += 1;
          }
          // Opening a dispute holds the transfer on both screens.
          await sql.query(
            `UPDATE offers SET status = 'disputed', version = version + 1 WHERE ns = $1 AND key = $2`,
            [ns, offerKey],
          );

          return {
            status: 201,
            body: await disputeReply(sql, ns, party as Party, disputeKey),
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- markers ----------------------------------------------------------- */

  router.add({
    method: 'PUT',
    path: '/api/desks/:ns/disputes/:dispute/markers/:marker',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const disputeKey = params['dispute'] as string;
      const markerId = params['marker'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const x = body['x'];
      const y = body['y'];
      const text = optionalString(body, 'text');
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { disputeKey, markerId, expectedVersion, x, y, text },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          if (!(await partyOfDispute(ns, disputeKey, party))) return false;
          const { state } = await loadDesk(ns, party as Party);
          return state.disputes[disputeKey]?.markers.some((marker) => marker.id === markerId) === true;
        },
        permitted: () => party !== null,
        commit: async (context) => {
          const { sql } = context;
          const dispute = await lockDispute(sql, ns, disputeKey);
          if (!dispute) throw notFound();
          // Of two screens moving one marker the loser sees the server's value.
          if (dispute.version !== expectedVersion) throw stale();

          const { photoById } = await loadDesk(ns, party as Party, sql);
          const arrival = [...photoById.values()]
            .filter((photo) => photo.specimen === dispute.specimen && photo.label === 'arrival')
            .pop();
          if (!arrival) throw notFound();

          const fieldErrors: Record<string, string> = {};
          if (typeof x !== 'number' || typeof y !== 'number' || !isInsidePhoto(x, y, arrival)) {
            fieldErrors['x'] = fieldCopy.coord;
            fieldErrors['y'] = fieldCopy.coord;
          }
          if (noteTooLong(text)) fieldErrors['text'] = fieldCopy.textLong;
          if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);

          await sql.query(
            'UPDATE dispute_markers SET x = $3, y = $4, text = $5 WHERE ns = $1 AND id = $2',
            [ns, markerId, x, y, text],
          );
          // Moving a marker bumps only the dispute's version.
          await sql.query('UPDATE disputes SET version = version + 1 WHERE ns = $1 AND key = $2', [
            ns,
            disputeKey,
          ]);

          const event = await appendEvent(sql, ns, {
            type: 'marker.moved',
            actor: party as Party,
            commandId: context.commandId,
            payload: { dispute: disputeKey, marker: markerId },
          });
          return {
            status: 200,
            body: await disputeReply(sql, ns, party as Party, disputeKey),
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- resolution -------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/disputes/:dispute/resolution',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const disputeKey = params['dispute'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const outcome = requireString(body, 'outcome');
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { disputeKey, expectedVersion, outcome },
        visible: () => partyOfDispute(ns, disputeKey, party),
        permitted: () => party !== null,
        commit: async (context) => {
          const { sql } = context;
          const dispute = await lockDispute(sql, ns, disputeKey);
          if (!dispute) throw notFound();
          if (dispute.version !== expectedVersion) throw stale();
          if (outcome !== 'transfer' && outcome !== 'return') {
            throw invalid({ outcome: fieldCopy.order });
          }

          // Proposing never bumps the offer, only the dispute.
          await sql.query(
            `UPDATE disputes
                SET outcome = $3, proposed_by = $4, approvals = '[]', version = version + 1
              WHERE ns = $1 AND key = $2`,
            [ns, disputeKey, outcome, party],
          );
          const event = await appendEvent(sql, ns, {
            type: 'resolution.proposed',
            actor: party as Party,
            commandId: context.commandId,
            payload: { dispute: disputeKey, outcome },
          });
          return {
            status: 200,
            body: await disputeReply(sql, ns, party as Party, disputeKey),
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/disputes/:dispute/approve-resolution',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const disputeKey = params['dispute'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { disputeKey, expectedVersion, approve: true },
        visible: () => partyOfDispute(ns, disputeKey, party),
        permitted: async () => {
          if (!party) return false;
          const { state } = await loadDesk(ns, party);
          const dispute = state.disputes[disputeKey];
          if (!dispute?.resolution) return false;
          // Only the party that did not propose may approve.
          return dispute.resolution.proposed_by !== party;
        },
        commit: async (context) => {
          const { sql } = context;
          const acting = party as Party;
          const dispute = await lockDispute(sql, ns, disputeKey);
          if (!dispute) throw notFound();
          if (dispute.version !== expectedVersion) throw stale();
          if (!dispute.outcome || !dispute.proposed_by) throw stale();
          if (dispute.proposed_by === acting) throw forbidden();

          const approvals = [...new Set([...dispute.approvals, acting, dispute.proposed_by as Party])];
          await sql.query(
            `UPDATE disputes
                SET approvals = $3, open = false, version = version + 1
              WHERE ns = $1 AND key = $2`,
            [ns, disputeKey, JSON.stringify(approvals)],
          );

          const events: AppendedEvent[] = [
            await appendEvent(sql, ns, {
              type: 'resolution.approved',
              actor: acting,
              commandId: context.commandId,
              payload: { dispute: disputeKey, outcome: dispute.outcome },
            }),
          ];

          const offerFound = await sql.query<{
            dealer_items: string[];
            counterpart_items: string[];
            status: string;
          }>(
            'SELECT dealer_items, counterpart_items, status FROM offers WHERE ns = $1 AND key = $2 FOR UPDATE',
            [ns, dispute.offer],
          );
          const offer = offerFound.rows[0];
          if (!offer) throw notFound();

          if (dispute.outcome === 'transfer') {
            const receipts = await sql.query<{ party: string }>(
              'SELECT party FROM receipts WHERE ns = $1 AND offer = $2 AND confirmed = true',
              [ns, dispute.offer],
            );
            if (receipts.rows.length === 2) {
              events.push(...(await transferOwnership(context, dispute.offer, offer)));
            } else {
              const back = receipts.rows.length === 1 ? 'received' : 'dispatched';
              await sql.query(
                'UPDATE offers SET status = $3, version = version + 1 WHERE ns = $1 AND key = $2',
                [ns, dispute.offer, back],
              );
            }
          } else {
            // A return leaves ownership unchanged and releases reservations.
            await sql.query(
              `UPDATE offers SET status = 'returned', version = version + 1, expires_at = NULL
                WHERE ns = $1 AND key = $2`,
              [ns, dispute.offer],
            );
            await sql.query('DELETE FROM offer_holds WHERE ns = $1 AND offer = $2', [
              ns,
              dispute.offer,
            ]);
            events.push(
              await appendEvent(sql, ns, {
                type: 'offer.returned',
                actor: 'system',
                commandId: context.commandId,
                payload: { offer: dispute.offer },
              }),
            );
          }

          const { state } = await loadDesk(ns, acting, sql);
          return {
            status: 200,
            body: {
              dispute: state.disputes[disputeKey],
              offer: state.offers[dispute.offer],
            },
            events,
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- private evidence links -------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/disputes/:dispute/links',
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const disputeKey = params['dispute'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const party = session ? viewerParty(session) : null;

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { disputeKey, link: true },
        visible: () => partyOfDispute(ns, disputeKey, party),
        permitted: () => party !== null,
        commit: async (context) => {
          const { sql } = context;
          const token = randomBytes(24).toString('base64url');
          const now = await namespaceNow(sql, ns);
          const expiresAt = new Date(now.getTime() + limits.linkTtlS * 1000);
          await sql.query(
            `INSERT INTO evidence_links (ns, token, dispute, expires_at, revoked)
             VALUES ($1,$2,$3,$4,false)`,
            [ns, token, disputeKey, expiresAt],
          );
          const event = await appendEvent(sql, ns, {
            type: 'link.created',
            actor: party as Party,
            commandId: context.commandId,
            payload: { dispute: disputeKey },
          });
          return {
            status: 201,
            body: {
              link: {
                token,
                url: `${app.publicUrl}/evidence/${token}`,
                expires_at: expiresAt.toISOString(),
              },
            },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'DELETE',
    path: '/api/desks/:ns/disputes/:dispute/links/:token',
    handler: async ({ response, params, session }) => {
      const ns = params['ns'] as string;
      const disputeKey = params['dispute'] as string;
      const token = params['token'] as string;
      const party = session ? viewerParty(session) : null;

      await executeCommand<void, void>({
        session,
        ns,
        commandId: `link-revoke-${token}`,
        fingerprintParts: { disputeKey, token, revoke: true },
        visible: () => partyOfDispute(ns, disputeKey, party),
        permitted: () => party !== null,
        commit: async (context) => {
          const { sql } = context;
          // Revoking ends access immediately.
          const revoked = await sql.query(
            'UPDATE evidence_links SET revoked = true WHERE ns = $1 AND token = $2 AND dispute = $3',
            [ns, token, disputeKey],
          );
          const events: AppendedEvent[] = [];
          if ((revoked.rowCount ?? 0) > 0) {
            events.push(
              await appendEvent(sql, ns, {
                type: 'link.revoked',
                actor: party as Party,
                commandId: context.commandId,
                payload: { dispute: disputeKey },
              }),
            );
          }
          return { status: 204, body: null, events };
        },
      });
      sendNoContent(response);
    },
  });
}

export { otherParty };
