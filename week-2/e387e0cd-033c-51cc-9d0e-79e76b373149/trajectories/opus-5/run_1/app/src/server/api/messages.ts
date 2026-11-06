import { isAsset, parseAmount } from '../../shared/assets';
import { toInstant } from '../../shared/businesstime';
import { FIELD_COPY } from '../../shared/copy';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { checkNames } from '../domain/names';
import { maskPersonName } from '../domain/masking';
import { failure } from '../http/errors';
import { define, Registered, Role, sha256Of } from '../http/runtime';
import { asRecord, FieldCheck, isAddress, readText } from '../http/validate';
import { answerArrivalFor, applyAnswer, lapseAnswers, meterIncomingMessage } from '../store/caseengine';
import { findCaseByReference } from '../store/cases';
import { findCustomerByDepositAddress } from '../store/customers';
import { getObject, putObject, StorageUnreachable } from '../services/s3';

const MESSAGE_READERS: readonly Role[] = [
  'compliance_officer',
  'compliance_analyst',
  'operations_lead',
  'support_agent',
];
const ORIGINAL_READERS: readonly Role[] = ['compliance_officer', 'compliance_analyst'];

interface MessageRow {
  id: string;
  workspace_slug: string;
  message_id: string;
  counterparty_id: string;
  type: string;
  received_at: Date;
  sha256: string;
  size_bytes: number;
  object_key: string;
  object_deleted: boolean;
  outcome: string;
  working: Record<string, unknown>;
  case_id: string | null;
  customer_id: string | null;
  name_check: string | null;
  response_status: number;
  response_body: string;
}

function maskWorking(working: Record<string, unknown>, role: Role): Record<string, unknown> {
  if (role !== 'support_agent') return working;
  const copy: Record<string, unknown> = { ...working };
  const originator = copy.originator;
  if (originator !== null && typeof originator === 'object') {
    const inner = originator as Record<string, unknown>;
    copy.originator = {
      ...inner,
      name: typeof inner.name === 'string' ? maskPersonName(inner.name) : inner.name,
    };
  }
  const beneficiary = copy.beneficiary;
  if (beneficiary !== null && typeof beneficiary === 'object') {
    const inner = beneficiary as Record<string, unknown>;
    copy.beneficiary = {
      ...inner,
      name: typeof inner.name === 'string' ? maskPersonName(inner.name) : inner.name,
    };
  }
  return copy;
}

async function messageSummary(row: MessageRow): Promise<Record<string, unknown>> {
  const counterparty = await queryOne<{ id: string; legal_name: string }>(
    'SELECT id, legal_name FROM counterparties WHERE id = $1',
    [row.counterparty_id],
  );
  return {
    id: row.id,
    messageId: row.message_id,
    type: row.type,
    receivedAt: toInstant(row.received_at),
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    counterparty:
      counterparty === null ? null : { id: counterparty.id, name: counterparty.legal_name },
    outcome: row.outcome,
  };
}

