import { labelOf } from "../shared/fields.js";
import { now, withClockAt } from "./clock.js";
import { settings } from "./config.js";
import type { Tx } from "./db.js";
import type { Env } from "./env.js";
import { fail, notFound } from "./errors.js";
import { deliver } from "./inbox.js";
import { publish, publishTo } from "./live.js";
import { Graph } from "./map.js";
import { addActivity, findRecord, save, type DraftRecord } from "./records.js";
import { businessSeconds } from "./schedule.js";
import { addDays, dateKey, formatLocal, wallToInstant } from "../shared/tz.js";
import { toRecord, type RecordObj } from "./world.js";

export interface Board {
  name: string;
  rule: "all" | "any" | "n_of_m" | "weighted";
  n: number | null;
  threshold_percent: number | null;
  window_hours: number;
  members: { username: string; weight: number }[];
}

interface StepSpec {
  rule: Board["rule"];
  n: number | null;
  threshold_percent: number | null;
  window_hours: number;
  voters: { username: string; weight: number }[];
}

export interface Tally {
  approve: number;
  reject: number;
  waiting: number;
  needed: number;
  of: number;
  approve_weight: number;
  reject_weight: number;
  waiting_weight: number;
  total_weight: number;
}

export type StepStatus = "not_started" | "open" | "approved" | "rejected";

interface StepRow {
  change_number: string;
  step_no: number;
  name: string;
  status: StepStatus;
  opens_at: string | null;
  closes_at: string | null;
  spec: StepSpec;
}

interface VoteRow {
  voter: string;
  voted_by: string;
  decision: "approve" | "reject";
  at: string;
}

const HOUR = 3_600_000;

/** The one decision of every quorum rule. */
function decideStep(spec: StepSpec, votes: Pick<VoteRow, "voter" | "decision">[]): { status: "open" | "approved" | "rejected"; tally: Tally } {
  const m = spec.voters.length;
  const weightOf = new Map(spec.voters.map((v) => [v.username, v.weight]));
  const approving = votes.filter((v) => v.decision === "approve");
  const rejecting = votes.filter((v) => v.decision === "reject");
  const a = approving.length;
  const r = rejecting.length;
  const T = spec.voters.reduce((sum, v) => sum + v.weight, 0);
  const A = approving.reduce((sum, v) => sum + (weightOf.get(v.voter) ?? 0), 0);
  const R = rejecting.reduce((sum, v) => sum + (weightOf.get(v.voter) ?? 0), 0);
  const t = spec.threshold_percent ?? 0;
  const n = spec.n ?? m;
  let approved = false;
  let rejected = false;
  let needed = m;
  switch (spec.rule) {
    case "all":
      approved = m > 0 && a === m;
      rejected = r >= 1;
      needed = m;
      break;
    case "any":
      approved = a >= 1;
      rejected = m > 0 && r === m;
      needed = 1;
      break;
    case "n_of_m":
      approved = a >= n;
      rejected = r > m - n;
      needed = n;
      break;
    case "weighted":
      approved = T > 0 && 100 * A >= t * T;
      rejected = T > 0 && 100 * (T - R) < t * T;
      needed = Math.ceil((t * T) / 100);
      break;
  }
  return {
    status: approved ? "approved" : rejected ? "rejected" : "open",
    tally: { approve: a, reject: r, waiting: m - a - r, needed, of: spec.rule === "weighted" ? T : m, approve_weight: A, reject_weight: R, waiting_weight: T - A - R, total_weight: T },
  };
}

export interface StepJson {
  step: number;
  name: string;
  rule: string;
  status: StepStatus;
  opens_at: string | null;
  closes_at: string | null;
  voters: { username: string; weight: number; decision: string | null; voted_by: string | null }[];
  tally: Tally;
}

async function loadSteps(tx: Tx, number: string, lock = false): Promise<StepRow[]> {
  const rows = await tx.query(`SELECT * FROM change_steps WHERE change_number = $1 ORDER BY step_no ${lock ? "FOR UPDATE" : ""}`, [number]);
  return rows.map((r) => ({
    change_number: r.change_number as string,
    step_no: r.step_no as number,
    name: r.name as string,
    status: r.status as StepStatus,
    opens_at: (r.opens_at as string | null) ?? null,
    closes_at: (r.closes_at as string | null) ?? null,
    spec: r.spec as StepSpec,
  }));
}

