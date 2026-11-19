import { randomUUID } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { limits } from '../config.ts';
import {
  conflict,
  fieldCopy,
  invalid,
  notFound,
  stale,
  uploadTooLarge,
} from '../http/errors.ts';
import { executeCommand, type CommandContext } from '../http/precedence.ts';
import { readJsonBody, readMultipartBody, sendJson } from '../http/request.ts';
import type { Router } from '../http/router.ts';
import { objectKeys, putObject, sha256Hex } from '../providers/storage.ts';
import { fetchVarietyImage, lookupAlbum, lookupVariety } from '../providers/register.ts';
import type { AlbumRecord, VarietyRecord } from '../providers/register.ts';
import { appendEvent, appendAuditMark, type AppendedEvent } from '../store/events.ts';
import { loadDesk } from '../store/state.ts';
import { namespaceNow } from '../domain/clock.ts';
import { holderFits } from '../domain/holder.ts';
import { albumIneligibility, canQuarantine, displayLabelFor } from '../domain/specimen.ts';
import {
  contentTypeOf,
  extensionOf,
  judgePhoto,
  refusalCopy,
  type PhotoShape,
} from '../domain/photo.ts';
import {
  correctionTooLong,
  isInsidePhoto,
  isValidReference,
  listsEachOnce,
  noteTooLong,
} from '../domain/validation.ts';
import {
  deskVisibleTo,
  lockSpecimen,
  requireCommandId,
  requireExpectedVersion,
  requireInteger,
  requireString,
  requireStringList,
  optionalString,
  reservationOf,
} from './common.ts';
import type { Sql } from '../providers/db.ts';

const dealerOnly = true;

/** Re-reads one specimen for the command reply. */
async function specimenReply(sql: Sql, ns: string, key: string): Promise<unknown> {
  const { state } = await loadDesk(ns, 'dealer', sql);
  const specimen = state.specimens[key];
  if (!specimen) throw notFound();
  return { specimen: { key, ...specimen } };
}

/**
 * A change to a specimen's attribution, photographs or annotations voids both
 * acceptances of every live offer that includes it, and returns that offer to
 * the changing party's status.
 */
async function voidOffersIncluding(
  context: CommandContext,
  key: string,
  type: 'specimen.reconciled' | 'annotation.saved',
): Promise<AppendedEvent[]> {
  const { sql, ns } = context;
  const affected = await sql.query<{ key: string; status: string }>(
    `SELECT key, status FROM offers
      WHERE ns = $1 AND status IN ('sent','countered','accepted')
        AND (dealer_items @> $2::jsonb OR counterpart_items @> $2::jsonb)
      FOR UPDATE`,
    [ns, JSON.stringify([key])],
  );
  const events: AppendedEvent[] = [];
  const now = await namespaceNow(sql, ns);
  const expiresAt = new Date(now.getTime() + limits.offerWindowS * 1000);
  for (const offer of affected.rows) {
    await sql.query(
      `UPDATE offers
          SET version = version + 1, status = 'sent',
              accept_dealer = NULL, accept_counterpart = NULL, expires_at = $3
        WHERE ns = $1 AND key = $2`,
      [ns, offer.key, expiresAt],
    );
    events.push(
      await appendEvent(sql, ns, {
        type,
        actor: 'dealer',
        commandId: context.commandId,
        payload: { offer: offer.key, specimen: key, acceptances_cleared: true },
      }),
    );
  }
  return events;
}

/** A hole reopens whenever the specimen filling it becomes ineligible. */
async function reopenHolesFor(
  context: CommandContext,
  key: string,
): Promise<AppendedEvent[]> {
  const { sql, ns } = context;
  const filled = await sql.query<{ label: string }>(
    'SELECT label FROM album_holes WHERE ns = $1 AND specimen = $2 FOR UPDATE',
    [ns, key],
  );
  if (filled.rowCount === 0) return [];
  await sql.query('UPDATE album_holes SET specimen = NULL WHERE ns = $1 AND specimen = $2', [
    ns,
    key,
  ]);
  await sql.query('UPDATE albums SET version = version + 1 WHERE ns = $1', [ns]);
  return [
    await appendEvent(sql, ns, {
      type: 'album.reopened',
      actor: 'dealer',
      commandId: context.commandId,
      payload: { specimen: key, holes: filled.rows.map((row) => row.label) },
    }),
  ];
}

