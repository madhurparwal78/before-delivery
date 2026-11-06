import { LIMITS } from '../../shared/limits';
import { ClientOp, parseClientOp } from '../../shared/ops';
import { transaction } from '../db';
import { jsonBody, requireMember } from '../http/context';
import { apiErrors } from '../http/errors';
import { addRoute } from '../http/pipeline';
import { withRequestKey } from '../domain/requestKeys';
import { loadWorkbookState } from '../domain/state';
import { applyBatch } from '../domain/sync';
import { loadWorkbook, loadWorkbookForUpdate } from '../domain/workbooks';

const BATCH_FIELDS = new Set(['deviceId', 'baseSeq', 'ops']);

interface ParsedBatch {
  deviceId: string;
  baseSeq: number;
  rawOps: unknown[];
}

function parseBatch(body: Record<string, unknown>): ParsedBatch {
  for (const key of Object.keys(body)) {
    if (!BATCH_FIELDS.has(key)) throw apiErrors.validation({ [key]: 'That field is not part of a batch.' });
  }
  const deviceId = body.deviceId;
  if (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > 64) {
    throw apiErrors.validation({ deviceId: 'Send a device id of 1 to 64 characters.' });
  }
  const baseSeq = body.baseSeq;
  if (typeof baseSeq !== 'number' || !Number.isInteger(baseSeq) || baseSeq < 0) {
    throw apiErrors.validation({ baseSeq: 'Send a whole number from 0 to the current head sequence.' });
  }
  const ops = body.ops;
  if (!Array.isArray(ops) || ops.length < 1 || ops.length > LIMITS.maxOpsPerBatch) {
    throw apiErrors.validation({ ops: `Send 1 to ${LIMITS.maxOpsPerBatch} ops.` });
  }
  const seen = new Set<string>();
  for (const raw of ops) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw apiErrors.validation({ ops: 'Each op must be an object.' });
    }
    const opId = (raw as Record<string, unknown>).opId;
    if (typeof opId !== 'string' || opId.length < 1 || opId.length > 64) {
      throw apiErrors.validation({ ops: 'Each op needs an opId of 1 to 64 characters.' });
    }
    if (seen.has(opId)) throw apiErrors.validation({ ops: 'Each opId must be unique in the batch.' });
    seen.add(opId);
  }
  return { deviceId, baseSeq, rawOps: ops };
}

/** An op that fails shape validation is rejected on its own as `invalid_op`. */
function toOps(rawOps: unknown[]): { op: ClientOp | null; opId: string }[] {
  return rawOps.map((raw) => ({
    op: parseClientOp(raw),
    opId: String((raw as Record<string, unknown>).opId),
  }));
}

export function registerSyncRoutes(): void {
  addRoute({
    method: 'POST',
    pattern: '/api/workbooks/:id/sync',
    auth: true,
    handler: async (ctx) => {
      const member = requireMember(ctx);
      const workbook = await loadWorkbook(ctx.params.id, member.stationId);
      const key = ctx.req.headers['idempotency-key'] as string | undefined;
      const stored = await withRequestKey(
        {
          memberId: member.id,
          endpoint: 'sync',
          workbookId: workbook.id,
          key,
          body: ctx.rawBody,
        },
        async () => {
          const batch = parseBatch(jsonBody(ctx));
          const response = await transaction(async (client) => {
            const row = await loadWorkbookForUpdate(client, workbook.id, member.stationId);
            const { state, headSeq } = await loadWorkbookState(row.id, client);
            if (batch.baseSeq > headSeq) {
              throw apiErrors.validation({ baseSeq: 'Send a whole number from 0 to the current head sequence.' });
            }
            const checked = toOps(batch.rawOps);
            const validOps: ClientOp[] = [];
            const invalid = new Map<string, true>();
            for (const entry of checked) {
              if (entry.op) validOps.push(entry.op);
              else invalid.set(entry.opId, true);
            }
            const applied = await applyBatch(
              client,
              row,
              member,
              { deviceId: batch.deviceId, baseSeq: batch.baseSeq, ops: validOps },
              state,
              headSeq,
            );
            const results = checked.map((entry) => {
              if (invalid.has(entry.opId)) {
                return { opId: entry.opId, status: 'rejected' as const, reason: 'invalid_op' as const, conflictId: null };
              }
              return applied.results.find((result) => result.opId === entry.opId) as (typeof applied.results)[number];
            });
            return {
              batch: { key: key as string, deviceId: batch.deviceId, headSeq: applied.batch.headSeq },
              results,
            };
          });
          return { status: 200, text: JSON.stringify(response) };
        },
      );
      ctx.res.writeHead(stored.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      });
      ctx.res.end(stored.text);
    },
  });
}
