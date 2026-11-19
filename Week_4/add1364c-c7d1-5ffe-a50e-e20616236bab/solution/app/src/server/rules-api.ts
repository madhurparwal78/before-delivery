import { db, write } from "./db.js";
import type { Db } from "./db.js";
import { record } from "./audit.js";
import { now } from "./clock.js";
import { newId } from "./crypto.js";
import { Fields, checkBody, conflict, forbidden, invalid, notFound, type Spec } from "./http.js";
import { isDesk, type PersonRow, type RuleRow, type VaultRow } from "./model.js";
import { addDays, isRealDate, officeDate, officeMidnight, offsetAt } from "./office-time.js";
import { actorOf } from "./people.js";
import { MIN_LENGTH_CEILING, MIN_LENGTH_FLOOR, findRule, inForceText, ruleInForce, ruleView, rulesByVault, takesForceText } from "./rules.js";

const RULE_CHANGED = "This rule changed since you opened it. Reload it and try again.";
const CANNOT_SIGN = "This rule can't be signed now.";
const RULER_NIGHTS = 60;

function requireDesk(viewer: PersonRow): void {
  if (!isDesk(viewer.role)) throw forbidden();
}

const vaultSubject = (vault: VaultRow): { kind: "vault"; id: string; name: string } => ({ kind: "vault", id: vault.id, name: vault.name });

async function ruleOr404(reader: Db, id: string): Promise<RuleRow> {
  const rule = await findRule(reader, id);
  if (!rule) throw notFound();
  return rule;
}

export async function listRules(viewer: PersonRow, vaultId: string | null): Promise<Record<string, unknown>[]> {
  requireDesk(viewer);
  if (vaultId !== null && !(await db.one("SELECT 1 FROM vaults WHERE id = $1", [vaultId]))) throw notFound();
  const grouped = await rulesByVault(db);
  const order = (await db.query<{ id: string }>("SELECT id FROM vaults ORDER BY ord")).map((vault) => vault.id);
  const rows = order.filter((id) => vaultId === null || id === vaultId).flatMap((id) => grouped.get(id) ?? []);
  const today = officeDate(now());
  return rows.map((rule) => ruleView(rule, today));
}

export async function showRule(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  const rule = await ruleOr404(db, id);
  requireDesk(viewer);
  return ruleView(rule, officeDate(now()));
}

function checkMinLength(value: unknown, fields: Fields): void {
  if (typeof value === "number" && Number.isInteger(value) && (value < MIN_LENGTH_FLOOR || value > MIN_LENGTH_CEILING)) {
    fields.add("min_length", `Use a whole number from ${MIN_LENGTH_FLOOR} to ${MIN_LENGTH_CEILING}.`);
  }
}

function checkEffectiveOn(value: unknown, today: string, fields: Fields): void {
  if (typeof value !== "string") return;
  if (!isRealDate(value)) fields.add("effective_on", "Use a date like 2027-01-01.");
  else if (value <= today) fields.add("effective_on", "Pick a date after today.");
}

const NEW_RULE: Spec = { vault_id: { kind: "string" }, min_length: { kind: "integer" }, effective_on: { kind: "string" } };
const EDIT_RULE: Spec = {
  version: { kind: "any", optional: true },
  min_length: { kind: "integer", optional: true },
  effective_on: { kind: "string", optional: true },
};

