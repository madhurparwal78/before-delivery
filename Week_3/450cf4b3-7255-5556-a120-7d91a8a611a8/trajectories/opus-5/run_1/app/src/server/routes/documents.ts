import { createHash, randomUUID } from 'node:crypto';
import { query, queryOne, transactionNow, withTransaction, type Db } from '../db';
import { kitchenDate } from '../kitchen-time';
import { MINIMUM_PER_OCCURRENCE_LIMIT, serverMessage, uploadMessage } from '../../shared/copy';
import { daysBetween, isCalendarDate } from '../../shared/format';
import {
  currentOf,
  documentsOfTenant,
  isCurrentDocument,
  objectExtension,
  objectKeyFor,
  DOCUMENT_COLUMNS,
  type DocumentRow,
} from '../domain/documents';
import { StorageUnavailableError, getObject, putObject } from '../services/storage';
import { ApiError, notFound, unauthenticated } from '../http/errors';
import { FILE_PART_LIMIT } from '../http/body';
import { finishValidation, isUuid } from '../http/validate';
import { documentView, loadDocumentViews } from '../views';
import type { Ctx, Reply, Route } from '../http/route';
import type { DocumentKind } from '../../shared/types';

const UPLOAD_PARTS = ['kind', 'expiresOn', 'file', 'perOccurrenceLimit', 'additionalInsured'] as const;

function detectContentType(bytes: Buffer): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

const upload: Route = {
  method: 'POST',
  pattern: '/api/documents',
  roles: ['tenant'],
  multipartFields: UPLOAD_PARTS,
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null || user.tenantId === null) throw unauthenticated();
    const tenantId = user.tenantId;
    const multipart = ctx.multipart;
    if (multipart === null) throw notFound();

    const fields: Record<string, string> = {};
    const kindValue = multipart.fields.kind ?? null;
    const kind: DocumentKind | null =
      kindValue === 'insurance_certificate' || kindValue === 'food_handler_card' ? kindValue : null;
    if (kind === null) fields.kind = serverMessage.kindInvalid;

    const today = await withTransaction(async (client) => kitchenDate(await transactionNow(client)));
    const expiresOn = multipart.fields.expiresOn ?? null;
    if (expiresOn === null || !isCalendarDate(expiresOn)) {
      fields.expiresOn = serverMessage.expiresOnInvalid;
    } else if (daysBetween(today, expiresOn) < 0) {
      fields.expiresOn = uploadMessage.pastDate;
    }

    const file = multipart.files.file ?? null;
    let contentType: string | null = null;
    if (file === null || file.bytes.length === 0) {
      fields.file = serverMessage.fileMissing;
    } else if (file.truncated || file.bytes.length > FILE_PART_LIMIT) {
      fields.file = uploadMessage.fileSize;
    } else {
      contentType = detectContentType(file.bytes);
      if (contentType === null) fields.file = uploadMessage.fileType;
    }

    let perOccurrenceLimit: number | null = null;
    let additionalInsured: boolean | null = null;
    if (kind === 'insurance_certificate') {
      const rawLimit = multipart.fields.perOccurrenceLimit ?? null;
      const parsedLimit = rawLimit === null ? Number.NaN : Number(rawLimit);
      if (rawLimit === null || !Number.isInteger(parsedLimit) || parsedLimit < 0) {
        fields.perOccurrenceLimit = serverMessage.limitInvalid;
      } else if (parsedLimit < MINIMUM_PER_OCCURRENCE_LIMIT) {
        fields.perOccurrenceLimit = uploadMessage.limit;
      } else {
        perOccurrenceLimit = parsedLimit;
      }
      const rawInsured = multipart.fields.additionalInsured ?? null;
      if (rawInsured !== 'true' && rawInsured !== 'false') {
        fields.additionalInsured = serverMessage.additionalInsuredInvalid;
      } else if (rawInsured !== 'true') {
        fields.additionalInsured = uploadMessage.additionalInsured;
      } else {
        additionalInsured = true;
      }
    } else if (kind === 'food_handler_card') {
      if (multipart.fields.perOccurrenceLimit !== undefined) {
        fields.perOccurrenceLimit = serverMessage.unacceptedField;
      }
      if (multipart.fields.additionalInsured !== undefined) {
        fields.additionalInsured = serverMessage.unacceptedField;
      }
    }
    finishValidation(ctx, fields);
    if (kind === null || file === null || contentType === null || expiresOn === null) throw notFound();

    const documentId = randomUUID();
    const objectKey = objectKeyFor(tenantId, documentId, contentType);
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');

    try {
      await putObject(objectKey, file.bytes, contentType);
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw new ApiError(503, 'storage_unavailable', serverMessage.storageUnavailableUpload);
      }
      throw error;
    }

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      await query(
        client,
        `insert into documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured,
           content_type, size_bytes, sha256, has_file, object_key, uploaded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)`,
        [
          documentId,
          tenantId,
          kind,
          expiresOn,
          perOccurrenceLimit,
          additionalInsured,
          contentType,
          file.bytes.length,
          sha256,
          objectKey,
          now,
        ],
      );
      const documents = await documentsOfTenant(client, tenantId);
      const current = currentOf(documents);
      if (current.insurance !== null && current.foodHandler !== null) {
        await query(
          client,
          `update tenants set base_status = 'documents_pending'
           where id = $1 and base_status = 'applied'`,
          [tenantId],
        );
      }
      const stored = documents.find((document) => document.id === documentId);
      if (stored === undefined) throw notFound();
      return {
        status: 201,
        body: await documentView(client, stored, isCurrentDocument(stored, current), kitchenDate(now)),
      };
    });
  },
};

