/** Accounts: normalised emails, display names, and the realm user each account is linked to. */
import { lockNamed, nextCode, one, run, transaction, type Queryable } from "./db.js";
import { audit } from "./audit.js";
import { deleteUser, provisionUser } from "./identity.js";
import { refuse } from "./errors.js";
import { DELETED_ACCOUNT_NAME } from "../shared/copy.js";
import type { Account, Person, Role } from "../shared/types.js";

export interface AccountRow {
  id: string;
  num: number;
  email: string;
  display_name: string;
  role: Role;
  keycloak_id: string | null;
  seeded: boolean;
  deleted: boolean;
}

export const normaliseEmail = (email: string): string => email.normalize("NFC").toLowerCase().normalize("NFC");

export const displayNameOf = (account: Pick<AccountRow, "display_name" | "deleted">): string =>
  account.deleted ? DELETED_ACCOUNT_NAME : account.display_name;

export const personOf = (account: Pick<AccountRow, "email" | "display_name" | "deleted">): Person => ({
  email: account.email,
  display_name: displayNameOf(account),
});

export const accountView = (account: AccountRow): Account => ({
  id: account.id,
  email: account.email,
  display_name: displayNameOf(account),
  role: account.role,
});

export async function accountById(db: Queryable, id: string): Promise<AccountRow | null> {
  return one<AccountRow>(db, "SELECT * FROM account WHERE id = $1", [id]);
}

export async function accountByEmail(db: Queryable, email: string): Promise<AccountRow | null> {
  return one<AccountRow>(db, "SELECT * FROM account WHERE email = $1", [normaliseEmail(email)]);
}

export async function accountByIdentity(db: Queryable, subject: string): Promise<AccountRow | null> {
  return one<AccountRow>(db, "SELECT * FROM account WHERE keycloak_id = $1 AND NOT deleted", [subject]);
}

export async function liveAccountOfRole(db: Queryable, email: unknown, role: Role): Promise<AccountRow | null> {
  if (typeof email !== "string") return null;
  const found = await accountByEmail(db, email);
  return found && !found.deleted && found.role === role ? found : null;
}

export async function createAccount(actor: AccountRow, input: { email: string; displayName: string; password: string; role: Role }): Promise<AccountRow> {
  const email = normaliseEmail(input.email);
  return transaction(async (db) => {
    await lockNamed(db, `account:${email}`);
    if (await accountByEmail(db, email)) throw refuse("email_taken");
    const num = await nextCode(db, "account");
    const id = `A-${String(num).padStart(2, "0")}`;
    const user = await provisionUser(email, input.displayName, input.password, input.role);
    await run(db, "INSERT INTO account (id, num, email, display_name, role, keycloak_id) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      num,
      email,
      input.displayName,
      input.role,
      user.id,
    ]);
    await audit(db, { actor: actor.email, action: "account.create", target: id, after: input.role });
    return (await accountById(db, id))!;
  });
}

export async function renameAccount(actor: AccountRow, target: AccountRow, displayName: string): Promise<AccountRow> {
  return transaction(async (db) => {
    await run(db, "UPDATE account SET display_name = $2 WHERE id = $1", [target.id, displayName]);
    await audit(db, { actor: actor.email, action: "account.rename", target: target.id, before: target.display_name, after: displayName });
    return (await accountById(db, target.id))!;
  });
}

export async function refuseRoleChange(actor: AccountRow, target: AccountRow): Promise<never> {
  await transaction((db) => audit(db, { actor: actor.email, action: "account.role_change_refused", target: target.id, before: target.role, after: target.role }));
  throw refuse("role_change_forbidden");
}

export async function removeAccount(actor: AccountRow, target: AccountRow): Promise<void> {
  await transaction(async (db) => {
    const locked = await one<AccountRow>(db, "SELECT * FROM account WHERE id = $1 FOR UPDATE", [target.id]);
    if (!locked || locked.deleted) throw refuse("not_found");
    const owned = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM boat WHERE owner_id = $1", [target.id]);
    if (owned!.n > 0) throw refuse("account_in_use");
    if (locked.keycloak_id) await deleteUser(locked.keycloak_id);
    await run(db, "UPDATE account SET deleted = true WHERE id = $1", [target.id]);
    await audit(db, { actor: actor.email, action: "account.delete", target: target.id, before: target.role });
  });
}

