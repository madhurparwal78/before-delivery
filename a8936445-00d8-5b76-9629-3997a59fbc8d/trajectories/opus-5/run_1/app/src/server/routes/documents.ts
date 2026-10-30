import { errors } from '../http/errors.js';
import { fileField, parseMultipart, textField } from '../http/multipart.js';
import { route } from '../http/router.js';
import {
  approveDocument,
  documentFile,
  documentsFor,
  rejectDocument,
  requireDocument,
  uploadDocument,
} from '../services/documents.js';
import { kitchenToday } from '../domain/time.js';
import { documentJson } from './serialize.js';
import { queryValue, stringField } from './params.js';

route('POST', '/api/documents', { bodyKind: 'multipart' }, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  const parts = parseMultipart(ctx.multipartBody(), ctx.boundary());
  const givenTenantId = textField(parts, 'tenant_id');
  const actor = ctx.actor;
  let tenantId: string;
  if (actor.role === 'operator') {
    if (givenTenantId === null) throw errors.validation({ tenant_id: 'Choose a tenant.' });
    tenantId = givenTenantId;
  } else {
    if (givenTenantId !== null && givenTenantId !== actor.tenantId) throw errors.notFound();
    tenantId = actor.tenantId!;
  }
  const file = fileField(parts, 'file');
  const document = await uploadDocument(actor, {
    tenantId,
    kind: textField(parts, 'kind'),
    expiresOn: textField(parts, 'expires_on'),
    holderName: textField(parts, 'holder_name'),
    fileName: file ? file.fileName : null,
    bytes: file ? file.value : null,
  });
  return { status: 201, json: documentJson(document, kitchenToday()) };
});

route('GET', '/api/documents', {}, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  const documents = await documentsFor(ctx.actor, queryValue(ctx.query, 'tenant_id'));
  const today = kitchenToday();
  return { status: 200, json: { documents: documents.map((doc) => documentJson(doc, today)) } };
});

route('GET', '/api/documents/:id', {}, async (ctx) => {
  const document = await requireDocument(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator', 'owner');
  return { status: 200, json: documentJson(document, kitchenToday()) };
});

route('GET', '/api/documents/:id/file', {}, async (ctx) => {
  const document = await requireDocument(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator', 'owner');
  const object = await documentFile(document);
  return {
    status: 200,
    buffer: object.body,
    contentType: document.contentType,
    headers: { 'content-disposition': `attachment; filename="${document.fileName}"` },
  };
});

route('POST', '/api/documents/:id/approve', { bodyKind: 'json' }, async (ctx) => {
  await requireDocument(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator');
  ctx.jsonBody();
  const document = await approveDocument(ctx.actor, ctx.params['id']!);
  return { status: 200, json: documentJson(document, kitchenToday()) };
});

route('POST', '/api/documents/:id/reject', { bodyKind: 'json' }, async (ctx) => {
  await requireDocument(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator');
  const body = ctx.jsonBody();
  const document = await rejectDocument(ctx.actor, ctx.params['id']!, stringField(body, 'reason', ''));
  return { status: 200, json: documentJson(document, kitchenToday()) };
});
