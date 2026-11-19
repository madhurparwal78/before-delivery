/** Buyer and coordinator accounts: creation that never reveals existing addresses, sign-in, and Postgres-backed sessions. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PublicAccount } from "../shared/api-types.js";
import { ACCOUNT_CREATED_MESSAGE, FIELD_MESSAGES } from "../shared/copy.js";
import type { AppClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Database, Queryable } from "./db.js";
import { ApiError, invalid } from "./errors.js";

export type Role = "buyer" | "coordinator";

export interface AccountRow {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const toPublicAccount = (account: AccountRow): PublicAccount => ({
  email: account.email,
  name: account.name,
  role: account.role,
});

const SCRYPT_COST = 16_384;

const derive = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: SCRYPT_COST }, (error, key) => (error ? reject(error) : resolve(key)));
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
};

const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

export class Accounts {
  /** Hash checked against when an address is unknown, so a wrong password and an unknown address cost the same. */
  private decoyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Database,
    private readonly clock: AppClock,
    private readonly config: Config,
  ) {}

  /** Same answer whether or not the address already has an account, and an existing account is never changed. */
  async create(input: Record<string, unknown>): Promise<{ message: string }> {
    const name = typeof input["name"] === "string" ? input["name"].trim() : "";
    const email = typeof input["email"] === "string" ? normaliseEmail(input["email"]) : "";
    const password = typeof input["password"] === "string" ? input["password"] : "";
    const fields: Record<string, string> = {};
    if ([...name].length < 1 || [...name].length > 80) fields["name"] = FIELD_MESSAGES.name;
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) fields["email"] = FIELD_MESSAGES.email;
    if ([...password].length < 10 || [...password].length > 200) fields["password"] = FIELD_MESSAGES.password;
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const hash = await hashPassword(password);
    await this.db.query(
      "INSERT INTO accounts (email, name, password_hash, role, created_at) VALUES ($1, $2, $3, 'buyer', $4) ON CONFLICT (email) DO NOTHING",
      [email, name, hash, this.clock.now()],
    );
    return { message: ACCOUNT_CREATED_MESSAGE };
  }

  async signIn(input: Record<string, unknown>): Promise<{ account: AccountRow; token: string }> {
    const fields: Record<string, string> = {};
    if (typeof input["email"] !== "string") fields["email"] = FIELD_MESSAGES.email;
    if (typeof input["password"] !== "string") fields["password"] = FIELD_MESSAGES.password;
    if (typeof input["email"] !== "string" || typeof input["password"] !== "string") throw invalid(fields);
    const found = await this.db.query<AccountRow & { password_hash: string }>(
      "SELECT id, email, name, role, password_hash FROM accounts WHERE email = $1",
      [normaliseEmail(input["email"])],
    );
    const row = found.rows[0];
    this.decoyHash ??= hashPassword("decoy-password-for-timing");
    const matches = await verifyPassword(input["password"], row ? row.password_hash : await this.decoyHash);
    if (!row || !matches) throw new ApiError("sign_in_failed");
    const token = randomBytes(32).toString("base64url");
    const now = this.clock.now();
    await this.db.query("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)", [
      tokenHash(token),
      row.id,
      now,
      this.clock.plusSeconds(now, this.config.sessionSeconds),
    ]);
    return { account: { id: row.id, email: row.email, name: row.name, role: row.role }, token };
  }

  /** The account owning an unexpired session cookie value, otherwise null. */
  async fromToken(token: string | undefined, db: Queryable = this.db): Promise<AccountRow | null> {
    if (!token) return null;
    const found = await db.query<AccountRow>(
      `SELECT a.id, a.email, a.name, a.role FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash(token), this.clock.now()],
    );
    return found.rows[0] ?? null;
  }

  async signOut(token: string | undefined): Promise<void> {
    if (token) await this.db.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  }
}
