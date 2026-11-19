// Change endpoints: risk, approvals, votes, quorum, freeze, overlap, calendar.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, operatorOnly } from '../errors.js';
import { clock } from '../db.js';
import { loadSnapshot, RecordSnapshot } from '../recordengine.js';
import { fmtStamp } from '../../shared/time.js';

const BUSINESS_TZ = 'Europe/Berlin';

export async function changes(route: RouteContext, user: SessionUser, pathIn?: string): Promise<boolean> {
  const { method } = route;
  const path = pathIn ?? route.path;

  if (path === '/api/changes/calendar' && method === 'GET') return calendarRead(route);

  const riskMatch = /^\/api\/records\/(ALT-\d+)\/risk$/.exec(path);
  if (riskMatch && method === 'GET') return riskRead(route, user, riskMatch[1]);

  const approvalsMatch = /^\/api\/records\/(ALT-\d+)\/approvals$/.exec(path);
  if (approvalsMatch && method === 'GET') return approvalsRead(route, user, approvalsMatch[1]);

  const voteMatch = /^\/api\/records\/(ALT-\d+)\/steps\/(\d+)\/votes$/.exec(path);
  if (voteMatch && method === 'POST') return votePost(route, user, voteMatch[1], Number(voteMatch[2]));

  const closeMatch = /^\/api\/records\/(ALT-\d+)\/steps\/(\d+)\/close$/.exec(path);
  if (closeMatch && method === 'POST') return closeStep(route, user, closeMatch[1], Number(closeMatch[2]));

  const agendaMatch = /^\/api\/boards\/([^/]+)\/agenda$/.exec(path);
  if (agendaMatch && method === 'GET') return boardAgenda(route, user, agendaMatch[1]);

  const freezeMatch = /^\/api\/freeze-windows\/([^/]+)$/.exec(path);
  if (freezeMatch && method === 'GET') return freezeWindowsList(route);

  return false;
}

/** The risk score, its inputs and its band, per the published formula. */
export async function computeRisk(db: RouteContext['ctx']['db'], snap: RecordSnapshot): Promise<{ score: number; band: string; inputs: Record<string, unknown> }> {
  const fields = snap.fields;
  const ciName = fields.configuration_item as string | null;
  let criticality = 3;
  let businessCritical = false;
  let peopleTotal = 0;
  if (ciName) {
    const ci = await db.query(
      `SELECT criticality, business_critical, used_by_departments, used_by_people, "class" FROM cis WHERE name = $1`,
      [ciName],
    );
    if (ci.rows.length) {
      criticality = Number(ci.rows[0].criticality);
      businessCritical = Boolean(ci.rows[0].business_critical);
      // People computed as if the item were down.
      const { computeImpactForCi } = await import('./map.js');
      const impact = await computeImpactForCi(db, ciName);
      peopleTotal = impact.people_total;
    }
  }

  const backoutTested = Boolean(fields.backout_tested);
  const plannedStart = fields.planned_start ? Date.parse(String(fields.planned_start)) : null;
  const plannedEnd = fields.planned_end ? Date.parse(String(fields.planned_end)) : null;
  const durationHours = plannedStart !== null && plannedEnd !== null ? (plannedEnd - plannedStart) / 3_600_000 : 0;

  // People computed from the item's impact as if it were down.
  if (ciName) {
    const { computeImpactForNames } = await import('./mapimpact.js');
    const impact = await computeImpactForNames(db, ciName);
    const affectedBusiness = impact.affected.length;
    void affectedBusiness;
    const { computePeopleTotal } = await import('./mapimpact.js');
    peopleTotal = await computePeopleTotal(db, ciName);
  }

  // Overlap with open hours of the office hours schedule.
  let inBusinessHours = false;
  if (plannedStart !== null && plannedEnd !== null) {
    const sched = await db.query(`SELECT time_zone, hours, holidays FROM schedules WHERE name = 'Office hours'`);
    if (sched.rows.length) {
      const { businessSeconds } = await import('../schedule.js');
      const seconds = businessSeconds({
        name: 'Office hours',
        time_zone: String(sched.rows[0].time_zone),
        hours: sched.rows[0].hours as Record<string, Array<[string, string]>>,
        holidays: sched.rows[0].holidays as string[],
      }, plannedStart, plannedEnd);
      inBusinessHours = seconds > 0;
    }
  }

  // Failed changes in 90 days on the same item.
  let failed = 0;
  if (ciName && plannedStart !== null) {
    const res = await db.query(
      `SELECT fields FROM records WHERE "table" = 'change' AND state = 'done' AND fields->>'configuration_item' = $1`,
      [ciName],
    );
    for (const row of res.rows) {
      const f = row.fields as Record<string, unknown>;
      const end = f.planned_end ? Date.parse(String(f.planned_end)) : null;
      const outcome = f.outcome;
      if (end === null || (outcome !== 'failed' && outcome !== 'backed_out')) continue;
      if (end >= plannedStart - 90 * 86_400_000 && end <= plannedStart) failed++;
    }
  }

  const peopleBand = peopleTotal === 0 ? 0 : peopleTotal <= 10 ? 1 : peopleTotal <= 50 ? 2 : 3;
  let score = 3 * criticality + 2 * peopleBand + (backoutTested ? 0 : 4) + (inBusinessHours ? 2 : 0) + 3 * Math.min(failed, 2) + (durationHours > 4 ? 2 : 0);
  void businessCritical;
  const band = score <= 9 ? 'Low' : score <= 17 ? 'Moderate' : 'High';
  return {
    score,
    band,
    inputs: {
      criticality,
      people_total: peopleTotal,
      people_band: peopleBand,
      backout_tested: backoutTested,
      in_business_hours: inBusinessHours,
      failed_changes_90d: failed,
      duration_hours: durationHours,
    },
  };
}

