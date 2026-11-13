import type { LedgerEntry, LedgerKind, Role } from "../../../shared/types.js";
import { config } from "../../config.js";
import { db, type Transaction } from "../../db.js";
import { serverDate } from "../../domain/dates.js";
import { formatPrice, parseDecimal } from "../../domain/money.js";
import { computeRoundScenario, TARGET_POOL_UNREACHABLE } from "../../domain/scenario.js";
import { vestedOptions } from "../../domain/vesting.js";
import { nextPersonId, nextScenarioId, nextValuationId } from "../../ids.js";
import { writeWithEvents } from "../../live/events.js";
import { ADMIN, grantAudience, personAudience } from "../../flows/audiences.js";
import { addShares, emitCapTable, writeLedgerEntry } from "../../flows/ledger.js";
import { GRANT_COLUMNS, grantContext, scheduleInputFor, type GrantRow } from "../../model/grants.js";
import { loadPeople, loadPerson, toPerson, type PersonRow } from "../../model/people.js";
import { loadRegisterTotals } from "../../model/register.js";
import { loadValuations } from "../../model/valuations.js";
import { hashPassword } from "../../passwords.js";
import { conflict, forbidden, notFound, validation } from "../errors.js";
import { field, readCount, readDate, readPrice, readText } from "../fields.js";
import { json, requirePerson, requireRole, type Handler } from "../context.js";
import { route, type Route } from "../router.js";

const SHARE_CLASSES = ["Common", "Series Seed Preferred", "Series A Preferred"];
const ASSIGNABLE_ROLES: Role[] = ["option_holder", "investor", "board_member"];

const ledger: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "board_member") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await db.query<LedgerRow>(`${LEDGER_SELECT} order by l.seq desc`)
      : await db.query<LedgerRow>(`${LEDGER_SELECT} where l.holder_id = $1 order by l.seq desc`, [person.id]);
  return json({ entries: rows.map(toLedgerEntry) });
};

interface LedgerRow {
  id: string;
  at: Date;
  holder_id: string | null;
  holder_name: string | null;
  kind: LedgerKind;
  share_class: string | null;
  shares_delta: number;
  options_delta: number;
  reference: string | null;
}

const LEDGER_SELECT = `select l.id, l.at, l.holder_id, p.name as holder_name, l.kind, l.share_class,
  l.shares_delta, l.options_delta, l.reference
  from ledger_entries l left join people p on p.id = l.holder_id`;

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    holder_id: row.holder_id,
    holder_name: row.holder_name,
    kind: row.kind,
    class: row.share_class,
    shares_delta: row.shares_delta,
    options_delta: row.options_delta,
    reference: row.reference,
  };
}

const readPool: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const totals = await loadRegisterTotals(db);
  return json(totals.pool);
};

const resizePool: Handler = async (context) => {
  requireRole(context, "founder_admin");
  return writeWithEvents(async (tx, emit) => {
    const authorized = readCount(field(context.body, "authorized"));
    const totals = await loadRegisterTotals(tx);
    const allocated = totals.pool.outstanding + totals.pool.exercised + totals.pool.reserved;
    if (authorized !== null && authorized < allocated) {
      throw conflict("pool_below_allocated", `The pool can't be smaller than the ${allocated} options already allocated.`);
    }
    if (authorized === null) throw validation({ authorized: "Enter a whole number of options from 1 upward." });
    await tx.query("update option_pool set authorized = $1 where id = 1", [authorized]);
    await writeLedgerEntry(tx, { at: context.now, holderId: null, kind: "pool_resized", optionsDelta: 0, reference: null });
    await emitCapTable(emit);
    const updated = await loadRegisterTotals(tx);
    return json(updated.pool);
  });
};

const issueShares: Handler = async (context) => {
  requireRole(context, "founder_admin");
  return writeWithEvents(async (tx, emit) => {
    const holderId = readText(field(context.body, "holder_id"));
    const holder = holderId === null ? null : await loadPerson(tx, holderId);
    if (holderId !== null && holder === null) throw notFound();
    const shareClass = readText(field(context.body, "class"));
    const shares = readCount(field(context.body, "shares"));
    const fields: Record<string, string> = {};
    if (holder === null) fields["holder_id"] = "Choose a holder.";
    if (shareClass === null || !SHARE_CLASSES.includes(shareClass)) fields["class"] = "Choose a share class.";
    if (shares === null) fields["shares"] = "Enter a whole number of shares from 1 upward.";
    if (holder === null || shareClass === null || shares === null || Object.keys(fields).length > 0) {
      throw validation(fields);
    }
    await addShares(tx, holder.id, shareClass, shares);
    const id = await writeLedgerEntry(tx, {
      at: context.now,
      holderId: holder.id,
      kind: "issuance",
      shareClass,
      sharesDelta: shares,
      reference: null,
    });
    await emitCapTable(emit);
    const row = await tx.queryOne<LedgerRow>(`${LEDGER_SELECT} where l.id = $1`, [id]);
    if (row === null) throw new Error("the ledger entry was not written");
    return json({ entry: toLedgerEntry(row) }, 201);
  });
};

