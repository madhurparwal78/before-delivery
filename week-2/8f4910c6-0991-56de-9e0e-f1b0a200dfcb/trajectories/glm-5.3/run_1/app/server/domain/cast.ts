import { query, one, withTransaction } from "../db.js";
import { errors } from "../http/errors.js";
import { randomToken, OFFICES, OFFICE_META } from "../../shared/domain.js";
import { toInstant } from "../../shared/instants.js";
import { queueEmail } from "./outbox.js";

/** Cast requests from brand clients, with idempotency by key. */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function cleanSingleLine(value: string): string {
  return value.replace(CONTROL_CHARS, " ").trim();
}

export interface CastRequestInput {
  name: string;
  company: string;
  email: string;
  office: string;
  shootDate: string | null;
  brief: string;
  talentSlugs: string[];
}

const STEP_FIELDS: Record<number, string[]> = {
  1: ["talentSlugs"],
  2: ["name", "company", "email"],
  3: ["office", "shootDate"],
  4: ["brief"],
};

export function validateCastStep(step: number, draft: Partial<CastRequestInput>): Record<string, string> {
  const errs: Record<string, string> = {};
  const fields = STEP_FIELDS[step] || [];
  const check = (field: string) => fields.includes(field) || step === 4;
  if (check("name") && draft.name !== undefined && !draft.name?.trim()) errs.name = "Enter your name.";
  if (check("company") && draft.company !== undefined && !draft.company?.trim()) errs.company = "Enter your company.";
  if (check("email") && draft.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email || "")) errs.email = "Enter an email address like name@example.com.";
  if (check("office") && draft.office !== undefined && !(OFFICES as readonly string[]).includes(draft.office)) errs.office = "Choose an office.";
  if (check("talentSlugs") && draft.talentSlugs !== undefined) {
    if (draft.talentSlugs.length === 0) errs.talentSlugs = "Add at least one talent to your tray.";
    if (draft.talentSlugs.length > 12) errs.talentSlugs = "Your tray holds up to 12 talent.";
  }
  if (check("shootDate") && draft.shootDate !== undefined && draft.shootDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.shootDate)) errs.shootDate = "Enter a date like 2027-04-20.";
  if (check("brief") && draft.brief !== undefined && !draft.brief?.trim()) errs.brief = "Enter the brief.";
  return errs;
}

export function validateCastRequest(input: CastRequestInput, activeSlugs: Set<string>): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!input.name?.trim()) errs.name = "Enter your name.";
  if (!input.company?.trim()) errs.company = "Enter your company.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email || "")) errs.email = "Enter an email address like name@example.com.";
  if (!(OFFICES as readonly string[]).includes(input.office)) errs.office = "Choose an office.";
  if (!input.brief?.trim()) errs.brief = "Enter the brief.";
  if (input.talentSlugs.length < 1 || input.talentSlugs.length > 12) errs.talentSlugs = "Your tray holds up to 12 talent.";
  else {
    for (const slug of input.talentSlugs) {
      if (!activeSlugs.has(slug)) {
        errs.talentSlugs = "Talent in your tray are no longer available; remove them to continue.";
        break;
      }
    }
  }
  return errs;
}

export async function createCastRequest(input: CastRequestInput): Promise<{ id: string; reference: string; receivedAt: string }> {
  const slugs = await query<{ slug: string }>(`SELECT slug FROM talent WHERE state = 'active' AND lower(slug) = ANY($1::text[])`, [input.talentSlugs.map((s) => s.toLowerCase())]);
  const activeSlugs = new Set(slugs.map((s) => s.slug));
  const errs = validateCastRequest(input, activeSlugs);
  if (Object.keys(errs).length > 0) throw errors.validation(errs);
  const id = `cr_${randomToken(12)}`;
  return withTransaction(async (tx) => {
    await tx.query(`INSERT INTO counters (name, value) VALUES ('cast_request_reference', 0) ON CONFLICT DO NOTHING`);
    const counter = await tx.one<{ value: number }>(`UPDATE counters SET value = value + 1 WHERE name = 'cast_request_reference' RETURNING value`);
    const reference = `CR-${String(counter?.value || 1).padStart(6, "0")}`;
    const receivedAt = new Date();
    await tx.query(
      `INSERT INTO cast_requests (id, reference, name, company, email, office, shoot_date, brief, talent_ids, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, reference, cleanSingleLine(input.name), cleanSingleLine(input.company), cleanSingleLine(input.email), input.office, input.shootDate, input.brief, [...activeSlugs], receivedAt]
    );
    const desk = OFFICE_META[input.office as "toronto" | "vancouver"].desk;
    const body = [
      `A brand client has sent a cast request.`,
      ``,
      `Reference: ${reference}`,
      `Client: ${cleanSingleLine(input.name)} (${cleanSingleLine(input.company)})`,
      `Email: ${cleanSingleLine(input.email)}`,
      `Office: ${OFFICE_META[input.office as "toronto" | "vancouver"].city}`,
      input.shootDate ? `Shoot date: ${input.shootDate}` : `Shoot date: not given`,
      `Talent: ${[...activeSlugs].join(", ")}`,
      ``,
      `Brief:`,
      input.brief,
    ].join("\r\n");
    await queueEmail({
      to: desk,
      subject: `Cast request from ${cleanSingleLine(input.company)}: ${[...activeSlugs].length} talent`,
      body,
    });
    return { id, reference, receivedAt: toInstant(receivedAt) };
  });
}

export async function listCastRequests(): Promise<unknown> {
  const rows = await query<{ id: string; reference: string; name: string; company: string; email: string; office: string; received_at: Date }>(
    `SELECT id, reference, name, company, email, office, received_at FROM cast_requests ORDER BY received_at DESC`
  );
  return rows.map((r) => ({ id: r.id, reference: r.reference, name: r.name, company: r.company, email: r.email, office: r.office, receivedAt: toInstant(r.received_at) }));
}

export async function findCastRequest(id: string): Promise<{ id: string; reference: string } | null> {
  return one<{ id: string; reference: string }>(`SELECT id, reference FROM cast_requests WHERE id = $1`, [id]);
}
