import type { DbStore } from "./db";
import { SCHEMA_SQL } from "./schema";
import { NIGHT_NUMBER, TABLE_VERSION_SEED, TOTAL_ROUNDS } from "../domain/constants";
import type { RoundStatus } from "../domain/types";

export interface SeedTeam {
  readonly id: number;
  readonly name: string;
  readonly email: string;
  readonly nights: readonly [number, number, number];
}

export const SEED_TEAMS: readonly SeedTeam[] = [
  { id: 1, name: "Tequila Mockingbird", email: "captain01@snug-league.test", nights: [51, 48, 53] },
  { id: 2, name: "Les Quizérables", email: "captain02@snug-league.test", nights: [50, 49, 50] },
  { id: 3, name: "Sherlock Ohms", email: "captain03@snug-league.test", nights: [47, 52, 46] },
  { id: 4, name: "The Quizzly Bears", email: "captain04@snug-league.test", nights: [45, 50, 50] },
  { id: 5, name: "The Mitochondriacs", email: "captain05@snug-league.test", nights: [44, 46, 48] },
  { id: 6, name: "Universally Challenged", email: "captain06@snug-league.test", nights: [43, 45, 44] },
  { id: 7, name: "Spelling Bees", email: "captain07@snug-league.test", nights: [41, 44, 43] },
  { id: 8, name: "Norfolk Enchants", email: "captain08@snug-league.test", nights: [40, 42, 41] },
  { id: 9, name: "Half Past Pints", email: "captain09@snug-league.test", nights: [38, 40, 41] },
  { id: 10, name: "The Lemon Tops", email: "captain10@snug-league.test", nights: [36, 39, 40] },
  { id: 11, name: "Dot's Lot", email: "captain11@snug-league.test", nights: [35, 37, 36] },
  { id: 12, name: "Bad Losers", email: "captain12@snug-league.test", nights: [30, 33, 31] },
];

export const SEED_ROUNDS: readonly { number: number; title: string; kind: "standard" | "picture" }[] = [
  { number: 1, title: "General Knowledge", kind: "standard" },
  { number: 2, title: "History", kind: "standard" },
  { number: 3, title: "Picture Round: Doorways", kind: "picture" },
  { number: 4, title: "Music", kind: "standard" },
  { number: 5, title: "Science and Nature", kind: "standard" },
  { number: 6, title: "Picture Round: Shop Fronts", kind: "picture" },
  { number: 7, title: "Sport", kind: "standard" },
  { number: 8, title: "Final Round: Local Knowledge", kind: "standard" },
];

export function deskCodeForTeam(teamId: number): string {
  return `CAP-${teamId.toString().padStart(2, "0")}`;
}

/** Applies the schema and the seed, idempotently, into the database the app is given. */
export async function applySchemaAndSeed(store: DbStore): Promise<void> {
  for (const statement of SCHEMA_SQL) {
    await store.query(statement);
  }
  await store.query(`INSERT INTO league_meta (key, value) VALUES ('league', 'Snug Thursday League') ON CONFLICT (key) DO NOTHING`);
  await store.query(`INSERT INTO league_meta (key, value) VALUES ('season', 'Autumn 2026') ON CONFLICT (key) DO NOTHING`);
  await store.query(`INSERT INTO league_meta (key, value) VALUES ('pub', 'The Snug, Little Brampton') ON CONFLICT (key) DO NOTHING`);
  await store.query(
    `INSERT INTO league_meta (key, value) VALUES ('night', $1) ON CONFLICT (key) DO NOTHING`,
    [NIGHT_NUMBER.toString()],
  );
  await store.query(
    `INSERT INTO league_meta (key, value) VALUES ('table_version', $1) ON CONFLICT (key) DO NOTHING`,
    [TABLE_VERSION_SEED.toString()],
  );
  await store.query(
    `INSERT INTO league_meta (key, value) VALUES ('last_published_round', '') ON CONFLICT (key) DO NOTHING`,
  );

  for (const team of SEED_TEAMS) {
    await store.query(
      `INSERT INTO teams (id, name, captain_email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [team.id, team.name, team.email],
    );
    for (let night = 1; night <= 3; night++) {
      const score = team.nights[night - 1]!;
      await store.query(
        `INSERT INTO published_scores (team_id, round, score) VALUES ($1, $2, $3) ON CONFLICT (team_id, round) DO NOTHING`,
        [team.id, -night, score],
      );
    }
  }

  for (const team of SEED_TEAMS) {
    await store.query(
      `INSERT INTO desk_codes (code, role, team_id) VALUES ($1, 'captain', $2) ON CONFLICT (code) DO NOTHING`,
      [deskCodeForTeam(team.id), team.id],
    );
  }
  await store.query(
    `INSERT INTO desk_codes (code, role, team_id) VALUES ('HOST-4417', 'quizmaster', NULL) ON CONFLICT (code) DO NOTHING`,
  );
  await store.query(
    `INSERT INTO desk_codes (code, role, team_id) VALUES ('MARK-2093', 'marker', NULL) ON CONFLICT (code) DO NOTHING`,
  );

  for (const round of SEED_ROUNDS) {
    await store.query(
      `INSERT INTO rounds (number, title, kind, status) VALUES ($1, $2, $3, 'drafted') ON CONFLICT (number) DO NOTHING`,
      [round.number, round.title, round.kind],
    );
  }
  await store.query(`DELETE FROM rounds WHERE number > ${TOTAL_ROUNDS}`);
}

export function seedStatus(): RoundStatus {
  return "drafted";
}
