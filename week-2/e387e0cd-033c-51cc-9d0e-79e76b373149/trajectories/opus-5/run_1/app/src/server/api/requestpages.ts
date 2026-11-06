import { toInstant } from '../../shared/businesstime';
import { FIELD_COPY } from '../../shared/copy';
import { maskedAddress } from '../../shared/format';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { detectContentType, removeLocationData } from '../domain/image';
import { failure } from '../http/errors';
import { readMultipart } from '../http/multipart';
import { define, headerValue, Registered, sha256Of } from '../http/runtime';
import { codePoints, FieldCheck } from '../http/validate';
import { putObject, StorageUnreachable } from '../services/s3';
import { answerArrivalFor, applyAnswer, lapseAnswers } from '../store/caseengine';
import { CaseRow, remainingSeconds, RequestPageRow, requestPageStatus } from '../store/cases';
import { findWorkspace } from '../store/workspace';

const CERTIFICATE_LIMIT = 5000000;

interface PageBundle {
  readonly page: RequestPageRow;
  readonly caseRow: CaseRow;
}

async function loadLivePage(token: string, now: Date): Promise<PageBundle> {
  const page = await queryOne<RequestPageRow>('SELECT * FROM request_pages WHERE token = $1', [
    token,
  ]);
  if (page === null) throw failure('not_found');
  await lapseAnswers(page.workspace_slug, now);
  const caseRow = await queryOne<CaseRow>('SELECT * FROM cases WHERE id = $1', [page.case_id]);
  if (caseRow === null) throw failure('not_found');
  if (requestPageStatus(page, now) === 'ended') throw failure('request_page_ended');
  return { page, caseRow };
}

async function pageBody(bundle: PageBundle, now: Date): Promise<Record<string, unknown>> {
  const workspace = await findWorkspace(bundle.page.workspace_slug);
  const status = requestPageStatus(bundle.page, now);
  return {
    caseReference: bundle.caseRow.reference,
    asset: bundle.caseRow.asset,
    amount: bundle.caseRow.amount,
    fromAddressMasked: maskedAddress(bundle.caseRow.sending_address),
    toAddressMasked: maskedAddress(bundle.caseRow.destination_address),
    requestingExchange: workspace === null ? '' : workspace.legalName,
    status,
    endsAt: toInstant(bundle.page.ends_at),
    remainingSeconds: status === 'live' ? remainingSeconds(bundle.page.ends_at, now) : 0,
    now: toInstant(now),
  };
}

export const requestPageRoutes: readonly Registered[] = [
  define({
    kind: 'public',
    method: 'GET',
    path: '/api/request-pages/:token',
    load: (context) => loadLivePage(context.params.token, context.now),
    handler: async (context) => ({
      status: 200,
      json: { page: await pageBody(context.loaded, context.now) },
    }),
  }),
  define({
    kind: 'public',
    method: 'POST',
    path: '/api/request-pages/:token/answer',
    content: 'multipart',
    bodyLimit: 6000000,
    load: (context) => loadLivePage(context.params.token, context.now),
    handler: async (context) => {
      const form = readMultipart(headerValue(context.headers, 'content-type') ?? '', context.raw);
      if (form === null) throw failure('bad_form');
      const certificate = form.files.find((file) => file.fieldName === 'certificate') ?? null;
      if (certificate !== null && certificate.bytes.length > CERTIFICATE_LIMIT) {
        throw failure('file_too_large');
      }
      const contentType = certificate === null ? null : detectContentType(certificate.bytes);
      if (certificate !== null && contentType === null) throw failure('unsupported_file');
      if (context.loaded.page.answered_at !== null) throw failure('already_answered');
      const arrival = answerArrivalFor(context.loaded.caseRow, context.now);
      if (arrival === 'refused') throw failure('answer_not_expected');

      const answer = form.fields.answer ?? null;
      const note = form.fields.note ?? '';
      const check = new FieldCheck();
      if (answer !== 'accepted' && answer !== 'rejected') {
        check.add('answer', 'Choose Accepted or Rejected.');
      }
      if (certificate === null) check.add('certificate', FIELD_COPY.certificate);
      if (codePoints(note) > 1000) check.add('note', 'A note can be at most 1,000 characters.');
      check.settle();

      const cleaned = removeLocationData(
        (certificate as NonNullable<typeof certificate>).bytes,
        contentType as NonNullable<typeof contentType>,
      );
      const id = newId('cert');
      const objectKey = `${context.loaded.page.workspace_slug}/certificates/${id}`;
      try {
        await putObject(objectKey, cleaned);
      } catch (error) {
        if (error instanceof StorageUnreachable) throw failure('storage_unreachable');
        throw error;
      }
      const digest = sha256Of(cleaned);
      await query(
        `INSERT INTO certificates (id, workspace_slug, case_id, content_type, size_bytes, sha256,
           object_key, stored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          context.loaded.page.workspace_slug,
          context.loaded.caseRow.id,
          contentType,
          cleaned.length,
          digest,
          objectKey,
          context.now,
        ],
      );
      await query(
        `UPDATE request_pages SET answered_at = $2, answer_decision = $3, certificate_id = $4
         WHERE id = $1`,
        [context.loaded.page.id, context.now, answer, id],
      );
      await applyAnswer(
        context.loaded.caseRow,
        answer as 'accepted' | 'rejected',
        'request_page',
        arrival,
        context.now,
      );
      return {
        status: 201,
        json: {
          answer: {
            decision: answer,
            receivedAt: toInstant(context.now),
            certificate: {
              id,
              contentType,
              sizeBytes: cleaned.length,
              sha256: digest,
            },
          },
        },
      };
    },
  }),
];

export async function requestPageExists(token: string, now: Date): Promise<'live' | 'ended' | 'missing'> {
  const page = await queryOne<RequestPageRow>('SELECT * FROM request_pages WHERE token = $1', [
    token,
  ]);
  if (page === null) return 'missing';
  return requestPageStatus(page, now) === 'ended' ? 'ended' : 'live';
}
