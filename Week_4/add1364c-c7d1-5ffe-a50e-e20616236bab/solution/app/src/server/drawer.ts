import type { Db, Tx } from "./db.js";
import { db, write } from "./db.js";
import { record, type Actor } from "./audit.js";
import { now } from "./clock.js";
import { newId, open, seal, secretLength } from "./crypto.js";
import { ApiError, Fields, checkBody, forbidden, notFound, type Spec } from "./http.js";
import { credentialViews, factsOf, mayTurn } from "./credentials.js";
import { isDesk, type CredentialRow, type PersonRow, type RuleRow, type VaultRow, type VendorRow } from "./model.js";
import { officeDate } from "./office-time.js";
import { ruleBrief, ruleInForce, ruleView, rulesByVault } from "./rules.js";
import { completeTurns } from "./turns.js";
import { canSeeVault, visibleVaultIds } from "./visibility.js";
import { actorOf } from "./people.js";

const DOMAIN = /^(?=.{3,120}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DEFAULT_MIN_LENGTH = 12;

const vaultSubject = (vault: VaultRow): { kind: "vault"; id: string; name: string } => ({ kind: "vault", id: vault.id, name: vault.name });
const vendorSubject = (vendor: VendorRow): { kind: "vendor"; id: string; name: string } => ({ kind: "vendor", id: vendor.id, name: vendor.name });
export const loginSubject = (login: CredentialRow): { kind: "login"; id: string; name: string } => ({ kind: "login", id: login.id, name: login.label });

// ---- vaults ----

async function vaultsJson(reader: Db, vaultIds: string[], viewer: PersonRow, at: Date): Promise<Record<string, unknown>[]> {
  if (vaultIds.length === 0) return [];
  const [rows, rules, counts] = await Promise.all([
    reader.query<VaultRow>("SELECT * FROM vaults WHERE id = ANY($1) ORDER BY ord", [vaultIds]),
    rulesByVault(reader),
    reader.query<{ vault_id: string; count: number }>("SELECT vault_id, count(*)::int AS count FROM credentials GROUP BY vault_id"),
  ]);
  const today = officeDate(at);
  return rows.map((vault) => {
    const vaultRules = rules.get(vault.id) ?? [];
    return {
      id: vault.id,
      name: vault.name,
      formerly: vault.formerly,
      off_when_travelling: vault.off_when_travelling,
      rule_in_force: ruleBrief(ruleInForce(vaultRules, today)),
      pending_rules: isDesk(viewer.role)
        ? vaultRules.filter((rule) => rule.state === "drafted" || rule.state === "scheduled").map((rule) => ruleView(rule, today))
        : [],
      credential_count: counts.find((count) => count.vault_id === vault.id)?.count ?? 0,
    };
  });
}

export async function listVaults(viewer: PersonRow): Promise<Record<string, unknown>[]> {
  const at = now();
  return vaultsJson(db, await visibleVaultIds(db, viewer, at), viewer, at);
}

export async function showVault(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  const at = now();
  if (!(await canSeeVault(db, viewer, id, at))) throw notFound();
  const [vault] = await vaultsJson(db, [id], viewer, at);
  const rows = await db.query<CredentialRow>("SELECT * FROM credentials WHERE vault_id = $1 ORDER BY ord", [id]);
  return { vault, credentials: await credentialViews(db, rows, at) };
}

const NEW_VAULT: Spec = { name: { kind: "string" }, off_when_travelling: { kind: "boolean" } };
const PATCH_VAULT: Spec = { name: { kind: "string", optional: true }, off_when_travelling: { kind: "boolean", optional: true } };

async function checkVaultName(tx: Db, name: string, own: string | null, fields: Fields): Promise<void> {
  if (name.length < 2 || name.length > 40) fields.add("name", "Use 2 to 40 characters.");
  else if (await tx.one("SELECT 1 FROM vaults WHERE lower(name) = lower($1) AND id <> $2", [name, own ?? ""])) {
    fields.add("name", "A vault with that name is already filed.");
  }
}

export async function createVault(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_VAULT, fields);
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (v.name !== undefined) await checkVaultName(tx, name, null, fields);
    fields.throwIfAny();
    const at = now();
    const id = newId();
    await tx.query("INSERT INTO vaults (id, name, off_when_travelling, created_at) VALUES ($1,$2,$3,$4)", [id, name, v.off_when_travelling, at]);
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_at)
       VALUES ($1,$2,$3,$4,'in_force',1,'Lockset','Lockset',$5)`,
      [newId(), id, DEFAULT_MIN_LENGTH, officeDate(at), at],
    );
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [id]);
    if (!vault) throw new Error("vault was not stored");
    await record(tx, actorOf(actor), "vault_create", vaultSubject(vault), { off_when_travelling: vault.off_when_travelling });
    const [view] = await vaultsJson(tx, [id], actor, at);
    return view ?? {};
  });
}

export async function changeVault(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const at = now();
    if (!(await canSeeVault(tx, actor, id, at))) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    const vault = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [id]);
    if (!vault) throw notFound();
    const fields = new Fields();
    const v = checkBody(body, PATCH_VAULT, fields);
    const name = typeof v.name === "string" ? v.name.trim() : null;
    if (name !== null) await checkVaultName(tx, name, vault.id, fields);
    fields.throwIfAny();
    if (name !== null && name !== vault.name) {
      await tx.query("UPDATE vaults SET name = $2, formerly = $3 WHERE id = $1", [vault.id, name, vault.name]);
      await tx.query("INSERT INTO vault_renames (id, vault_id, old_name, new_name, by_name, at) VALUES ($1,$2,$3,$4,$5,$6)", [
        newId(),
        vault.id,
        vault.name,
        name,
        actor.full_name,
        at,
      ]);
      await record(tx, actorOf(actor), "vault_rename", vaultSubject(vault), { old: vault.name, new: name });
    }
    if (typeof v.off_when_travelling === "boolean" && v.off_when_travelling !== vault.off_when_travelling) {
      await tx.query("UPDATE vaults SET off_when_travelling = $2 WHERE id = $1", [vault.id, v.off_when_travelling]);
      const renamed = await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [vault.id]);
      await record(tx, actorOf(actor), "vault_change", renamed ? vaultSubject(renamed) : vaultSubject(vault), { off_when_travelling: v.off_when_travelling });
    }
    const [view] = await vaultsJson(tx, [id], actor, at);
    return view ?? {};
  });
}

// ---- vendors ----

async function vendorJson(reader: Db, rows: VendorRow[]): Promise<Record<string, unknown>[]> {
  const renames = await reader.query<{ vendor_id: string; old_name: string; new_name: string; by_name: string; at: Date }>(
    "SELECT * FROM vendor_renames ORDER BY at",
  );
  return rows.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    domain: vendor.domain,
    formerly: vendor.formerly,
    renames: renames
      .filter((rename) => rename.vendor_id === vendor.id)
      .map((rename) => ({ old: rename.old_name, new: rename.new_name, by: rename.by_name, at: rename.at.toISOString() })),
  }));
}

export async function listVendors(): Promise<Record<string, unknown>[]> {
  return vendorJson(db, await db.query<VendorRow>("SELECT * FROM vendors ORDER BY ord"));
}

const NEW_VENDOR: Spec = { name: { kind: "string" }, domain: { kind: "string" } };
const PATCH_VENDOR: Spec = { name: { kind: "string", optional: true }, domain: { kind: "string", optional: true } };

async function checkVendor(tx: Db, v: Record<string, unknown>, own: string | null, fields: Fields): Promise<void> {
  if (typeof v.name === "string" && (v.name.trim().length < 2 || v.name.trim().length > 60)) fields.add("name", "Use 2 to 60 characters.");
  if (typeof v.domain === "string") {
    const domain = v.domain.trim().toLowerCase();
    if (!DOMAIN.test(domain)) fields.add("domain", "Give a host name like bank.example.");
    else if (await tx.one("SELECT 1 FROM vendors WHERE domain = $1 AND id <> $2", [domain, own ?? ""])) fields.add("domain", "That domain is already filed.");
  }
}

export async function createVendor(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_VENDOR, fields);
    await checkVendor(tx, v, null, fields);
    fields.throwIfAny();
    const id = newId();
    const name = String(v.name).trim();
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$3,$4)", [id, name, String(v.domain).trim().toLowerCase(), now()]);
    const vendor = await tx.one<VendorRow>("SELECT * FROM vendors WHERE id = $1", [id]);
    if (!vendor) throw new Error("vendor was not stored");
    await record(tx, actorOf(actor), "vendor_create", vendorSubject(vendor), { domain: vendor.domain });
    return (await vendorJson(tx, [vendor]))[0] ?? {};
  });
}

export async function changeVendor(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const vendor = await tx.one<VendorRow>("SELECT * FROM vendors WHERE id = $1", [id]);
    if (!vendor) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, PATCH_VENDOR, fields);
    await checkVendor(tx, v, vendor.id, fields);
    fields.throwIfAny();
    const name = typeof v.name === "string" ? v.name.trim() : null;
    if (name !== null && name !== vendor.name) {
      await tx.query("UPDATE vendors SET name = $2, formerly = $3 WHERE id = $1", [vendor.id, name, vendor.name]);
      await tx.query("INSERT INTO vendor_renames (id, vendor_id, old_name, new_name, by_name, at) VALUES ($1,$2,$3,$4,$5,$6)", [
        newId(),
        vendor.id,
        vendor.name,
        name,
        actor.full_name,
        now(),
      ]);
      await record(tx, actorOf(actor), "vendor_rename", vendorSubject(vendor), { old: vendor.name, new: name });
    }
    const domain = typeof v.domain === "string" ? v.domain.trim().toLowerCase() : null;
    if (domain !== null && domain !== vendor.domain) {
      await tx.query("UPDATE vendors SET domain = $2 WHERE id = $1", [vendor.id, domain]);
      const renamed = await tx.one<VendorRow>("SELECT * FROM vendors WHERE id = $1", [vendor.id]);
      await record(tx, actorOf(actor), "vendor_change", renamed ? vendorSubject(renamed) : vendorSubject(vendor), { domain });
    }
    const fresh = await tx.one<VendorRow>("SELECT * FROM vendors WHERE id = $1", [vendor.id]);
    return (await vendorJson(tx, fresh ? [fresh] : [vendor]))[0] ?? {};
  });
}

// ---- logins ----

function turnMessage(vault: VaultRow, rule: RuleRow): string {
  return `${vault.name} needs at least ${rule.min_length} characters.`;
}

async function loginIfVisible(reader: Db, viewer: PersonRow, id: string): Promise<{ login: CredentialRow; vault: VaultRow }> {
  const login = await reader.one<CredentialRow>("SELECT * FROM credentials WHERE id = $1", [id]);
  if (!login || !(await canSeeVault(reader, viewer, login.vault_id, now()))) throw notFound();
  const vault = await reader.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [login.vault_id]);
  if (!vault) throw notFound();
  return { login, vault };
}

export async function showLogin(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  const { login } = await loginIfVisible(db, viewer, id);
  return (await credentialViews(db, [login], now()))[0] ?? {};
}

const NEW_LOGIN: Spec = {
  vault_id: { kind: "string" },
  vendor_id: { kind: "string" },
  label: { kind: "string" },
  username: { kind: "string" },
  secret: { kind: "string" },
};

/** The rule in force decides the minimum a new secret must meet. */
async function checkSecret(tx: Db, vault: VaultRow, secret: string, fields: Fields, at: Date): Promise<void> {
  if (secret.length < 1 || secretLength(secret) > 128) {
    fields.add("secret", "Use 1 to 128 characters.");
    return;
  }
  const rules = (await rulesByVault(tx)).get(vault.id) ?? [];
  const rule = ruleInForce(rules, officeDate(at));
  if (secretLength(secret) < rule.min_length) fields.add("secret", turnMessage(vault, rule));
}

export async function createLogin(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_LOGIN, fields);
    const at = now();
    const vault = typeof v.vault_id === "string" ? await tx.one<VaultRow>("SELECT * FROM vaults WHERE id = $1", [v.vault_id]) : null;
    if (v.vault_id !== undefined && !vault) fields.add("vault_id", "Pick a vault that exists.");
    const vendor = typeof v.vendor_id === "string" ? await tx.one<VendorRow>("SELECT * FROM vendors WHERE id = $1", [v.vendor_id]) : null;
    if (v.vendor_id !== undefined && !vendor) fields.add("vendor_id", "Pick a vendor that exists.");
    const label = typeof v.label === "string" ? v.label.trim() : "";
    if (v.label !== undefined && (label.length < 1 || label.length > 60)) fields.add("label", "Use 1 to 60 characters.");
    const username = typeof v.username === "string" ? v.username : "";
    if (v.username !== undefined && (username.length < 1 || username.length > 120)) fields.add("username", "Use 1 to 120 characters.");
    const secret = typeof v.secret === "string" ? v.secret : "";
    if (vault && v.secret !== undefined) await checkSecret(tx, vault, secret, fields, at);
    if (vault && vendor && username.length > 0 && !fields.errors.username) {
      if (await tx.one("SELECT 1 FROM credentials WHERE vault_id = $1 AND vendor_id = $2 AND lower(username) = lower($3)", [vault.id, vendor.id, username])) {
        fields.add("username", "That login is already filed in this vault.");
      }
    }
    fields.throwIfAny();
    if (!vault || !vendor) throw new Error("login references were validated");
    const id = newId();
    await tx.query(
      `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, vault.id, vendor.id, label, username, seal(secret), secretLength(secret), officeDate(at), at],
    );
    await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [id, actor.id]);
    const login = await tx.one<CredentialRow>("SELECT * FROM credentials WHERE id = $1", [id]);
    if (!login) throw new Error("login was not stored");
    await record(tx, actorOf(actor), "credential_create", loginSubject(login), { vault_id: vault.id });
    return (await credentialViews(tx, [login], at))[0] ?? {};
  });
}