async function votesOf(tx: Tx, number: string, step: number): Promise<VoteRow[]> {
  const rows = await tx.query("SELECT voter, voted_by, decision, at FROM votes WHERE change_number = $1 AND step_no = $2 AND NOT voided ORDER BY id", [number, step]);
  return rows.map((r) => ({ voter: r.voter as string, voted_by: r.voted_by as string, decision: r.decision as "approve" | "reject", at: r.at as string }));
}

async function stepJson(tx: Tx, row: StepRow): Promise<StepJson> {
  const votes = await votesOf(tx, row.change_number, row.step_no);
  const { tally } = decideStep(row.spec, votes);
  return {
    step: row.step_no,
    name: row.name,
    rule: row.spec.rule,
    status: row.status,
    opens_at: row.opens_at,
    closes_at: row.closes_at,
    voters: row.spec.voters.map((v) => {
      const vote = votes.find((x) => x.voter === v.username);
      return { username: v.username, weight: v.weight, decision: vote?.decision ?? null, voted_by: vote?.voted_by ?? null };
    }),
    tally,
  };
}

export async function stepsOf(tx: Tx, number: string): Promise<StepJson[]> {
  return Promise.all((await loadSteps(tx, number)).map((row) => stepJson(tx, row)));
}

async function boardOf(tx: Tx, name: string): Promise<Board | null> {
  const rows = await tx.query("SELECT * FROM boards WHERE name = $1", [name]);
  const b = rows[0];
  return b ? { name: b.name as string, rule: b.rule as Board["rule"], n: (b.n as number | null) ?? null, threshold_percent: (b.threshold_percent as number | null) ?? null, window_hours: b.window_hours as number, members: b.members as Board["members"] } : null;
}

function boardSpec(board: Board): StepSpec {
  return { rule: board.rule, n: board.n, threshold_percent: board.threshold_percent, window_hours: board.window_hours, voters: board.members };
}

export interface Risk {
  score: number;
  band: "Low" | "Moderate" | "High";
  inputs: {
    criticality: number;
    people_total: number;
    people_band: number;
    backout_tested: boolean;
    in_business_hours: boolean;
    failed_changes_90d: number;
    duration_hours: number;
  };
}

/** The one place the risk score is computed. */
export async function computeRisk(env: Env, number: string | null, fields: DraftRecord["fields"]): Promise<Risk | null> {
  const itemName = fields.configuration_item;
  const ci = typeof itemName === "string" ? env.world.cis.get(itemName) : undefined;
  if (!ci || typeof fields.planned_start !== "string" || typeof fields.planned_end !== "string") return null;
  const start = Date.parse(fields.planned_start);
  const end = Date.parse(fields.planned_end);
  const graph = await Graph.load(env.world, env.tx);
  const people = graph.impact(ci.name, "down").people_total;
  const band = people === 0 ? 0 : people <= 10 ? 1 : people <= 50 ? 2 : 3;
  const office = (await env.slaCatalog()).schedules.get("Office hours");
  const inHours = office ? businessSeconds(office, start, end) > 0 : false;
  const failed = await env.tx.query(
    "SELECT count(*)::int AS n FROM records WHERE table_name = 'change' AND number IS DISTINCT FROM $1 AND fields->>'configuration_item' = $2 AND fields->>'state' = 'done' AND fields->>'outcome' IN ('failed','backed_out') AND (fields->>'planned_end')::timestamptz >= $3::timestamptz - interval '90 days' AND (fields->>'planned_end')::timestamptz < $3::timestamptz",
    [number, ci.name, new Date(start).toISOString()],
  );
  const failures = failed[0]!.n as number;
  const hours = (end - start) / HOUR;
  const score = 3 * ci.criticality + 2 * band + (fields.backout_tested === true ? 0 : 4) + (inHours ? 2 : 0) + 3 * Math.min(failures, 2) + (hours > 4 ? 2 : 0);
  return {
    score,
    band: score >= 18 ? "High" : score >= 10 ? "Moderate" : "Low",
    inputs: { criticality: ci.criticality, people_total: people, people_band: band, backout_tested: fields.backout_tested === true, in_business_hours: inHours, failed_changes_90d: failures, duration_hours: hours },
  };
}

export async function changeBand(env: Env, draft: DraftRecord): Promise<Risk["band"] | null> {
  if (draft.fields.model === "standard") return null;
  return (await computeRisk(env, draft.number, draft.fields))?.band ?? null;
}

