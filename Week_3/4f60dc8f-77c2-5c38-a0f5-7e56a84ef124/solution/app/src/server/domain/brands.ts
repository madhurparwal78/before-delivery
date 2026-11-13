// Starting a project: the brand, its three contacts and a quoted engagement; and new engagements for a brand.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { one, transaction, type Db } from "../db.js";
import { ApiError, FIELD_COPY, FieldErrors } from "../errors.js";
import { isCurrency, type Currency } from "../../shared/money.js";
import { createSession } from "./sessions.js";
import { validEmail } from "./signin.js";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function projectTitle(errors: FieldErrors, value: unknown): string {
  const title = text(value);
  if (title.length < 1 || title.length > 120) errors.add("title", FIELD_COPY.title_project);
  return title;
}

async function createEngagement(db: Db, brandId: string, title: string): Promise<string> {
  const id = randomUUID();
  const next = await one<{ n: number }>(db, "SELECT nextval('engagement_reference')::int AS n");
  await db.query("INSERT INTO engagements (id, brand_id, reference, title, state) VALUES ($1, $2, $3, $4, 'quoted')", [id, brandId, `GW-${next?.n}`, title]);
  return id;
}

export type NewBrand = { name: string; currency: Currency; owner: { name: string; email: string }; finance: string; reviewer: string; title: string };

/** Inserts a brand with owner, finance and reviewer contacts and one quoted engagement; refuses emails any brand already holds. */
export async function insertBrand(client: pg.PoolClient, brand: NewBrand): Promise<{ brandId: string; engagementId: string }> {
  const emails = [...new Set([brand.owner.email, brand.finance, brand.reviewer].map((e) => e.toLowerCase()))].sort();
  for (const email of emails) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`contact:${email}`]);
  const taken = await one(client, "SELECT 1 FROM contacts WHERE lower(email) = ANY($1::text[]) LIMIT 1", [emails]);
  if (taken) throw new ApiError("email_taken");
  const brandId = randomUUID();
  await client.query("INSERT INTO brands (id, name, currency) VALUES ($1, $2, $3)", [brandId, brand.name, brand.currency]);
  const contacts: [string, string, string][] = [
    ["owner", brand.owner.name, brand.owner.email],
    ["finance", brand.owner.name, brand.finance],
    ["reviewer", brand.owner.name, brand.reviewer],
  ];
  for (const [role, name, email] of contacts) {
    await client.query("INSERT INTO contacts (id, brand_id, role, name, email) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), brandId, role, name, email]);
  }
  const engagementId = await createEngagement(client, brandId, brand.title);
  return { brandId, engagementId };
}

export async function startProject(body: Record<string, unknown>): Promise<{ engagementId: string; brandId: string; token: string }> {
  const errors = new FieldErrors();
  const name = text(body.brand_name);
  if (name.length < 1 || name.length > 80) errors.add("brand_name", FIELD_COPY.brand_name);
  const contactName = text(body.contact_name);
  if (contactName.length < 1 || contactName.length > 80) errors.add("contact_name", FIELD_COPY.contact_name);
  if (!validEmail(body.email)) errors.add("email", FIELD_COPY.email);
  const title = projectTitle(errors, body.title);
  if (!isCurrency(body.currency)) errors.add("currency", FIELD_COPY.currency_start);
  const financeGiven = body.finance_email !== undefined && body.finance_email !== null && body.finance_email !== "";
  if (financeGiven && !validEmail(body.finance_email)) errors.add("finance_email", FIELD_COPY.email);
  if (!validEmail(body.reviewer_email)) errors.add("reviewer_email", FIELD_COPY.email);
  const owner = text(body.email);
  const emailsValid = validEmail(body.email) && validEmail(body.reviewer_email) && (!financeGiven || validEmail(body.finance_email));
  return transaction(async (client) => {
    if (emailsValid) {
      const candidates = [owner, text(body.reviewer_email), ...(financeGiven ? [text(body.finance_email)] : [])].map((e) => e.toLowerCase());
      const taken = await one(client, "SELECT 1 FROM contacts WHERE lower(email) = ANY($1::text[]) LIMIT 1", [candidates]);
      if (taken) throw new ApiError("email_taken");
    }
    errors.throwIfAny();
    const currency = body.currency as Currency;
    const created = await insertBrand(client, {
      name,
      currency,
      owner: { name: contactName, email: owner },
      finance: financeGiven ? text(body.finance_email) : owner,
      reviewer: text(body.reviewer_email),
      title,
    });
    const token = await createSession(client, "client", created.brandId, owner);
    return { ...created, token };
  });
}

export async function newEngagement(brandId: string, body: Record<string, unknown>): Promise<string> {
  const errors = new FieldErrors();
  const title = projectTitle(errors, body.title);
  errors.throwIfAny();
  return transaction((client) => createEngagement(client, brandId, title));
}
