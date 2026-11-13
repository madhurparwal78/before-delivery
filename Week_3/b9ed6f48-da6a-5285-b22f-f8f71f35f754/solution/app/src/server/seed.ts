// Applies the seed idempotently on every start: missing records are created, existing ones are
// left alone (brief: Seed data). Seeded media objects are written to storage once it answers.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { locked, pool, rows } from "./db.js";
import { SEED_CHAPTERS, SEED_EVENTS, SEED_SOURCES } from "./seed-content.js";
import { plateImage } from "./plates.js";
import { objectExists, putObject } from "./storage.js";
import { addDays, lisbonDate, wallClockToInstant } from "../shared/lisbon.js";

const NARRATION_DIR = fileURLToPath(new URL("../../assets/narration/", import.meta.url));

const narrationId = (chapter: number) => `media-ch${chapter}-narration`;
const plateId = (chapter: number, index: number) => `media-ch${chapter}-plate-${index + 1}`;

/** 18:30 Lisbon, `days` after the Lisbon date of `now`. */
function eveningAfter(now: number, days: number): Date {
  const [year, month, day] = addDays(lisbonDate(now), days).split("-").map(Number);
  return new Date(wallClockToInstant({ year, month, day, hour: 18, minute: 30, second: 0 }) as number);
}

export async function seedDatabase(): Promise<void> {
  await locked("seed", async (db) => {
    for (const [id, citation] of SEED_SOURCES) {
      await db.query("INSERT INTO sources (id, n, citation) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING", [id, Number(id.slice(4)), citation]);
    }
    for (const c of SEED_CHAPTERS) {
      await db.query(
        `INSERT INTO chapters (id, number, numeral, title, era, sightline_deg, exhibit, body, status, owner_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9) ON CONFLICT (id) DO NOTHING`,
        [`chapter-${c.number}`, c.number, c.numeral, c.title, c.era, c.sightline, c.exhibit, c.body, c.owner],
      );
      await db.query(
        `INSERT INTO media (id, item_id, kind, filename, bytes, content_type, key, transcript, created_at)
         VALUES ($1, $2, 'narration', $3, 0, 'audio/mpeg', $4, $5, '2020-01-01') ON CONFLICT (id) DO NOTHING`,
        [narrationId(c.number), `chapter-${c.number}`, `chapter-${c.number}.mp3`, `media/${narrationId(c.number)}/chapter-${c.number}.mp3`, c.transcript],
      );
      for (const [index, caption] of c.plates.entries()) {
        const id = plateId(c.number, index);
        await db.query(
          `INSERT INTO media (id, item_id, kind, filename, bytes, content_type, key, caption, position, created_at)
           VALUES ($1, $2, 'image', $3, 0, 'image/png', $4, $5, $6, '2020-01-01') ON CONFLICT (id) DO NOTHING`,
          [id, `chapter-${c.number}`, `plate-${index + 1}.png`, `media/${id}/plate-${index + 1}.png`, caption, index + 1],
        );
      }
    }
    for (const e of SEED_EVENTS) {
      const owner = SEED_CHAPTERS[e.chapter - 1].owner;
      await db.query(
        `INSERT INTO events (id, chapter, year, title, summary, source_ids, status, owner_email)
         VALUES ($1, $2, $3, $4, $5, $6, 'published', $7) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.chapter, e.year, e.title, e.summary, e.sources, owner],
      );
    }
    const now = Date.now();
    const soon = new Date(Math.ceil((now + 20 * 60_000) / 60_000) * 60_000);
    const sessions: [string, string, Date, number, number][] = [
      ["ses-lovelace", "Lovelace's Notes, Read Aloud", eveningAfter(now, 3), 60, 12],
      ["ses-perceptron", "Inside the Perceptron", eveningAfter(now, 10), 60, 2],
      ["ses-rules", "Rules, Rooms and Reason", soon, 45, 10],
    ];
    for (const [id, title, starts, duration, capacity] of sessions) {
      await db.query("INSERT INTO guided_sessions (id, title, starts_at, duration_minutes, capacity) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING", [
        id,
        title,
        starts,
        duration,
        capacity,
      ]);
    }
  });
}

/** Writes any seeded plate or narration object that storage does not hold yet. */
export async function seedStorage(): Promise<void> {
  const seeded = await rows<{ id: string; key: string; item_id: string; kind: string; position: number }>(
    pool,
    "SELECT id, key, item_id, kind, position FROM media WHERE id LIKE 'media-ch%' ORDER BY id",
  );
  for (const media of seeded) {
    if (await objectExists(media.key)) continue;
    const chapter = Number(media.item_id.slice("chapter-".length));
    const body = media.kind === "narration" ? await readFile(`${NARRATION_DIR}chapter-${chapter}.mp3`) : plateImage(chapter, media.position - 1);
    await putObject(media.key, body, media.kind === "narration" ? "audio/mpeg" : "image/png");
    await pool.query("UPDATE media SET bytes = $2 WHERE id = $1", [media.id, body.length]);
  }
}