async function trayVersion(sql: Sql, ns: string): Promise<number> {
  const found = await sql.query<{ version: number }>(
    'SELECT version FROM trays WHERE ns = $1 FOR UPDATE',
    [ns],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row.version;
}

async function albumVersion(sql: Sql, ns: string): Promise<number> {
  const found = await sql.query<{ version: number }>(
    'SELECT version FROM albums WHERE ns = $1 FOR UPDATE',
    [ns],
  );
  const row = found.rows[0];
  if (!row) throw notFound();
  return row.version;
}

export function registerStockRoutes(router: Router): void {
  /* -- intake ------------------------------------------------------------ */

  interface IntakeChecked {
    reference: string;
    obverse: { bytes: Buffer; shape: PhotoShape };
    reverse: { bytes: Buffer; shape: PhotoShape };
  }
  interface IntakeStored {
    obverse: { objectKey: string; sha256: string; contentType: string };
    reverse: { objectKey: string; sha256: string; contentType: string };
  }

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/specimens',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const { fields, files } = await readMultipartBody(request);
      const commandId = requireCommandId(fields as Record<string, unknown>);
      const reference = fields['reference'] ?? '';
      const obverse = files.find((file) => file.field === 'obverse');
      const reverse = files.find((file) => file.field === 'reverse');

      const result = await executeCommand<IntakeChecked, IntakeStored>({
        session,
        ns,
        commandId,
        fingerprintParts: {
          reference,
          obverse: obverse ? sha256Hex(obverse.bytes) : null,
          reverse: reverse ? sha256Hex(reverse.bytes) : null,
        },
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
        check: async ({ sql }) => {
          // 5. the reference may already be taken.
          const existing = await sql.query('SELECT 1 FROM specimens WHERE ns = $1 AND key = $2', [
            ns,
            reference,
          ]);
          if (existing.rowCount === 1) throw conflict(F.INTAKE_DUP);

          // 6. field and semantic validation, with the step-6 413 for a file
          // over the single-photograph limit.
          const fieldErrors: Record<string, string> = {};
          if (!isValidReference(reference)) fieldErrors['reference'] = fieldCopy.referenceFormat;

          let oversized = false;
          const judged: Record<string, { bytes: Buffer; shape: PhotoShape } | null> = {
            obverse: null,
            reverse: null,
          };
          for (const [name, file] of [
            ['obverse', obverse],
            ['reverse', reverse],
          ] as const) {
            if (!file) {
              fieldErrors[name] = fieldCopy.photoMissing;
              continue;
            }
            const judgement = judgePhoto(file.bytes);
            if (judgement.refusal) {
              fieldErrors[name] = refusalCopy(judgement.refusal);
              if (judgement.refusal === 'bytes') oversized = true;
              continue;
            }
            judged[name] = { bytes: file.bytes, shape: judgement.shape as PhotoShape };
          }
          if (oversized) throw uploadTooLarge(fieldErrors);
          if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);

          return {
            reference,
            obverse: judged['obverse'] as IntakeChecked['obverse'],
            reverse: judged['reverse'] as IntakeChecked['reverse'],
          };
        },
        // Both faces are written and confirmed before anything is committed.
        provide: async (checked) => {
          const write = async (
            label: 'obverse' | 'reverse',
            face: { bytes: Buffer; shape: PhotoShape },
          ) => {
            const digest = sha256Hex(face.bytes);
            const key = objectKeys.specimenPhoto(
              ns,
              checked.reference,
              label,
              digest,
              extensionOf[face.shape.format],
            );
            const stored = await putObject(key, face.bytes, contentTypeOf[face.shape.format]);
            return {
              objectKey: stored.objectKey,
              sha256: stored.sha256,
              contentType: stored.contentType,
            };
          };
          return {
            obverse: await write('obverse', checked.obverse),
            reverse: await write('reverse', checked.reverse),
          };
        },
        commit: async (context, checked, stored) => {
          const { sql } = context;
          const created = await appendEvent(sql, ns, {
            type: 'specimen.created',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { specimen: checked.reference },
          });
          // Of two creates with the same reference exactly one wins.
          const inserted = await sql.query(
            `INSERT INTO specimens
               (ns, key, display_label, owner, status, version, holder, attribution,
                quarantined, missing, created_seq)
             VALUES ($1,$2,$3,'dealer','pending_catalogue',1,$4,$5,false,false,$6)
             ON CONFLICT (ns, key) DO NOTHING`,
            [
              ns,
              checked.reference,
              displayLabelFor(checked.reference),
              { kind: 'flip', width_mm: 50, height_mm: 50 },
              {
                reference: null,
                mintmark: null,
                revision: null,
                certainty: 'certain',
                note: null,
                correction: null,
                register: 'pending',
              },
              created.sequence,
            ],
          );
          if (inserted.rowCount === 0) throw conflict(F.INTAKE_DUP);

          for (const [label, face, shape] of [
            ['obverse', stored.obverse, checked.obverse.shape],
            ['reverse', stored.reverse, checked.reverse.shape],
          ] as const) {
            await sql.query(
              `INSERT INTO photos
                 (ns, id, specimen, label, object_key, sha256, width, height, content_type, created_seq)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                ns,
                randomUUID(),
                checked.reference,
                label,
                face.objectKey,
                face.sha256,
                shape.width,
                shape.height,
                face.contentType,
                created.sequence,
              ],
            );
          }

          return {
            status: 201,
            body: await specimenReply(sql, ns, checked.reference),
            events: [created],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- quarantine -------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/specimens/:key/quarantine',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const key = params['key'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const note = optionalString(body, 'note');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { key, expectedVersion, note },
        visible: async () =>
          (await deskVisibleTo(session, ns)) && (await loadDesk(ns, 'dealer')).state.specimens[key] !== undefined,
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          const specimen = await lockSpecimen(sql, ns, key);
          if (!specimen) throw notFound();
          if (specimen.version !== expectedVersion) throw stale();

          const { state } = await loadDesk(ns, 'dealer', sql);
          const live = state.specimens[key];
          if (live && !canQuarantine(live)) throw conflict(F.IN_OFFER);
          if (noteTooLong(note)) throw invalid({ note: fieldCopy.textLong });

          await sql.query(
            `UPDATE specimens
                SET quarantined = true, version = version + 1,
                    attribution = jsonb_set(
                      jsonb_set(attribution, '{certainty}', '"uncertain"'),
                      '{note}', $3::jsonb)
              WHERE ns = $1 AND key = $2`,
            [ns, key, JSON.stringify(note)],
          );

          const events = [
            await appendEvent(sql, ns, {
              type: 'specimen.quarantined',
              actor: 'dealer',
              commandId: context.commandId,
              payload: { specimen: key },
            }),
            // A quarantined specimen is excluded from sets, so its hole reopens.
            ...(await reopenHolesFor(context, key)),
          ];
          return { status: 200, body: await specimenReply(sql, ns, key), events };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- catalogue reconciliation ------------------------------------------ */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/specimens/:key/reconcile',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const key = params['key'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const correction = requireString(body, 'correction');

      const result = await executeCommand<string, { record: VarietyRecord; image: Buffer }>({
        session,
        ns,
        commandId,
        fingerprintParts: { key, expectedVersion, correction },
        visible: async () =>
          (await deskVisibleTo(session, ns)) && (await loadDesk(ns, 'dealer')).state.specimens[key] !== undefined,
        permitted: () => session?.role === 'dealer',
        check: async ({ sql }) => {
          const specimen = await lockSpecimen(sql, ns, key);
          if (!specimen) throw notFound();
          if (specimen.version !== expectedVersion) throw stale();
          if (correctionTooLong(correction) || correction.trim() === '') {
            throw invalid({ correction: fieldCopy.correctionLong });
          }
          return correction;
        },
        // The correction is kept before the register is called, so a register
        // outage never loses it.
        prepare: async ({ sql }, checked) => {
          await sql.query(
            `UPDATE specimens
                SET attribution = jsonb_set(
                      jsonb_set(attribution, '{correction}', $3::jsonb),
                      '{register}', '"pending"')
              WHERE ns = $1 AND key = $2`,
            [ns, key, JSON.stringify(checked)],
          );
        },
        provide: async (checked) => {
          const record = await lookupVariety(checked);
          const image = await fetchVarietyImage(record.imagePath);
          return { record, image };
        },
        commit: async (context, checked, provided) => {
          const { sql } = context;
          const { record, image } = provided;
          // Only a record whose image is stored completes the reconcile.
          const imageKey = objectKeys.registerImage(ns, record.reference, record.revision);
          await putObject(imageKey, image, 'image/svg+xml');
          await sql.query(
            `INSERT INTO register_records (ns, reference, revision, issue, mintmark, image_key)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (ns, reference, revision) DO UPDATE
               SET issue = EXCLUDED.issue, mintmark = EXCLUDED.mintmark,
                   image_key = EXCLUDED.image_key`,
            [ns, record.reference, record.revision, record.issue, record.mintmark, imageKey],
          );

          const specimen = await lockSpecimen(sql, ns, key);
          if (!specimen) throw notFound();
          // The specimen takes the register's values and keeps the correction.
          await sql.query(
            `UPDATE specimens
                SET version = version + 1,
                    attribution = attribution
                      || jsonb_build_object(
                           'reference', $3::text,
                           'mintmark', $4::text,
                           'revision', $5::int,
                           'register', 'stored',
                           'correction', $6::text)
              WHERE ns = $1 AND key = $2`,
            [ns, key, record.reference, record.mintmark, record.revision, checked],
          );

          const events = [
            await appendEvent(sql, ns, {
              type: 'specimen.reconciled',
              actor: 'dealer',
              commandId: context.commandId,
              payload: { specimen: key, reference: record.reference },
            }),
            ...(await voidOffersIncluding(context, key, 'specimen.reconciled')),
          ];
          return { status: 200, body: await specimenReply(sql, ns, key), events };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- annotations ------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/specimens/:key/annotations',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const key = params['key'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const annotationId = optionalString(body, 'annotation') || randomUUID();
      const photoId = requireString(body, 'photo');
      const x = requireInteger(body, 'x');
      const y = requireInteger(body, 'y');
      const text = optionalString(body, 'text');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { key, expectedVersion, annotationId, photoId, x, y, text },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state, photoById } = await loadDesk(ns, 'dealer');
          return state.specimens[key] !== undefined && photoById.has(photoId);
        },
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          const specimen = await lockSpecimen(sql, ns, key);
          if (!specimen) throw notFound();
          if (specimen.version !== expectedVersion) throw stale();

          const { photoById } = await loadDesk(ns, 'dealer', sql);
          const photo = photoById.get(photoId);
          if (!photo) throw notFound();

          const fieldErrors: Record<string, string> = {};
          if (!isInsidePhoto(x, y, photo)) {
            fieldErrors['x'] = fieldCopy.coord;
            fieldErrors['y'] = fieldCopy.coord;
          }
          if (noteTooLong(text)) fieldErrors['text'] = fieldCopy.textLong;
          if (Object.keys(fieldErrors).length > 0) throw invalid(fieldErrors);

          await sql.query(
            `INSERT INTO annotations (ns, id, specimen, photo, x, y, text)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (ns, id) DO UPDATE
               SET photo = EXCLUDED.photo, x = EXCLUDED.x, y = EXCLUDED.y, text = EXCLUDED.text`,
            [ns, annotationId, key, photoId, x, y, text],
          );
          await sql.query('UPDATE specimens SET version = version + 1 WHERE ns = $1 AND key = $2', [
            ns,
            key,
          ]);

          const events = [
            await appendEvent(sql, ns, {
              type: 'annotation.saved',
              actor: 'dealer',
              commandId: context.commandId,
              payload: { specimen: key, annotation: annotationId },
            }),
            ...(await voidOffersIncluding(context, key, 'annotation.saved')),
          ];
          return { status: 200, body: await specimenReply(sql, ns, key), events };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- tray placement ---------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/tray/placements',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const specimenKey = requireString(body, 'specimen');
      const cell = requireString(body, 'cell');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { expectedVersion, specimenKey, cell },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, 'dealer');
          return state.specimens[specimenKey] !== undefined && state.tray[cell] !== undefined;
        },
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          // Placement uses the tray version, so of two simultaneous placements
          // exactly one commits and the other is stale.
          const version = await trayVersion(sql, ns);
          const target = await sql.query<{
            specimen: string | null;
            width_mm: number;
            height_mm: number;
          }>(
            'SELECT specimen, width_mm, height_mm FROM tray_cells WHERE ns = $1 AND cell = $2 FOR UPDATE',
            [ns, cell],
          );
          const cellRow = target.rows[0];
          if (!cellRow) throw notFound();

          if (version !== expectedVersion) throw stale();
          // Occupancy is checked before holder fit, as the published order says.
          if (cellRow.specimen !== null && cellRow.specimen !== specimenKey) {
            throw conflict(F.TRAY_TAKEN);
          }

          const specimen = await lockSpecimen(sql, ns, specimenKey);
          if (!specimen) throw notFound();
          if (!holderFits(specimen.holder, cellRow)) {
            throw invalid({ cell: fieldCopy.traySize });
          }

          // Placing a shelved specimen moves it, freeing its old cell.
          await sql.query(
            'UPDATE tray_cells SET specimen = NULL WHERE ns = $1 AND specimen = $2',
            [ns, specimenKey],
          );
          await sql.query('UPDATE tray_cells SET specimen = $3 WHERE ns = $1 AND cell = $2', [
            ns,
            cell,
            specimenKey,
          ]);
          await sql.query('UPDATE trays SET version = version + 1 WHERE ns = $1', [ns]);

          const event = await appendEvent(sql, ns, {
            type: 'tray.placed',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { specimen: specimenKey, cell },
          });
          const { state } = await loadDesk(ns, 'dealer', sql);
          return {
            status: 200,
            body: { tray: state.tray, version: version + 1 },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- album ------------------------------------------------------------- */

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/album/reconcile',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);

      const result = await executeCommand<void, AlbumRecord>({
        session,
        ns,
        commandId,
        fingerprintParts: { album: 'ALD-CROWN' },
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
        provide: () => lookupAlbum('ALD-CROWN'),
        commit: async (context, _checked, record) => {
          const { sql } = context;
          // Holes exist only from a stored register album record.
          await sql.query(
            `INSERT INTO albums (ns, set_key, revision, version)
             VALUES ($1,$2,$3,1)
             ON CONFLICT (ns) DO UPDATE
               SET set_key = EXCLUDED.set_key, revision = EXCLUDED.revision,
                   version = albums.version + 1`,
            [ns, record.set, record.revision],
          );
          let position = 0;
          for (const hole of record.holes) {
            await sql.query(
              `INSERT INTO album_holes (ns, label, reference, mintmark, specimen, position)
               VALUES ($1,$2,$3,$4,NULL,$5)
               ON CONFLICT (ns, label) DO UPDATE
                 SET reference = EXCLUDED.reference, mintmark = EXCLUDED.mintmark,
                     position = EXCLUDED.position`,
              [ns, hole.label, hole.reference, hole.mintmark, position],
            );
            position += 1;
          }
          const event = await appendEvent(sql, ns, {
            type: 'album.reconciled',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { set: record.set, revision: record.revision },
          });
          const { state } = await loadDesk(ns, 'dealer', sql);
          return { status: 200, body: { album: state.album }, events: [event] };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/album/holes/:hole/fill',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const hole = params['hole'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const specimenKey = requireString(body, 'specimen');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { hole, expectedVersion, specimenKey },
        visible: async () => {
          if (!(await deskVisibleTo(session, ns))) return false;
          const { state } = await loadDesk(ns, 'dealer');
          return state.album.holes[hole] !== undefined && state.specimens[specimenKey] !== undefined;
        },
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          const version = await albumVersion(sql, ns);
          if (version !== expectedVersion) throw stale();

          const { state } = await loadDesk(ns, 'dealer', sql);
          const target = state.album.holes[hole];
          const specimen = state.specimens[specimenKey];
          if (!target || !specimen) throw notFound();

          // The published 409 order: uncertain, then outbound, then pending.
          const reason = albumIneligibility(specimen);
          if (reason === 'quarantined') throw conflict(F.SET_UNCERTAIN);
          if (reason === 'outbound') throw conflict(F.SET_OUTBOUND);
          if (reason === 'catalogue_pending') throw conflict(F.CATALOG_PENDING);

          if (specimen.attribution.mintmark !== target.mintmark) {
            throw invalid({ specimen: fieldCopy.setMismatch });
          }

          await sql.query(
            'UPDATE album_holes SET specimen = NULL WHERE ns = $1 AND specimen = $2',
            [ns, specimenKey],
          );
          await sql.query('UPDATE album_holes SET specimen = $3 WHERE ns = $1 AND label = $2', [
            ns,
            hole,
            specimenKey,
          ]);
          await sql.query('UPDATE albums SET version = version + 1 WHERE ns = $1', [ns]);

          const event = await appendEvent(sql, ns, {
            type: 'album.filled',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { hole, specimen: specimenKey },
          });
          const after = await loadDesk(ns, 'dealer', sql);
          return {
            status: 200,
            body: { album: after.state.album, version: version + 1 },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- keeper order ------------------------------------------------------ */

  router.add({
    method: 'PUT',
    path: '/api/desks/:ns/keeper-order',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);
      const order = requireStringList(body, 'order');

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { expectedVersion, order },
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          const found = await sql.query<{ ordering: string[]; version: number }>(
            'SELECT ordering, version FROM keeper_orders WHERE ns = $1 FOR UPDATE',
            [ns],
          );
          const current = found.rows[0];
          if (!current) throw notFound();
          if (current.version !== expectedVersion) throw stale();
          if (!listsEachOnce(order, current.ordering)) {
            throw invalid({ order: fieldCopy.order });
          }

          await sql.query(
            `UPDATE keeper_orders
                SET previous = ordering, ordering = $2, version = version + 1
              WHERE ns = $1`,
            [ns, JSON.stringify(order)],
          );
          const event = await appendEvent(sql, ns, {
            type: 'keeper.reordered',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { order },
          });
          return {
            status: 200,
            body: { keeper_order: order, version: current.version + 1 },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/keeper-order/undo',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const commandId = requireCommandId(body);
      const expectedVersion = requireExpectedVersion(body);

      const result = await executeCommand<void, void>({
        session,
        ns,
        commandId,
        fingerprintParts: { expectedVersion, undo: true },
        visible: () => deskVisibleTo(session, ns),
        permitted: () => session?.role === 'dealer',
        commit: async (context) => {
          const { sql } = context;
          const found = await sql.query<{
            ordering: string[];
            previous: string[] | null;
            version: number;
          }>('SELECT ordering, previous, version FROM keeper_orders WHERE ns = $1 FOR UPDATE', [ns]);
          const current = found.rows[0];
          if (!current) throw notFound();
          if (current.version !== expectedVersion) throw stale();
          // Undo stays available until the next confirmed reorder or undo.
          if (!current.previous) throw conflict(F.UNDO_NONE);

          const restored = current.previous;
          await sql.query(
            `UPDATE keeper_orders
                SET ordering = $2, previous = NULL, version = version + 1
              WHERE ns = $1`,
            [ns, JSON.stringify(restored)],
          );
          const event = await appendEvent(sql, ns, {
            type: 'keeper.restored',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { order: restored },
          });
          return {
            status: 200,
            body: { keeper_order: restored, version: current.version + 1 },
            events: [event],
          };
        },
      });
      sendJson(response, result.status, result.body);
    },
  });

  /* -- audit ------------------------------------------------------------- */

  const markCommand = async (
    ns: string,
    session: Parameters<typeof executeCommand>[0]['session'],
    input: { commandId: string; expectedVersion: number; cell: string },
  ) =>
    executeCommand<void, void>({
      session,
      ns,
      commandId: input.commandId,
      fingerprintParts: { cell: input.cell, expectedVersion: input.expectedVersion, mark: 'missing' },
      visible: async () => {
        if (!(await deskVisibleTo(session, ns))) return false;
        const { state } = await loadDesk(ns, 'dealer');
        return state.tray[input.cell] !== undefined;
      },
      permitted: () => session?.role === 'dealer',
      commit: async (context) => {
        const { sql } = context;
        const found = await sql.query<{ specimen: string | null; audit_version: number }>(
          'SELECT specimen, audit_version FROM tray_cells WHERE ns = $1 AND cell = $2 FOR UPDATE',
          [ns, input.cell],
        );
        const cellRow = found.rows[0];
        if (!cellRow) throw notFound();
        if (cellRow.audit_version !== input.expectedVersion) throw stale();
        if (cellRow.specimen === null) throw invalid({ cell: fieldCopy.cellEmpty });

        await sql.query(
          `UPDATE tray_cells SET audit_mark = 'missing', audit_version = audit_version + 1
            WHERE ns = $1 AND cell = $2`,
          [ns, input.cell],
        );
        await sql.query(
          `UPDATE specimens SET missing = true, version = version + 1
            WHERE ns = $1 AND key = $2`,
          [ns, cellRow.specimen],
        );
        await appendAuditMark(sql, ns, {
          cell: input.cell,
          actor: 'dealer',
          commandId: context.commandId,
        });
        const events = [
          await appendEvent(sql, ns, {
            type: 'audit.marked',
            actor: 'dealer',
            commandId: context.commandId,
            payload: { cell: input.cell, specimen: cellRow.specimen, mark: 'missing' },
          }),
          // A missing specimen is no longer eligible, so its hole reopens.
          ...(await reopenHolesFor(context, cellRow.specimen)),
        ];
        return {
          status: 200,
          body: {
            cell: {
              cell: input.cell,
              specimen: cellRow.specimen,
              audit_mark: 'missing',
              audit_version: cellRow.audit_version + 1,
            },
          },
          events,
        };
      },
    });

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/audit/marks',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const result = await markCommand(ns, session, {
        commandId: requireCommandId(body),
        expectedVersion: requireExpectedVersion(body),
        cell: requireString(body, 'cell'),
      });
      sendJson(response, result.status, result.body);
    },
  });

  router.add({
    method: 'POST',
    path: '/api/desks/:ns/audit/sync',
    dealerOnly,
    handler: async ({ request, response, params, session }) => {
      const ns = params['ns'] as string;
      const body = await readJsonBody(request);
      const commands = body['commands'];
      if (!Array.isArray(commands)) throw invalid({ commands: fieldCopy.syncLimit });
      if (commands.length > limits.syncBatchMax) {
        throw invalid({ commands: fieldCopy.syncLimit });
      }

      // One result per command in request order, each as if posted alone.
      const results: { command_id: string; status: number; body: unknown }[] = [];
      for (const raw of commands) {
        const entry = (raw ?? {}) as Record<string, unknown>;
        const commandId = requireCommandId(entry);
        try {
          const outcome = await markCommand(ns, session, {
            commandId,
            expectedVersion: requireExpectedVersion(entry),
            cell: requireString(entry, 'cell'),
          });
          results.push({ command_id: commandId, status: outcome.status, body: outcome.body });
        } catch (error) {
          const api = error as { status?: number; body?: () => unknown };
          if (typeof api.status === 'number' && typeof api.body === 'function') {
            results.push({ command_id: commandId, status: api.status, body: api.body() });
            continue;
          }
          throw error;
        }
      }
      sendJson(response, 200, { results });
    },
  });
}

export { reservationOf };
