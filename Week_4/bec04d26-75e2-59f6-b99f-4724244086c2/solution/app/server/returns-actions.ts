import type { PoolClient } from "pg";
import { transaction } from "./db";
import { deadlinePassed, conflict, illegalStatus } from "./http/errors";
import { extensionOpen } from "./domain/extension";
import { toCents } from "./domain/money";
import { type Action, moveStatus } from "./domain/status";
import { toIso } from "./domain/labels";
import type { Message } from "./services/messages";
import { approvalRequest, approvedNotice, filedNotice, sentBackNotice } from "./services/messages";
import { background } from "./services/background";
import { publish } from "./services/hub";
import { dispatchMail } from "./services/outbox";
import { renderWaitingPackets } from "./services/packets";
import { MESSAGES, asObject, Check, isVersion, trimmed } from "./validation";
import { type Account, bookkeeperOf, getPractice, nowOf, ownerOf, type Practice } from "./store/practice";
import { applySchedule, cancelPendingReminders, loadView, lockReturn, type ReturnRow } from "./store/returns";
import { getStates } from "./store/states";
import type { ReturnChange, ReturnView, Status } from "../shared/types";

interface Step {
  db: PoolClient;
  row: ReturnRow;
  practice: Practice;
  actor: Account;
  nowMs: number;
  next: Status;
}

type Notices = (view: ReturnView) => Promise<{ to: string; message: Message }[]>;

interface ActionDef<Input> {
  action: Action;
  change: ReturnChange;
  guard?: (row: ReturnRow, nowMs: number) => void;
  parse: (body: Record<string, unknown>, check: Check) => Input;
  apply: (step: Step, input: Input) => Promise<{ notices?: Notices }>;
}

/**
 * Runs one write on a return in the one order the brief fixes: stale version, illegal status move, late
 * deadline, then field validation. Every persisted change adds one to the version.
 */
async function run<Input>(actor: Account, returnId: string, rawBody: unknown, def: ActionDef<Input>): Promise<ReturnView> {
  const body = asObject(rawBody);
  const { view, notified } = await transaction(async (db) => {
    const row = await lockReturn(db, returnId);
    if (isVersion(body.version) && body.version !== row.version) {
      throw conflict(row.version, row.status, row.changed_by);
    }
    const next = moveStatus(def.action, row.status, { awaitingApproval: row.awaiting_approval, extended: row.ext_granted_at !== null });
    if (!next) throw illegalStatus(row.status);
    const practice = await getPractice(db, row.practice_id);
    const nowMs = nowOf(practice);
    def.guard?.(row, nowMs);
    const check = new Check();
    check.version(body.version);
    const input = def.parse(body, check);
    check.done();
    const outcome = await def.apply({ db, row, practice, actor, nowMs, next }, input);
    const view = await loadView(db, returnId);
    return { view, notified: Boolean(await outcome.notices?.(view)) };
  });
  publish(actor.practiceId, { type: "return", change: def.change, by: actor.displayName, return: view },
    { clientId: view.client.id });
  if (notified) background(() => dispatchMail(actor.practiceId));
  if (view.packet === "pending") background(renderWaitingPackets);
  return view;
}

const enqueue = async (db: PoolClient, view: ReturnView, practiceId: string,
  notices: { to: string; message: Message }[]): Promise<void> => {
  for (const { to, message } of notices) {
    await db.query("INSERT INTO notices (practice_id, return_id, to_email, subject, body) VALUES ($1,$2,$3,$4,$5)",
      [practiceId, view.id, to, message.subject, message.body]);
  }
};

const amountsOf = (body: Record<string, unknown>, check: Check, grossKey = "gross_sales", taxKey = "tax_due") =>
  ({ gross: check.amount(grossKey, body[grossKey]), tax: check.amount(taxKey, body[taxKey]) });

type Amounts = { gross: string; tax: string };

/** Notices are written in the same transaction as the change, so each event leaves exactly one. */
function withNotices(step: Step, build: Notices): Notices {
  return async (view) => {
    const notices = await build(view);
    await enqueue(step.db, view, step.practice.id, notices);
    return notices;
  };
}

const approvalRequestFor = (step: Step) => withNotices(step, async (view) => {
  const owner = await ownerOf(step.db, step.row.client_id);
  return [{ to: owner.email, message: approvalRequest(view, owner.displayName, step.actor.displayName) }];
});

const savingAmounts = (action: "prepare" | "save_amounts", change: ReturnChange): ActionDef<Amounts> => ({
  action, change,
  parse: (body, check) => amountsOf(body, check),
  async apply(step, input) {
    const awaiting = step.next === "prepared";
    await step.db.query(
      `UPDATE returns SET status = $2, gross_cents = $3, tax_cents = $4, awaiting_approval = $5,
         version = version + 1, changed_by = $6 WHERE id = $1`,
      [step.row.id, step.next, toCents(input.gross), toCents(input.tax), awaiting, step.actor.displayName]);
    return { notices: awaiting ? approvalRequestFor(step) : undefined };
  },
});