export const messageRoutes: readonly Registered[] = [
  define({
    kind: 'sender',
    method: 'POST',
    path: '/api/network/:slug/messages',
    content: 'json',
    bodyLimit: 256000,
    handler: async (context) => {
      const digest = sha256Of(context.raw);
      const body = asRecord(context.body);
      const messageId = readText(context.body, 'messageId');
      if (messageId !== null) {
        const existing = await queryOne<MessageRow>(
          `SELECT * FROM messages WHERE workspace_slug = $1 AND counterparty_id = $2 AND message_id = $3`,
          [context.workspace.slug, context.sender.counterpartyId, messageId],
        );
        if (existing !== null) {
          if (existing.sha256 !== digest) throw failure('message_id_reused');
          return {
            status: existing.response_status,
            json: JSON.parse(existing.response_body) as unknown,
          };
        }
      }
      const type = readText(context.body, 'type');
      await lapseAnswers(context.workspace.slug, context.now);

      if (type === 'answer') {
        const reference = readText(context.body, 'caseReference');
        const decision = readText(context.body, 'decision');
        const caseRow =
          reference === null ? null : await findCaseByReference(context.workspace.slug, reference);
        const sentToSender =
          caseRow !== null && caseRow.counterparty_id === context.sender.counterpartyId;
        if (sentToSender && caseRow !== null) {
          const arrival = answerArrivalFor(caseRow, context.now);
          if (arrival === 'refused') throw failure('answer_not_expected');
        }
        const check = new FieldCheck();
        if (messageId === null || messageId.length < 1 || messageId.length > 100) {
          check.add('messageId', 'Send a message id of 1 to 100 characters.');
        }
        if (!sentToSender) check.add('caseReference', FIELD_COPY.caseReference);
        if (decision !== 'accepted' && decision !== 'rejected') {
          check.add('decision', 'Send accepted or rejected.');
        }
        check.settle();
        const answered = caseRow as NonNullable<typeof caseRow>;
        const arrival = answerArrivalFor(answered, context.now) as 'applied' | 'late' | 'noted';
        const outcome = arrival === 'late' ? 'late' : (decision as string);
        const stored = await storeAndAnswer(
          context,
          digest,
          'answer',
          body,
          outcome,
          answered.id,
          null,
          null,
        );
        await applyAnswer(answered, decision as 'accepted' | 'rejected', 'network', arrival, context.now);
        return stored;
      }

      const asset = body.asset;
      const amount = body.amount;
      const destinationAddress = readText(context.body, 'destinationAddress');
      const beneficiary = asRecord(body.beneficiary);
      const originator = asRecord(body.originator);
      const customer =
        destinationAddress === null
          ? null
          : await findCustomerByDepositAddress(context.workspace.slug, destinationAddress);
      const check = new FieldCheck();
      if (messageId === null || messageId.length < 1 || messageId.length > 100) {
        check.add('messageId', 'Send a message id of 1 to 100 characters.');
      }
      if (type !== 'transfer') check.add('type', 'Send a known message type.');
      if (!isAsset(asset)) check.add('asset', 'Send a known asset.');
      if (typeof amount !== 'string' || (isAsset(asset) && parseAmount(amount, asset) === null)) {
        check.add('amount', 'Send an amount greater than zero as a string.');
      }
      if (destinationAddress === null || !isAddress(destinationAddress)) {
        check.add('destinationAddress', FIELD_COPY.address);
      } else if (customer === null) {
        check.add('destinationAddress', FIELD_COPY.depositAddress);
      }
      if (typeof beneficiary.name !== 'string' || beneficiary.name === '') {
        check.add('beneficiary', "Send the beneficiary's name.");
      }
      if (typeof originator.name !== 'string' || originator.name === '') {
        check.add('originator', "Send the originator's name.");
      }
      check.settle();
      const result = checkNames(beneficiary.name as string, (customer as { name: string }).name);
      return storeAndAnswer(
        context,
        digest,
        'transfer',
        body,
        result,
        null,
        (customer as { id: string }).id,
        result,
      );
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/messages',
    roles: MESSAGE_READERS,
    handler: async (context) => {
      const rows = await query<MessageRow>(
        'SELECT * FROM messages WHERE workspace_slug = $1 ORDER BY received_at DESC',
        [context.workspace.slug],
      );
      return {
        status: 200,
        json: { messages: await Promise.all(rows.map((row) => messageSummary(row))) },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/messages/:messageId',
    roles: MESSAGE_READERS,
    load: async (context) => {
      const row = await queryOne<MessageRow>(
        'SELECT * FROM messages WHERE workspace_slug = $1 AND id = $2',
        [context.workspace.slug, context.params.messageId],
      );
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => {
      const row = context.loaded;
      const customer =
        row.customer_id === null
          ? null
          : await queryOne<{ id: string; name: string | null }>(
              'SELECT id, name FROM customers WHERE id = $1',
              [row.customer_id],
            );
      const customerName =
        customer === null || customer.name === null
          ? null
          : context.member.role === 'support_agent'
            ? maskPersonName(customer.name)
            : customer.name;
      return {
        status: 200,
        json: {
          message: {
            ...(await messageSummary(row)),
            working: maskWorking(row.working, context.member.role),
            nameCheck:
              row.name_check === null
                ? null
                : {
                    result: row.name_check,
                    customerId: row.customer_id,
                    customerName,
                  },
          },
        },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/messages/:messageId/original',
    roles: ORIGINAL_READERS,
    load: async (context) => {
      const row = await queryOne<MessageRow>(
        'SELECT * FROM messages WHERE workspace_slug = $1 AND id = $2',
        [context.workspace.slug, context.params.messageId],
      );
      if (row === null) throw failure('not_found');
      if (row.object_deleted) throw failure('original_erased');
      return row;
    },
    handler: async (context) => {
      try {
        const bytes = await getObject(context.loaded.object_key);
        return {
          status: 200,
          bytes,
          contentType: 'application/json',
          headers: {
            'Content-Disposition': `attachment; filename="${context.loaded.message_id}.json"`,
          },
        };
      } catch (error) {
        if (error instanceof StorageUnreachable) throw failure('storage_unreachable');
        throw error;
      }
    },
  }),
];

async function storeAndAnswer(
  context: {
    workspace: { slug: string; timeZone: string };
    sender: { counterpartyId: string; legalName: string };
    raw: Buffer;
    now: Date;
  },
  digest: string,
  type: 'transfer' | 'answer',
  working: Record<string, unknown>,
  outcome: string,
  caseId: string | null,
  customerId: string | null,
  nameCheck: string | null,
): Promise<{ status: number; json: unknown }> {
  const id = newId('msg');
  const objectKey = `${context.workspace.slug}/messages/${id}`;
  const messageId = typeof working.messageId === 'string' ? working.messageId : '';
  try {
    await putObject(objectKey, context.raw);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw failure('storage_unreachable');
    throw error;
  }
  const summary = {
    id,
    messageId,
    type,
    receivedAt: toInstant(context.now),
    sha256: digest,
    sizeBytes: context.raw.length,
    counterparty: { id: context.sender.counterpartyId, name: context.sender.legalName },
    outcome,
  };
  const responseBody = JSON.stringify({ message: summary });
  await query(
    `INSERT INTO messages (id, workspace_slug, message_id, counterparty_id, type, received_at,
       sha256, size_bytes, object_key, outcome, working, case_id, customer_id, name_check,
       response_status, response_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,201,$15)`,
    [
      id,
      context.workspace.slug,
      messageId,
      context.sender.counterpartyId,
      type,
      context.now,
      digest,
      context.raw.length,
      objectKey,
      outcome,
      JSON.stringify(working),
      caseId,
      customerId,
      nameCheck,
      responseBody,
    ],
  );
  await meterIncomingMessage(context.workspace.slug, context.workspace.timeZone, context.now, id);
  return { status: 201, json: { message: summary } };
}