interface Freeze {
  name: string;
  start: number;
  end: number;
  zone: string;
  scope: "all" | { items: string[] };
}

async function loadFreezes(tx: Tx): Promise<Freeze[]> {
  const rows = await tx.query("SELECT * FROM freeze_windows ORDER BY start_at, name");
  return rows.map((r) => ({ name: r.name as string, start: Date.parse(r.start_at as string), end: Date.parse(r.end_at as string), zone: r.time_zone as string, scope: r.scope as Freeze["scope"] }));
}

const OVERLAP_STATES = ["assessed", "peer_review", "board_vote", "approved", "implementing"];

/** Refuses a change that falls in a freeze window or overlaps another on the same or a linked item. */
export async function checkFreezeAndOverlap(env: Env, draft: DraftRecord): Promise<void> {
  const f = draft.fields;
  if (typeof f.planned_start !== "string" || typeof f.planned_end !== "string" || typeof f.configuration_item !== "string") return;
  const start = Date.parse(f.planned_start);
  const end = Date.parse(f.planned_end);
  const graph = await Graph.load(env.world, env.tx);
  const item = f.configuration_item;
  const zone = settings.BUSINESS_TIME_ZONE;
  for (const freeze of await loadFreezes(env.tx)) {
    const covers = freeze.scope === "all" || freeze.scope.items.some((listed) => listed === item || graph.dependsOnClosure(listed).has(item));
    if (!covers || !(start < freeze.end && freeze.start < end)) continue;
    if (f.model === "emergency" && typeof f.freeze_override_reason === "string" && f.freeze_override_reason !== "") continue;
    fail(422, "freeze", `This change falls inside the freeze "${freeze.name}" (${formatLocal(freeze.start, freeze.zone)} to ${formatLocal(freeze.end, freeze.zone)}).`);
  }
  const rows = await env.tx.query("SELECT * FROM records WHERE table_name = 'change' AND number IS DISTINCT FROM $1 AND fields->>'state' = ANY($2) ORDER BY number", [draft.number, OVERLAP_STATES]);
  const dependsOn = graph.dependsOnClosure(item);
  for (const rec of rows.map(toRecord)) {
    const other = rec.fields.configuration_item;
    if (typeof other !== "string" || typeof rec.fields.planned_start !== "string" || typeof rec.fields.planned_end !== "string") continue;
    const os = Date.parse(rec.fields.planned_start);
    const oe = Date.parse(rec.fields.planned_end);
    if (!(start < oe && os < end)) continue;
    const window = `(${formatLocal(os, zone)} to ${formatLocal(oe, zone)})`;
    if (other === item) fail(422, "overlap", `This change overlaps ${rec.number} on ${other} ${window}.`);
    if (dependsOn.has(other)) fail(422, "overlap", `This change overlaps ${rec.number} on ${other}, which ${item} depends on ${window}.`);
    if (graph.dependsOnClosure(other).has(item)) fail(422, "overlap", `This change overlaps ${rec.number} on ${other}, which depends on ${item} ${window}.`);
  }
}

async function departmentVoters(env: Env, itemName: string): Promise<{ username: string; weight: number }[]> {
  const ci = env.world.cis.get(itemName);
  const graph = await Graph.load(env.world, env.tx);
  const impact = graph.impact(itemName, "down");
  const departments = new Set<string>();
  if (ci) departments.add(ci.owner_department);
  for (const entry of [{ name: itemName }, ...impact.affected.map((a) => a.ci)]) {
    const service = env.world.cis.get(entry.name);
    if (service?.class === "Business service") for (const d of service.used_by?.departments ?? []) departments.add(d);
  }
  return [...env.world.people.values()]
    .filter((p) => p.hasLogin && p.active && p.roles.includes("approver") && departments.has(p.department))
    .map((p) => ({ username: p.username, weight: 1 }));
}

