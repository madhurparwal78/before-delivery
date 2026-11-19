/**
 * Changes: the risk score, approval steps and their quorum, freeze and overlap
 * refusals, votes with delegates, and the locked-field reset.
 */

import { iso, now, nowMs } from '../clock';
import { query, transaction, type PoolClient } from '../db';
import { ApiError, conflict, notFound } from '../errors';
import { changePriority, type RiskBand } from '../domain/priority';
import {
  decide,
  tallyOf,
  type Decision,
  type QuorumRule,
  type StepStatus,
  type Voter,
} from '../domain/quorum';
import { durationHours, overlapsOpenHours, peopleBandOf, riskBand, riskScore, type RiskInputs } from '../domain/risk';
import { stateLabel } from '../domain/transitions';
import { displayTime } from '../domain/zone';
import { eventTexts } from '../domain/inbox';
import { fieldLabel } from '../domain/fields';
import { Engine, type Caller } from './engine';
import { publish } from './live';
import { deliver, operators, unreadCount } from './notify';
import { insertActivity, type FreezeScope, type RecordRow } from './store';

export const lockedFields: readonly string[] = [
  'configuration_item',
  'planned_start',
  'planned_end',
  'implementation_plan',
  'backout_plan',
];

export const approvalStates: readonly string[] = ['peer_review', 'board_vote', 'approved'];

function plannedWindow(record: RecordRow): { start: number; end: number } | null {
  const start = Date.parse(String(record.fields.planned_start ?? ''));
  const end = Date.parse(String(record.fields.planned_end ?? ''));
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

/** The risk inputs, computed from the item's impact as if it were down. */
export function riskInputsOf(engine: Engine, record: RecordRow): RiskInputs {
  const item = engine.itemOf(record.fields);
  const window = plannedWindow(record);
  const impact = item ? engine.impact(item.name) : null;
  const peopleTotal = impact?.peopleTotal ?? 0;
  const failed = countFailedChanges(engine, record, window?.start ?? nowMs());
  return {
    criticality: item?.criticality ?? 1,
    peopleTotal,
    peopleBand: peopleBandOf(peopleTotal),
    backoutTested: record.fields.backout_tested === true,
    inBusinessHours: window ? overlapsOpenHours(engine.officeHours, window.start, window.end) : false,
    failedChanges90d: failed,
    durationHours: window ? durationHours(window.start, window.end) : 0,
  };
}

/** Done changes on the same item with a failed outcome in the 90 days before the start. */
function countFailedChanges(engine: Engine, record: RecordRow, plannedStart: number): number {
  const item = record.fields.configuration_item;
  if (typeof item !== 'string') return 0;
  const from = plannedStart - 90 * 86_400_000;
  let count = 0;
  for (const other of engine.records.values()) {
    if (other.table !== 'change' || other.number === record.number) continue;
    if (other.state !== 'done') continue;
    if (other.fields.configuration_item !== item) continue;
    const outcome = other.fields.outcome;
    if (outcome !== 'failed' && outcome !== 'backed_out') continue;
    const end = Date.parse(String(other.fields.planned_end ?? ''));
    if (Number.isNaN(end)) continue;
    if (end >= from && end < plannedStart) count += 1;
  }
  return count;
}

export interface Risk {
  readonly score: number;
  readonly band: RiskBand;
  readonly inputs: RiskInputs;
}

export function riskOf(engine: Engine, record: RecordRow): Risk {
  const inputs = riskInputsOf(engine, record);
  const score = riskScore(inputs);
  return { score, band: riskBand(score), inputs };
}

/** A freeze covers a change when its scope includes the item and the windows overlap. */
function freezeCovers(engine: Engine, scope: FreezeScope, item: string | null): boolean {
  if (scope === 'all') return true;
  if (item === null) return false;
  const named = scope.items.map((n) => n.toLowerCase());
  if (named.includes(item.toLowerCase())) return true;
  // Any item a listed item depends on, transitively.
  const seen = new Set<string>();
  const walk = (name: string): boolean => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    for (const { item: target } of engine.map.dependencyTargets(name)) {
      if (target.name.toLowerCase() === item.toLowerCase()) return true;
      if (walk(target.name)) return true;
    }
    return false;
  };
  return named.some((name) => walk(name));
}

