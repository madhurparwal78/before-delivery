/** Recipients: bank details are write-only, duplicates are refused, and removal keeps history. */
import { createHash } from "node:crypto";
import { DISPLAY_NAME_MAX, EMAIL_MAX, PAYMENT_METHODS } from "../../shared/rules.js";
import { isUniqueViolation, query, transaction, type Tx } from "../db.js";
import { Fields, notFound, refusal } from "../http/errors.js";
import type { SessionUser } from "../http/context.js";
import { codePointLength, hasRefusedCharacter, isEmailAddress } from "../http/text.js";
import { isId, newId } from "../ids.js";
import { normalizeEmail } from "./auth.js";

import type { Row } from "./row.js";

export interface RecipientView {
  id: string;
  display_name: string;
  kind: "person" | "business" | null;
  method: string | null;
  status: "active" | "pending";
  account_last4: string | null;
  email: string | null;
}

export function recipientView(row: Row): RecipientView {
  return {
    id: row.id,
    display_name: row.display_name,
    kind: row.kind,
    method: row.method,
    status: row.status,
    account_last4: row.account_last4,
    email: row.email,
  };
}

export async function listRecipients(tx: Tx, companyId: string): Promise<RecipientView[]> {
  const found = await tx.query("SELECT * FROM recipients WHERE company_id = $1 AND status <> 'removed' ORDER BY created_at, id", [companyId]);
  return found.rows.map(recipientView);
}

export async function getRecipient(tx: Tx, companyId: string, id: unknown): Promise<RecipientView> {
  if (!isId(id)) throw notFound();
  const found = await tx.query("SELECT * FROM recipients WHERE id = $1 AND company_id = $2 AND status <> 'removed'", [id, companyId]);
  if (!found.rows[0]) throw notFound();
  return recipientView(found.rows[0]);
}

/** A recipient a send may name. Shared-locked, so a removal and a send are applied one at a time. */
export async function findRecipientForSend(tx: Tx, companyId: string, id: unknown): Promise<Row> {
  if (!isId(id)) throw notFound();
  const found = await tx.query("SELECT * FROM recipients WHERE id = $1 AND company_id = $2 FOR SHARE", [id, companyId]);
  const row = found.rows[0];
  if (!row || row.status === "removed") throw notFound();
  return row;
}

const DIGITS = /^[0-9]+$/;

function abaChecksumHolds(routing: string): boolean {
  const digit = (index: number) => routing.charCodeAt(index) - 48;
  const sum =
    3 * (digit(0) + digit(3) + digit(6)) + 7 * (digit(1) + digit(4) + digit(7)) + (digit(2) + digit(5) + digit(8));
  return sum % 10 === 0;
}

interface RecipientInput {
  displayName: string;
  kind: "person" | "business";
  method: string;
  accountNumber: string;
  routingNumber: string;
}

function readRecipient(body: Record<string, unknown>): RecipientInput {
  const fields = new Fields();
  let displayName = "";
  if (typeof body.display_name !== "string") fields.fail("display_name", "Enter a name of up to 120 characters");
  else {
    displayName = body.display_name.trim();
    const length = codePointLength(displayName);
    if (hasRefusedCharacter(displayName, "single-line")) fields.fail("display_name", "Remove control or direction characters from this name");
    else if (length < 1 || length > DISPLAY_NAME_MAX) fields.fail("display_name", "Enter a name of up to 120 characters");
  }
  const kind = body.kind === "person" || body.kind === "business" ? body.kind : null;
  if (!kind) fields.fail("kind", "Choose Business or Person");
  const method = PAYMENT_METHODS.find((candidate) => candidate === body.method);
  if (!method) fields.fail("method", "Choose ACH, wire, real-time or check");
  const account = body.account_number;
  if (typeof account !== "string" || !DIGITS.test(account) || account.length < 4 || account.length > 17) fields.fail("account_number", "Enter 4 to 17 digits");
  const routing = body.routing_number;
  if (typeof routing !== "string" || !DIGITS.test(routing) || routing.length !== 9 || !abaChecksumHolds(routing)) {
    fields.fail("routing_number", "Enter a valid 9-digit routing number");
  }
  fields.raise();
  return { displayName, kind: kind as "person" | "business", method: method as string, accountNumber: account as string, routingNumber: routing as string };
}

function fingerprint(routing: string, account: string): string {
  return createHash("sha256").update(`${routing}:${account}`).digest("hex");
}

async function duplicate(companyId: string, column: "bank_fingerprint" | "email", value: string) {
  const found = await query(`SELECT id, display_name FROM recipients WHERE company_id = $1 AND ${column} = $2 AND status IN ('active', 'pending') ORDER BY created_at LIMIT 1`, [companyId, value]);
  const row = found.rows[0];
  return refusal(409, "duplicate_recipient", { recipient_id: row?.id ?? null, display_name: row?.display_name ?? null });
}

export async function saveRecipient(user: SessionUser, body: Record<string, unknown>, now: Date): Promise<RecipientView> {
  const input = readRecipient(body);
  const print = fingerprint(input.routingNumber, input.accountNumber);
  try {
    return await transaction(async (tx) => {
      const id = newId();
      const inserted = await tx.query(
        `INSERT INTO recipients (id, company_id, kind, method, display_name, status, account_last4, bank_fingerprint, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8) RETURNING *`,
        [id, user.companyId, input.kind, input.method, input.displayName, input.accountNumber.slice(-4), print, now],
      );
      return recipientView(inserted.rows[0]);
    });
  } catch (error) {
    if (isUniqueViolation(error, "recipients_active_bank")) throw await duplicate(user.companyId, "bank_fingerprint", print);
    throw error;
  }
}

export async function inviteRecipient(user: SessionUser, body: Record<string, unknown>, now: Date): Promise<{ invite_id: string; recipient: RecipientView }> {
  const fields = new Fields();
  let email = "";
  if (typeof body.email !== "string") fields.fail("email", "Enter a valid email");
  else {
    email = normalizeEmail(body.email);
    if (hasRefusedCharacter(email, "single-line") || !isEmailAddress(email, EMAIL_MAX)) fields.fail("email", "Enter a valid email");
  }
  fields.raise();
  try {
    return await transaction(async (tx) => {
      const id = newId();
      const inserted = await tx.query(
        `INSERT INTO recipients (id, company_id, display_name, status, email, created_at)
         VALUES ($1, $2, $3, 'pending', $3, $4) RETURNING *`,
        [id, user.companyId, email, now],
      );
      return { invite_id: id, recipient: recipientView(inserted.rows[0]) };
    });
  } catch (error) {
    if (isUniqueViolation(error, "recipients_pending_email")) throw await duplicate(user.companyId, "email", email);
    throw error;
  }
}
