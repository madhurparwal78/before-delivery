/**
 * The extra checks and side effects each record type adds to a move: the reopen
 * window, resolve together, problem closure, and the change freeze, overlap and
 * approval steps.
 */

import { now, nowMs } from '../clock';
import { ApiError } from '../errors';
import { isOpenState, stateLabel } from '../domain/transitions';
import {
  buildSteps,
  freezeRefusal,
  loadSteps,
  openStep,
  overlapRefusal,
  priorityOfChange,
  resetApproval,
  lockedFields,
  approvalStates,
} from './changes';
import { publish } from './live';
import {
  registerLockedFieldHook,
  registerTransitionHooks,
  reopenDeadline,
  reopenWindowPassed,
  transitionInTransaction,
} from './recordops';
import { insertActivity } from './store';
import { advanceRunsWaitingOn } from './workflow';

registerTransitionHooks('incident', {
  before: async (client, engine, caller, record, to) => {
    if (to === 'in_progress' && record.state === 'resolved') {
      const deadline = reopenDeadline(engine, record);
      if (deadline !== null && nowMs() > deadline) throw reopenWindowPassed();
    }
    if (to === 'resolved' && record.fields.is_major === true) {
      // Resolving a major incident resolves every open child, or changes none.
      const children = [...engine.records.values()].filter((r) => r.fields.parent === record.number);
      for (const child of children) {
        if (!isOpenState(child.table, child.state)) continue;
        try {
          await transitionInTransaction(
            client,
            engine,
            { ...caller, roles: ['operator'], system: true },
            child.number,
            'resolved',
            {
              resolution_code: {
                value: record.fields.resolution_code ?? null,
                version: child.versions.resolution_code ?? 1,
              },
              resolution_note: {
                value: `Resolved with major incident ${record.number}: ${String(record.fields.resolution_note ?? '')}`,
                version: child.versions.resolution_note ?? 1,
              },
            },
            { fromAnyOpenState: true },
          );
        } catch (e) {
          const reason = e instanceof ApiError ? e.message : 'Something went wrong.';
          throw new ApiError(422, 'child_failed', `Child ${child.number} could not be resolved: ${reason}.`);
        }
      }
    }
  },
  after: async (client, _engine, _caller, record, to) => {
    if (to === 'resolved' || to === 'in_progress') {
      publish({
        topic: `major:${record.fields.parent ?? record.number}`,
        event: 'children',
        data: { number: record.number, state: to },
      });
    }
    if (record.fields.is_major === true) {
      await insertActivity(
        client,
        record.number,
        now(),
        'resolution',
        `${stateLabel('incident', to)} for every open child.`,
        null,
      );
    }
  },
});

/** A request closes at the moment every item is delivered, closed, rejected or cancelled. */
registerTransitionHooks('request_item', {
  after: async (client, engine, _caller, record) => {
    const request = typeof record.fields.request === 'string' ? record.fields.request : null;
    if (request === null) return;
    const siblings = [...engine.records.values()].filter(
      (r) => r.table === 'request_item' && r.fields.request === request,
    );
    if (siblings.some((item) => isOpenState('request_item', item.state))) return;
    await client.query(
      `UPDATE record SET state = 'closed', fields = jsonb_set(fields, '{state}', '"closed"'::jsonb)
       WHERE number = $1 AND state <> 'closed'`,
      [request],
    );
    publish({ topic: `record:${request}`, event: 'state', data: { number: request, state: 'closed' } });
  },
});

// A waiting flow step moves on once the task it waits for is finished.
registerTransitionHooks('task', {
  after: async (_client, engine, _caller, record, to) => {
    if (to !== 'done' && to !== 'cancelled') return;
    const parent = typeof record.fields.parent === 'string' ? record.fields.parent : null;
    if (parent === null) return;
    await advanceRunsWaitingOn(engine, parent);
  },
});

registerTransitionHooks('problem', {
  before: async (_client, engine, _caller, record, to) => {
    if (to === 'resolved') {
      const fix = typeof record.fields.fix_change === 'string' ? record.fields.fix_change : null;
      const change = fix ? engine.records.get(fix) : null;
      if (fix && (!change || change.state !== 'done')) {
        throw new ApiError(422, 'fix_not_done', `The fix change ${fix} is not done yet.`);
      }
    }
    if (to === 'closed') {
      const open = [...engine.records.values()].filter(
        (r) => r.table === 'incident' && r.fields.problem === record.number && isOpenState('incident', r.state),
      );
      if (open.length > 0) {
        throw new ApiError(
          422,
          'open_incidents',
          `Resolve or close the ${open.length} linked open incidents before closing this problem.`,
        );
      }
    }
  },
});

const submitStates = new Set(['assessed', 'peer_review', 'board_vote', 'approved']);

registerTransitionHooks('change', {
  before: async (_client, engine, _caller, record, to) => {
    // Freeze and overlap run on each assessment and submit.
    if (submitStates.has(to)) {
      const freeze = freezeRefusal(engine, record);
      if (freeze) throw freeze;
      const overlap = overlapRefusal(engine, record);
      if (overlap) throw overlap;
    }
  },
  after: async (client, engine, _caller, record, to) => {
    if (to === 'assessed' || to === 'draft') {
      await buildSteps(client, engine, record);
    }
    const priority = priorityOfChange(engine, record);
    await client.query(
      `UPDATE record SET fields = jsonb_set(fields, '{priority}', $2::jsonb) WHERE number = $1`,
      [record.number, JSON.stringify(priority)],
    );
    const fresh = engine.records.get(record.number);
    if (fresh) {
      engine.records.set(record.number, {
        ...fresh,
        fields: { ...fresh.fields, priority },
      });
    }
    if (to === 'peer_review') {
      const steps = await loadSteps(record.number);
      if (steps.length === 0) await buildSteps(client, engine, record);
      await openStep(client, engine, record, 1);
    }
    if (to === 'board_vote' && String(record.fields.model ?? 'normal') === 'emergency') {
      const steps = await loadSteps(record.number);
      if (steps.length === 0) await buildSteps(client, engine, record);
      await openStep(client, engine, record, 1);
    }
  },
});

/** Editing a locked field once approval has started resets the approval. */
registerLockedFieldHook(async (client, engine, record, changedFields) => {
  if (record.table !== 'change') return;
  if (!approvalStates.includes(record.state)) return;
  const locked = changedFields.find((field) => lockedFields.includes(field));
  if (!locked) return;
  await resetApproval(client, engine, record, locked);
});
