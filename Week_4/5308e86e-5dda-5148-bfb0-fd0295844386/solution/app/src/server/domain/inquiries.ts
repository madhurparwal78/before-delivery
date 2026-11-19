/** Sales inquiries: typed and bounded validation, a honeypot, and a per-email rate limit counted one at a time. */
import { EMAIL_MAX, INQUIRY_MESSAGE_MAX, INQUIRY_NAME_MAX, INQUIRY_RATE_COUNT } from "../../shared/rules.js";
import { config } from "../config.js";
import { transaction } from "../db.js";
import { Fields, refusal } from "../http/errors.js";
import { codePointLength, hasRefusedCharacter, isEmailAddress } from "../http/text.js";
import { newId } from "../ids.js";

const SOURCES = ["contact", "sales"];

/** A honeypot counts as empty when absent, null, or blank text; any other value counts as filled. */
function honeypotFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim() !== "";
}

interface Inquiry {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  message: string;
  source: string;
}

/** Trimmed, NFC-normalised text measured in code points, or null with the field failed. */
function readText(value: unknown, field: string, kind: "single-line" | "multi-line", max: number, message: string, fields: Fields): string {
  if (typeof value !== "string") {
    fields.fail(field, message);
    return "";
  }
  const text = value.trim().normalize("NFC");
  const length = codePointLength(text);
  if (length < 1 || length > max || hasRefusedCharacter(text, kind)) fields.fail(field, message);
  return text;
}

function readInquiry(body: Record<string, unknown>): Inquiry {
  const fields = new Fields();
  let email = "";
  if (typeof body.email !== "string") fields.fail("email", "Enter a valid email");
  else {
    email = body.email.trim().toLowerCase().normalize("NFC");
    if (hasRefusedCharacter(email, "single-line") || !isEmailAddress(email, EMAIL_MAX)) fields.fail("email", "Enter a valid email");
  }
  const firstName = readText(body.first_name, "first_name", "single-line", INQUIRY_NAME_MAX, "Enter your first name", fields);
  const lastName = readText(body.last_name, "last_name", "single-line", INQUIRY_NAME_MAX, "Enter your last name", fields);
  const company = readText(body.company, "company", "single-line", INQUIRY_NAME_MAX, "Enter your company", fields);
  const message = readText(body.message, "message", "multi-line", INQUIRY_MESSAGE_MAX, "Enter a message", fields);
  const source = typeof body.source === "string" && SOURCES.includes(body.source) ? body.source : "";
  if (source === "") fields.fail("source", "Choose contact or sales");
  fields.raise();
  return { email, firstName, lastName, company, message, source };
}

export async function storeInquiry(body: Record<string, unknown>, now: Date): Promise<{ id: string; created_at: string }> {
  if (honeypotFilled(body.website)) return { id: newId(), created_at: now.toISOString() };
  const inquiry = readInquiry(body);
  const windowStart = new Date(now.getTime() - config.inquiryRateWindowSeconds * 1000);
  const stored = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`inquiry:${inquiry.email}`]);
    const recent = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM inquiries WHERE email = $1 AND created_at > $2", [inquiry.email, windowStart]);
    if ((recent.rows[0]?.n ?? 0) >= INQUIRY_RATE_COUNT) return null;
    const id = newId();
    await tx.query(
      "INSERT INTO inquiries (id, email, first_name, last_name, company, message, source, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, inquiry.email, inquiry.firstName, inquiry.lastName, inquiry.company, inquiry.message, inquiry.source, now],
    );
    return id;
  });
  if (stored === null) throw refusal(429, "rate_limited");
  return { id: stored, created_at: now.toISOString() };
}