async function riskRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('approver'))) throw forbidden();
  const snap = await loadSnapshot(route.ctx.db, number);
  if (!snap) throw notFound();
  const risk = await computeRisk(route.ctx.db, snap);
  sendJson(route.res, 200, risk);
  return true;
}

async function approvalsRead(route: RouteContext, user: SessionUser, number: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('approver'))) throw forbidden();
  const snap = await loadSnapshot(route.ctx.db, number);
  if (!snap) throw notFound();
  const steps = await readSteps(route.ctx.db, number);
  sendJson(route.res, 200, { steps });
  return true;
}

async function readSteps(db: RouteContext['ctx']['db'], change: string): Promise<unknown[]> {
  const res = await db.query(`SELECT * FROM approval_steps WHERE change = $1 ORDER BY step`, [change]);
  const out: unknown[] = [];
  for (const row of res.rows) {
    const votes = await db.query(
      `SELECT voter, voted_by, decision, comment, at FROM votes WHERE step_id = $1 ORDER BY at, id`,
      [row.id],
    );
    const voters = row.voters as Array<{ username: string; weight: number }>;
    const votesByUsername = new Map<string, { decision: string; voted_by: string }>();
    for (const v of votes.rows) votesByUsername.set(String(v.voter), { decision: String(v.decision), voted_by: String(v.voted_by) });

    // The board's own rule decides the step, but the recorded rule wins when set.
    const board = await boardOf(db, String(row.name));
    const rule = String(row.rule);
    const n = row.n === null ? null : Number(row.n);
    const threshold = row.threshold_percent === null ? (board?.threshold ?? null) : Number(row.threshold_percent);
    const tally = tallyOf(voters, votesByUsername, rule, n, threshold);
    void board;
    out.push({
      step: Number(row.step),
      name: row.name,
      rule: row.rule,
      status: row.status,
      opens_at: row.opens_at ? new Date(row.opens_at as Date).toISOString() : null,
      closes_at: row.closes_at ? new Date(row.closes_at as Date).toISOString() : null,
      voters: voters.map(v => ({
        username: v.username,
        weight: v.weight,
        decision: votesByUsername.get(v.username)?.decision ?? null,
        voted_by: votesByUsername.get(v.username)?.voted_by ?? null,
      })),
      tally,
    });
  }
  return out;
}

async function boardOf(db: RouteContext['ctx']['db'], name: string): Promise<{ rule: string; n: number | null; threshold: number | null } | null> {
  const boardName = name === 'Change board' ? 'Change board' : name === 'Emergency board' ? 'Emergency board' : null;
  if (!boardName) return null;
  const res = await db.query(`SELECT rule, n, threshold_percent FROM boards WHERE name = $1`, [boardName]);
  if (!res.rows.length) return null;
  return { rule: String(res.rows[0].rule), n: res.rows[0].n === null ? null : Number(res.rows[0].n), threshold: res.rows[0].threshold_percent === null ? null : Number(res.rows[0].threshold_percent) };
}

