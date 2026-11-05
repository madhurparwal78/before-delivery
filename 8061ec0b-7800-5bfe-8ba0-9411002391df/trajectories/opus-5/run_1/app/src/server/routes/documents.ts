import { Router } from 'express';
import { now } from '../clock';
import { pool, tx } from '../db';
import { ApiError, conflict, notFound, validationFailed } from '../errors';
import { param, route } from '../http';
import { isoSeconds } from '../../shared/time';
import type { ConditionEvent, ConditionKind } from '../../shared/types';
import { ensureAgreementObject, loadActionContext } from '../domain/actions';
import { MAX_PHOTO_BYTES, PhotoRefused, processPhoto } from '../services/images';
import {
  agreementKey,
  billOfSaleKey,
  conditionPhotoKey,
  deleteObject,
  getObject,
  putObject,
} from '../services/storage';
import { randomToken } from '../ids';
import { visibleContractRow } from './access';

export const documentsRouter = Router();

documentsRouter.get(
  '/contracts/:id/agreement.pdf',
  route(['owner', 'parent'], async ({ user, req, res }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    if (!row.agreement_stored) throw notFound('agreement_not_stored');
    const context = await loadActionContext(pool, row.id);
    await ensureAgreementObject(context);
    const object = await getObject(agreementKey(row.id));
    if (object === null) throw notFound('agreement_not_stored');
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="agreement-${row.id}.pdf"`);
    res.send(object.body);
    return undefined;
  }),
);

documentsRouter.get(
  '/contracts/:id/bill-of-sale.pdf',
  route(['owner', 'parent'], async ({ user, req, res }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    if (!row.bill_of_sale_stored) throw notFound('bill_of_sale_not_stored');
    const object = await getObject(billOfSaleKey(row.id));
    if (object === null) throw notFound('bill_of_sale_not_stored');
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bill-of-sale-${row.id}.pdf"`);
    res.send(object.body);
    return undefined;
  }),
);

async function conditionEvents(contractId: string): Promise<ConditionEvent[]> {
  const { rows } = await pool.query<{
    id: string;
    kind: ConditionKind;
    notes: string | null;
    recorded_by: string;
    created_at: Date;
  }>(
    'select id, kind, notes, recorded_by, created_at from condition_events where contract_id = $1 order by created_at desc, id desc',
    [contractId],
  );
  const { rows: photos } = await pool.query<{ id: string; event_id: string }>(
    'select p.id, p.event_id from condition_photos p where p.contract_id = $1 order by p.position',
    [contractId],
  );
  return rows.map((event) => ({
    id: event.id,
    kind: event.kind,
    notes: event.notes,
    recorded_by: event.recorded_by,
    created_at: isoSeconds(event.created_at),
    photos: photos
      .filter((photo) => photo.event_id === event.id)
      .map((photo) => ({ id: photo.id, url: `/api/condition-photos/${photo.id}` })),
  }));
}

documentsRouter.get(
  '/contracts/:id/condition-events',
  route(['owner', 'tech', 'parent'], async ({ user, req }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    return { body: { events: await conditionEvents(row.id) } };
  }),
);

documentsRouter.post(
  '/contracts/:id/condition-events',
  route(['owner', 'tech'], async ({ user, req, parts }) => {
    const row = await visibleContractRow(pool, user!, param(req, 'id'));
    if (!['signed', 'active', 'exchanged', 'returned'].includes(row.status)) {
      throw conflict('contract_not_open', 'Condition cannot be recorded on this contract.');
    }
    const kind = parts.find((part) => part.name === 'kind' && part.filename === null)?.data.toString('utf8') ?? '';
    const notesPart = parts.find((part) => part.name === 'notes' && part.filename === null);
    const notes = notesPart === undefined ? null : notesPart.data.toString('utf8');
    if (kind !== 'checkout' && kind !== 'exchange' && kind !== 'return') {
      throw validationFailed({ kind: 'Choose check-out, exchange or return.' });
    }
    if (notes !== null && notes.length > 1000) {
      throw validationFailed({ notes: 'Keep notes to 1,000 characters or fewer.' });
    }
    const photos = parts.filter((part) => part.name === 'photos' && part.filename !== null);
    if (photos.length < 1 || photos.length > 6) {
      throw validationFailed({ photos: 'count' });
    }

    const processed: Buffer[] = [];
    photos.forEach((photo, index) => {
      try {
        processed.push(processPhoto(photo.data));
      } catch (error) {
        if (!(error instanceof PhotoRefused)) throw error;
        if (error.refusal === 'photo_too_large') {
          throw new ApiError(413, 'photo_too_large', `That photo is over ${MAX_PHOTO_BYTES} bytes.`, {
            photo_index: index,
          });
        }
        if (error.refusal === 'unsupported_image') {
          throw new ApiError(415, 'unsupported_image', 'Photos must be JPEG, PNG or WebP images.', {
            photo_index: index,
          });
        }
        throw new ApiError(422, 'validation_failed', 'Check the highlighted fields.', {
          fields: { photos: 'dimensions' },
          photo_index: index,
        });
      }
    });

    const eventId = randomToken(16);
    const photoIds = processed.map(() => randomToken(16));
    const written: string[] = [];
    try {
      for (const [index, body] of processed.entries()) {
        const key = conditionPhotoKey(row.id, eventId, photoIds[index]!);
        await putObject(key, body, 'image/jpeg');
        written.push(key);
      }
    } catch (error) {
      for (const key of written) {
        try {
          await deleteObject(key);
        } catch {
          /* the outage answer already says nothing was saved */
        }
      }
      throw error;
    }

    const at = now();
    await tx(async (sql) => {
      await sql.query(
        'insert into condition_events (id, contract_id, kind, notes, recorded_by, created_at) values ($1,$2,$3,$4,$5,$6)',
        [eventId, row.id, kind, notes, user!.name, at],
      );
      for (const [index, photoId] of photoIds.entries()) {
        await sql.query(
          'insert into condition_photos (id, event_id, contract_id, position) values ($1,$2,$3,$4)',
          [photoId, eventId, row.id, index],
        );
      }
    });

    return {
      status: 201,
      body: {
        event: {
          id: eventId,
          kind,
          notes,
          recorded_by: user!.name,
          created_at: isoSeconds(at),
          photos: photoIds.map((id) => ({ id, url: `/api/condition-photos/${id}` })),
        },
      },
    };
  }),
);

documentsRouter.get(
  '/condition-photos/:photoId',
  route(['owner', 'tech', 'parent'], async ({ user, req, res }) => {
    const { rows } = await pool.query<{ id: string; event_id: string; contract_id: string }>(
      'select id, event_id, contract_id from condition_photos where id = $1',
      [param(req, 'photoId')],
    );
    const photo = rows[0];
    if (photo === undefined) throw notFound();
    await visibleContractRow(pool, user!, photo.contract_id);
    const object = await getObject(conditionPhotoKey(photo.contract_id, photo.event_id, photo.id));
    if (object === null) throw notFound();
    res.status(200);
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(object.body);
    return undefined;
  }),
);