async function buildSteps(env: Env, rec: RecordObj): Promise<Array<{ name: string; spec: StepSpec }>> {
  if (rec.fields.model === "emergency") {
    const board = await boardOf(env.tx, "Emergency board");
    return board ? [{ name: board.name, spec: boardSpec(board) }] : [];
  }
  const sign: { name: string; spec: StepSpec } = {
    name: "Department sign-off",
    spec: { rule: "any", n: null, threshold_percent: null, window_hours: 48, voters: await departmentVoters(env, String(rec.fields.configuration_item)) },
  };
  const risk = await computeRisk(env, rec.number, rec.fields);
  const out = [sign];
  if (risk && risk.band !== "Low") {
    const board = await boardOf(env.tx, "Change board");
    if (board) out.push({ name: board.name, spec: boardSpec(board) });
  }
  return out;
}

async function notifyVoters(env: Env, rec: RecordObj, voters: string[]): Promise<void> {
  const delegates = await env.tx.query("SELECT delegate FROM users WHERE username = ANY($1) AND delegate IS NOT NULL AND (delegate->>'from')::timestamptz <= $2 AND $2 < (delegate->>'to')::timestamptz", [voters, new Date(now()).toISOString()]);
  const recipients = [...voters, ...delegates.map((d) => (d.delegate as { delegate: string }).delegate)];
  await deliver(env.tx, "vote_requested", recipients, `Your vote is needed on ${rec.number}: ${String(rec.fields.title)}.`, rec.number);
  announceApprovals(recipients);
}

function announceApprovals(users: string[]): void {
  for (const username of new Set(users)) publishTo(username, "approvals", "changed", {});
}

async function openStep(env: Env, rec: RecordObj, step: StepRow, notify = true): Promise<void> {
  const spec = step.name === "Change board" || step.name === "Emergency board" ? (await boardOf(env.tx, step.name).then((b) => (b ? boardSpec(b) : step.spec))) : { ...step.spec, voters: await departmentVoters(env, String(rec.fields.configuration_item)) };
  const opens = new Date(now());
  const closes = new Date(opens.getTime() + spec.window_hours * HOUR);
  await env.tx.query("UPDATE votes SET voided = true WHERE change_number = $1 AND step_no = $2", [rec.number, step.step_no]);
  await env.tx.query("UPDATE change_steps SET status = 'open', opens_at = $3, closes_at = $4, spec = $5 WHERE change_number = $1 AND step_no = $2", [
    rec.number,
    step.step_no,
    opens.toISOString(),
    closes.toISOString(),
    JSON.stringify(spec),
  ]);
  if (notify) await notifyVoters(env, rec, spec.voters.map((v) => v.username));
  env.tx.after.push(() => publish(`votes:${rec.number}`, "tally", {}));
}

async function ensureSteps(env: Env, rec: RecordObj): Promise<StepRow[]> {
  const steps = await loadSteps(env.tx, rec.number, true);
  if (steps.length > 0) return steps;
  for (const [index, step] of (await buildSteps(env, rec)).entries()) {
    await env.tx.query("INSERT INTO change_steps (change_number, step_no, name, status, spec) VALUES ($1, $2, $3, 'not_started', $4)", [rec.number, index + 1, step.name, JSON.stringify(step.spec)]);
  }
  return loadSteps(env.tx, rec.number, true);
}

/** When a change enters peer review or an emergency board vote, create its steps and open the first one that is not approved. */
async function enterReview(env: Env, rec: RecordObj): Promise<void> {
  const first = (await ensureSteps(env, rec)).find((s) => s.status !== "approved");
  if (first) await openStep(env, rec, first);
}

/** A change created by fixture in peer review or board vote has its open step opened at its last state change, without notices. */
export async function openFixtureReview(env: Env, rec: RecordObj): Promise<void> {
  const openedAt = rec.history[rec.history.length - 1]?.at ?? rec.createdAt;
  await withClockAt(Date.parse(openedAt), async () => {
    const steps = await ensureSteps(env, rec);
    const atBoard = rec.fields.state === "board_vote" && rec.fields.model !== "emergency";
    for (const step of steps.filter((s) => atBoard && s.name !== "Change board")) {
      await env.tx.query("UPDATE change_steps SET status = 'approved' WHERE change_number = $1 AND step_no = $2", [rec.number, step.step_no]);
      step.status = "approved";
    }
    await openStep(env, rec, steps.find((s) => s.status !== "approved") ?? steps[steps.length - 1]!, false);
  });
}

