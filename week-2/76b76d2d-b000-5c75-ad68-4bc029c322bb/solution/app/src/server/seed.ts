import type pg from "pg";
import { hashPassword } from "./passwords.ts";
import { addDays, torontoDate, torontoInstant } from "./time.ts";

const VENUES = [
  ["maison-halide", "Maison Halide", "1450 rue de la Pellicule, Montréal"],
  ["annexe-clark", "Annexe Clark", "62 rue Argentique, Montréal"],
] as const;

const AUDITORIUMS = [
  ["MH1", "maison-halide", "Salle Lumière", "A", "J", 14],
  ["MH2", "maison-halide", "Salle Nitrate", "A", "D", 6],
  ["AC1", "annexe-clark", "Studio Clark", "A", "F", 8],
] as const;

type SeedSeason = { slug: string; en: string; fr: string; sale: number; lifecycle: "scheduled" | "draft"; screenings: [string, string, string, number, string][] };

const SEASONS: SeedSeason[] = [
  { slug: "nitrate-nights", en: "Nitrate Nights", fr: "Nuits nitrate", sale: -10, lifecycle: "scheduled", screenings: [
    ["La Chambre ambre", "35mm", "MH2", 2, "19:00"], ["The Lantern Keeper", "35mm", "MH2", 4, "21:00"], ["Sel d'argent", "35mm", "MH1", 6, "19:00"]] },
  { slug: "cinema-direct", en: "Direct Cinema Québec", fr: "Cinéma direct québécois", sale: 2, lifecycle: "scheduled", screenings: [
    ["Rue des Érables, 1963", "16mm", "AC1", 3, "18:30"], ["Les Glaneurs du fleuve", "16mm", "AC1", 5, "20:00"]] },
  { slug: "winter-retrospective", en: "Winter Retrospective", fr: "Rétrospective d'hiver", sale: 30, lifecycle: "scheduled", screenings: [
    ["Neige sur Verdun", "DCP", "MH1", 40, "19:00"], ["The Long Thaw", "DCP", "MH1", 47, "19:00"]] },
  { slug: "spring-workshop", en: "Spring Workshop", fr: "Atelier du printemps", sale: 80, lifecycle: "draft", screenings: [
    ["Atelier lumière", "DCP", "AC1", 90, "19:00"]] },
];

const ACCOUNTS = [
  ["finance@halide.example", "Reel-Finance-2026!", "Noor Haddad", "finance", "fr"],
  ["door@halide.example", "Reel-Door-2026!", "Théo Gagnon", "door", "fr"],
  ["programmer@halide.example", "Reel-Programme-2026!", "Ines Laurin", "programmer", "en"],
  ["elise@patrons.example", "Patron-Elise-2026!", "Élise Tremblay", "patron", "fr"],
  ["marcus@patrons.example", "Patron-Marcus-2026!", "Marcus Bell", "patron", "en"],
] as const;

/** The published seed, written on an empty database; D is today's Toronto date. */
export async function seed(tx: pg.PoolClient): Promise<void> {
  const today = torontoDate(new Date());
  for (const venue of VENUES) await tx.query("INSERT INTO venues (id, name, address) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [...venue]);
  for (const auditorium of AUDITORIUMS) {
    await tx.query("INSERT INTO auditoriums (code, venue_id, name, first_row, last_row, seats_per_row) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING", [...auditorium]);
  }
  for (const season of SEASONS) {
    await tx.query(
      "INSERT INTO seasons (slug, title_en, title_fr, public_sale_date, lifecycle, screenings_created) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
      [season.slug, season.en, season.fr, addDays(today, season.sale), season.lifecycle, season.screenings.length],
    );
    for (const [index, [film, format, auditorium, day, time]] of season.screenings.entries()) {
      await tx.query("INSERT INTO screenings (id, season_slug, film_title, format, auditorium, starts_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING", [
        `${season.slug}-${index + 1}`, season.slug, film, format, auditorium, torontoInstant(addDays(today, day), time),
      ]);
    }
  }
  for (const [email, password, name, role, locale] of ACCOUNTS) {
    const number = role === "patron" ? `A-${(await tx.query("SELECT nextval('account_number_seq') AS n")).rows[0].n}` : null;
    await tx.query("INSERT INTO accounts (number, email, name, password_hash, role, locale) VALUES ($1, $2, $3, $4, $5, $6)", [
      number, email, name, await hashPassword(password), role, locale,
    ]);
  }
}