export function freezeRefusal(engine: Engine, record: RecordRow): ApiError | null {
  const window = plannedWindow(record);
  if (!window) return null;
  const item = typeof record.fields.configuration_item === 'string' ? record.fields.configuration_item : null;
  const model = String(record.fields.model ?? 'normal');
  for (const freeze of engine.freezeWindows) {
    if (!freezeCovers(engine, freeze.scope, item)) continue;
    // Ends are exclusive.
    if (!(window.start < freeze.end && freeze.start < window.end)) continue;
    if (model === 'emergency' && String(record.fields.freeze_override_reason ?? '').trim() !== '') continue;
    return new ApiError(
      422,
      'freeze',
      `This change falls inside the freeze "${freeze.name}" (${displayTime(freeze.timeZone, freeze.start)} to ${displayTime(freeze.timeZone, freeze.end)}).`,
    );
  }
  return null;
}

const overlapStates = ['assessed', 'peer_review', 'board_vote', 'approved', 'implementing'];

function dependsOn(engine: Engine, from: string, target: string): boolean {
  const seen = new Set<string>();
  const walk = (name: string): boolean => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    for (const { item } of engine.map.dependencyTargets(name)) {
      if (item.name.toLowerCase() === target.toLowerCase()) return true;
      if (walk(item.name)) return true;
    }
    return false;
  };
  return walk(from);
}

export function overlapRefusal(engine: Engine, record: RecordRow): ApiError | null {
  const window = plannedWindow(record);
  if (!window) return null;
  const item = typeof record.fields.configuration_item === 'string' ? record.fields.configuration_item : null;
  if (item === null) return null;
  const zone = engine.businessZone;
  for (const other of engine.records.values()) {
    if (other.table !== 'change' || other.number === record.number) continue;
    if (!overlapStates.includes(other.state)) continue;
    const otherItem = other.fields.configuration_item;
    if (typeof otherItem !== 'string') continue;
    const otherWindow = plannedWindow(other);
    if (!otherWindow) continue;
    if (!(window.start < otherWindow.end && otherWindow.start < window.end)) continue;
    const when = `${displayTime(zone, otherWindow.start)} to ${displayTime(zone, otherWindow.end)}`;
    if (otherItem.toLowerCase() === item.toLowerCase()) {
      return new ApiError(
        422,
        'overlap',
        `This change overlaps ${other.number} on ${otherItem} (${when}).`,
      );
    }
    if (dependsOn(engine, item, otherItem)) {
      return new ApiError(
        422,
        'overlap',
        `This change overlaps ${other.number} on ${otherItem}, which ${item} depends on (${when}).`,
      );
    }
    if (dependsOn(engine, otherItem, item)) {
      return new ApiError(
        422,
        'overlap',
        `This change overlaps ${other.number} on ${otherItem}, which depends on ${item} (${when}).`,
      );
    }
  }
  return null;
}

export interface StepRow {
  readonly id: number;
  readonly number: string;
  readonly step: number;
  readonly name: string;
  readonly rule: QuorumRule;
  readonly n: number | null;
  readonly thresholdPercent: number | null;
  readonly windowHours: number;
  readonly status: StepStatus;
  readonly opensAt: number | null;
  readonly closesAt: number | null;
  readonly voters: readonly Voter[];
}

export async function loadSteps(number: string): Promise<StepRow[]> {
  const rows = await query<{
    id: string;
    number: string;
    step: number;
    name: string;
    rule: string;
    n: number | null;
    threshold_percent: number | null;
    window_hours: number;
    status: string;
    opens_at: Date | null;
    closes_at: Date | null;
    voters: Voter[];
  }>(`SELECT * FROM approval_step WHERE number = $1 ORDER BY step`, [number]);
  return rows.map((r) => ({
    id: Number(r.id),
    number: r.number,
    step: r.step,
    name: r.name,
    rule: r.rule as QuorumRule,
    n: r.n,
    thresholdPercent: r.threshold_percent,
    windowHours: r.window_hours,
    status: r.status as StepStatus,
    opensAt: r.opens_at ? r.opens_at.getTime() : null,
    closesAt: r.closes_at ? r.closes_at.getTime() : null,
    voters: r.voters ?? [],
  }));
}

