import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config';
import { Db, db, tx } from '../db/pool';
import {
  FIELD_COPY,
  duplicateRequest,
  notEligible,
  notFound,
  outOfStock,
  storageUnavailable,
  tooLargeFile,
  unsupportedFile,
  validationFailed,
  warrantyExpired,
  windowClosedReturn,
  windowClosedTrial
} from '../errors';
import { requireUser } from '../http/context';
import { sendBytes, sendJson } from '../http/respond';
import { route } from '../http/router';
import { pdfIsPlain, safeFilename, sniffContentType } from '../http/body';
import {
  FieldErrors,
  readInteger,
  readString,
  readStringArray,
  validateIdempotencyKey
} from '../http/validate';
import {
  CaseKind,
  ClaimRow,
  ReturnRow,
  TrialRow,
  addCaseHistory,
  claimPayload,
  nextCaseNumber,
  openClaimExists,
  openReturnOrTrialExists,
  publishCase,
  returnPayload,
  trialPayload
} from '../domain/cases';
import { CLAIM_COMPONENTS, RETURN_REASONS } from '../domain/constants';
import { runIdempotent } from '../domain/idempotency';
import {
  OrderLineRow,
  OrderRow,
  exchangeCandidates,
  loadOrder,
  warrantyCoveredUntil
} from '../domain/orders';
import { returnSubject, recordNotification, statusBody, trialSubject, warrantySubject } from '../domain/notify';
import { hasCabinFit, windowState } from '../domain/rules';
import { getObject, putConfirmed } from '../services/storage';

type LineContext = { line: OrderLineRow; order: OrderRow };

async function loadOwnedLine(client: Db, lineId: string, userId: string): Promise<LineContext> {
  const line = await client.one<OrderLineRow>('SELECT * FROM order_lines WHERE id::text = $1', [lineId]);
  if (line === null) throw notFound();
  const order = await loadOrder(client, line.order_number);
  if (order === null || order.user_id !== userId) throw notFound();
  return { line, order };
}