export async function draftRule(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    requireDesk(actor);
    const fields = new Fields();
    const v = checkBody(body, NEW_RULE, fields);
    const at = now();
    const today = officeDate(at);
    const vault = typeof v.vault_id === "string" ? await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [v.vault_id]) : null;
    if (v.vault_id !== undefined && !vault) fields.add("vault_id", "Pick a vault that exists.");
    checkMinLength(v.min_length, fields);
    checkEffectiveOn(v.effective_on, today, fields);
    fields.throwIfAny();
    if (!vault) throw new Error("vault was validated");
    const id = newId();
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, created_at)
       VALUES ($1,$2,$3,$4,'drafted',1,$5,$6)`,
      [id, vault.id, v.min_length, v.effective_on, actor.full_name, at],
    );
    await record(tx, actorOf(actor), "rule_draft", vaultSubject(vault), { rule_id: id, min_length: v.min_length, effective_on: v.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}

export async function editRule(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const rule = await ruleOr404(tx, id);
    requireDesk(actor);
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    if (rule.state === "in_force") throw conflict("rule_in_force", "An in-force rule cannot be edited. Draft a new rule instead.");
    if (rule.state === "superseded") throw conflict("rule_superseded", "A superseded rule cannot be edited.");
    const sent = raw.version;
    if (typeof sent === "number" && Number.isInteger(sent) && sent !== rule.version) throw conflict("rule_changed", RULE_CHANGED);
    const fields = new Fields();
    const v = checkBody(body, EDIT_RULE, fields);
    const at = now();
    const today = officeDate(at);
    if (typeof sent !== "number" || !Number.isInteger(sent)) fields.add("version", "Send the whole-number version you opened.");
    checkMinLength(v.min_length, fields);
    checkEffectiveOn(v.effective_on, today, fields);
    fields.throwIfAny();
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) throw notFound();
    await tx.query(
      "UPDATE rules SET min_length = $2, effective_on = $3, state = 'drafted', signed_by = NULL, version = version + 1 WHERE id = $1",
      [rule.id, v.min_length ?? rule.min_length, v.effective_on ?? rule.effective_on],
    );
    await record(tx, actorOf(actor), "rule_edit", vaultSubject(vault), { rule_id: rule.id, min_length: v.min_length ?? rule.min_length, effective_on: v.effective_on ?? rule.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}

export async function signRule(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const rule = await ruleOr404(tx, id);
    if (actor.role !== "managing_partner") throw forbidden();
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const at = now();
    const today = officeDate(at);
    if (rule.state === "in_force") throw conflict("rule_in_force", CANNOT_SIGN);
    if (rule.state === "superseded") throw conflict("rule_superseded", CANNOT_SIGN);
    if (rule.state === "scheduled") throw conflict("not_a_draft", CANNOT_SIGN);
    const sent = raw.version;
    if (typeof sent === "number" && Number.isInteger(sent) && sent !== rule.version) throw conflict("rule_changed", RULE_CHANGED);
    if (rule.effective_on <= today) throw conflict("effective_date_passed", CANNOT_SIGN);
    if (await tx.one("SELECT 1 FROM rules WHERE vault_id = $1 AND state = 'scheduled' AND effective_on = $2 AND id <> $3", [rule.vault_id, rule.effective_on, rule.id])) {
      throw conflict("rule_date_taken", CANNOT_SIGN);
    }
    const fields = new Fields();
    checkBody(body, { version: { kind: "any" } }, fields);
    if (typeof sent !== "number" || !Number.isInteger(sent)) fields.add("version", "Send the whole-number version you opened.");
    fields.throwIfAny();
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) throw notFound();
    await tx.query("UPDATE rules SET state = 'scheduled', version = version + 1, signed_by = $2 WHERE id = $1", [rule.id, actor.full_name]);
    await record(tx, actorOf(actor), "rule_sign", vaultSubject(vault), { rule_id: rule.id, min_length: rule.min_length, effective_on: rule.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}

/** Answers, for a chosen office midnight, which rule is in force in each vault, the stubs, and the out-of-policy counts. */
export async function asOf(viewer: PersonRow, night: string | null): Promise<Record<string, unknown>> {
  requireDesk(viewer);
  const at = now();
  const today = officeDate(at);
  if (night === null || !isRealDate(night) || night <= today || night > addDays(today, RULER_NIGHTS)) {
    throw invalid({ night: "Pick one of the next 60 office midnights." });
  }
  const [vaults, rules, logins] = await Promise.all([
    db.query<VaultRow>("SELECT * FROM vaults ORDER BY ord"),
    rulesByVault(db),
    db.query<{ vault_id: string; secret_length: number }>("SELECT vault_id, secret_length FROM credentials"),
  ]);
  const perVault = vaults.map((vault) => {
    const vaultRules = rules.get(vault.id) ?? [];
    const inForce = ruleInForce(vaultRules, night);
    const stubs = vaultRules
      .filter((rule) => rule.state === "scheduled" || (rule.state === "in_force" && rule.took_force_on === today))
      .sort((a, b) => a.effective_on.localeCompare(b.effective_on))
      .map((rule) => ({
        rule_id: rule.id,
        version: rule.version,
        min_length: rule.min_length,
        text: night < rule.effective_on ? takesForceText(rule.effective_on) : inForceText(rule.effective_on),
        in_force: night >= rule.effective_on,
      }));
    return {
      vault_id: vault.id,
      name: vault.name,
      rule_in_force: { id: inForce.id, min_length: inForce.min_length, effective_on: inForce.effective_on },
      cylinder: vaultRules.some((rule) => rule.state === "scheduled" && rule.effective_on > night) ? "pending" : "in_force",
      stubs,
      out_of_policy_count: logins.filter((login) => login.vault_id === vault.id && login.secret_length < inForce.min_length).length,
    };
  });
  const start = officeMidnight(night);
  return {
    night,
    offset: offsetAt(start),
    starts_at: start.toISOString(),
    out_of_policy_count: perVault.reduce((sum, vault) => sum + vault.out_of_policy_count, 0),
    vaults: perVault,
  };
}