const prepare = savingAmounts("prepare", "prepared");
const saveAmounts = savingAmounts("save_amounts", "amounts");

const approve: ActionDef<null> = {
  action: "approve", change: "approved",
  parse: () => null,
  async apply(step) {
    await step.db.query("INSERT INTO approvals (return_id, action, by_name, at) VALUES ($1, 'approved', $2, $3)",
      [step.row.id, step.actor.displayName, toIso(step.nowMs)]);
    await step.db.query(
      "UPDATE returns SET status = $2, awaiting_approval = false, version = version + 1, changed_by = $3 WHERE id = $1",
      [step.row.id, step.next, step.actor.displayName]);
    return { notices: withNotices(step, async (view) => [{
      to: (await bookkeeperOf(step.db, step.practice.id)).email, message: approvedNotice(view, step.actor.displayName),
    }]) };
  },
};

const sendBack: ActionDef<string> = {
  action: "send_back", change: "sent_back",
  parse(body, check) {
    const reason = trimmed(body.reason);
    if (!reason) check.fail("reason", MESSAGES.reason);
    else if (reason.length > 500) check.fail("reason", MESSAGES.reasonLong);
    return reason;
  },
  async apply(step, reason) {
    await step.db.query("INSERT INTO approvals (return_id, action, by_name, at, reason) VALUES ($1, 'sent_back', $2, $3, $4)",
      [step.row.id, step.actor.displayName, toIso(step.nowMs), reason]);
    await step.db.query(
      "UPDATE returns SET status = $2, awaiting_approval = false, version = version + 1, changed_by = $3 WHERE id = $1",
      [step.row.id, step.next, step.actor.displayName]);
    return { notices: withNotices(step, async (view) => [{
      to: (await bookkeeperOf(step.db, step.practice.id)).email, message: sentBackNotice(view, step.actor.displayName, reason),
    }]) };
  },
};

const file: ActionDef<null> = {
  action: "file", change: "filed",
  parse: () => null,
  async apply(step) {
    await step.db.query(
      `UPDATE returns SET status = $2, filed_at = $3, awaiting_approval = false, version = version + 1, changed_by = $4
       WHERE id = $1`, [step.row.id, step.next, toIso(step.nowMs), step.actor.displayName]);
    await cancelPendingReminders(step.db, step.row.id);
    return { notices: withNotices(step, async (view) => [{
      to: (await ownerOf(step.db, step.row.client_id)).email, message: filedNotice(view),
    }]) };
  },
};

const extend: ActionDef<null> = {
  action: "extend", change: "extended",
  guard(row, nowMs) {
    if (!extensionOpen(Date.parse(row.due_at), nowMs)) throw deadlinePassed();
  },
  parse: () => null,
  async apply(step) {
    const state = (await getStates(step.db, step.practice.id)).find((s) => s.code === step.row.state_code)!;
    const edition = state.editions.find((e) => e.effective_date === step.row.edition_effective)!;
    await applySchedule(step.db, step.row, {
      edition, extensionDays: edition.extension_days, state, hour: step.practice.reminderHour,
      changedBy: step.actor.displayName, grantedAt: step.nowMs,
    });
    return {};
  },
};

const amend: ActionDef<Amounts & { note: string | null }> = {
  action: "amend", change: "amended",
  parse(body, check) {
    return { ...amountsOf(body, check), note: check.note("note", body.note) };
  },
  async apply(step, input) {
    await step.db.query(
      `INSERT INTO amendments (return_id, at, by_name, note, original_gross_cents, original_tax_cents,
         amended_gross_cents, amended_tax_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [step.row.id, toIso(step.nowMs), step.actor.displayName, input.note, step.row.gross_cents ?? 0,
        step.row.tax_cents ?? 0, toCents(input.gross), toCents(input.tax)]);
    await step.db.query(
      `UPDATE returns SET status = $2, gross_cents = $3, tax_cents = $4, version = version + 1, changed_by = $5
       WHERE id = $1`, [step.row.id, step.next, toCents(input.gross), toCents(input.tax), step.actor.displayName]);
    return {};
  },
};

type Runner = (actor: Account, returnId: string, body: unknown) => Promise<ReturnView>;

export const returnActions = {
  prepare: (actor, id, body) => run(actor, id, body, prepare),
  saveAmounts: (actor, id, body) => run(actor, id, body, saveAmounts),
  approve: (actor, id, body) => run(actor, id, body, approve),
  sendBack: (actor, id, body) => run(actor, id, body, sendBack),
  file: (actor, id, body) => run(actor, id, body, file),
  extend: (actor, id, body) => run(actor, id, body, extend),
  amend: (actor, id, body) => run(actor, id, body, amend),
} satisfies Record<string, Runner>;
