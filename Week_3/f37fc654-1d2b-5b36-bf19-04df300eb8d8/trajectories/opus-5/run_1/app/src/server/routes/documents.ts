import { Router } from 'express';
import { ApiError } from '../http/errors.js';
import { pathParam, route } from '../http/handler.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, documentFor } from '../domain/access.js';
import { listDocuments } from '../domain/documents.js';
import { getObject } from '../services/s3.js';
import { isoUtc } from '../../shared/venue-time.js';

export const documentsRouter = Router();

documentsRouter.get(
  '/api/commissions/:commissionId/documents',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const documents = await listDocuments(commission.id);
    res.json({
      documents: documents.map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        version: doc.version,
        label: doc.label,
        status: doc.status,
        sizeBytes: doc.size_bytes,
        sha256: doc.sha256,
        issuedAt: doc.issued_at ? isoUtc(doc.issued_at) : null,
      })),
    });
  }),
);

documentsRouter.get(
  '/api/documents/:documentId/pdf',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const document = await documentFor(pathParam(req, 'documentId'), caller);
    if (document.status !== 'issued') throw new ApiError(409, 'document_preparing');
    const object = await getObject(document.object_key);
    res.type('application/pdf').send(object.bytes);
  }),
);
