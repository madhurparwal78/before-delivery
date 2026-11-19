import type pg from "pg";
import type { Category } from "../shared/api.js";
import { digest } from "./codes.js";
import { addDays, localMoment } from "./domain/time.js";
import { nameKey } from "./domain/validation.js";

interface SeedCoach {
  name: string;
  email: string;
  timeZone: string;
  accessCode: string;
}

interface SeedCohort {
  name: string;
  coach: SeedCoach;
  startOffset: number;
  published: boolean;
  priceCents: number;
  seats: number;
}

interface SeedEntry {
  night: number;
  title: string;
  text: string;
  recalled: number;
  wbtb: boolean;
  technique: "none" | "mild" | "ssild";
  minutes: number;
  shared: boolean;
  signs: [string, Category][];
}

const WREN: SeedCoach = { name: "Wren Aldana", email: "wren@saltmoon.example", timeZone: "America/Denver", accessCode: "coach-wren-4417" };
const TOBIAS: SeedCoach = { name: "Tobias Merrow", email: "tobias@saltmoon.example", timeZone: "Europe/Lisbon", accessCode: "coach-tobias-2290" };

const COHORTS: SeedCohort[] = [
  { name: "Autumn Lantern", coach: WREN, startOffset: -10, published: true, priceCents: 24000, seats: 12 },
  { name: "Harvest Moon", coach: WREN, startOffset: -3, published: true, priceCents: 24000, seats: 3 },
  { name: "Winter Owl", coach: WREN, startOffset: 14, published: true, priceCents: 18000, seats: 20 },
  { name: "Spring Draft", coach: WREN, startOffset: 40, published: false, priceCents: 20000, seats: 10 },
  { name: "Tidewatch", coach: TOBIAS, startOffset: -2, published: true, priceCents: 20000, seats: 8 },
];

const DREAMERS = [
  { name: "Mara Quist", email: "mara@dreamers.example", cohort: "Autumn Lantern", homeTz: "America/Chicago", bedtime: "23:00", accessCode: "dreamer-mara-3051" },
  { name: "Jun Ferreira", email: "jun@dreamers.example", cohort: "Autumn Lantern", homeTz: "Asia/Tokyo", bedtime: "22:30", accessCode: "dreamer-jun-7720" },
  { name: "Elodie Vance", email: "elodie@dreamers.example", cohort: "Harvest Moon", homeTz: "Europe/Berlin", bedtime: "23:30", accessCode: "dreamer-elodie-1186" },
  { name: "Sam Petrakis", email: "sam@dreamers.example", cohort: "Harvest Moon", homeTz: "America/New_York", bedtime: "22:45", accessCode: "dreamer-sam-5502" },
  { name: "Ines Calloway", email: "ines@dreamers.example", cohort: "Tidewatch", homeTz: "Europe/Lisbon", bedtime: "23:00", accessCode: "dreamer-ines-6634" },
];

const MARA_ENTRIES: SeedEntry[] = [
  { night: 2, title: "Folding staircase", text: "I was climbing a staircase that folded into the sea, and my teeth felt loose.", recalled: 1, wbtb: false, technique: "none", minutes: 0, shared: false, signs: [["folded into the sea", "form"], ["my teeth felt loose", "form"]] },
  { night: 3, title: "Grandmother's kitchen", text: "My grandmother was cooking in a kitchen on the roof of my old school.", recalled: 1, wbtb: false, technique: "none", minutes: 0, shared: false, signs: [["a kitchen on the roof of my old school", "context"]] },
  { night: 5, title: "Flying lesson", text: "I flew over the river with my arms out and felt completely calm.", recalled: 2, wbtb: false, technique: "none", minutes: 0, shared: false, signs: [["I flew over the river", "action"], ["felt completely calm", "inner_awareness"]] },
  { night: 9, title: "The blue door", text: "A blue door kept changing size each time I reached for it.", recalled: 1, wbtb: true, technique: "mild", minutes: 20, shared: true, signs: [["kept changing size", "form"]] },
  { night: 10, title: "No recall", text: "Woke at the alarm, nothing came back.", recalled: 0, wbtb: true, technique: "ssild", minutes: 15, shared: false, signs: [] },
];

/** Seeds the invented coaches, cohorts and dreamers once, into an empty database only. */
export async function seed(client: pg.PoolClient): Promise<void> {
  const existing = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM coaches");
  if ((existing.rows[0]?.count ?? 0) > 0) return;
  const now = new Date();
  const coachIds = new Map<SeedCoach, string>();
  for (const coach of [WREN, TOBIAS]) {
    const row = await client.query<{ id: string }>(
      "INSERT INTO coaches (name, email, time_zone, access_code_hash) VALUES ($1, $2, $3, $4) RETURNING id",
      [coach.name, coach.email, coach.timeZone, digest(coach.accessCode)],
    );
    coachIds.set(coach, row.rows[0]?.id ?? "");
  }
  const cohortStarts = new Map<string, { id: string; startsOn: string }>();
  for (const cohort of COHORTS) {
    const startsOn = addDays(localMoment(now, cohort.coach.timeZone).date, cohort.startOffset);
    const row = await client.query<{ id: string }>(
      `INSERT INTO cohorts (coach_id, name, name_key, starts_on, price_cents, seats, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [coachIds.get(cohort.coach), cohort.name, nameKey(cohort.name), startsOn, cohort.priceCents, cohort.seats, cohort.published],
    );
    cohortStarts.set(cohort.name, { id: row.rows[0]?.id ?? "", startsOn });
  }
  for (const dreamer of DREAMERS) {
    const cohort = cohortStarts.get(dreamer.cohort);
    if (!cohort) continue;
    const row = await client.query<{ id: string }>(
      `INSERT INTO enrollments (cohort_id, name, email, home_tz, bedtime, status, first_night, access_code_hash)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING id`,
      [cohort.id, dreamer.name, dreamer.email, dreamer.homeTz, dreamer.bedtime, cohort.startsOn, digest(dreamer.accessCode)],
    );
    if (dreamer.name === "Mara Quist") await seedEntries(client, row.rows[0]?.id ?? "", cohort.startsOn, dreamer.homeTz);
  }
}

async function seedEntries(client: pg.PoolClient, enrollmentId: string, firstNight: string, homeTz: string): Promise<void> {
  for (const entry of MARA_ENTRIES) {
    const nightKey = addDays(firstNight, entry.night - 1);
    const created = await client.query<{ id: string }>(
      `INSERT INTO entries (id, enrollment_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique,
         technique_minutes, late_recall, shared, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false, $6, $7, $8, false, $9,
         LEAST(($2::date + 1 + time '06:30') AT TIME ZONE $10, now()))
       RETURNING id`,
      [enrollmentId, nightKey, entry.title, entry.text, entry.recalled, entry.wbtb, entry.technique, entry.minutes, entry.shared, homeTz],
    );
    for (const [phrase, category] of entry.signs) {
      const start = entry.text.indexOf(phrase);
      await client.query(
        "INSERT INTO dream_signs (entry_id, start_offset, end_offset, phrase, category) VALUES ($1, $2, $3, $4, $5)",
        [created.rows[0]?.id, start, start + phrase.length, phrase, category],
      );
    }
  }
}
