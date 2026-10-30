// Newsletter signups and partner applications: once per trimmed, lower-cased email, even under races.
import { pool } from "../db.ts";
import { ApiError, assertValid, type Fields } from "../errors.ts";
import { now } from "../clock.ts";
import { normaliseEmail, safeText } from "../patterns.ts";

const SUBSCRIBED = "Thanks for subscribing.";
const PARTNER_KINDS = ["dealer", "wholesale", "affiliate"];

export async function subscribe(body: Record<string, unknown>): Promise<{ created: boolean; message: string }> {
  const fields: Fields = {};
  const email = normaliseEmail(body.email);
  if (!email) fields.email = "Enter a valid email.";
  if (body.consent !== true) fields.consent = "Please agree to the terms to sign up.";
  assertValid(fields);
  const { rowCount } = await pool.query(
    "INSERT INTO newsletter_signups (email_norm, created_at) VALUES ($1, $2) ON CONFLICT (email_norm) DO NOTHING",
    [email, now()],
  );
  return { created: rowCount === 1, message: SUBSCRIBED };
}

function website(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200 || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value)) return undefined;
  return value;
}

export async function applyAsPartner(body: Record<string, unknown>): Promise<{ id: number }> {
  const fields: Fields = {};
  const name = safeText(body.business_name) ?? "";
  if (name.length < 2 || name.length > 80) fields.business_name = "Enter your business name.";
  const email = normaliseEmail(body.email);
  if (!email) fields.email = "Enter a valid email.";
  if (typeof body.country !== "string" || !/^[A-Z]{2}$/.test(body.country)) fields.country = "Enter a two-letter country code.";
  if (typeof body.kind !== "string" || !PARTNER_KINDS.includes(body.kind)) fields.kind = "Choose a partner type.";
  const site = website(body.website);
  if (site === undefined) fields.website = "Enter a web address starting with http:// or https://.";
  assertValid(fields);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO partner_applications (email_norm, business_name, country, kind, website, created_at)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (email_norm) DO NOTHING RETURNING id`,
    [email, name, body.country, body.kind, site, now()],
  );
  if (!rows[0]) throw new ApiError("already_applied");
  return { id: rows[0].id };
}
