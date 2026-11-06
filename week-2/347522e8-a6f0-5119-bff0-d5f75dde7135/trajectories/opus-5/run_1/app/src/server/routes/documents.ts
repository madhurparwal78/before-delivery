/** Compliance document upload, listing, review and signed file links. */

import { randomUUID } from 'node:crypto';
import { db, transaction } from '../db.js';
import * as errors from '../http/errors.js';
import { json, redirect, type Route, type RouteResult, type SessionContext } from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import {
  EXTENSION_FOR_TYPE,
  UPLOAD_FILE_LIMIT,
  detectFileType,
  sanitiseOriginalName,
} from '../http/body.js';
import { Validator } from '../http/validate.js';
import { kitchenToday } from '../domain/clock.js';
import { blockingDocumentsCurrent, hasAllThreeKinds } from '../domain/compliance.js';
import { canDocumentMove } from '../domain/transitions.js';
import { isDateString } from '../../shared/kitchenTime.js';
import {
  StorageUnavailable,
  assertStorageReachable,
  documentObjectKey,
  presignGetUrl,
  putObject,
} from '../services/storage.js';
import { presentDocument, renterDocumentFacts, renterSummary } from './present.js';
import { DOCUMENT_COLUMNS, type DocumentRow, type RenterRow } from '../rows.js';
import type { DocumentKind } from '../../shared/types.js';

const ALL_ROLES = ['operator', 'shift_lead', 'renter'] as const;
const DOCUMENT_KINDS: DocumentKind[] = ['coi', 'food_handler_card', 'business_licence'];

async function upload(context: SessionContext): Promise<RouteResult> {
  const renter = requireResolved(context.resolved, 'renter');
  if (renter.status === 'offboarded') throw errors.renterOffboarded();

  const { fields, files } = context.multipart;
  const today = kitchenToday();
  const validator = new Validator();

  const kind = fields['kind'];
  if (kind === undefined || !(DOCUMENT_KINDS as string[]).includes(kind)) {
    validator.fail('kind', 'Choose one of: coi, food_handler_card, business_licence.');
  }
  const expiresOnRaw = fields['expires_on'];
  let expiresOn: string | null = null;
  const dateRequired = kind === 'coi' || kind === 'food_handler_card';
  if (expiresOnRaw === undefined || expiresOnRaw.trim() === '') {
    if (dateRequired) validator.fail('expires_on', 'Enter the expiry date.');
  } else if (!isDateString(expiresOnRaw.trim())) {
    validator.fail('expires_on', 'Enter a date as YYYY-MM-DD.');
  } else if (expiresOnRaw.trim() < today) {
    validator.fail('expires_on', 'Enter a date that has not already passed.');
  } else {
    expiresOn = expiresOnRaw.trim();
  }
  const file = files['file'];
  if (!file || file.bytes.length === 0) {
    validator.fail('file', 'Attach a scan file.');
  }
  validator.done();
  if (!file) throw errors.validation({ file: 'Attach a scan file.' });

  if (file.bytes.length > UPLOAD_FILE_LIMIT) throw errors.fileTooLarge();
  const detected = detectFileType(file.bytes);
  if (detected === null) throw errors.unsupportedType();

  const documentId = randomUUID();
  const objectKey = documentObjectKey(renter.id, documentId, EXTENSION_FOR_TYPE[detected]);
  try {
    await putObject(objectKey, file.bytes, detected);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
    throw error;
  }

  const stored = await transaction(async (tx) => {
    const row = await tx.one<DocumentRow>(
      `INSERT INTO documents
         (id, renter_id, kind, expires_on, status, original_name, size_bytes, content_type, object_key)
       VALUES ($1, $2, $3, $4, 'pending_review', $5, $6, $7, $8)
       RETURNING ${DOCUMENT_COLUMNS}`,
      [
        documentId,
        renter.id,
        kind,
        expiresOn,
        sanitiseOriginalName(file.filename),
        file.bytes.length,
        detected,
        objectKey,
      ],
    );
    if (renter.status === 'applied') {
      const facts = await renterDocumentFacts(tx, renter.id);
      if (hasAllThreeKinds(facts)) {
        await tx.query("UPDATE renters SET status = 'documents_review' WHERE id = $1", [renter.id]);
      }
    }
    return row;
  });

  return json(201, { document: presentDocument(stored) });
}

async function review(context: SessionContext): Promise<RouteResult> {
  const document = requireResolved(context.resolved, 'document');
  const validator = new Validator(context.body);
  const decision = validator.oneOf('decision', ['approve', 'reject'] as const);
  validator.done();
  const to = decision === 'approve' ? 'approved' : 'rejected';

  if (!canDocumentMove(document.status, to)) {
    throw errors.invalidTransition(document.status, to);
  }
  const today = kitchenToday();
  if (to === 'approved' && document.expires_on !== null && document.expires_on < today) {
    throw errors.documentExpired();
  }

  const note = typeof context.body['note'] === 'string' ? context.body['note'] : null;
  const result = await transaction(async (tx) => {
    const updated = await tx.one<DocumentRow>(
      `UPDATE documents SET status = $2, review_note = $3 WHERE id = $1
       RETURNING ${DOCUMENT_COLUMNS}`,
      [document.id, to, note],
    );
    const renter = await tx.one<RenterRow>(
      `SELECT id, user_id, business_name, contact_name, email, phone, status, killbill_account_id
         FROM renters WHERE id = $1`,
      [document.renter_id],
    );
    // An approval that leaves the COI and card current reinstates a suspended renter.
    if (
      to === 'approved' &&
      renter.status === 'suspended' &&
      blockingDocumentsCurrent(await renterDocumentFacts(tx, renter.id), today)
    ) {
      await tx.query("UPDATE renters SET status = 'active' WHERE id = $1", [renter.id]);
      renter.status = 'active';
    }
    return { document: updated, renter };
  });

  return json(200, {
    document: presentDocument(result.document),
    renter: await renterSummary(db, result.renter),
  });
}

export const documentRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/renters/:renter_id/documents',
    auth: 'session',
    roles: ['renter'],
    body: 'multipart',
    resolve: ['renter'],
    handle: upload,
  },
  {
    method: 'GET',
    path: '/api/renters/:renter_id/documents',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['renter'],
    async handle(context) {
      const renter = requireResolved(context.resolved, 'renter');
      const rows = await db.query<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE renter_id = $1 ORDER BY seq DESC`,
        [renter.id],
      );
      return json(200, { documents: rows.map(presentDocument) });
    },
  },
  {
    method: 'GET',
    path: '/api/documents/:document_id',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['document'],
    async handle(context) {
      return json(200, { document: presentDocument(requireResolved(context.resolved, 'document')) });
    },
  },
  {
    method: 'GET',
    path: '/api/documents/:document_id/file',
    auth: 'session',
    roles: [...ALL_ROLES],
    resolve: ['document'],
    async handle(context) {
      const document = requireResolved(context.resolved, 'document');
      try {
        await assertStorageReachable(document.object_key);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw error;
      }
      return redirect(presignGetUrl(document.object_key));
    },
  },
  {
    method: 'POST',
    path: '/api/documents/:document_id/review',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['document'],
    handle: review,
  },
];