/** The quorum rules decide a step as soon as its outcome is certain. */
export function tallyOf(
  voters: Array<{ username: string; weight: number }>,
  votes: Map<string, { decision: string; voted_by: string }>,
  rule: string,
  n: number | null,
  thresholdPercent: number | null,
): Record<string, number> {
  const approve = voters.filter(v => votes.get(v.username)?.decision === 'approve');
  const reject = voters.filter(v => votes.get(v.username)?.decision === 'reject');
  const waiting = voters.length - approve.length - reject.length;
  const approveWeight = approve.reduce((sum, v) => sum + v.weight, 0);
  const rejectWeight = reject.reduce((sum, v) => sum + v.weight, 0);
  const totalWeight = voters.reduce((sum, v) => sum + v.weight, 0);

  let needed = 0;
  if (rule === 'all') needed = voters.length;
  else if (rule === 'any') needed = 1;
  else if (rule === 'n_of_m') needed = n ?? 1;
  else if (rule === 'weighted') {
    const t = thresholdPercent ?? 100;
    needed = Math.ceil((t * totalWeight) / 100);
  }

  return {
    approve: approve.length,
    reject: reject.length,
    waiting,
    needed,
    of: voters.length,
    approve_weight: approveWeight,
    reject_weight: rejectWeight,
    waiting_weight: totalWeight - approveWeight - rejectWeight,
    total_weight: totalWeight,
  };
}

