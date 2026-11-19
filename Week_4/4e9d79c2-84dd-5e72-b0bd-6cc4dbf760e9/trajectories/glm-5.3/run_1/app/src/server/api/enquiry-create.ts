import type { Ctx } from "../app.js";
import { errors } from "../errors.js";
import { validOccasion, validJourneyType, validEmail, validTelephone, parseLocalDate, serverNowMinute, type PartyInput } from "../validation.js";
import { foldEmail, foldTelephone } from "../domain.js";
import { ukDateString } from "../uktime.js";
import { tx, newReference } from "../repo.js";

export interface EnquiryInput {
  raw: Record<string, unknown>;
  website: string;
  occasion: unknown;
  journeyType: unknown;
  stops: unknown[];
  party: PartyInput;
  name: string;
  email: string;
  telephone: string;
  language: string;
  details: string | null;
  depart: Record<string, unknown> | null;
  return: Record<string, unknown> | null;
  isTrap: boolean;
}

export interface CreateEnquiryResult {
  reference: string;
  receivedAt: Date;
  stored: boolean;
}

const MISSING = "Choose an hour and minutes.";

function fieldErrors(fields: Record<string, string>): never {
  throw errors.invalid(fields);
}

/** Both enquiry routes share these checks, per Business rules. */
export function validateEnquiry(input: EnquiryInput): {
  occasion: string;
  journeyType: string;
  stops: { text: string; checked: boolean }[];
  departAt: { date: string; time: string; instant: Date };
  returnAt: { date: string; time: string; instant: Date } | null;
  name: string;
  email: string;
  telephone: string;
  language: string;
  details: string | null;
} {
  const f: Record<string, string> = {};
  if (!validOccasion(input.occasion)) f.occasion = "Choose an occasion.";
  if (!validJourneyType(input.journeyType)) f.journeyType = "Choose a journey type.";
  const stops: { text: string; checked: boolean }[] = [];
  if (Array.isArray(input.stops)) {
    let i = 0;
    for (const s of input.stops) {
      if (!s || typeof s !== "object" || typeof (s as Record<string, unknown>).text !== "string" || ((s as Record<string, unknown>).text as string).trim() === "") {
        f.stops = i === 0 ? "Enter the pick-up address." : "Enter the destination.";
        break;
      }
      const o = s as Record<string, unknown>;
      stops.push({ text: String(o.text).trim(), checked: o.checked === true });
      i++;
    }
  }
  if (stops.length < 2) f.stops = stops.length === 0 ? "Enter the pick-up address." : "Enter the destination.";
  if (stops.length > 7) f.stops = "Enter between 2 and 7 stops.";
  if (!input.name) f.name = "Enter your name.";
  if (!validEmail(input.email)) f.email = "Enter a real email address.";
  if (!validTelephone(input.telephone)) f.telephone = "Enter a UK telephone number.";
  if (input.journeyType === "severalStops" && (input.details === null || input.details.trim() === "")) {
    f.details = "Describe the stops in up to 2,000 characters.";
  }
  if (input.details !== null && input.details.length > 2000) f.details = "Describe the stops in up to 2,000 characters.";
  const needsReturn = input.journeyType === "return" || input.journeyType === "sameDayReturn";
  let departAt: { date: string; time: string; instant: Date } | null = null;
  let returnAt: { date: string; time: string; instant: Date } | null = null;
  if (!input.depart || typeof input.depart !== "object") {
    f.departAt = "Enter a date as DD/MM/YYYY.";
  } else {
    const o = input.depart as Record<string, unknown>;
    if (typeof o.time === "string" && !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(o.time)) {
      throw errors.invalid({ departAt: MISSING });
    }
    try {
      const parsed = parseLocalDate(o, "departAt");
      departAt = parsed;
      if (needsReturn) {
        if (input.journeyType === "sameDayReturn") {
          returnAt = parsed;
        } else if (input.return && typeof input.return === "object") {
          const ro = input.return as Record<string, unknown>;
          if (typeof ro.time === "string" && !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(ro.time)) {
            throw errors.invalid({ returnAt: MISSING });
          }
          returnAt = parseLocalDate(ro, "returnAt");
        } else {
          f.returnAt = "Enter a date as DD/MM/YYYY.";
        }
      }
      if (returnAt && returnAt.instant.getTime() <= departAt.instant.getTime()) {
        f.returnAt = "The return has to be after the pick-up.";
      }
    } catch (e) {
      if (e && typeof e === "object" && "status" in e) throw e;
      f.departAt = f.departAt ?? "Enter a date as DD/MM/YYYY.";
    }
  }
  if (Object.keys(f).length) fieldErrors(f);
  const now = serverNowMinute();
  const today = ukDateString(now);
  const dep = departAt as { date: string; time: string; instant: Date };
  if (dep.date < today) {
    throw errors.invalid({ departAt: "That date has passed. Choose today or a later date." });
  }
  if (dep.date === today) {
    const nowMins = nowUKMinutes();
    const pickMins = Number(dep.time.slice(0, 2)) * 60 + Number(dep.time.slice(3, 5));
    // A time breaking both rules gets the minutes refusal first.
    if (pickMins < nowMins) throw errors.invalid({ departAt: "No more pick-ups today." });
    if (pickMins - nowMins < 30) throw errors.invalid({ departAt: "We need at least 30 minutes' notice for a pick-up." });
  }
  return {
    occasion: input.occasion as string,
    journeyType: input.journeyType as string,
    stops,
    departAt: dep,
    returnAt,
    name: input.name,
    email: input.email,
    telephone: input.telephone,
    language: input.language,
    details: input.details,
  };
}