/** Saving a new secret: the edit, every open turn done, and the saver now holds it. */
async function saveSecret(tx: Tx, login: CredentialRow, secret: string, actor: Actor & { personId: string }, at: Date): Promise<void> {
  await tx.query(
    "UPDATE credentials SET secret_sealed = $2, secret_length = $3, secret_rev = secret_rev + 1, last_turned_on = $4, imported_on = NULL WHERE id = $1",
    [login.id, seal(secret), secretLength(secret), officeDate(at)],
  );
  await record(tx, actor, "secret_edit", loginSubject(login), { vault_id: login.vault_id });
  await completeTurns(tx, login, actor);
  await tx.query("DELETE FROM holders WHERE credential_id = $1", [login.id]);
  await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [login.id, actor.personId]);
}

export async function turnLogin(actor: PersonRow, id: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const { login, vault } = await loginIfVisible(tx, actor, id);
    if (!mayTurn(actor)) throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, { secret: { kind: "string" } }, fields);
    const at = now();
    if (typeof v.secret === "string") await checkSecret(tx, vault, v.secret, fields, at);
    fields.throwIfAny();
    await saveSecret(tx, login, String(v.secret), { personId: actor.id, name: actor.full_name }, at);
    const fresh = await tx.one<CredentialRow>("SELECT * FROM credentials WHERE id = $1", [id]);
    return (await credentialViews(tx, fresh ? [fresh] : [login], at))[0] ?? {};
  });
}

export async function revealLogin(actor: PersonRow, id: string, body: unknown, action: "reveal" | "copy"): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const { login } = await loginIfVisible(tx, actor, id);
    const fields = new Fields();
    checkBody(body, {}, fields);
    fields.throwIfAny();
    const at = now();
    const facts = factsOf(login, (await rulesByVault(tx)).get(login.vault_id) ?? [], at);
    if (facts.outOfPolicy && facts.leewayEndsAt && at.getTime() >= facts.leewayEndsAt.getTime()) {
      throw new ApiError(423, "turn_required", "This login is past its 14-day leeway. Turn it before revealing.");
    }
    const entry = await record(tx, actorOf(actor), action, loginSubject(login), { rule_id: facts.rule.id }, at);
    return { credential_id: login.id, secret: open(login.secret_sealed), rule_id: facts.rule.id, audit_id: entry.id };
  });
}