export function registerCaseRoutes(): void {
  route('POST', '/api/returns', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const key = validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, false);
    const result = await runIdempotent(key, user.id, 'POST /api/returns', ctx.body, async () => {
      const payload = await tx(async (client) => {
        const lineId = readString(ctx.body, 'order_line_id') ?? '';
        const { line, order } = await loadOwnedLine(client, lineId, user.id);
        if (await openReturnOrTrialExists(client, line.id)) throw duplicateRequest();

        const errors = new FieldErrors();
        const quantity = readInteger(ctx.body, 'quantity');
        const reason = readString(ctx.body, 'reason') ?? '';
        const outcome = readString(ctx.body, 'outcome') ?? '';
        const exchangeSku = readString(ctx.body, 'exchange_sku');
        if (quantity === null || quantity < 1 || quantity > 10) errors.add('quantity', FIELD_COPY.quantity);
        if (!RETURN_REASONS.includes(reason)) errors.add('reason', FIELD_COPY.reason);
        if (outcome !== 'refund' && outcome !== 'exchange') errors.add('outcome', FIELD_COPY.outcome);

        const candidates = await exchangeCandidates(client, line);
        if (outcome === 'exchange') {
          const candidate = candidates.find((item) => item.sku === exchangeSku);
          if (candidate === undefined) errors.add('exchange_sku', FIELD_COPY.exchangeSku);
        }
        errors.throwIfAny();

        if (line.fulfillment !== 'delivered') throw notEligible();
        if (line.returned_quantity + (quantity as number) > line.quantity) throw notEligible();
        const window = windowState(order.delivered_at, config.returnWindowDays, new Date());
        if (window === null) throw notEligible();
        if (!window.open) throw windowClosedReturn(new Date(window.ends_at));

        if (outcome === 'exchange') {
          const candidate = candidates.find((item) => item.sku === exchangeSku)!;
          if (candidate.available <= 0) {
            throw outOfStock(candidate.sku, 0, `${line.product} — ${candidate.colour}, ${candidate.size}`);
          }
        }

        const number = await nextCaseNumber(client, 'return');
        await client.query(
          `INSERT INTO returns (number, order_line_id, user_id, status, quantity, reason, outcome, exchange_sku)
           VALUES ($1, $2, $3, 'requested', $4, $5, $6, $7)`,
          [number, line.id, user.id, quantity, reason, outcome, outcome === 'exchange' ? exchangeSku : null]
        );
        await addCaseHistory(client, 'return', number, 'requested');
        const row = await client.one<ReturnRow>('SELECT * FROM returns WHERE number = $1', [number]);
        await publishCase(client, 'return', { number, status: 'requested', version: 1 }, user.id);
        const subject = returnSubject(number, 'requested');
        await recordNotification(client, user.id, subject, statusBody(`Return ${number}`, 'Requested', null), 'pending');
        return returnPayload(client, row!);
      });
      return { status: 201, payload };
    });
    sendJson(ctx, result.status, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
  });

  route('GET', '/api/returns', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query<ReturnRow>(
      'SELECT * FROM returns WHERE user_id = $1 ORDER BY created_at DESC, number DESC',
      [user.id]
    );
    sendJson(ctx, 200, await Promise.all(rows.map((row) => returnPayload(db, row))));
  });

  route('GET', '/api/returns/:number', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const row = await db.one<ReturnRow>('SELECT * FROM returns WHERE number = $1 AND user_id = $2', [
      ctx.params.number,
      user.id
    ]);
    if (row === null) throw notFound();
    sendJson(ctx, 200, await returnPayload(db, row));
  });

  route('POST', '/api/trials', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const key = validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, false);
    const result = await runIdempotent(key, user.id, 'POST /api/trials', ctx.body, async () => {
      const payload = await tx(async (client) => {
        const lineId = readString(ctx.body, 'order_line_id') ?? '';
        const { line, order } = await loadOwnedLine(client, lineId, user.id);
        if (await openReturnOrTrialExists(client, line.id)) throw duplicateRequest();

        const note = readString(ctx.body, 'note') ?? '';
        if (note.length > 500) throw validationFailed({ note: FIELD_COPY.note });

        if (line.fulfillment !== 'delivered') throw notEligible();
        if (!hasCabinFit(line.category)) throw notEligible();
        if (line.returned_quantity >= line.quantity) throw notEligible();
        const window = windowState(order.delivered_at, config.trialWindowDays, new Date());
        if (window === null) throw notEligible();
        if (!window.open) throw windowClosedTrial(new Date(window.ends_at));

        const number = await nextCaseNumber(client, 'trial');
        await client.query(
          `INSERT INTO trials (number, order_line_id, user_id, status, note)
           VALUES ($1, $2, $3, 'requested', $4)`,
          [number, line.id, user.id, note]
        );
        await addCaseHistory(client, 'trial', number, 'requested');
        const row = await client.one<TrialRow>('SELECT * FROM trials WHERE number = $1', [number]);
        await publishCase(client, 'trial', { number, status: 'requested', version: 1 }, user.id);
        const subject = trialSubject(number, 'requested');
        await recordNotification(
          client,
          user.id,
          subject,
          statusBody(`Trial return ${number}`, 'Requested', null),
          'pending'
        );
        return trialPayload(client, row!);
      });
      return { status: 201, payload };
    });
    sendJson(ctx, result.status, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
  });

  route('GET', '/api/trials', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query<TrialRow>(
      'SELECT * FROM trials WHERE user_id = $1 ORDER BY created_at DESC, number DESC',
      [user.id]
    );
    sendJson(ctx, 200, await Promise.all(rows.map((row) => trialPayload(db, row))));
  });

  route('GET', '/api/trials/:number', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const row = await db.one<TrialRow>('SELECT * FROM trials WHERE number = $1 AND user_id = $2', [
      ctx.params.number,
      user.id
    ]);
    if (row === null) throw notFound();
    sendJson(ctx, 200, await trialPayload(db, row));
  });

  route('POST', '/api/warranty/registrations', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const payload = await tx(async (client) => {
      const lineId = readString(ctx.body, 'order_line_id') ?? '';
      const { line, order } = await loadOwnedLine(client, lineId, user.id);
      const existing = await client.one<{ id: string; covered_until: Date }>(
        'SELECT id, covered_until FROM warranty_registrations WHERE order_line_id = $1',
        [line.id]
      );
      if (existing !== null) {
        return {
          status: 200,
          body: {
            id: existing.id,
            order_line_id: line.id,
            covered_until: existing.covered_until.toISOString()
          }
        };
      }
      if (line.fulfillment !== 'delivered' || order.delivered_at === null) throw notEligible();
      const coveredUntil = warrantyCoveredUntil(line.category, order.delivered_at);
      if (new Date().getTime() >= coveredUntil.getTime()) throw warrantyExpired(coveredUntil);
      const id = randomUUID();
      await client.query(
        'INSERT INTO warranty_registrations (id, order_line_id, user_id, covered_until) VALUES ($1, $2, $3, $4)',
        [id, line.id, user.id, coveredUntil]
      );
      return {
        status: 201,
        body: { id, order_line_id: line.id, covered_until: coveredUntil.toISOString() }
      };
    });
    sendJson(ctx, payload.status, payload.body);
  });

  route('POST', '/api/warranty/evidence', 'upload', async (ctx) => {
    const user = requireUser(ctx);
    validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, false);
    const multipart = ctx.multipart;
    const kind = multipart?.fields.find((field) => field.name === 'kind')?.value ?? '';
    const file = multipart?.files.find((item) => item.name === 'file');

    const errors = new FieldErrors();
    if (kind !== 'photo' && kind !== 'receipt') errors.add('kind', FIELD_COPY.kind);
    if (file === undefined || file.data.length === 0) errors.add('file', FIELD_COPY.file);
    errors.throwIfAny();

    if (file!.data.length > config.uploadMaxBytes) throw tooLargeFile();
    const sniffed = sniffContentType(file!.data);
    const allowed =
      kind === 'photo'
        ? ['image/jpeg', 'image/png', 'image/webp']
        : ['application/pdf'];
    if (sniffed === null || !allowed.includes(sniffed)) throw unsupportedFile(false);
    if (sniffed === 'application/pdf' && !pdfIsPlain(file!.data)) throw unsupportedFile(false);

    const id = randomUUID();
    const storageKey = `evidence/${user.id}/${id}`;
    const confirmed = await putConfirmed(storageKey, file!.data, sniffed);
    if (!confirmed) throw storageUnavailable(false);

    const filename = safeFilename(file!.filename);
    const sha256 = createHash('sha256').update(file!.data).digest('hex');
    const storedAt = new Date();
    await db.query(
      `INSERT INTO evidence (id, user_id, kind, filename, content_type, bytes, sha256, storage_key, status, stored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stored', $9)`,
      [id, user.id, kind, filename, sniffed, file!.data.length, sha256, storageKey, storedAt]
    );
    sendJson(ctx, 201, {
      id,
      kind,
      filename,
      content_type: sniffed,
      bytes: file!.data.length,
      sha256,
      status: 'stored',
      stored_at: storedAt.toISOString()
    });
  });

  route('GET', '/api/warranty/evidence/:id/content', 'raw', async (ctx) => {
    const user = requireUser(ctx);
    const row = await db.one<{ storage_key: string; content_type: string; filename: string }>(
      'SELECT storage_key, content_type, filename FROM evidence WHERE id::text = $1 AND user_id = $2',
      [ctx.params.id, user.id]
    );
    if (row === null) throw notFound();
    const bytes = await getObject(row.storage_key);
    if (bytes === null) throw notFound();
    const extra: Record<string, string> =
      row.content_type === 'application/pdf'
        ? { 'Content-Disposition': `attachment; filename="${row.filename.replace(/"/g, '')}"` }
        : {};
    sendBytes(ctx, 200, bytes, row.content_type, extra);
  });

  route('POST', '/api/warranty/claims', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const key = validateIdempotencyKey(ctx.request.headers['idempotency-key'] as string | undefined, false);
    const result = await runIdempotent(key, user.id, 'POST /api/warranty/claims', ctx.body, async () => {
      const payload = await tx(async (client) => {
        const registrationId = readString(ctx.body, 'registration_id') ?? '';
        const registration = await client.one<{ id: string; order_line_id: string; covered_until: Date }>(
          'SELECT id, order_line_id, covered_until FROM warranty_registrations WHERE id::text = $1 AND user_id = $2',
          [registrationId, user.id]
        );
        if (registration === null) throw notFound();

        const component = readString(ctx.body, 'component') ?? '';
        const description = readString(ctx.body, 'description') ?? '';
        const evidenceIds = readStringArray(ctx.body, 'evidence_ids') ?? [];

        if (CLAIM_COMPONENTS.includes(component) && (await openClaimExists(client, registration.order_line_id, component))) {
          throw duplicateRequest();
        }

        const errors = new FieldErrors();
        if (!CLAIM_COMPONENTS.includes(component)) errors.add('component', FIELD_COPY.component);
        if (description.length < 20 || description.length > 1000) errors.add('description', FIELD_COPY.description);

        const evidence =
          evidenceIds.length === 0
            ? []
            : await client.query<{ id: string; kind: string; claim_number: string | null }>(
                `SELECT id, kind, claim_number FROM evidence
                 WHERE id::text = ANY($1::text[]) AND user_id = $2 AND status = 'stored'`,
                [evidenceIds, user.id]
              );
        if (evidence.length !== evidenceIds.length || evidence.some((item) => item.claim_number !== null)) {
          throw notFound();
        }
        const photos = evidence.filter((item) => item.kind === 'photo').length;
        const receipts = evidence.filter((item) => item.kind === 'receipt').length;
        if (photos < 1 || photos > 5 || receipts > 1) errors.add('evidence_ids', FIELD_COPY.evidenceIds);
        errors.throwIfAny();

        if (new Date().getTime() >= new Date(registration.covered_until).getTime()) {
          throw warrantyExpired(new Date(registration.covered_until));
        }

        const number = await nextCaseNumber(client, 'warranty_claim');
        await client.query(
          `INSERT INTO warranty_claims (number, registration_id, user_id, component, description, status)
           VALUES ($1, $2, $3, $4, $5, 'submitted')`,
          [number, registration.id, user.id, component, description]
        );
        await client.query('UPDATE evidence SET claim_number = $2 WHERE id::text = ANY($1::text[])', [
          evidenceIds,
          number
        ]);
        await addCaseHistory(client, 'warranty_claim', number, 'submitted');
        const row = await client.one<ClaimRow>('SELECT * FROM warranty_claims WHERE number = $1', [number]);
        await publishCase(client, 'warranty_claim', { number, status: 'submitted', version: 1 }, user.id);
        const subject = warrantySubject(number, 'submitted');
        await recordNotification(
          client,
          user.id,
          subject,
          statusBody(`Warranty claim ${number}`, 'Submitted', null),
          'pending'
        );
        return claimPayload(client, row!);
      });
      return { status: 201, payload };
    });
    sendJson(ctx, result.status, result.payload, result.replayed ? { 'Idempotency-Replayed': 'true' } : {});
  });

  route('GET', '/api/warranty/claims', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const rows = await db.query<ClaimRow>(
      'SELECT * FROM warranty_claims WHERE user_id = $1 ORDER BY created_at DESC, number DESC',
      [user.id]
    );
    sendJson(ctx, 200, await Promise.all(rows.map((row) => claimPayload(db, row))));
  });

  route('GET', '/api/warranty/claims/:number', 'api', async (ctx) => {
    const user = requireUser(ctx);
    const row = await db.one<ClaimRow>('SELECT * FROM warranty_claims WHERE number = $1 AND user_id = $2', [
      ctx.params.number,
      user.id
    ]);
    if (row === null) throw notFound();
    sendJson(ctx, 200, await claimPayload(db, row));
  });
}

export type { CaseKind };
