// Brand clients' cast requests: step checks, the request itself and the booking desk notification.

import { exec, pool, rows, tx, type Db } from "../db.js";
import { publicRoute, json } from "../http.js";
import { EMAIL_COPY, FieldErrors, isoInstant, required } from "../errors.js";
import { enqueue } from "../mail.js";
import { asObject, newId, nextCounter, str, type Body } from "../util.js";
import { formatDate } from "../../shared/format.js";
import { isEmail, singleLine } from "../../shared/text.js";
import { OFFICES, isIsoDate, isOfficeId } from "../../shared/zones.js";

const DESKS = { toronto: "toronto-desk@vesperrowe.example", vancouver: "vancouver-desk@vesperrowe.example" };
const MAX_TALENT = 12;

const clean = (body: Body, key: string) => singleLine(str(body, key)).trim();

async function checkTalent(db: Db, body: Body, errors: FieldErrors): Promise<Array<{ id: string; slug: string; display_name: string }>> {
  const slugs = Array.isArray(body.talentSlugs) ? body.talentSlugs.filter((s): s is string => typeof s === "string") : [];
  if (!slugs.length) {
    errors.add("talentSlugs", "Add at least one talent to your tray.");
    return [];
  }
  if (slugs.length > MAX_TALENT) errors.add("talentSlugs", "Your tray holds up to 12 talent.");
  const found = await rows<{ id: string; slug: string; display_name: string; state: string }>(
    db, "SELECT id, slug, display_name, state FROM talent WHERE slug = ANY($1)", [slugs]);
  for (const slug of slugs) {
    const talent = found.find((t) => t.slug === slug);
    if (!talent || talent.state !== "active") {
      errors.add("talentSlugs", `${talent && talent.state === "withdrawn" ? talent.display_name : slug} is no longer available; remove them to continue.`);
    }
  }
  return slugs.map((slug) => found.find((t) => t.slug === slug)).filter((t) => t !== undefined);
}

function checkDetails(body: Body, errors: FieldErrors): void {
  if (!clean(body, "name")) errors.add("name", required("Your name"));
  if (!clean(body, "company")) errors.add("company", required("Company"));
  const email = clean(body, "email");
  if (!email) errors.add("email", required("Email"));
  else if (!isEmail(email)) errors.add("email", EMAIL_COPY);
  const office = clean(body, "office");
  if (!isOfficeId(office)) errors.add("office", required("Office"));
}

function checkJob(body: Body, errors: FieldErrors): void {
  const shootDate = str(body, "shootDate");
  if (!shootDate) errors.add("shootDate", required("Shoot date"));
  else if (!isIsoDate(shootDate)) errors.add("shootDate", "Enter the shoot date like 2027-04-20.");
  if (!str(body, "brief").trim()) errors.add("brief", required("Brief"));
}

publicRoute("POST", "/api/cast-requests/checks", async (ctx) => {
  const body = asObject(await ctx.json());
  const step = body.step;
  const draft = asObject(body.draft);
  const errors: FieldErrors = new FieldErrors();
  if (step === 1 || step === 4) await checkTalent(pool, draft, errors);
  if (step === 2 || step === 4) checkDetails(draft, errors);
  if (step === 3 || step === 4) checkJob(draft, errors);
  if (step !== 1 && step !== 2 && step !== 3 && step !== 4) errors.add("step", "Choose a step from 1 to 4.");
  errors.throwIfAny();
  return json(200, { ok: true });
});

publicRoute("POST", "/api/cast-requests", async (ctx) => {
  const body = asObject(await ctx.json());
  return ctx.idempotent("route:cast-requests", body, async () => {
    const errors: FieldErrors = new FieldErrors();
    const talent = await checkTalent(pool, body, errors);
    checkDetails(body, errors);
    checkJob(body, errors);
    errors.throwIfAny();
    const office = clean(body, "office");
    if (!isOfficeId(office)) errors.fail();
    const company = clean(body, "company");
    const name = clean(body, "name");
    const email = clean(body, "email");
    const shootDate = str(body, "shootDate");
    const brief = str(body, "brief").trim();
    return tx(async (client) => {
      const id = newId();
      const reference = `CR-${String(await nextCounter(client, "cast-request")).padStart(6, "0")}`;
      const receivedAt = new Date(Math.floor(ctx.now / 1000) * 1000);
      await exec(
        client,
        `INSERT INTO cast_requests (id, reference, name, company, email, office_id, shoot_date, brief, talent_slugs, received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, reference, name, company, email, office, shootDate, brief, talent.map((t) => t.slug), receivedAt],
      );
      await enqueue(client, {
        to: DESKS[office],
        subject: `Cast request from ${company}: ${talent.length} talent`,
        text: [
          `Cast request ${reference} for the ${OFFICES[office].city} desk.`,
          "",
          `From: ${name}, ${company}`,
          `Email: ${email}`,
          `Shoot date: ${formatDate(shootDate)}`,
          "",
          "Talent:",
          ...talent.map((t, i) => `${i + 1}. ${t.display_name}`),
          "",
          "Brief:",
          brief,
        ].join("\n"),
        talentIds: talent.map((t) => t.id),
      });
      return json(201, { id, reference, receivedAt: isoInstant(receivedAt) });
    });
  });
}, { rateLimit: "cast_requests" });