async function votePost(route: RouteContext, user: SessionUser, change: string, step: number): Promise<boolean> {
  const snap = await loadSnapshot(route.ctx.db, change);
  if (!snap) throw notFound();
  const stepRow = await route.ctx.db.query(`SELECT * FROM approval_steps WHERE change = $1 AND step = $2`, [change, step]);
  if (!stepRow.rows.length) throw notFound();
  const row = stepRow.rows[0];

  const voters = row.voters as Array<{ username: string; weight: number }>;
  const onBehalfOf = route.body.on_behalf_of ? String(route.body.on_behalf_of) : null;
  const voter = onBehalfOf ?? user.username;

  // A delegate votes on a member's behalf while their delegation is active.
  if (onBehalfOf) {
    const delegation = await route.ctx.db.query(
      `SELECT delegate, delegate_from, delegate_to FROM people WHERE username = $1 AND delegate = $2`,
      [onBehalfOf, user.username],
    );
    const now = clock.nowMs();
    const active = delegation.rows.length &&
      (!delegation.rows[0].delegate_from || new Date(delegation.rows[0].delegate_from as Date).getTime() <= now) &&
      (!delegation.rows[0].delegate_to || new Date(delegation.rows[0].delegate_to as Date).getTime() >= now);
    if (!active) throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
  }

  if (!voters.some(v => v.username === voter)) {
    throw new ApiError(403, 'not_a_voter', 'You are not a voter on this step.');
  }

  // One vote per voter per step opening.
  const existing = await route.ctx.db.query(`SELECT voter FROM votes WHERE step_id = $1 AND voter = $2`, [row.id, voter]);
  if (existing.rows.length) {
    const person = await route.ctx.db.query(`SELECT display_name FROM people WHERE username = $1`, [voter]);
    throw new ApiError(409, 'already_voted', `${String(person.rows[0]?.display_name ?? voter)} has already voted on this step.`);
  }

  if (row.status !== 'open') {
    throw new ApiError(409, 'vote_closed', `This vote closed at ${row.closes_at ? fmtStamp(new Date(row.closes_at as Date).getTime(), BUSINESS_TZ) : 'an earlier time'}.`);
  }
  const now = clock.nowMs();
  if (row.closes_at && now > new Date(row.closes_at as Date).getTime()) {
    throw new ApiError(409, 'vote_closed', `This vote closed at ${fmtStamp(new Date(row.closes_at as Date).getTime(), BUSINESS_TZ)}.`);
  }

  const decision = route.body.decision === 'reject' ? 'reject' : 'approve';
  await route.ctx.db.query(
    `INSERT INTO votes(step_id, voter, voted_by, decision, comment, at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [row.id, voter, user.username, decision, String(route.body.comment ?? ''), new Date(now)],
  );

  const steps = await readSteps(route.ctx.db, change);
  route.ctx.live.publish(`votes:${change}`, 'updated', { change, steps });

  // Decide the step when its outcome is certain.
  await decideStep(route, change, step);

  const fresh = await readSteps(route.ctx.db, change);
  const current = fresh.find(s => (s as { step: number }).step === step) as { step: number; name: string; status: string } | undefined;
  sendJson(route.res, 201, {
    vote: { voter, voted_by: user.username, decision, at: new Date(now).toISOString() },
    step: current,
  });
  return true;
}

/** Close a step early (operator only), decided as at window close. */
async function closeStep(route: RouteContext, user: SessionUser, change: string, step: number): Promise<boolean> {
  if (!user.roles.includes('operator')) throw operatorOnly();
  const stepRow = await route.ctx.db.query(`SELECT * FROM approval_steps WHERE change = $1 AND step = $2`, [change, step]);
  if (!stepRow.rows.length) throw notFound();
  if (stepRow.rows[0].status !== 'open') throw new ApiError(409, 'vote_closed', 'This vote is already closed.');
  await decideStep(route, change, step, true);
  const steps = await readSteps(route.ctx.db, change);
  sendJson(route.res, 200, { steps });
  return true;
}

/** Decide a step by its quorum rule; a rejection resets later steps. */
async function decideStep(route: RouteContext, change: string, step: number, force = false): Promise<void> {
  const db = route.ctx.db;
  const rows = await db.query(`SELECT * FROM approval_steps WHERE change = $1 ORDER BY step`, [change]);
  const row = rows.rows.find((r: Record<string, unknown>) => Number(r.step) === step);
  if (!row) return;

  const votes = await db.query(`SELECT voter, decision FROM votes WHERE step_id = $1`, [row.id]);
  const votesBy = new Map<string, { decision: string; voted_by: string }>();
  for (const v of votes.rows) votesBy.set(String(v.voter), { decision: String(v.decision), voted_by: '' });
  const voters = row.voters as Array<{ username: string; weight: number }>;
  const tally = tallyOf(voters, votesBy, String(row.rule), row.n === null ? null : Number(row.n), row.threshold_percent === null ? null : Number(row.threshold_percent));

  const a = tally.approve;
  const r = tally.reject;
  const m = voters.length;
  const rule = String(row.rule);
  let approved: boolean | null = null;

  if (rule === 'all') {
    if (r > 0) approved = false;
    else if (a === m) approved = true;
  } else if (rule === 'any') {
    if (a > 0) approved = true;
    else if (r === m) approved = false;
  } else if (rule === 'n_of_m') {
    const n = Number(row.n ?? 1);
    if (r > m - n) approved = false;
    else if (a >= n) approved = true;
  } else if (rule === 'weighted') {
    const t = Number(row.threshold_percent ?? 100);
    const T = tally.total_weight;
    if (100 * (T - tally.reject_weight) < t * T) approved = false;
    else if (100 * tally.approve_weight >= t * T) approved = true;
  }

  if (approved === null && !force) {
    // The window close decides undecided steps.
    const closesAt = row.closes_at ? new Date(row.closes_at as Date).getTime() : null;
    if (closesAt !== null && clock.nowMs() > closesAt) {
      approved = false;
      await db.query(`UPDATE approval_steps SET status = 'rejected', decided_at = $2 WHERE id = $1`, [row.id, new Date()]);
      await activityLine(db, change, `Vote closed without reaching quorum.`);
      await finishChange(route, change, step, false);
      return;
    }
    return;
  }
  if (approved === null && force) {
    // Early close: decided as at window close.
    approved = false;
  }

  if (approved === true) {
    await db.query(`UPDATE approval_steps SET status = 'approved', decided_at = $2 WHERE id = $1`, [row.id, new Date()]);
    await finishChange(route, change, step, true);
  } else if (approved === false) {
    await db.query(`UPDATE approval_steps SET status = 'rejected', decided_at = $2 WHERE id = $1`, [row.id, new Date()]);
    await finishChange(route, change, step, false);
  }
}

/** A passed step moves the change on; a failed step rejects it and resets later
 *  steps; a rejection writes the vote_result inbox item. */
async function finishChange(route: RouteContext, change: string, step: number, approved: boolean): Promise<void> {
  const db = route.ctx.db;
  const snap = await loadSnapshot(db, change);
  if (!snap) return;
  const rows = await db.query(`SELECT * FROM approval_steps WHERE change = $1 ORDER BY step`, [change]);
  const row = rows.rows.find((r: Record<string, unknown>) => Number(r.step) === step);

  if (!approved) {
    // The change becomes rejected and every later step returns to not_started.
    for (const r of rows.rows) {
      if (Number(r.step) > step) {
        await db.query(`UPDATE approval_steps SET status = 'not_started', opens_at = NULL, closes_at = NULL WHERE id = $1`, [r.id]);
        await db.query(`DELETE FROM votes WHERE step_id = $1`, [r.id]);
      }
    }
    await db.query(`UPDATE records SET state = 'rejected', updated_at = $2 WHERE number = $1`, [change, new Date()]);
    await db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'rejected',$2)`, [change, new Date()]);
    await activityLine(db, change, `${change} was rejected at ${row?.name}.`);
    await notifyResult(route, change, snap, 'rejected', String(row?.name ?? ''));
    return;
  }

  // Approved: if a later step exists it opens; otherwise the change is approved.
  const later = rows.rows.find((r: Record<string, unknown>) => Number(r.step) === step + 1);
  if (later) {
    const windowHours = await windowHoursFor(db, String(later.name));
    await db.query(
      `UPDATE approval_steps SET status = 'open', opens_at = $2, closes_at = $3 WHERE id = $1`,
      [later.id, new Date(), new Date(clock.nowMs() + windowHours * 3_600_000)],
    );
    // Move the change to the state of the next step.
    const nextState = Number(later.step) === 2 ? 'board_vote' : 'peer_review';
    await db.query(`UPDATE records SET state = $2, updated_at = $3 WHERE number = $1`, [change, nextState, new Date()]);
    await db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [change, nextState, new Date()]);
    await activityLine(db, change, `${change} was approved at ${row?.name}.`);
    await notifyResult(route, change, snap, 'approved', String(row?.name ?? ''));
    await notifyVoters(route, change, later);
  } else {
    await db.query(`UPDATE records SET state = 'approved', updated_at = $2 WHERE number = $1`, [change, new Date()]);
    await db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'approved',$2)`, [change, new Date()]);
    await activityLine(db, change, `${change} was approved at ${row?.name}.`);
    await notifyResult(route, change, snap, 'approved', String(row?.name ?? ''));
  }
}

async function windowHoursFor(db: RouteContext['ctx']['db'], stepName: string): Promise<number> {
  const boardName = stepName === 'Change board' ? 'Change board' : stepName === 'Emergency board' ? 'Emergency board' : null;
  if (boardName) {
    const res = await db.query(`SELECT window_hours FROM boards WHERE name = $1`, [boardName]);
    if (res.rows.length) return Number(res.rows[0].window_hours);
  }
  return 48;
}

async function activityLine(db: RouteContext['ctx']['db'], change: string, text: string): Promise<void> {
  await db.query(
    `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,'system',NULL,'state',$3)`,
    [change, new Date(clock.nowMs()), text],
  );
}

async function notifyResult(route: RouteContext, change: string, snap: RecordSnapshot, outcome: 'approved' | 'rejected', stepName: string): Promise<void> {
  const { deliver, loadRules } = await import('./inboxdata.js');
  const rules = await loadRules(route.ctx.db);
  const recipients = new Set<string>([snap.created_by ?? 'oona', 'oona']);
  for (const username of recipients) {
    await deliver(route.ctx.db, rules, 'vote_result', username, `${change} was ${outcome} at ${stepName}.`, change);
  }
  route.ctx.live.publish('inbox', 'updated', {});
}

async function notifyVoters(route: RouteContext, change: string, stepRow: Record<string, unknown>): Promise<void> {
  const voters = (stepRow.voters ?? []) as Array<{ username: string }>;
  const snap = await loadSnapshot(route.ctx.db, change);
  const title = snap?.fields.title ?? '';
  const { deliver, loadRules } = await import('./inboxdata.js');
  const rules = await loadRules(route.ctx.db);
  for (const voter of voters) {
    await deliver(route.ctx.db, rules, 'vote_requested', voter.username, `Your vote is needed on ${change}: ${title}.`, change);
  }
}

async function boardAgenda(route: RouteContext, user: SessionUser, board: string): Promise<boolean> {
  if (!(user.roles.includes('operator') || user.roles.includes('technician') || user.roles.includes('approver'))) throw forbidden();
  const boardRow = await route.ctx.db.query(`SELECT name FROM boards WHERE name = $1`, [board]);
  if (!boardRow.rows.length) throw notFound();
  const rows = await route.ctx.db.query(
    `SELECT s.change, s.name, s.step FROM approval_steps s
     JOIN records r ON r.number = s.change
     WHERE s.status = 'open' AND s.name = $1
     ORDER BY r.fields->>'planned_start', s.change`,
    [board === 'Change board' ? 'Change board' : board],
  );
  const items: unknown[] = [];
  for (const row of rows.rows) {
    const snap = await loadSnapshot(route.ctx.db, String(row.change));
    if (!snap) continue;
    items.push({
      number: row.change,
      title: snap.fields.title,
      planned_start: snap.fields.planned_start ?? null,
      step: (await readSteps(route.ctx.db, String(row.change))).find(s => (s as { step: number }).step === Number(row.step)) ?? null,
    });
  }
  sendJson(route.res, 200, { items });
  return true;
}

async function freezeWindowsList(route: RouteContext): Promise<boolean> {
  const res = await route.ctx.db.query(`SELECT name, start, "end", time_zone, scope_kind, scope_items FROM freeze_windows ORDER BY name`);
  sendJson(route.res, 200, {
    freeze_windows: res.rows.map((r: Record<string, unknown>) => ({
      name: r.name,
      start: new Date(r.start as Date).toISOString(),
      end: new Date(r.end as Date).toISOString(),
      time_zone: r.time_zone,
      scope: r.scope_kind === 'all' ? 'all' : { items: r.scope_items },
    })),
  });
  return true;
}

async function calendarRead(route: RouteContext): Promise<boolean> {
  const month = route.url.searchParams.get('month') ?? '';
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) throw new ApiError(422, 'validation', 'month must be YYYY-MM');

  const { civilToEpoch, partsOf } = await import('../../shared/time.js');
  const first = civilToEpoch(y, m, 1, 0, 0, 0, BUSINESS_TZ);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  // Only changes in assessed, peer_review, board_vote, approved, implementing
  // or done count; draft, rejected and cancelled never appear.
  const changes = await route.ctx.db.query(
    `SELECT number, fields, state FROM records WHERE "table" = 'change' AND state IN ('assessed','peer_review','board_vote','approved','implementing','done')`,
  );
  const freezes = await route.ctx.db.query(`SELECT name, start, "end", time_zone, scope_kind, scope_items FROM freeze_windows`);

  const out: unknown[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = civilToEpoch(y, m, d, 0, 0, 0, BUSINESS_TZ);
    const dayEnd = civilToEpoch(y, m, d + 1, 0, 0, 0, BUSINESS_TZ);
    const items: unknown[] = [];
    for (const change of changes.rows) {
      const fields = change.fields as Record<string, unknown>;
      const start = fields.planned_start ? Date.parse(String(fields.planned_start)) : null;
      const end = fields.planned_end ? Date.parse(String(fields.planned_end)) : null;
      if (start === null || end === null) continue;
      if (start < dayEnd && end > dayStart) {
        items.push({
          number: change.number,
          title: fields.title,
          planned_start: fields.planned_start,
          planned_end: fields.planned_end,
        });
      }
    }
    const dayFreezes: string[] = [];
    for (const f of freezes.rows) {
      const fs = new Date(f.start as Date).getTime();
      const fe = new Date(f.end as Date).getTime();
      if (fs < dayEnd && fe > dayStart) dayFreezes.push(String(f.name));
    }
    dayFreezes.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    void partsOf;
    out.push({ date, changes: items, freezes: dayFreezes });
  }
  sendJson(route.res, 200, { days: out });
  return true;
}

export async function castVote(route: RouteContext, user: SessionUser, stepId: number, body: { decision: string; comment: string; on_behalf_of: string | null }): Promise<void> {
  const row = await route.ctx.db.query(`SELECT * FROM approval_steps WHERE id = $1`, [stepId]);
  if (!row.rows.length) throw notFound();
  const change = String(row.rows[0].change);
  const step = Number(row.rows[0].step);
  route.body = { ...body };
  await votePost(route, user, change, step);
}
