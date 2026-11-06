import type pg from "pg";
import type { Locale, SeasonState } from "../shared/domain.ts";
import { ApiError } from "./errors.ts";
import { one, query, type Db } from "./db.ts";
import { addDays, isoToronto, torontoDate, torontoInstant, torontoLocal } from "./time.ts";

export type SeasonRow = { slug: string; title_en: string; title_fr: string; public_sale_date: string; lifecycle: "draft" | "scheduled" | "archived" | "withdrawn" };

/** Sale openings: 10:00 America/Toronto on the public sale date, and three calendar days earlier. */
export function saleOpenings(publicSaleDate: string): { priorityOpensAt: Date; publicOpensAt: Date } {
  return { priorityOpensAt: torontoInstant(addDays(publicSaleDate, -3), "10:00"), publicOpensAt: torontoInstant(publicSaleDate, "10:00") };
}

/** The season state machine: a scheduled season's state is derived from the time. */
export function seasonState(season: Pick<SeasonRow, "lifecycle" | "public_sale_date">, now: Date): SeasonState {
  if (season.lifecycle !== "scheduled") return season.lifecycle;
  const { priorityOpensAt, publicOpensAt } = saleOpenings(season.public_sale_date);
  if (now < priorityOpensAt) return "scheduled";
  return now < publicOpensAt ? "member-priority" : "on-sale";
}

const SEASON_COLUMNS = "slug, title_en, title_fr, to_char(public_sale_date, 'YYYY-MM-DD') AS public_sale_date, lifecycle";

type ScreeningStats = { first_at: Date | null; last_at: Date | null; count: number };

export function seasonSummary(season: SeasonRow, stats: ScreeningStats, locale: Locale, now: Date): Record<string, unknown> {
  const { priorityOpensAt, publicOpensAt } = saleOpenings(season.public_sale_date);
  return {
    slug: season.slug,
    title: locale === "en" ? season.title_en : season.title_fr,
    title_en: season.title_en,
    title_fr: season.title_fr,
    state: seasonState(season, now),
    public_sale_date: season.public_sale_date,
    priority_opens_at: isoToronto(priorityOpensAt),
    public_opens_at: isoToronto(publicOpensAt),
    first_date: stats.first_at ? torontoDate(stats.first_at) : null,
    last_date: stats.last_at ? torontoDate(stats.last_at) : null,
    screening_count: stats.count,
  };
}

export async function seasonStats(slugs: string[], db?: Db): Promise<Map<string, ScreeningStats>> {
  const rows = await query<{ season_slug: string } & ScreeningStats>(
    "SELECT season_slug, min(starts_at) AS first_at, max(starts_at) AS last_at, count(*)::int AS count FROM screenings WHERE season_slug = ANY($1) GROUP BY season_slug",
    [slugs], db,
  );
  return new Map(rows.map((row) => [row.season_slug, row]));
}

const NO_SCREENINGS: ScreeningStats = { first_at: null, last_at: null, count: 0 };

/** Seasons on the stage (scheduled, member-priority, on-sale) ordered by first screening date, then slug. */
export async function stageSeasons(locale: Locale, now: Date): Promise<Record<string, unknown>[]> {
  const seasons = await query<SeasonRow>(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE lifecycle = 'scheduled'`);
  const stats = await seasonStats(seasons.map((s) => s.slug));
  return seasons
    .map((season) => seasonSummary(season, stats.get(season.slug) ?? NO_SCREENINGS, locale, now))
    .sort((a, b) => String(a.first_date).localeCompare(String(b.first_date)) || String(a.slug).localeCompare(String(b.slug)));
}

export async function allSeasons(locale: Locale, now: Date): Promise<{ season: SeasonRow; summary: Record<string, unknown> }[]> {
  const seasons = await query<SeasonRow>(`SELECT ${SEASON_COLUMNS} FROM seasons ORDER BY created_at, slug`);
  const stats = await seasonStats(seasons.map((s) => s.slug));
  return seasons.map((season) => ({ season, summary: seasonSummary(season, stats.get(season.slug) ?? NO_SCREENINGS, locale, now) }));
}

export async function findSeason(slug: string, db?: Db, lock = false): Promise<SeasonRow | undefined> {
  return one<SeasonRow>(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE slug = $1${lock ? " FOR UPDATE" : ""}`, [slug], db);
}

/** Legal season transitions; every other request is `illegal_transition`. */
export function checkTransition(from: SeasonState, to: string): void {
  const legal = (from === "draft" && to === "scheduled") || (from === "on-sale" && to === "archived") || ((from === "scheduled" || from === "on-sale") && to === "withdrawn");
  if (!legal) throw new ApiError("illegal_transition", { from, to });
}

/**
 * Weekly screenings from one Toronto wall-clock start: occurrence n is `first_local` + 7·n calendar
 * days at the same wall-clock time (gap → one hour later, repeated hour → daylight-time occurrence).
 */
export function weeklyStarts(firstLocal: string, weeks: number): Date[] {
  const [date = "", time = ""] = firstLocal.split("T");
  return Array.from({ length: weeks }, (_, n) => torontoInstant(addDays(date, 7 * n), time));
}

export async function addScreenings(tx: pg.PoolClient, slug: string, input: { film_title: string; format: string; auditorium: string; starts: Date[] }): Promise<Record<string, string>[]> {
  const counter = await one<{ screenings_created: number }>(
    "UPDATE seasons SET screenings_created = screenings_created + $2 WHERE slug = $1 RETURNING screenings_created", [slug, input.starts.length], tx,
  );
  const first = (counter?.screenings_created ?? input.starts.length) - input.starts.length + 1;
  const created: Record<string, string>[] = [];
  for (const [index, startsAt] of input.starts.entries()) {
    const id = `${slug}-${first + index}`;
    await tx.query("INSERT INTO screenings (id, season_slug, film_title, format, auditorium, starts_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      id, slug, input.film_title, input.format, input.auditorium, startsAt,
    ]);
    created.push({ id, starts_local: torontoLocal(startsAt), starts_at: isoToronto(startsAt) });
  }
  return created;
}