async function resetApproval(env: Env, rec: RecordObj, field: string): Promise<void> {
  const steps = await loadSteps(env.tx, rec.number, true);
  const started = steps.filter((s) => s.status !== "not_started").flatMap((s) => s.spec.voters.map((v) => v.username));
  await env.tx.query("UPDATE votes SET voided = true WHERE change_number = $1", [rec.number]);
  await env.tx.query("UPDATE change_steps SET status = 'not_started', opens_at = NULL, closes_at = NULL WHERE change_number = $1", [rec.number]);
  await save(env, { table: "change", number: rec.number, submitted: {}, to: "assessed", system: true, force: true });
  await addActivity(env, rec.number, "system", `Approval reset because ${labelOf("change", field)} changed.`, { system: true });
  await deliver(env.tx, "approval_reset", started, `Approval on ${rec.number} was reset: ${labelOf("change", field)} changed.`, rec.number);
  env.tx.after.push(() => {
    publish(`votes:${rec.number}`, "reset", {});
    for (const username of new Set(started)) publishTo(username, "approvals", "reset", { number: rec.number });
  });
}

const LOCKED = ["configuration_item", "planned_start", "planned_end", "implementation_plan", "backout_plan"];

/** After a change is saved: open approval steps on entering review, and reset approval when a locked field changed. */
export async function afterChangeSave(env: Env, rec: RecordObj, previous: RecordObj | null, changed: string[]): Promise<void> {
  if (rec.table === "change") {
    const state = String(rec.fields.state);
    const before = previous ? String(previous.fields.state) : null;
    if (before !== state && (state === "peer_review" || (state === "board_vote" && rec.fields.model === "emergency" && before === "draft"))) {
      await enterReview(env, rec);
      return;
    }
    const lockedChange = changed.find((f) => LOCKED.includes(f));
    if (lockedChange && before === state && ["peer_review", "board_vote", "approved"].includes(state)) await resetApproval(env, rec, lockedChange);
  }
}

async function activeDelegation(tx: Tx, member: string, delegate: string): Promise<boolean> {
  const rows = await tx.query("SELECT delegate FROM users WHERE username = $1", [member]);
  const d = rows[0]?.delegate as { delegate: string; from: string; to: string } | null | undefined;
  return !!d && d.delegate === delegate && Date.parse(d.from) <= now() && now() < Date.parse(d.to);
}

async function operatorsAnd(tx: Tx, extra: Array<string | null>): Promise<string[]> {
  const rows = await tx.query("SELECT username FROM users WHERE 'operator' = ANY(roles)");
  return [...rows.map((r) => r.username as string), ...extra.filter((e): e is string => !!e)];
}

async function applyOutcome(env: Env, rec: RecordObj, step: StepRow, status: "approved" | "rejected"): Promise<void> {
  const steps = await loadSteps(env.tx, rec.number, true);
  await env.tx.query("UPDATE change_steps SET status = $3 WHERE change_number = $1 AND step_no = $2", [rec.number, step.step_no, status]);
  if (status === "rejected") {
    for (const later of steps.filter((s) => s.step_no > step.step_no)) {
      await env.tx.query("UPDATE votes SET voided = true WHERE change_number = $1 AND step_no = $2", [rec.number, later.step_no]);
      await env.tx.query("UPDATE change_steps SET status = 'not_started', opens_at = NULL, closes_at = NULL WHERE change_number = $1 AND step_no = $2", [rec.number, later.step_no]);
    }
  }
  const creator = (await findRecord(env.tx, rec.number))?.createdBy ?? null;
  await deliver(env.tx, "vote_result", await operatorsAnd(env.tx, [creator]), `${rec.number} was ${status} at ${step.name}.`, rec.number);
  const next = steps.find((s) => s.step_no === step.step_no + 1);
  if (status === "rejected") await save(env, { table: "change", number: rec.number, submitted: {}, to: "rejected", system: true });
  else if (next) {
    await save(env, { table: "change", number: rec.number, submitted: {}, to: "board_vote", system: true });
    const fresh = (await findRecord(env.tx, rec.number))!;
    await openStep(env, fresh, next);
  } else await save(env, { table: "change", number: rec.number, submitted: {}, to: "approved", system: true });
  env.tx.after.push(() => {
    publish(`votes:${rec.number}`, "tally", {});
    announceApprovals([...step.spec.voters.map((v) => v.username)]);
  });
}

