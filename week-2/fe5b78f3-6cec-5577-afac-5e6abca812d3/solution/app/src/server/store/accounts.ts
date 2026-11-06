// Traveller accounts: scrypt password hashes, and the Kill Bill account made no later than the first charge.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import type { AccountRow } from "../http/session.js";
import type { KillBill } from "../services/killbill.js";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split("$");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** The traveller's Kill Bill account (`pakka-<account id>`, INR, their name), created on first use. */
export async function killBillAccount(db: Pool, killbill: KillBill, account: AccountRow): Promise<string> {
  if (account.kb_account_id) return account.kb_account_id;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ kb_account_id: string | null }>(
      "SELECT kb_account_id FROM accounts WHERE id = $1 FOR UPDATE",
      [account.id],
    );
    const known = rows[0]?.kb_account_id;
    const id = known ?? (await killbill.ensureAccount(`pakka-${account.id}`, account.name));
    if (!known) await client.query("UPDATE accounts SET kb_account_id = $2 WHERE id = $1", [account.id, id]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
