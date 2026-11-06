import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, type Ctx } from './http.js';
import { parseMultipart } from './multipart.js';
import { detectImageType, stripLocation } from '../domain/images.js';
import { putObject } from '../services/s3.js';
import { sha256Hex, newToken } from '../domain/crypto.js';
import { codePoints } from './helpers.js';
import { applyAnswerToCase } from './answers.js';

const MAX_CERTIFICATE_BYTES = 5000000;

export async function answerPage(ctx: Ctx): Promise<Response> {
  const contentType = ctx.req.headers.get('content-type') ?? '';
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime !== 'multipart/form-data') throw errors.unsupportedMedia();
  const body = await ctx.rawBody();
  const parts = parseMultipart(body, contentType);
  if (parts === null) throw errors.badForm();

  const byName = new Map<string, (typeof parts)[number]>();
  for (const part of parts) byName.set(part.name, part);
  const answerPart = byName.get('answer');
  const notePart = byName.get('note');
  const certPart = byName.get('certificate');

  const fields: Record<string, string> = {};
  const answer = answerPart !== undefined ? answerPart.data.toString('utf8').trim() : '';
  if (answer !== 'accepted' && answer !== 'rejected') fields.answer = 'Choose Accepted or Rejected.';
  if (certPart === undefined || certPart.data.length === 0) fields.certificate = 'Attach the licence certificate.';
  if (Object.keys(fields).length > 0) throw errors.invalid(fields);

  const note = notePart !== undefined ? notePart.data.toString('utf8') : '';
  if (codePoints(note) > 1000) throw errors.invalid({ note: 'The note can be at most 1,000 characters.' });

  const certData = certPart!.data;
  if (certData.length > MAX_CERTIFICATE_BYTES) throw errors.fileTooLarge();
  const imageType = detectImageType(certData);
  if (imageType === null) throw errors.unsupportedFile();

  const page = await query<{ id: string; case_id: string; workspace_slug: string; status: string; ends_at: Date; answer_decision: string | null }>('SELECT id, case_id, workspace_slug, status, ends_at, answer_decision FROM request_pages WHERE token = $1', [ctx.params.token]);
  if (page.rows.length === 0) throw errors.notFound();
  const p = page.rows[0];
  const now = new Date();
  const live = p.status === 'live' && p.ends_at.getTime() > now.getTime();
  if (!live) throw errors.requestPageEnded();
  if (p.status === 'answered' || p.answer_decision !== null) throw errors.conflict('already_answered', 'This page has already been answered.');

  const caseRow = await query<{ status: string; outcome: string | null; answer_decision: string | null; path: string; answer_due_at: Date | null }>('SELECT status, outcome, answer_decision, path, answer_due_at FROM cases WHERE id = $1 AND workspace_slug = $2', [p.case_id, p.workspace_slug]);
  const c = caseRow.rows[0];
  const answerResult = applyAnswerToCase(c, answer as 'accepted' | 'rejected', now, 'request_page');
  if (answerResult.kind === 'refused') throw answerResult.error;

  // Store the certificate in MinIO before anything is recorded.
  const certId = `cert-${newToken(10).toLowerCase()}`;
  const cleaned = stripLocation(certData, imageType);
  const objectKey = `${p.workspace_slug}/certificates/${certId}`;
  const stored = await putObject(objectKey, cleaned, imageType);
  if (!stored.ok) throw errors.storageUnreachable();

  await query('INSERT INTO certificates (id, workspace_slug, case_id, content_type, size_bytes, sha256, object_key, stored_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [certId, p.workspace_slug, p.case_id, imageType, cleaned.length, sha256Hex(cleaned), objectKey, now]);
  await query('UPDATE request_pages SET status = $1, answer_decision = $2, answer_received_at = $3, certificate_id = $4 WHERE id = $5',
    ['answered', answer, now, certId, p.id]);
  await query('UPDATE cases SET answer_decision = $1, answer_at = $2, answer_late = $3, answer_via = $4, status = $5 WHERE id = $6',
    [answerResult.decision, now, answerResult.late, 'request_page', answerResult.status, p.case_id]);

  return jsonOk({ answer: { decision: answer, receivedAt: `${now.toISOString().slice(0, 19)}Z`, certificate: { id: certId, contentType: imageType, sizeBytes: cleaned.length, sha256: sha256Hex(cleaned) } } }, 201);
}
