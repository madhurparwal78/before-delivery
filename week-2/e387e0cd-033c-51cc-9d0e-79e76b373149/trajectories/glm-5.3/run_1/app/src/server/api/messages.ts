import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, requireJsonContentType, type Ctx } from './http.js';
import { hmacSha256Hex, sha256Hex, newToken } from '../domain/crypto.js';
import { putObject, getObject } from '../services/s3.js';
import { compareNames } from '../domain/names.js';
import { isStr } from './helpers.js';
import { initials } from '../../shared/util.js';
import { parseDecimal } from '../../shared/decimal.js';
import { ASSET_DECIMALS } from '../../shared/util.js';
import { applyAnswerToCase } from './answers.js';
import { formatInstant } from '../domain/time.js';

const SIGNATURE_WINDOW_SECONDS = 300;

interface MessageRow {
  id: string; workspace_slug: string; message_id: string; sender_counterparty_id: string; type: string;
  received_at: Date; sha256: string; size_bytes: string; object_key: string; outcome: string;
  case_id: string | null; working: Record<string, unknown> | null; erased: boolean;
}

interface NameCheck { result: string; customerId: string; customerName: string }

export async function postMessage(ctx: Ctx): Promise<Response> {
  requireJsonContentType(ctx, ['application/json']);
  const raw = await ctx.rawBody();
  const signatureHeader = ctx.req.headers.get('lanternline-signature') ?? '';
  const senderLei = (ctx.req.headers.get('lanternline-sender') ?? '').toUpperCase();

  // The signature is checked over the timestamp, a dot and the exact raw
  // bytes, before any JSON parsing.
  const match = signatureHeader.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (match === null) throw errors.badSignature();
  const timestamp = Number(match[1]);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_WINDOW_SECONDS) throw errors.badSignature();

  const sender = await query<{ id: string; signing_value: string | null; network: string; legal_name: string }>(
    'SELECT id, signing_value, network, legal_name FROM counterparties WHERE workspace_slug = $1 AND upper(lei) = $2',
    [ctx.params.slug, senderLei],
  );
  if (sender.rows.length === 0 || sender.rows[0].network !== 'on_network' || sender.rows[0].signing_value === null) throw errors.badSignature();
  const expected = hmacSha256Hex(sender.rows[0].signing_value, Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), raw]));
  if (expected !== match[2]) throw errors.badSignature();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
  } catch {
    throw errors.badJson();
  }

  const bodySha = sha256Hex(raw);
  const messageId = isStr(parsed.messageId) ? parsed.messageId : '';
  const existing = await query<MessageRow>('SELECT * FROM messages WHERE workspace_slug = $1 AND sender_counterparty_id = $2 AND message_id = $3', [ctx.params.slug, sender.rows[0].id, messageId]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.sha256 === bodySha && Number(row.size_bytes) === raw.length) {
      return jsonOk({ message: await view(row, 'compliance_officer') }, 201);
    }
    throw errors.conflict('message_id_reused', 'This message id was already received with different content.');
  }

  const fields: Record<string, string> = {};
  if (messageId.length < 1 || messageId.length > 100) fields.messageId = 'The message id must be 1 to 100 characters.';
  const type = isStr(parsed.type) ? parsed.type : '';
  if (type !== 'transfer' && type !== 'answer') fields.type = 'The message type must be transfer or answer.';

  let outcome: string | null = null;
  let caseId: string | null = null;
  let nameCheck: NameCheck | null = null;

  if (Object.keys(fields).length === 0) {
    if (type === 'transfer') {
      const asset = isStr(parsed.asset) ? parsed.asset : '';
      if (!Object.prototype.hasOwnProperty.call(ASSET_DECIMALS, asset)) fields.asset = 'Choose an asset.';
      const amount = isStr(parsed.amount) ? parseDecimal(parsed.amount) : null;
      if (amount === null) fields.amount = 'Send the amount as a decimal string.';
      const destinationAddress = isStr(parsed.destinationAddress) ? parsed.destinationAddress : '';
      const beneficiary = asObject(parsed.beneficiary);
      const beneficiaryName = beneficiary !== null && isStr(beneficiary.name) ? beneficiary.name : '';
      if (beneficiaryName === '') fields.beneficiary = "Enter the beneficiary's name.";
      const originator = asObject(parsed.originator);
      if (originator === null || !isStr(originator.name) || originator.name === '') fields.originator = "Enter the originator's name.";
      if (Object.keys(fields).length === 0) {
        const customer = await query<{ id: string; name: string }>('SELECT id, name FROM customers WHERE workspace_slug = $1 AND deposit_address = $2', [ctx.params.slug, destinationAddress]);
        if (customer.rows.length === 0) fields.destinationAddress = 'No customer holds this deposit address.';
        else {
          const result = compareNames(beneficiaryName, customer.rows[0].name);
          outcome = result;
          nameCheck = { result, customerId: customer.rows[0].id, customerName: customer.rows[0].name };
        }
      }
    } else {
      const caseReference = isStr(parsed.caseReference) ? parsed.caseReference : '';
      const decision = isStr(parsed.decision) ? parsed.decision : '';
      if (decision !== 'accepted' && decision !== 'rejected') fields.decision = 'The decision must be accepted or rejected.';
      if (Object.keys(fields).length === 0) {
        const found = await query<{ status: string; outcome: string | null; answer_decision: string | null; path: string; answer_due_at: Date | null; id: string }>('SELECT status, outcome, answer_decision, path, answer_due_at, id FROM cases WHERE workspace_slug = $1 AND reference = $2 AND counterparty_id = $3', [ctx.params.slug, caseReference, sender.rows[0].id]);
        if (found.rows.length === 0) fields.caseReference = 'No case with this reference was sent to you.';
        else {
          const c = found.rows[0];
          const result = applyAnswerToCase(c, decision as 'accepted' | 'rejected', new Date(), 'network');
          if (result.kind === 'refused') throw result.error;
          outcome = result.late ? 'late' : decision;
          caseId = c.id;
          if (result.late) {
            await query('UPDATE cases SET answer_decision = $1, answer_at = $2, answer_late = true, answer_via = $3, status = $4 WHERE id = $5', [decision, new Date(), 'network', 'no_response', c.id]);
          } else {
            await query('UPDATE cases SET answer_decision = $1, answer_at = $2, answer_late = false, answer_via = $3, status = $4 WHERE id = $5', [decision, new Date(), 'network', result.status, c.id]);
          }
        }
      }
    }
  }
  if (Object.keys(fields).length > 0) throw errors.invalid(fields);

  // The exact bytes go to MinIO before the desk answers.
  const id = `msg-${newToken(10).toLowerCase()}`;
  const objectKey = `${ctx.params.slug}/messages/${id}`;
  const stored = await putObject(objectKey, raw, 'application/json');
  if (!stored.ok) throw errors.storageUnreachable();

  const receivedAt = new Date();
  const inserted = await query(
    `INSERT INTO messages (id, workspace_slug, message_id, sender_counterparty_id, type, received_at, sha256, size_bytes, object_key, outcome, case_id, working)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (workspace_slug, sender_counterparty_id, message_id) DO NOTHING RETURNING id`,
    [id, ctx.params.slug, messageId, sender.rows[0].id, type, receivedAt, bodySha, raw.length, objectKey, outcome, caseId, JSON.stringify(parsed)],
  );
  if (inserted.rows.length === 0) throw errors.conflict('message_id_reused', 'This message id was already received with different content.');
  await query('INSERT INTO metered_messages (id, workspace_slug, at, direction) VALUES ($1,$2,$3,$4)', [`mm-${id}`, ctx.params.slug, receivedAt, 'received']);

  const row = await query<MessageRow>('SELECT * FROM messages WHERE id = $1', [id]);
  return jsonOk({ message: await view(row.rows[0], 'compliance_officer', nameCheck) }, 201);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

