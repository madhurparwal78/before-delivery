import { requireRole } from "../auth.js";
import { config } from "../config.js";
import { one, pool, rows, tx } from "../db.js";
import { rateLimited } from "../http/errors.js";
import { ok, type Route } from "../http/router.js";
import { Fields, record } from "../http/validate.js";
import { queueMail } from "../services/mail.js";
import { formatTime, zoneToday } from "../../shared/format.js";

// Project enquiries (brief: Enquiries): validated, rate limited per address, stored, and mailed to every
// studio director (Reply-To the enquirer) with an acknowledgement to the enquirer.

const SECTORS = ["retail", "workplace", "food_beverage"] as const;
const SECTOR_LABEL = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };
const REGIONS = ["HK", "SG", "MO"] as const;
const REGION_LABEL = { HK: "Hong Kong", SG: "Singapore", MO: "Macao" };
const RATE_LIMIT = 3;

interface Enquiry {
  name: string;
  company: string;
  email: string;
  phone: string;
  sector: (typeof SECTORS)[number];
  region: (typeof REGIONS)[number];
  sites: number;
  openingMonth: string;
  message: string;
}

/**
 * Validates the enquiry, or only the fields of one form step (1 about you, 2 the rollout, 3 the message),
 * so the browser's steps report exactly the copy the final submission would.
 */
function validate(body: Record<string, unknown>, step: number | null): Enquiry {
  const fields = new Fields(body);
  const all = step === null;
  const enquiry: Enquiry = { name: "", company: "", email: "", phone: "", sector: "retail", region: "HK", sites: 0, openingMonth: "", message: "" };
  if (all || step === 1) {
    enquiry.name = fields.text("name", "Your name", { max: 120, oneLine: true });
    enquiry.company = fields.text("company", "Company", { max: 120, oneLine: true });
    enquiry.email = fields.email("email", "Email");
    enquiry.phone = fields.text("phone", "Phone", { min: 0, max: 30, oneLine: true });
  }
  if (all || step === 2) {
    enquiry.sector = fields.oneOf("sector", "Sector", SECTORS);
    enquiry.region = fields.oneOf("region", "Region", REGIONS);
    enquiry.sites = fields.integer("sites", "Number of sites", 1, 200);
    const month = body.openingMonth;
    if (month === undefined || month === null || month === "") fields.fail("openingMonth", "Target opening month is required.");
    else if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      fields.fail("openingMonth", "Target opening month must be a month like 2027-03.");
    } else if (month < zoneToday("Asia/Hong_Kong").slice(0, 7)) {
      fields.fail("openingMonth", "Target opening month can't be before this month.");
    } else enquiry.openingMonth = month;
  }
  if (all || step === 3) enquiry.message = fields.text("message", "Tell us about the rollout", { max: 2000 });
  fields.done();
  return enquiry;
}

export const routes: Route[] = [
  {
    method: "POST", path: "/api/enquiries", auth: "public",
    handler: async (ctx) => {
      const body = record(ctx.json());
      const step = body.validateOnly;
      if (step === 1 || step === 2 || step === 3) {
        validate(body, step);
        return ok({ valid: true });
      }
      const enquiry = validate(body, null);
      const emailKey = enquiry.email.trim().toLowerCase();
      const created = await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('enquiry-rate:' || $1))", [emailKey]);
        const recent = await rows<{ created_at: Date }>(client,
          `SELECT created_at FROM enquiries WHERE email_key = $1 AND created_at > clock_timestamp() - make_interval(secs => $2)
           ORDER BY created_at DESC LIMIT $3`, [emailKey, config.enquiryRateWindowSeconds, RATE_LIMIT]);
        if (recent.length >= RATE_LIMIT) {
          const oldest = recent[recent.length - 1].created_at.getTime();
          const retryAfterSeconds = Math.max(1, Math.ceil((oldest + config.enquiryRateWindowSeconds * 1000 - Date.now()) / 1000));
          throw rateLimited(retryAfterSeconds);
        }
        await client.query("LOCK TABLE enquiries IN SHARE ROW EXCLUSIVE MODE");
        const number = Number((await one<{ n: number }>(client, "SELECT coalesce(max(number), 0) + 1 AS n FROM enquiries"))?.n);
        const reference = `ENQ-${String(number).padStart(4, "0")}`;
        const saved = await one<{ created_at: Date }>(client,
          `INSERT INTO enquiries (number, reference, name, company, email, email_key, phone, sector, region, sites, opening_month, message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING created_at`,
          [number, reference, enquiry.name, enquiry.company, enquiry.email, emailKey, enquiry.phone, enquiry.sector, enquiry.region,
            enquiry.sites, enquiry.openingMonth, enquiry.message]);
        const details = [
          `Reference: ${reference}`, `Received: ${formatTime(saved?.created_at ?? new Date())}`, `Name: ${enquiry.name}`,
          `Company: ${enquiry.company}`, `Email: ${enquiry.email}`, `Phone: ${enquiry.phone || "not given"}`,
          `Sector: ${SECTOR_LABEL[enquiry.sector]}`, `Region: ${REGION_LABEL[enquiry.region]}`, `Number of sites: ${enquiry.sites}`,
          `Target opening month: ${enquiry.openingMonth}`, "", "Message:", enquiry.message,
        ].join("\n");
        const directors = await rows<{ email: string }>(client,
          "SELECT email FROM members WHERE role = 'director' AND status = 'active' ORDER BY email");
        for (const director of directors) {
          await queueMail(client, {
            to: director.email, replyTo: enquiry.email, subject: `New enquiry from ${enquiry.name} at ${enquiry.company}`,
            text: `A new project enquiry came in through the Marrow Hall Interiors website.\n\n${details}\n\nReply to this email to answer ${enquiry.name} directly.`,
          });
        }
        await queueMail(client, {
          to: enquiry.email, subject: "We've received your enquiry",
          text: `Dear ${enquiry.name},\n\nThank you for telling us about your rollout. Your enquiry ${reference} is with our studio, ` +
            `and a director will reply within two working days.\n\nYour message:\n${enquiry.message}\n\nMarrow Hall Interiors`,
        });
        return reference;
      });
      return ok({ enquiry: { reference: created } }, 201);
    },
  },
  {
    method: "GET", path: "/api/enquiries", auth: "member",
    handler: async (ctx) => {
      requireRole(ctx.me, "director");
      const list = await rows<Record<string, unknown> & { created_at: Date }>(pool,
        `SELECT reference, name, company, email, phone, sector, region, sites, opening_month, message, created_at
         FROM enquiries ORDER BY created_at DESC`);
      return ok({
        enquiries: list.map((e) => ({
          reference: e.reference, name: e.name, company: e.company, email: e.email, phone: e.phone, sector: e.sector, region: e.region,
          sites: e.sites, openingMonth: e.opening_month, message: e.message, receivedAt: e.created_at.toISOString(),
        })),
      });
    },
  },
];