/**
 * Step 1 is Department sign-off: the approvers of every department that uses a
 * business service in the item's impact, plus the item's owner department.
 */
export function departmentSignOffVoters(engine: Engine, record: RecordRow): string[] {
  const item = engine.itemOf(record.fields);
  if (!item) return [];
  const impact = engine.impact(item.name);
  const departments = new Set<string>();
  if (item.ownerDepartment) departments.add(item.ownerDepartment);
  if (item.className === 'Business service') for (const d of item.usedByDepartments) departments.add(d);
  for (const entry of impact?.affected ?? []) {
    if (entry.item.className !== 'Business service') continue;
    for (const d of entry.item.usedByDepartments) departments.add(d);
  }
  return [...engine.people.values()]
    .filter((p) => p.active && p.roles.includes('approver') && p.department !== null && departments.has(p.department))
    .map((p) => p.username);
}

export async function buildSteps(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
): Promise<void> {
  const model = String(record.fields.model ?? 'normal');
  await client.query(`DELETE FROM approval_step WHERE number = $1`, [record.number]);
  if (model === 'standard') return;

  if (model === 'emergency') {
    const board = engine.boards.get('Emergency board');
    if (!board) return;
    await insertStep(client, record.number, 1, 'Emergency board', board);
    return;
  }

  const voters = departmentSignOffVoters(engine, record).map((username) => ({
    username,
    weight: 1,
    decision: null,
    votedBy: null,
  }));
  await client.query(
    `INSERT INTO approval_step (number, step, name, rule, window_hours, voters)
     VALUES ($1, 1, 'Department sign-off', 'any', 48, $2::jsonb)`,
    [record.number, JSON.stringify(voters)],
  );

  const band = riskOf(engine, record).band;
  if (band === 'Moderate' || band === 'High') {
    const board = engine.boards.get('Change board');
    if (board) await insertStep(client, record.number, 2, 'Change board', board);
  }
}