export async function castVote(env: Env, number: string, stepNo: number, decision: "approve" | "reject", onBehalfOf: string | null): Promise<{ vote: { voter: string; voted_by: string; decision: string; at: string }; step: StepJson }> {
  const rec = await findRecord(env.tx, number);
  const access = await env.access();
  if (!rec || rec.table !== "change" || !access.canRead(rec)) return notFound();
  const steps = await loadSteps(env.tx, number, true);
  const step = steps.find((s) => s.step_no === stepNo);
  if (!step) return notFound();
  const caller = env.user.username;
  const member = onBehalfOf ?? caller;
  const isVoter = step.spec.voters.some((v) => v.username === member);
  const delegated = onBehalfOf !== null && onBehalfOf !== caller ? await activeDelegation(env.tx, onBehalfOf, caller) : true;
  if (!isVoter || !delegated) fail(403, "not_a_voter", "You are not a voter on this step.");
  if (step.status === "not_started") fail(409, "step_not_open", "This step is not open for voting yet.");
  const closes = step.closes_at ? Date.parse(step.closes_at) : 0;
  if (step.status !== "open" || now() >= closes) fail(409, "vote_closed", `This vote closed at ${formatLocal(closes, settings.BUSINESS_TIME_ZONE)}.`);
  const existing = await votesOf(env.tx, number, stepNo);
  if (existing.some((v) => v.voter === member)) fail(409, "already_voted", `${env.world.displayName(member)} has already voted on this step.`);
  const at = new Date(now()).toISOString();
  await env.tx.query("INSERT INTO votes (change_number, step_no, voter, voted_by, decision, at) VALUES ($1, $2, $3, $4, $5, $6)", [number, stepNo, member, caller, decision, at]);
  const outcome = decideStep(step.spec, [...existing, { voter: member, decision }]);
  if (outcome.status !== "open") await applyOutcome(env, rec, step, outcome.status);
  else env.tx.after.push(() => publish(`votes:${number}`, "tally", {}));
  const fresh = (await loadSteps(env.tx, number)).find((s) => s.step_no === stepNo)!;
  return { vote: { voter: member, voted_by: caller, decision, at }, step: await stepJson(env.tx, fresh) };
}

/** Closes a step as at window close: undecided means rejected, with the published activity line. */
export async function closeStep(env: Env, number: string, stepNo: number): Promise<StepJson> {
  const rec = await findRecord(env.tx, number);
  if (!rec || rec.table !== "change") return notFound();
  const step = (await loadSteps(env.tx, number, true)).find((s) => s.step_no === stepNo);
  if (!step) return notFound();
  if (step.status !== "open") fail(409, "vote_closed", `This vote closed at ${formatLocal(step.closes_at ? Date.parse(step.closes_at) : now(), settings.BUSINESS_TIME_ZONE)}.`);
  const outcome = decideStep(step.spec, await votesOf(env.tx, number, stepNo));
  if (outcome.status === "open") await addActivity(env, number, "system", "Vote closed without reaching quorum.", { system: true });
  await applyOutcome(env, rec, step, outcome.status === "open" ? "rejected" : outcome.status);
  return stepJson(env.tx, (await loadSteps(env.tx, number)).find((s) => s.step_no === stepNo)!);
}

/** Steps whose window has run out by the given instant, earliest first. */
export async function expiredSteps(tx: Tx, atMs: number): Promise<{ number: string; step: number; closes: number }[]> {
  const rows = await tx.query("SELECT change_number, step_no, closes_at FROM change_steps WHERE status = 'open' AND closes_at <= $1 ORDER BY closes_at", [new Date(atMs).toISOString()]);
  return rows.map((r) => ({ number: r.change_number as string, step: r.step_no as number, closes: Date.parse(r.closes_at as string) }));
}

export async function nextStepClose(tx: Tx): Promise<number | null> {
  const rows = await tx.query("SELECT min(closes_at) AS at FROM change_steps WHERE status = 'open'");
  const at = rows[0]?.at as string | null | undefined;
  return at ? Date.parse(at) : null;
}

export interface ApprovalCard {
  kind: "change_step" | "request_item";
  id: string;
  record: string;
  title: string;
  closes_at: string | null;
  step: StepJson | null;
}

