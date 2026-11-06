import { fieldMessage } from '../../shared/copy.js';
import { taskId } from '../../shared/domain.js';
import type { DecisionResult, RequestOutcome } from '../../shared/types.js';
import { runChange } from '../change.js';
import { currentCycleKey } from '../cycles.js';
import { task } from '../domain/graph.js';
import type { Ctx } from '../http/context.js';
import { apiError } from '../http/errors.js';
import { withIdempotency } from '../http/idempotency.js';
import { json, type Reply } from '../http/reply.js';
import {
  getRequest,
  IntakeRejected,
  IntakeUnavailable,
  writeDecision,
} from '../services/intake.js';
import { markIntake } from '../services/monitor.js';
import {
  parseDepartment,
  parseLabel,
  parseOwner,
  parsePriority,
  parseTaskRef,
  refuseIfAny,
  type Fields,
} from './validate.js';

type Decision = 'accept' | 'decline' | 'merge';

export async function decideTriage(ctx: Ctx, number: number): Promise<Reply> {
  const path = `/api/triage/${taskId(number)}/decision`;
  return withIdempotency(ctx.idempotencyKey, 'POST', path, ctx.body, async () => {
    const change = await runChange({
      kind: 'decision',
      actor: ctx.actor,
      body: async (session) => {
        const row = task(session.graph, number);
        if (row.status !== 'triage') {
          throw apiError.conflict('already_decided', `${taskId(number)} was already decided.`);
        }

        const fields: Fields = { ...ctx.headerFields };
        const body = ctx.body;
        const decision = body.decision;
        if (decision !== 'accept' && decision !== 'decline' && decision !== 'merge') {
          fields.decision = fieldMessage.decision;
          throw apiError.validation(fields);
        }

        let departmentKey: string | undefined;
        let note = '';
        let recorded = taskId(number);
        if (decision === 'accept') {
          departmentKey = parseDepartment(body.department, fields);
          const priority = body.priority === undefined ? 0 : parsePriority(body.priority, fields);
          const owner = body.owner === undefined ? null : parseOwner(body.owner, fields);
          const label =
            body.label === undefined || body.label === null
              ? null
              : parseLabel(body.label, departmentKey ?? null, fields);
          refuseIfAny(fields);
          session.setFields(
            number,
            {
              status: 'backlog',
              department: departmentKey as string,
              priority: priority as 0 | 1 | 2 | 3 | 4,
              owner: owner as string | null,
              label: label as string | null,
              cycle: currentCycleKey(session.cycles, session.now),
            },
            'decided',
          );
        } else if (decision === 'decline') {
          const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
          if (reason.length === 0) fields.reason = fieldMessage.reason;
          refuseIfAny(fields);
          note = reason;
          session.setFields(number, { status: 'cancelled', cycle: null }, 'decided');
        } else {
          const target = parseTaskRef(body.duplicate_of, fields, 'duplicate_of');
          let targetNumber: number | undefined;
          if (target !== undefined) {
            const targetRow = session.graph.tasks.get(target);
            const mergeable =
              targetRow !== undefined &&
              ['backlog', 'todo', 'in_progress', 'done'].includes(targetRow.status);
            if (!mergeable) fields.duplicate_of = fieldMessage.duplicateOf;
            else targetNumber = target;
          }
          refuseIfAny(fields);
          recorded = taskId(targetNumber as number);
          session.setFields(
            number,
            { status: 'duplicate', duplicate_of: targetNumber as number, cycle: null },
            'decided',
          );
        }

        // Every triage task comes from the intake, so it carries its record id.
        const requestId = row.request as string;
        const record = await writeOutcome(requestId, decision, recorded, note, session.now);
        const outcome: RequestOutcome = {
          id: record.id,
          status: record.status,
          task: record.task === '' ? null : record.task,
        };
        return outcome;
      },
    });

    const result: DecisionResult = { ...change.result, request: change.value };
    return json(200, result);
  });
}

const OUTCOME_STATUS: Record<Decision, 'accepted' | 'declined' | 'merged'> = {
  accept: 'accepted',
  decline: 'declined',
  merge: 'merged',
};

/** The decision is final only once the intake has recorded it. */
async function writeOutcome(
  requestId: string,
  decision: Decision,
  recordedTask: string,
  note: string,
  at: Date,
) {
  try {
    const existing = await getRequest(requestId);
    if (existing.status !== 'pending') throw new IntakeRejected('That record is not pending.');
    const record = await writeDecision(requestId, {
      status: OUTCOME_STATUS[decision],
      task: recordedTask,
      note,
      at,
    });
    markIntake(true);
    return record;
  } catch (error) {
    if (error instanceof IntakeUnavailable) {
      markIntake(false);
      throw apiError.intakeUnavailable();
    }
    if (error instanceof IntakeRejected) throw apiError.intakeRejected();
    throw error;
  }
}