async function insertStep(
  client: PoolClient,
  number: string,
  step: number,
  name: string,
  board: { rule: QuorumRule; n: number | null; thresholdPercent: number | null; windowHours: number; members: readonly { username: string; weight: number }[] },
): Promise<void> {
  const voters = board.members.map((m) => ({
    username: m.username,
    weight: m.weight,
    decision: null,
    votedBy: null,
  }));
  await client.query(
    `INSERT INTO approval_step (number, step, name, rule, n, threshold_percent, window_hours, voters)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [number, step, name, board.rule, board.n, board.thresholdPercent, board.windowHours, JSON.stringify(voters)],
  );
}

/** A step opens when the change enters its state, and closes at opens_at plus the window. */
export async function openStep(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  step: number,
  at: number = nowMs(),
): Promise<void> {
  const rows = await loadSteps(record.number);
  const target = rows.find((r) => r.step === step);
  if (!target) return;
  const closesAt = at + target.windowHours * 3_600_000;
  await client.query(
    `UPDATE approval_step SET status = 'open', opens_at = $2, closes_at = $3 WHERE number = $1 AND step = $4`,
    [record.number, new Date(at), new Date(closesAt), step],
  );
  const title = String(record.fields.title ?? '');
  const recipients = new Set<string>();
  for (const voter of target.voters) {
    recipients.add(voter.username);
    const delegate = activeDelegateOf(engine, voter.username, at);
    if (delegate) recipients.add(delegate);
  }
  const delivered = await deliver(
    client,
    engine.inboxRules,
    engine.people,
    'vote_requested',
    [...recipients],
    eventTexts.vote_requested(record.number, title),
    record.number,
  );
  for (const username of delivered) {
    publish({ topic: 'inbox', event: 'unread', data: { username, unread: await unreadCount(client, username) } });
  }
  publish({ topic: 'approvals', event: 'opened', data: { number: record.number, step } });
  publish({ topic: `votes:${record.number}`, event: 'step', data: { number: record.number, step } });
}

export function activeDelegateOf(engine: Engine, username: string, at: number): string | null {
  const person = engine.person(username);
  if (!person || person.delegate === null) return null;
  if (person.delegateFrom !== null && at < person.delegateFrom) return null;
  if (person.delegateTo !== null && at > person.delegateTo) return null;
  return person.delegate;
}

export function stepJson(engine: Engine, step: StepRow): Record<string, unknown> {
  const setup = { rule: step.rule, n: step.n, thresholdPercent: step.thresholdPercent };
  const tally = tallyOf(step.voters, setup);
  return {
    step: step.step,
    name: step.name,
    rule: step.rule,
    status: step.status,
    opens_at: step.opensAt === null ? null : iso(new Date(step.opensAt)),
    closes_at: step.closesAt === null ? null : iso(new Date(step.closesAt)),
    voters: step.voters.map((v) => ({
      username: v.username,
      weight: v.weight,
      decision: v.decision,
      voted_by: v.votedBy,
    })),
    tally: {
      approve: tally.approve,
      reject: tally.reject,
      waiting: tally.waiting,
      needed: tally.needed,
      of: tally.of,
      approve_weight: tally.approveWeight,
      reject_weight: tally.rejectWeight,
      waiting_weight: tally.waitingWeight,
      total_weight: tally.totalWeight,
    },
  };
}

/** Records a vote, then settles the step if its outcome is now certain. */
export async function castVote(
  engine: Engine,
  caller: Caller,
  number: string,
  stepNumber: number,
  decision: Decision,
  comment: string,
  onBehalfOf: string | null,
): Promise<{ step: StepRow; voter: string; votedBy: string; at: number }> {
  return transaction(async (client) => {
    const record = engine.records.get(number);
    if (!record) throw notFound();
    const steps = await loadSteps(number);
    const step = steps.find((s) => s.step === stepNumber);
    if (!step) throw notFound();

    const at = nowMs();
    const member = onBehalfOf ?? caller.username;
    const voter = step.voters.find((v) => v.username === member);
    if (!voter) throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
    if (onBehalfOf !== null) {
      if (activeDelegateOf(engine, onBehalfOf, at) !== caller.username) {
        throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
      }
    } else if (voter.username !== caller.username) {
      throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
    }

    if (step.status !== 'open') {
      if (step.status === 'not_started') {
        throw conflict('step_not_open', 'This vote closed at ' + iso(new Date(at)) + '.');
      }
      throw conflict(
        'vote_closed',
        `This vote closed at ${displayTime(engine.businessZone, step.closesAt ?? at)}.`,
      );
    }
    if (step.closesAt !== null && at > step.closesAt) {
      throw conflict('vote_closed', `This vote closed at ${displayTime(engine.businessZone, step.closesAt)}.`);
    }
    if (voter.decision !== null) {
      throw conflict('already_voted', `${engine.displayName(member)} has already voted on this step.`);
    }

    const voters: Voter[] = step.voters.map((v) =>
      v.username === member ? { ...v, decision, votedBy: caller.username } : v,
    );
    await client.query(`UPDATE approval_step SET voters = $2::jsonb WHERE number = $1 AND step = $3`, [
      number,
      JSON.stringify(voters),
      stepNumber,
    ]);
    await client.query(
      `INSERT INTO approval_vote (number, step, voter, voted_by, decision, comment, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [number, stepNumber, member, caller.username, decision, comment, new Date(at)],
    );

    const updated: StepRow = { ...step, voters };
    await settleStep(client, engine, record, updated, at);
    publish({ topic: `votes:${number}`, event: 'vote', data: { number, step: stepNumber } });
    publish({ topic: 'approvals', event: 'vote', data: { number, step: stepNumber } });
    return { step: updated, voter: member, votedBy: caller.username, at };
  });
}

/** Settles a step once its outcome is certain, or at its window close. */
export async function settleStep(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  step: StepRow,
  at: number,
  forceClose = false,
): Promise<StepStatus> {
  const setup = { rule: step.rule, n: step.n, thresholdPercent: step.thresholdPercent };
  let outcome = decide(step.voters, setup);
  if (outcome === null && forceClose) {
    outcome = 'rejected';
    await insertActivity(client, record.number, now(), 'approval', 'Vote closed without reaching quorum.', null);
  }
  if (outcome === null) return step.status;

  await client.query(`UPDATE approval_step SET status = $2 WHERE number = $1 AND step = $3`, [
    record.number,
    outcome,
    step.step,
  ]);

  const creator = record.createdBy;
  const recipients = new Set<string>(operators(engine.people));
  if (creator) recipients.add(creator);
  const delivered = await deliver(
    client,
    engine.inboxRules,
    engine.people,
    'vote_result',
    [...recipients],
    eventTexts.vote_result(record.number, outcome === 'approved' ? 'approved' : 'rejected', step.name),
    record.number,
  );
  for (const username of delivered) {
    publish({ topic: 'inbox', event: 'unread', data: { username, unread: await unreadCount(client, username) } });
  }

  await advanceChange(client, engine, record, step, outcome, at);
  return outcome;
}