function nowUKMinutes(): number {
  const now = serverNowMinute();
  const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return Number(o.slice(0, 2)) * 60 + Number(o.slice(3, 5));
}

export async function createEnquiryFromRequest(ctx: Ctx, deskId: string, input: EnquiryInput, publicRoute: boolean): Promise<CreateEnquiryResult> {
  // A filled trap field answers 201, stores nothing, counts nothing.
  if (input.isTrap) {
    return { reference: "CV-" + trapReference(), receivedAt: new Date(), stored: false };
  }
  const v = validateEnquiry(input);
  if (publicRoute) {
    await checkRateLimit(ctx, deskId, v.email);
  }
  const reference = await newReference(ctx.db, deskId);
  const customerId = await findOrCreateCustomer(ctx, deskId, v.name, v.email, v.telephone, v.language);
  await tx(ctx.db, async (client) => {
    await client.query(
      `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, details, people, large, medium, hand, wheelchairs, name, email, telephone, language, submitted_body, created_at, merged_references)
       VALUES ($1,$2,$3,$4,$5,'new',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'{}')`,
      [
        reference,
        deskId,
        customerId,
        reference,
        v.occasion,
        v.journeyType,
        v.departAt.date,
        v.departAt.time,
        v.departAt.instant,
        v.returnAt?.date ?? null,
        v.returnAt?.time ?? null,
        v.returnAt?.instant ?? null,
        v.details,
        input.party.people,
        input.party.large,
        input.party.medium,
        input.party.hand,
        input.party.wheelchairs,
        v.name,
        v.email,
        v.telephone,
        v.language,
        JSON.stringify(input.raw),
        new Date(),
      ]
    );
    let position = 0;
    for (const s of v.stops) {
      await client.query("INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,$2,$3,$4,$5,$6)", [
        "ST-" + reference + "-" + position,
        reference,
        deskId,
        position,
        s.text,
        s.checked,
      ]);
      position++;
    }
    if (publicRoute) {
      await client.query("INSERT INTO enquiry_rate_limit (desk_id, email_folded, created_at) VALUES ($1,$2,NOW())", [deskId, foldEmail(v.email)]);
    }
  });
  return { reference, receivedAt: new Date(), stored: true };
}

function trapReference(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function checkRateLimit(ctx: Ctx, deskId: string, email: string): Promise<void> {
  const folded = foldEmail(email);
  const windowSeconds = ctx.cfg.enquiryRateWindowSeconds;
  const r = await ctx.db.query(
    "SELECT created_at FROM enquiry_rate_limit WHERE desk_id=$1 AND email_folded=$2 AND created_at > NOW() - ($3 || ' seconds')::interval ORDER BY created_at",
    [deskId, folded, String(windowSeconds)]
  );
  if (r.rows.length >= 5) {
    const oldest = r.rows[0].created_at as Date;
    const retryAt = new Date(oldest.getTime() + windowSeconds * 1000);
    const o = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(retryAt);
    const minutes = Math.ceil((retryAt.getTime() - Date.now()) / 1000);
    throw errors.rateLimited(Math.max(1, minutes), `Try again after ${o}.`);
  }
}

export async function findOrCreateCustomer(ctx: Ctx, deskId: string, name: string, email: string, telephone: string, language: string): Promise<string | null> {
  const existing = await ctx.db.query<{ id: string }>(
    "SELECT id FROM customers WHERE desk_id=$1 AND ((email_folded IS NOT NULL AND email_folded=$2) OR (telephone_folded IS NOT NULL AND telephone_folded=$3)) LIMIT 1",
    [deskId, foldEmail(email), foldTelephone(telephone)]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = "CU-" + Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  await ctx.db.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, name, email, telephone, language, foldEmail(email), foldTelephone(telephone)]
  );
  return id;
}