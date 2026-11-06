import { fieldMessage } from '../../shared/copy.js';
import { department } from '../../shared/domain.js';
import type { IntakeRequest } from '../../shared/types.js';
import type { Ctx } from '../http/context.js';
import { apiError } from '../http/errors.js';
import { withIdempotency } from '../http/idempotency.js';
import { json, type Reply } from '../http/reply.js';
import {
  createRequest,
  IntakeRejected,
  IntakeUnavailable,
  listRequests,
  type IntakeRecord,
} from '../services/intake.js';
import { markIntake } from '../services/monitor.js';
import { parseDetails, parseTitle, refuseIfAny, type Fields } from './validate.js';

function toRequest(record: IntakeRecord): IntakeRequest {
  return {
    id: record.id,
    title: record.title,
    details: record.details,
    requester: record.requester,
    department: record.department === '' ? null : record.department,
    status: record.status,
    task: record.task === '' ? null : record.task,
    created: record.created.replace(' ', 'T').replace(/Z?$/, 'Z'),
    decided_at:
      record.decided_at === '' ? null : record.decided_at.replace(' ', 'T').replace(/Z?$/, 'Z'),
  };
}

export async function getRequests(): Promise<Reply> {
  try {
    const records = await listRequests();
    markIntake(true);
    return json(200, { requests: records.map(toRequest) });
  } catch (error) {
    if (error instanceof IntakeUnavailable) markIntake(false);
    if (error instanceof IntakeUnavailable || error instanceof IntakeRejected) {
      throw apiError.intakeUnavailable();
    }
    throw error;
  }
}

export async function fileRequest(ctx: Ctx): Promise<Reply> {
  return withIdempotency(ctx.idempotencyKey, 'POST', '/api/requests', ctx.body, async () => {
    const fields: Fields = { ...ctx.headerFields };
    const title = parseTitle(ctx.body.title, fields, 'title');
    const requester =
      typeof ctx.body.requester === 'string' && ctx.body.requester.trim().length > 0
        ? ctx.body.requester.trim()
        : undefined;
    if (requester === undefined) fields.requester = fieldMessage.requester;
    const details = ctx.body.details === undefined ? '' : parseDetails(ctx.body.details, fields);
    let departmentKey = '';
    if (ctx.body.department !== undefined && ctx.body.department !== null) {
      if (typeof ctx.body.department !== 'string' || department(ctx.body.department) === undefined) {
        fields.department = fieldMessage.department;
      } else {
        departmentKey = ctx.body.department;
      }
    }
    refuseIfAny(fields);

    try {
      const record = await createRequest(
        title as string,
        (details as string) ?? '',
        requester as string,
        departmentKey,
      );
      markIntake(true);
      return json(201, { request: toRequest(record) });
    } catch (error) {
      return intakeFailure(error);
    }
  });
}

function intakeFailure(error: unknown): never {
  if (error instanceof IntakeUnavailable) {
    markIntake(false);
    throw apiError.intakeUnavailable();
  }
  if (error instanceof IntakeRejected) throw apiError.intakeRejected();
  throw error;
}