const listDocuments: Route = {
  method: 'GET',
  pattern: '/api/documents',
  roles: ['owner', 'tenant'],
  resolve: async (ctx, client) => {
    const tenantId = ctx.query.get('tenantId');
    if (tenantId === null || tenantId === '') return;
    if (!isUuid(tenantId)) throw notFound();
    const tenant = await queryOne<{ id: string }>(client, 'select id from tenants where id = $1', [tenantId]);
    if (tenant === null) throw notFound();
    if (ctx.user?.role === 'tenant' && tenantId !== ctx.user.tenantId) throw notFound();
  },
  handler: async (ctx: Ctx): Promise<Reply> => {
    const user = ctx.user;
    if (user === null) throw unauthenticated();
    const requested = ctx.query.get('tenantId');
    const fields: Record<string, string> = {};
    if (user.role === 'owner' && (requested === null || requested === '')) {
      fields.tenantId = serverMessage.tenantIdRequired;
    }
    finishValidation(ctx, fields);
    const tenantId = user.role === 'owner' ? requested ?? '' : user.tenantId ?? '';

    return withTransaction(async (client) => {
      const now = await transactionNow(client);
      return { status: 200, body: { documents: await loadDocumentViews(client, tenantId, kitchenDate(now)) } };
    });
  },
};

async function documentOr404(ctx: Ctx, client: Db): Promise<DocumentRow> {
  const document = await queryOne<DocumentRow>(
    client,
    `select ${DOCUMENT_COLUMNS} from documents where id = $1`,
    [ctx.params.id ?? ''],
  );
  if (document === null) throw notFound();
  if (ctx.user?.role === 'tenant' && document.tenant_id !== ctx.user.tenantId) throw notFound();
  return document;
}

const documentDetail: Route = {
  method: 'GET',
  pattern: '/api/documents/:id',
  roles: ['owner', 'tenant'],
  resolve: async (ctx, client) => {
    await documentOr404(ctx, client);
  },
  handler: async (ctx: Ctx): Promise<Reply> =>
    withTransaction(async (client) => {
      const now = await transactionNow(client);
      const document = await documentOr404(ctx, client);
      const current = currentOf(await documentsOfTenant(client, document.tenant_id));
      return {
        status: 200,
        body: await documentView(client, document, isCurrentDocument(document, current), kitchenDate(now)),
      };
    }),
};

const documentFile: Route = {
  method: 'GET',
  pattern: '/api/documents/:id/file',
  roles: ['owner', 'tenant'],
  resolve: async (ctx, client) => {
    await documentOr404(ctx, client);
  },
  handler: async (ctx: Ctx): Promise<Reply> => {
    const document = await withTransaction((client) => documentOr404(ctx, client));
    if (!document.has_file || document.object_key === null || document.content_type === null) {
      throw new ApiError(404, 'file_not_found', serverMessage.fileNotFound);
    }
    let bytes: Buffer;
    try {
      bytes = await getObject(document.object_key);
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw new ApiError(503, 'storage_unavailable', serverMessage.storageUnavailableRead);
      }
      throw error;
    }
    const extension = objectExtension(document.content_type);
    return {
      status: 200,
      bytes,
      headers: {
        'content-type': document.content_type,
        'content-length': String(bytes.length),
        'content-disposition': `inline; filename="${document.kind}-${document.id}.${extension}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cache-control': 'private, no-store',
      },
    };
  },
};

export const documentRoutes: ReadonlyArray<Route> = [
  upload,
  listDocuments,
  documentDetail,
  documentFile,
];