const listPeople: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const rows = await loadPeople(db);
  return json({ people: rows.map(toPerson) });
};

const addPerson: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const name = readText(field(context.body, "name"));
  const email = readText(field(context.body, "email"));
  const roleValue = readText(field(context.body, "role"));
  const password = readText(field(context.body, "password"));
  const fields: Record<string, string> = {};
  if (name === null || name.trim() === "" || name.length > 120) fields["name"] = "Enter a name of 1 to 120 characters.";
  if (email === null || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields["email"] = "Enter an email address.";
  if (roleValue === null || !ASSIGNABLE_ROLES.includes(roleValue as Role)) fields["role"] = "Choose a role.";
  if (password === null || password.length < 12 || password.length > 128) {
    fields["password"] = "Enter a password of 12 to 128 characters.";
  }
  if (name === null || email === null || roleValue === null || password === null || Object.keys(fields).length > 0) {
    throw validation(fields);
  }
  const taken = await db.queryOne<{ id: string }>("select id from people where lower(email) = lower($1)", [email]);
  if (taken !== null) throw validation({ email: "That email is already on the register." });
  return writeWithEvents(async (tx, emit) => {
    const id = await nextPersonId(tx);
    const first = name.trim().split(/\s+/)[0] ?? name;
    await tx.query(
      `insert into people (id, name, first_name, email, role, access, password_hash)
       values ($1, $2, $3, $4, $5, 'active', $6)`,
      [id, name.trim(), first, email, roleValue, await hashPassword(password)],
    );
    await emit("person_changed", { person_id: id, reason: "added" }, ADMIN);
    const created = await loadPerson(tx, id);
    if (created === null) throw new Error("the person was not written");
    return json({ person: toPerson(created) }, 201);
  });
};

const changeRole: Handler = async (context) => {
  const admin = requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const person = await loadPerson(tx, id);
    if (person === null) throw notFound();
    if (person.id === admin.id) throw conflict("own_role", "You can't change your own role.");
    if (person.role === "leaver") throw conflict("person_is_leaver", "A leaver's role can't be changed.");
    const roleValue = readText(field(context.body, "role"));
    if (roleValue === null || !ASSIGNABLE_ROLES.includes(roleValue as Role)) {
      throw validation({ role: "Choose a role." });
    }
    await tx.query("update people set role = $2 where id = $1", [id, roleValue]);
    await emit("role_changed", { person_id: id, role: roleValue }, personAudience(id));
    await emit("person_changed", { person_id: id, reason: "role" }, ADMIN);
    const updated = await loadPerson(tx, id);
    if (updated === null) throw new Error("the person was not written");
    return json({ person: toPerson(updated) });
  });
};

const removeAccess: Handler = async (context) => {
  const admin = requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const person = await loadPerson(tx, id);
    if (person === null) throw notFound();
    if (person.id === admin.id) throw conflict("own_role", "You can't remove your own access.");
    if (person.access === "removed") throw conflict("access_already_removed", "That access is already removed.");
    await tx.query("update people set access = 'removed' where id = $1", [id]);
    await tx.query("delete from sessions where person_id = $1", [id]);
    await emit("access_removed", { person_id: id }, personAudience(id));
    await emit("person_changed", { person_id: id, reason: "access" }, ADMIN);
    const updated = await loadPerson(tx, id);
    if (updated === null) throw new Error("the person was not written");
    return json({ person: toPerson(updated) });
  });
};

export async function recordDeparture(tx: Transaction, person: PersonRow, now: Date): Promise<PersonRow> {
  const windowEnds = new Date(now.getTime() + config.leaverWindowSeconds * 1000);
  const warnings = config.leaverWarningsSeconds
    .map((offset) => new Date(windowEnds.getTime() - offset * 1000))
    .filter((at) => at.getTime() > now.getTime());
  await tx.query(
    `update people set role = 'leaver', terminated_at = $2, termination_date = $3, window_ends_at = $4,
                       warnings_at = $5, warnings_sent = 0, window_closed = false
      where id = $1`,
    [person.id, now, serverDate(now), windowEnds, warnings.map((at) => at.toISOString())],
  );
  const updated = await loadPerson(tx, person.id);
  if (updated === null) throw new Error("the person was not written");
  return updated;
}