async function view(row: MessageRow, role: string, nameCheck: NameCheck | null = null): Promise<Record<string, unknown>> {
  const sender = await query<{ id: string; legal_name: string }>('SELECT id, legal_name FROM counterparties WHERE id = $1', [row.sender_counterparty_id]);
  const support = role === 'support_agent';
  const senderName = sender.rows[0].legal_name;
  let working = row.working;
  let check: NameCheck | null = nameCheck;
  if (row.type === 'transfer' && check === null) {
    const beneficiaryName = String(asObject(row.working?.beneficiary)?.name ?? '');
    const destination = String(row.working?.destinationAddress ?? '');
    const customer = await query<{ id: string; name: string }>('SELECT id, name FROM customers WHERE workspace_slug = $1 AND deposit_address = $2', [row.workspace_slug, destination]);
    check = { result: row.outcome, customerId: customer.rows[0]?.id ?? '', customerName: customer.rows[0]?.name ?? '' };
    void beneficiaryName;
  }
  if (support) {
    working = maskNames(working);
    check = check !== null ? { ...check, customerName: initials(check.customerName) } : null;
  }
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type,
    receivedAt: formatInstant(row.received_at),
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    counterparty: { id: sender.rows[0].id, name: support ? initials(senderName) : senderName },
    outcome: row.outcome,
    working,
    ...(row.type === 'transfer' && check !== null ? { nameCheck: { result: check.result, customerId: check.customerId, customerName: check.customerName } } : {}),
  };
}

function maskNames(working: Record<string, unknown> | null): Record<string, unknown> | null {
  if (working === null) return null;
  const masked: Record<string, unknown> = { ...working };
  const beneficiary = asObject(masked.beneficiary);
  if (beneficiary !== null) masked.beneficiary = { ...beneficiary, name: initials(String(beneficiary.name ?? '')) };
  const originator = asObject(masked.originator);
  if (originator !== null) masked.originator = { ...originator, name: initials(String(originator.name ?? '')) };
  return masked;
}

export async function listMessages(ctx: Ctx): Promise<Response> {
  const role = ctx.session?.role ?? 'compliance_officer';
  const rows = await query<MessageRow>('SELECT * FROM messages WHERE workspace_slug = $1 ORDER BY received_at DESC', [ctx.params.slug]);
  return jsonOk({ messages: await Promise.all(rows.rows.map((row) => view(row, role))) });
}

export async function getMessage(ctx: Ctx): Promise<Response> {
  const role = ctx.session?.role ?? 'compliance_officer';
  const rows = await query<MessageRow>('SELECT * FROM messages WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (rows.rows.length === 0) throw errors.notFound();
  return jsonOk({ message: await view(rows.rows[0], role) });
}

export async function downloadOriginal(ctx: Ctx): Promise<Response> {
  const rows = await query<MessageRow>('SELECT * FROM messages WHERE id = $1 AND workspace_slug = $2', [ctx.params.id, ctx.params.slug]);
  if (rows.rows.length === 0) throw errors.notFound();
  const row = rows.rows[0];
  if (row.erased) throw errors.originalErased();
  const stored = await getObject(row.object_key);
  if (!stored.ok) throw errors.storageUnreachable();
  return new Response(new Uint8Array(stored.value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${row.message_id}.json"`,
    },
  });
}