/** Moves the change on once a step is decided. */
async function advanceChange(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  step: StepRow,
  outcome: 'approved' | 'rejected',
  at: number,
): Promise<void> {
  const model = String(record.fields.model ?? 'normal');
  const steps = await loadSteps(record.number);

  if (outcome === 'rejected') {
    // Later steps return to not_started with their votes voided.
    for (const later of steps.filter((s) => s.step > step.step)) {
      await resetStep(client, later);
    }
    await setState(client, engine, record, 'rejected', at);
    return;
  }

  if (model === 'emergency') {
    await setState(client, engine, record, 'approved', at);
    return;
  }

  const next = steps.find((s) => s.step === step.step + 1);
  if (next) {
    await setState(client, engine, record, 'board_vote', at);
    const fresh = engine.records.get(record.number);
    if (fresh) await openStep(client, engine, fresh, next.step, at);
    return;
  }
  await setState(client, engine, record, 'approved', at);
}

async function resetStep(client: PoolClient, step: StepRow): Promise<void> {
  const voters = step.voters.map((v) => ({ ...v, decision: null, votedBy: null }));
  await client.query(
    `UPDATE approval_step SET status = 'not_started', opens_at = NULL, closes_at = NULL, voters = $2::jsonb
     WHERE number = $1 AND step = $3`,
    [step.number, JSON.stringify(voters), step.step],
  );
}

async function setState(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  to: string,
  at: number,
): Promise<void> {
  const history = [...record.stateHistory, { state: to, at: iso(new Date(at)) }];
  await client.query(
    `UPDATE record SET state = $2, fields = jsonb_set(fields, '{state}', $3::jsonb),
            state_history = $4::jsonb, updated_at = $5 WHERE number = $1`,
    [record.number, to, JSON.stringify(to), JSON.stringify(history), new Date(at)],
  );
  const updated: RecordRow = {
    ...record,
    state: to,
    fields: { ...record.fields, state: to },
    stateHistory: history,
    updatedAt: at,
  };
  engine.records.set(record.number, updated);
  await insertActivity(
    client,
    record.number,
    now(),
    'state',
    `${stateLabel('change', record.state)} to ${stateLabel('change', to)}`,
    null,
  );
  publish({
    topic: `record:${record.number}`,
    event: 'state',
    data: { number: record.number, state: to, state_label: stateLabel('change', to) },
  });
}

/**
 * Editing a locked field after approval has started returns the change to
 * Assessed, voids every vote, recomputes risk and tells the approvers.
 */
export async function resetApproval(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  field: string,
): Promise<void> {
  const steps = await loadSteps(record.number);
  for (const step of steps) await resetStep(client, step);
  await setState(client, engine, record, 'assessed', nowMs());
  const label = fieldLabel('change', field);
  await insertActivity(
    client,
    record.number,
    now(),
    'approval',
    `Approval reset because ${label} changed.`,
    null,
  );
  const voters = new Set<string>();
  for (const step of steps) for (const voter of step.voters) voters.add(voter.username);
  const delivered = await deliver(
    client,
    engine.inboxRules,
    engine.people,
    'approval_reset',
    [...voters],
    eventTexts.approval_reset(record.number, label),
    record.number,
  );
  for (const username of delivered) {
    publish({ topic: 'inbox', event: 'unread', data: { username, unread: await unreadCount(client, username) } });
  }
  publish({ topic: 'approvals', event: 'reset', data: { number: record.number } });
  publish({ topic: `votes:${record.number}`, event: 'reset', data: { number: record.number } });
}

export function priorityOfChange(engine: Engine, record: RecordRow): number {
  const model = String(record.fields.model ?? 'normal');
  if (record.state === 'draft' && model !== 'emergency') return 5;
  return changePriority(model, riskOf(engine, record).band);
}
