import { randomUUID } from "node:crypto";
import type { Ctx, Reply } from "../context.js";
import { one, query } from "../db.js";
import { putObject } from "../files.js";
import { notFound, tooLarge, unsupportedType, validation } from "../http.js";

const LICENCE_LIMIT = 5_000_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

/** A licence's type is judged by its first bytes, never its name or declared type. */
function sniff(data: Buffer): { ext: "pdf" | "png" | "jpg"; type: string } | undefined {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", type: "application/pdf" };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  return undefined;
}

export async function submitApplication(ctx: Ctx): Promise<Reply> {
  const form = ctx.form;
  const file = form?.files.get("licence");
  if (file && file.data.length > LICENCE_LIMIT) throw tooLarge();
  const kind = file ? sniff(file.data) : undefined;
  if (file && file.data.length > 0 && !kind) throw unsupportedType("Upload a PDF, PNG or JPEG.");
  const field = (name: string) => form?.fields.get(name)?.trim() ?? "";
  const business = field("business_name");
  const contact = field("contact_name");
  const email = field("email").toLowerCase();
  const province = field("province").toUpperCase();
  const fields: Record<string, string> = {};
  if (business.length < 2 || business.length > 120) fields.business_name = "Enter your business name.";
  if (contact.length < 2 || contact.length > 80) fields.contact_name = "Enter the contact's name.";
  if (!EMAIL.test(email)) fields.email = "Enter a valid email.";
  if (!PROVINCES.includes(province)) fields.province = "Pick a province or territory.";
  if (!kind) fields.licence = "Upload a PDF, PNG or JPEG.";
  if (!kind || !file || Object.keys(fields).length > 0) throw validation(fields);
  await query("SELECT 1");
  const id = randomUUID();
  const key = `licences/${id}/licence.${kind.ext}`;
  await putObject(key, file.data, kind.type);
  const [row] = await query<{ id: string; status: string; business_name: string; submitted_at: Date }>(
    `INSERT INTO applications (id, business_name, contact_name, email, province, status, licence_key, licence_type)
     VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7) RETURNING id, status, business_name, submitted_at`,
    [id, business, contact, email, province, key, kind.type],
  );
  return {
    status: 201,
    body: { application: { id: row.id, status: row.status, business_name: row.business_name, submitted_at: row.submitted_at.toISOString() } },
  };
}

export async function getApplication(ctx: Ctx): Promise<Reply> {
  const row = await one<{ id: string; status: string; business_name: string; submitted_at: Date }>(
    "SELECT id, status, business_name, submitted_at FROM applications WHERE id::text = $1",
    [ctx.params[0]],
  );
  if (!row) throw notFound();
  return {
    status: 200,
    body: { application: { id: row.id, status: row.status, business_name: row.business_name, submitted_at: row.submitted_at.toISOString() } },
  };
}
