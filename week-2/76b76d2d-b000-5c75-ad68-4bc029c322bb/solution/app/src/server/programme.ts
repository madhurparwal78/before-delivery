import { AUDITORIUMS, FORMATS, type Locale } from "../shared/domain.ts";
import { findBookingWhere, refundLocked } from "./bookings.ts";
import { isUniqueViolation, one, query, transaction } from "./db.ts";
import { ApiError } from "./errors.ts";
import { requireBilling } from "./killbill.ts";
import { wakeOutbox } from "./outbox.ts";
import { liveHold, occupancy, seasonScreeningView, seasonScreenings } from "./screenings.ts";
import { addScreenings, allSeasons, checkTransition, findSeason, seasonState, seasonStats, seasonSummary, weeklyStarts, type SeasonRow } from "./seasons.ts";
import type { Session } from "./sessions.ts";
import { isValidDate } from "./time.ts";
import { Fields, SLUG } from "./validate.ts";

const NO_STATS = { first_at: null, last_at: null, count: 0 };

async function summaryOf(season: SeasonRow, locale: Locale, now: Date): Promise<Record<string, unknown>> {
  return seasonSummary(season, (await seasonStats([season.slug])).get(season.slug) ?? NO_STATS, locale, now);
}

/** A public season with its future screenings; drafts, archived and withdrawn seasons are not found. */
export async function publicSeason(slug: string, locale: Locale, now: Date): Promise<Record<string, unknown>> {
  const season = await findSeason(slug);
  const state = season ? seasonState(season, now) : "draft";
  if (!season || state === "draft" || state === "archived" || state === "withdrawn") throw new ApiError("not_found");
  const screenings = (await seasonScreenings(slug)).filter((s) => s.starts_at > now);
  const occupied = await occupancy(screenings.map((s) => s.id), now);
  return { season: { ...(await summaryOf(season, locale, now)), screenings: screenings.map((s) => seasonScreeningView(s, occupied.get(s.id) ?? { sold: new Set(), held: new Map() })) } };
}

export async function programmerSeasons(locale: Locale, now: Date): Promise<Record<string, unknown>> {
  const seasons = await allSeasons(locale, now);
  const out = [];
  for (const { season, summary } of seasons) {
    const screenings = await seasonScreenings(season.slug);
    const occupied = await occupancy(screenings.map((s) => s.id), now);
    out.push({ ...summary, screenings: screenings.map((s) => seasonScreeningView(s, occupied.get(s.id) ?? { sold: new Set(), held: new Map() })) });
  }
  return { seasons: out };
}

export async function createSeason(body: Record<string, unknown>, locale: Locale): Promise<Record<string, unknown>> {
  const fields = new Fields(body);
  const slug = fields.text("slug", 3, 40);
  if (slug && await findSeason(slug)) throw new ApiError("slug_taken");
  if (slug && !SLUG.test(slug)) fields.add("slug", { kind: "length", params: { min: 3, max: 40 } });
  const titleEn = fields.text("title_en", 1, 80);
  const titleFr = fields.text("title_fr", 1, 80);
  if (!isValidDate(body.public_sale_date)) fields.add("public_sale_date", { kind: "date" });
  fields.done();
  try {
    await query("INSERT INTO seasons (slug, title_en, title_fr, public_sale_date, lifecycle) VALUES ($1, $2, $3, $4, 'draft')", [slug, titleEn, titleFr, body.public_sale_date]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError("slug_taken");  // a simultaneous create took the slug first
    throw error;
  }
  const season = await findSeason(slug);
  if (!season) throw new Error("season vanished");
  return { season: await summaryOf(season, locale, new Date()) };
}

export async function addWeeklyScreenings(slug: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return transaction(async (tx) => {
    const season = await findSeason(slug, tx, true);
    if (!season) throw new ApiError("not_found");
    if (season.lifecycle === "archived" || season.lifecycle === "withdrawn") throw new ApiError("season_closed");
    const fields = new Fields(body);
    const film = fields.text("film_title", 1, 120);
    const format = fields.choice("format", FORMATS);
    const auditorium = fields.choice("auditorium", AUDITORIUMS);
    const weeks = fields.integer("weeks", 1, 26, { kind: "choice" });
    const first = typeof body.first_local === "string" ? body.first_local : "";
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/.exec(first);
    if (!match || !isValidDate(match[1])) fields.add("first_local", { kind: "date" });
    fields.done();
    return { screenings: await addScreenings(tx, slug, { film_title: film, format, auditorium, starts: weeklyStarts(first, weeks) }) };
  });
}

/** Ends live holds, refunds each paid booking one by one, then marks the season withdrawn. */
async function withdraw(season: SeasonRow, staff: Session, reason: string, now: Date): Promise<number> {
  await query(`UPDATE holds h SET ended_by = 'season' FROM screenings s WHERE s.id = h.screening_id AND s.season_slug = $1 AND ${liveHold("$2")}`, [season.slug, now]);
  const paid = await findBookingWhere("s.season_slug = $1 AND b.state = 'paid' ORDER BY b.paid_at", [season.slug]);
  for (const { ref } of paid) {
    await transaction(async (tx) => {
      const rows = await findBookingWhere("b.ref = $1 AND b.state = 'paid' FOR UPDATE OF b", [ref], tx);
      const row = rows[0];
      if (row) await refundLocked(tx, row, { actor: staff.account.email, reason, emailReason: { kind: "season", title: { en: season.title_en, fr: season.title_fr } } });
    });
    wakeOutbox();
  }
  return transaction(async (tx) => {
    const total = await one<{ n: number; cents: number }>(
      `SELECT count(*)::int AS n, COALESCE(sum(b.refunded_cents), 0)::int AS cents FROM bookings b JOIN screenings s ON s.id = b.screening_id
        WHERE s.season_slug = $1 AND b.refund_reason = 'season'`, [season.slug], tx,
    );
    await tx.query("UPDATE seasons SET lifecycle = 'withdrawn' WHERE slug = $1", [season.slug]);
    await tx.query("INSERT INTO audit_log (actor, action, target, amount_cents, reason) VALUES ($1, 'season-withdraw', $2, $3, $4)", [staff.account.email, season.slug, total?.cents ?? 0, reason]);
    return total?.n ?? 0;
  });
}

export async function transitionSeason(slug: string, body: Record<string, unknown>, staff: Session, locale: Locale): Promise<Record<string, unknown>> {
  const now = new Date();
  const season = await findSeason(slug);
  if (!season) throw new ApiError("not_found");
  const to = typeof body.to === "string" ? body.to : "";
  checkTransition(seasonState(season, now), to);
  let refunded = 0;
  if (to === "scheduled") {
    if (!(await seasonStats([slug])).get(slug)?.count) throw new ApiError("season_empty");
    await query("UPDATE seasons SET lifecycle = 'scheduled' WHERE slug = $1", [slug]);
  } else if (to === "archived") {
    if ((await seasonScreenings(slug)).some((s) => s.starts_at > now)) throw new ApiError("season_has_future_screenings");
    await query("UPDATE seasons SET lifecycle = 'archived' WHERE slug = $1", [slug]);
  } else {
    const fields = new Fields(body);
    const reason = fields.text("reason", 3, 500);
    fields.done();
    requireBilling();
    refunded = await withdraw(season, staff, reason, now);
  }
  const updated = await findSeason(slug);
  if (!updated) throw new Error("season vanished");
  return { season: await summaryOf(updated, locale, new Date()), refunded_bookings: refunded };
}