const departure: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const id = context.params["id"] ?? "";
  return writeWithEvents(async (tx, emit) => {
    const person = await loadPerson(tx, id);
    if (person === null) throw notFound();
    if (person.role !== "option_holder") throw conflict("not_an_option_holder", "Only an option holder can depart.");
    const updated = await recordDeparture(tx, person, context.now);
    const rows = await tx.query<GrantRow>(
      `select ${GRANT_COLUMNS} from grants where holder_id = $1 and state in ('accepted', 'offered') for update`,
      [id],
    );
    const context_ = await grantContext(tx, context.now);
    context_.people.set(updated.id, updated);
    for (const row of rows) {
      if (row.state === "offered") {
        await tx.query("update grants set state = 'expired' where id = $1", [row.id]);
        await emit(
          "grant_changed",
          { grant_id: row.id, state: "expired", reason: "expired", holder_id: id, options: row.options },
          grantAudience(id, true),
        );
        continue;
      }
      const input = scheduleInputFor(row, context_);
      if (input === null || row.options === null) continue;
      const forfeited = row.options - vestedOptions(input);
      if (forfeited <= 0) continue;
      await tx.query("update grants set forfeited = forfeited + $2 where id = $1", [row.id, forfeited]);
      await writeLedgerEntry(tx, {
        at: context.now,
        holderId: id,
        kind: "options_cancelled",
        optionsDelta: -forfeited,
        reference: row.id,
      });
      await emit(
        "grant_changed",
        { grant_id: row.id, state: "accepted", reason: "departed", holder_id: id, forfeited },
        grantAudience(id),
      );
    }
    await emit("role_changed", { person_id: id, role: "leaver" }, personAudience(id));
    await emit("person_changed", { person_id: id, reason: "departure" }, ADMIN);
    await emitCapTable(emit);
    return json({ person: toPerson(updated) });
  });
};

const listValuations: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const view = await loadValuations(db, serverDate(context.now));
  return json({ valuations: view.rows, current_id: view.currentId });
};