/** Open votes waiting on a person, including those they may cast as an active delegate. */
export async function approvalsFor(env: Env): Promise<ApprovalCard[]> {
  const username = env.user.username;
  const cards: ApprovalCard[] = [];
  const open = await env.tx.query("SELECT s.*, r.fields FROM change_steps s JOIN records r ON r.number = s.change_number WHERE s.status = 'open' ORDER BY s.closes_at, s.change_number");
  const nowIso = new Date(now()).toISOString();
  const delegators = (await env.tx.query("SELECT username FROM users WHERE delegate->>'delegate' = $1 AND (delegate->>'from')::timestamptz <= $2 AND $2 < (delegate->>'to')::timestamptz", [username, nowIso])).map((r) => r.username as string);
  for (const row of open) {
    const spec = row.spec as StepSpec;
    const votes = await votesOf(env.tx, row.change_number as string, row.step_no as number);
    const mine = spec.voters.some((v) => v.username === username) && !votes.some((v) => v.voter === username);
    const proxy = spec.voters.some((v) => delegators.includes(v.username) && !votes.some((x) => x.voter === v.username));
    if (!mine && !proxy) continue;
    const step = await stepJson(env.tx, { change_number: row.change_number as string, step_no: row.step_no as number, name: row.name as string, status: "open", opens_at: row.opens_at as string, closes_at: row.closes_at as string, spec });
    cards.push({ kind: "change_step", id: `${row.change_number}:${row.step_no}`, record: row.change_number as string, title: String((row.fields as Record<string, unknown>).title ?? ""), closes_at: row.closes_at as string, step });
  }
  const items = await env.tx.query("SELECT a.id, a.request_item, a.approvers, a.decisions, r.fields FROM item_approvals a JOIN records r ON r.number = a.request_item WHERE a.status = 'open' ORDER BY a.request_item");
  const catalog = await env.tx.query("SELECT content FROM config_items WHERE workspace = 'live' AND kind = 'catalog_item'");
  const names = new Map(catalog.map((c) => [(c.content as { id: string }).id, (c.content as { name: string }).name]));
  for (const row of items) {
    const decisions = row.decisions as { username: string }[];
    if (!(row.approvers as string[]).includes(username) || decisions.some((d) => d.username === username)) continue;
    cards.push({ kind: "request_item", id: `item-${row.id}`, record: row.request_item as string, title: names.get(String((row.fields as Record<string, unknown>).item)) ?? String((row.fields as Record<string, unknown>).short_description ?? ""), closes_at: null, step: null });
  }
  return cards;
}

export async function calendarDays(env: Env, month: string): Promise<unknown[]> {
  const zone = settings.BUSINESS_TIME_ZONE;
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const length = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const rows = await env.tx.query("SELECT * FROM records WHERE table_name = 'change' AND fields->>'state' = ANY($1) ORDER BY number", [["assessed", "peer_review", "board_vote", "approved", "implementing", "done"]]);
  const changes = rows.map(toRecord).filter((r) => typeof r.fields.planned_start === "string" && typeof r.fields.planned_end === "string");
  const freezes = await loadFreezes(env.tx);
  const days: unknown[] = [];
  for (let day = 1; day <= length; day++) {
    const start = wallToInstant(year, mon, day, 0, 0, zone);
    const next = addDays(year, mon, day, 1);
    const end = wallToInstant(next.year, next.month, next.day, 0, 0, zone);
    days.push({
      date: dateKey(year, mon, day),
      changes: changes
        .filter((c) => Date.parse(c.fields.planned_start as string) < end && start < Date.parse(c.fields.planned_end as string))
        .map((c) => ({ number: c.number, title: c.fields.title, planned_start: c.fields.planned_start, planned_end: c.fields.planned_end })),
      freezes: freezes.filter((f) => f.start < end && start < f.end).map((f) => f.name).sort(),
    });
  }
  return days;
}

export async function boardAgenda(env: Env, name: string): Promise<unknown[]> {
  const rows = await env.tx.query("SELECT s.change_number FROM change_steps s WHERE s.status = 'open' AND s.name = $1", [name]);
  const items: Array<{ number: string; title: unknown; planned_start: unknown; step: StepJson }> = [];
  for (const row of rows) {
    const rec = await findRecord(env.tx, row.change_number as string);
    if (!rec) continue;
    const step = (await stepsOf(env.tx, rec.number)).find((s) => s.name === name && s.status === "open");
    if (step) items.push({ number: rec.number, title: rec.fields.title, planned_start: rec.fields.planned_start, step });
  }
  return items.sort((a, b) => String(a.planned_start).localeCompare(String(b.planned_start)) || (a.number < b.number ? -1 : 1));
}