const recordValuation: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const effective = readDate(field(context.body, "effective_on"));
  const expires = readDate(field(context.body, "expires_on"));
  const fmv = readPrice(field(context.body, "fmv_per_share"));
  const firm = readText(field(context.body, "firm"));
  const today = serverDate(context.now);
  const fields: Record<string, string> = {};
  if (effective === null) fields["effective_on"] = "The effective date can't be after today.";
  else if (effective > today) fields["effective_on"] = "The effective date can't be after today.";
  if (expires === null) fields["expires_on"] = "The expiry date can't be before the effective date.";
  else if (effective !== null && expires < effective) {
    fields["expires_on"] = "The expiry date can't be before the effective date.";
  }
  if (fmv === null) fields["fmv_per_share"] = "Enter a value above $0.0000 with up to four decimals.";
  if (firm === null || firm.trim() === "" || firm.length > 120) fields["firm"] = "Enter a valuation firm.";
  if (effective === null || expires === null || fmv === null || firm === null || Object.keys(fields).length > 0) {
    throw validation(fields);
  }
  return writeWithEvents(async (tx, emit) => {
    const id = await nextValuationId(tx);
    await tx.query(
      `insert into valuations (id, effective_on, expires_on, fmv_per_share, firm, recorded_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, effective, expires, formatPrice(fmv), firm.trim(), context.now],
    );
    await emit("valuation_changed", { valuation_id: id, reason: "recorded" }, ADMIN);
    const view = await loadValuations(tx, today);
    const created = view.rows.find((valuation) => valuation.id === id);
    if (created === undefined) throw new Error("the valuation was not written");
    return json(created, 201);
  });
};

const roundScenario: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const preMoney = parseDecimal(field(context.body, "pre_money"), 2);
  const investment = parseDecimal(field(context.body, "investment"), 2);
  const targetPool = parseDecimal(field(context.body, "target_pool_percent"), 2);
  const fields: Record<string, string> = {};
  if (preMoney === null || preMoney <= 0n) fields["pre_money"] = "Enter an amount above $0.00 with up to two decimals.";
  if (investment === null || investment <= 0n) {
    fields["investment"] = "Enter an amount above $0.00 with up to two decimals.";
  }
  if (targetPool === null || targetPool < 0n || targetPool > 3000n) {
    fields["target_pool_percent"] = "Enter a percentage from 0.00 to 30.00.";
  }
  if (preMoney === null || investment === null || targetPool === null || Object.keys(fields).length > 0) {
    throw validation(fields);
  }
  const totals = await loadRegisterTotals(db);
  const valuations = await loadValuations(db, serverDate(context.now));
  const result = computeRoundScenario({
    preMoneyCents: preMoney,
    investmentCents: investment,
    targetPoolHundredths: targetPool,
    fullyDilutedBefore: totals.fullyDilutedTotal,
    unallocatedPoolBefore: totals.pool.unallocated,
    fmvPerShare: valuations.fmvPerShare,
  });
  if (result === TARGET_POOL_UNREACHABLE) {
    throw validation({ target_pool_percent: "This target pool can't be reached at this investment." });
  }
  return json(result);
};

const listScenarios: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const rows = await db.query<{
    id: string;
    name: string;
    pre_money: string;
    investment: string;
    target_pool_percent: string;
    saved_at: Date;
  }>("select id, name, pre_money, investment, target_pool_percent, saved_at from saved_scenarios order by saved_at desc, id desc");
  return json({
    scenarios: rows.map((row) => ({
      id: row.id,
      name: row.name,
      pre_money: row.pre_money,
      investment: row.investment,
      target_pool_percent: row.target_pool_percent,
      saved_at: row.saved_at.toISOString(),
    })),
  });
};

const saveScenario: Handler = async (context) => {
  requireRole(context, "founder_admin");
  const name = readText(field(context.body, "name"));
  const preMoney = readText(field(context.body, "pre_money"));
  const investment = readText(field(context.body, "investment"));
  const targetPool = readText(field(context.body, "target_pool_percent"));
  const fields: Record<string, string> = {};
  const trimmed = name === null ? "" : name.trim();
  if (name === null || trimmed.length < 1 || trimmed.length > 60) {
    fields["name"] = "Enter a name of 1 to 60 characters.";
  }
  if (parseDecimal(preMoney, 2) === null) fields["pre_money"] = "Enter an amount above $0.00 with up to two decimals.";
  if (parseDecimal(investment, 2) === null) {
    fields["investment"] = "Enter an amount above $0.00 with up to two decimals.";
  }
  if (parseDecimal(targetPool, 2) === null) fields["target_pool_percent"] = "Enter a percentage from 0.00 to 30.00.";
  if (preMoney === null || investment === null || targetPool === null || Object.keys(fields).length > 0) {
    throw validation(fields);
  }
  const taken = await db.queryOne<{ id: string }>("select id from saved_scenarios where lower(name) = lower($1)", [
    trimmed,
  ]);
  if (taken !== null) throw conflict("scenario_name_taken", "A saved scenario already has that name.");
  return writeWithEvents(async (tx, emit) => {
    const id = await nextScenarioId(tx);
    const rows = await tx.query<{ saved_at: Date }>(
      `insert into saved_scenarios (id, name, pre_money, investment, target_pool_percent)
       values ($1, $2, $3, $4, $5) returning saved_at`,
      [id, trimmed, preMoney, investment, targetPool],
    );
    const saved = rows[0];
    if (saved === undefined) throw new Error("the scenario was not written");
    await emit("scenario_saved", { scenario_id: id, name: trimmed }, ADMIN);
    return json(
      {
        scenario: {
          id,
          name: trimmed,
          pre_money: preMoney,
          investment,
          target_pool_percent: targetPool,
          saved_at: saved.saved_at.toISOString(),
        },
      },
      201,
    );
  });
};

export const adminRoutes: Route[] = [
  route("GET", "/api/ledger", ledger),
  route("GET", "/api/pool", readPool),
  route("PATCH", "/api/pool", resizePool),
  route("POST", "/api/issuances", issueShares),
  route("GET", "/api/people", listPeople),
  route("POST", "/api/people", addPerson),
  route("PATCH", "/api/people/:id", changeRole),
  route("POST", "/api/people/:id/remove-access", removeAccess),
  route("POST", "/api/people/:id/departure", departure),
  route("GET", "/api/valuations", listValuations),
  route("POST", "/api/valuations", recordValuation),
  route("POST", "/api/scenarios/round", roundScenario),
  route("GET", "/api/scenarios/saved", listScenarios),
  route("POST", "/api/scenarios/saved", saveScenario),
];
