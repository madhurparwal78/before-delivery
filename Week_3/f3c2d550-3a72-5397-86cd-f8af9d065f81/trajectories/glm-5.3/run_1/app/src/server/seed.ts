// The seed: uploads each original to storage, confirms it, computes its swatch,
// then creates the reference and its search document. Runs only when the database
// has no references. Several copies starting together never seed twice.

import type { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computedSwatch, upright, displayCrop } from "./images.js";
import { insertReference, getReel, toIsoSecond } from "./repo.js";
import { s3, bucket, s3PutConfirmed, sha256 } from "./storage.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DEMO_STOPS } from "./demo.js";

export interface SeedReference {
  id: string; title: string; maker: string; year: number | null;
  materials: string[]; finish: string; colour_family: string;
  source_url: string | null; source_note: string | null; notes: string;
  tenths: [number, number, number]; captured_at: string; photoFile: string;
}

export const SEED_REFERENCES: SeedReference[] = [
  { id: "ref-desk-radio", title: "Desk radio", maker: "Braunfeld", year: 1971,
    materials: ["ABS", "aluminium"], finish: "Matte textured shell, brushed fascia",
    colour_family: "Grey", source_url: null, source_note: "Flea market, Ghent",
    notes: "The parting line runs under the fascia, out of sight.", tenths: [2360, 1520, 980],
    captured_at: "2025-03-14T10:20:00Z", photoFile: "demo-radio.jpg" },
  { id: "ref-pocket-calculator", title: "Pocket calculator", maker: "Orrin Electronics", year: 1977,
    materials: ["ABS", "two-shot PBT keycaps"], finish: "Satin",
    colour_family: "Black", source_url: null, source_note: "Charity shop, Leeds",
    notes: "Keycaps are two-shot PBT, so the legends never wear.", tenths: [1360, 780, 95],
    captured_at: "2025-04-02T15:05:00Z", photoFile: "demo-calculator.jpg" },
  { id: "ref-enamel-kettle", title: "Enamel kettle", maker: "Halvorsen Emalje", year: 1964,
    materials: ["Enamelled steel", "beech"], finish: "Gloss enamel",
    colour_family: "Orange", source_url: null, source_note: "Estate sale, Aarhus",
    notes: "Gloss enamel over a 0.8 mm steel shell; beech handle stays cool.", tenths: [2100, 1900, 1600],
    captured_at: "2025-05-19T09:40:00Z", photoFile: "demo-kettle.jpg" },
  { id: "ref-table-fan", title: "Table fan", maker: "Vellum Appliance Co.", year: 1958,
    materials: ["Steel", "Bakelite"], finish: "Baked enamel",
    colour_family: "Green", source_url: null, source_note: "Auction, Bristol",
    notes: "Baked enamel in deep green, chrome cage clips, no plastic.", tenths: [2850, 3400, 1700],
    captured_at: "2025-06-07T12:00:00Z", photoFile: "demo-radio.jpg" },
  { id: "ref-film-camera", title: "Film camera", maker: "Kestrel Optik", year: 1969,
    materials: ["Aluminium", "leatherette"], finish: "Satin chrome",
    colour_family: "Silver", source_url: null, source_note: "Camera fair, Utrecht",
    notes: "Satin chrome over a milled aluminium top plate.", tenths: [1380, 860, 620],
    captured_at: "2025-07-22T08:30:00Z", photoFile: "demo-radio.jpg" },
  { id: "ref-desk-lamp", title: "Desk lamp", maker: "Lumen & Pike", year: 1982,
    materials: ["Steel", "polycarbonate"], finish: "Powder coat, fine texture",
    colour_family: "Red", source_url: null, source_note: "Studio clear-out, Glasgow",
    notes: "Fine-texture powder coat hides casting marks.", tenths: [1500, 4200, 1500],
    captured_at: "2025-08-30T17:10:00Z", photoFile: "demo-calculator.jpg" },
  { id: "ref-wall-clock", title: "Wall clock", maker: "Hartwell Clocks", year: 1974,
    materials: ["Melamine", "glass"], finish: "Matte",
    colour_family: "White", source_url: null, source_note: "Flea market, Brussels",
    notes: "Matte melamine face; no parting line on the bezel.", tenths: [3000, 3000, 450],
    captured_at: "2025-10-11T11:45:00Z", photoFile: "demo-kettle.jpg" },
  { id: "ref-cassette-recorder", title: "Cassette recorder", maker: "Sondera", year: 1979,
    materials: ["ABS", "aluminium"], finish: "Brushed and anodised",
    colour_family: "Black", source_url: null, source_note: "Market stall, Lille",
    notes: "Brushed and clear-anodised deck plate over ABS.", tenths: [2600, 700, 1500],
    captured_at: "2026-01-09T14:00:00Z", photoFile: "demo-calculator.jpg" },
  { id: "ref-hair-dryer", title: "Hair dryer", maker: "Calloway Home", year: 1986,
    materials: ["ABS"], finish: "Gloss",
    colour_family: "Pink", source_url: null, source_note: "Charity shop, Leeds",
    notes: "High-gloss pink shell; the nozzle moulding is a single piece.", tenths: [2300, 2050, 820],
    captured_at: "2026-03-27T09:15:00Z", photoFile: "demo-calculator.jpg" },
  { id: "ref-electric-shaver", title: "Electric shaver", maker: "Brisk", year: 1991,
    materials: ["ABS", "TPE overmould"], finish: "Soft-touch",
    colour_family: "Blue", source_url: null, source_note: "Online auction",
    notes: "Soft-touch TPE overmould, matte to the finger.", tenths: [650, 1480, 420],
    captured_at: "2026-06-15T19:20:00Z", photoFile: "demo-radio.jpg" },
  { id: "ref-telephone-handset", title: "Telephone handset", maker: "Northline Telecom", year: 1983,
    materials: ["ABS"], finish: "Spark-eroded texture",
    colour_family: "Beige", source_url: null, source_note: "Office clearance, Manchester",
    notes: "Spark-eroded grained texture, deep beige, sun-proof pigment.", tenths: [2150, 640, 700],
    captured_at: "2026-09-04T10:05:00Z", photoFile: "demo-kettle.jpg" },
  { id: "ref-bead-blasted-kettle", title: "Bead-blasted kettle", maker: "Tamsin Metalworks", year: 2024,
    materials: ["Aluminium", "phenolic"], finish: "Bead-blasted, clear anodised",
    colour_family: "Silver", source_url: "https://tamsin-metalworks.example/kettle", source_note: null,
    notes: "Bead-blasted and clear anodised; the phenolic handle is pinned.", tenths: [2250, 2000, 1650],
    captured_at: "2026-11-03T10:00:00Z", photoFile: "demo-kettle.jpg" },
];

export const SEED_REELS = [
  { id: "reel-demo", name: "Demo reel", demo: true, stopIds: ["ref-desk-radio", "ref-pocket-calculator", "ref-enamel-kettle"] },
  { id: "reel-halden-kickoff", name: "Halden kickoff", demo: false, stopIds: [
    "ref-enamel-kettle", "ref-bead-blasted-kettle", "ref-pocket-calculator", "ref-desk-radio",
    "ref-table-fan", "ref-film-camera", "ref-desk-lamp", "ref-wall-clock",
    "ref-cassette-recorder", "ref-hair-dryer", "ref-electric-shaver", "ref-telephone-handset",
  ] },
];

export const SEED_PULLS = [
  { pull_day: "2026-10-31", reference_id: "ref-desk-radio" },
  { pull_day: "2026-11-01", reference_id: "ref-pocket-calculator" },
  { pull_day: "2026-11-02", reference_id: "ref-enamel-kettle" },
];

async function uploadOriginal(id: string, buf: Buffer, contentType: string) {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const key = `references/${id}/original.${ext}`;
  await s3PutConfirmed(key, buf, contentType);
  return key;
}

// Seed runs only when the database has no references, guarded by a Postgres
// advisory lock so several copies starting together never seed twice.
export async function seed(pool: Pool): Promise<void> {
  const existing = await pool.query(`SELECT count(*)::int AS n FROM "references"`);
  if (existing.rows[0].n > 0) return;
  const lock = await pool.query(`SELECT pg_try_advisory_lock(hashtext('stowdeck-seed')) AS locked`);
  if (!lock.rows[0].locked) return;
  try {
    const still = await pool.query(`SELECT count(*)::int AS n FROM "references"`);
    if (still.rows[0].n > 0) return;

    await pool.query(`INSERT INTO settings (singleton, home_history, pending_zone, unit)
      VALUES (true, $1::jsonb, NULL, 'mm')
      ON CONFLICT (singleton) DO NOTHING`,
      [JSON.stringify([{ zone: "Europe/London", effective_from: "2024-01-01T00:00:00Z" }])]);

    for (const r of SEED_REFERENCES) {
      const buf = readFileSync(join(process.cwd(), "assets", "photos", r.photoFile));
      const img = upright(buf);
      if (!img) throw new Error(`seed photo undecodable: ${r.photoFile}`);
      const contentType = buf.subarray(0, 8).toString("hex").startsWith("89504e47") ? "image/png" : "image/jpeg";
      const id = randomUUID();
      await uploadOriginal(id, buf, contentType);
      const swatch = computedSwatch(img);
      const reference = await insertReference(pool, {
        id, title: r.title, maker: r.maker, year: r.year, materials: r.materials,
        finish: r.finish, colour_family: r.colour_family, source_url: r.source_url,
        source_note: r.source_note, notes: r.notes,
        widthTenths: r.tenths[0], heightTenths: r.tenths[1], depthTenths: r.tenths[2],
        capturedAt: new Date(r.captured_at), photoContentType: contentType,
        photoBytes: buf.length, photoSha256: sha256(buf),
        photoWidth: img.width, photoHeight: img.height,
      }, swatch);
      const crop = displayCrop(img);
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: `references/${id}/display.jpg`, Body: crop, ContentType: "image/jpeg",
      }));
    }

    for (const reel of SEED_REELS) {
      await pool.query(
        `INSERT INTO reels (id, name, demo, version) VALUES ($1, $2, $3, 1)
         ON CONFLICT (id) DO NOTHING`, [reel.id, reel.name, reel.demo]);
      // Map the seed's fixed keys to the UUIDs created for the references.
      const refs = await pool.query<{ id: string }>(
        `SELECT id FROM "references" ORDER BY captured_at`);
      const seedOrder = SEED_REFERENCES.map((r) => r.title);
      const titleToId = new Map<string, string>();
      let i = 0;
      for (const row of refs.rows) {
        if (i < seedOrder.length) titleToId.set(seedOrder[i], row.id);
        i++;
      }
      const byTitle = new Map(SEED_REFERENCES.map((r) => [r.id, titleToId.get(r.title)]));
      let pos = 1;
      for (const stopId of reel.stopIds) {
        const mapped = byTitle.get(stopId) ?? stopId;
        await pool.query(
          `INSERT INTO reel_stops (reel_id, position, reference_id) VALUES ($1, $2, $3)`,
          [reel.id, pos++, mapped]);
      }
    }
    for (const pull of SEED_PULLS) {
      const refs = await pool.query<{ id: string }>(`SELECT id FROM "references" ORDER BY captured_at`);
      const seedOrder = SEED_REFERENCES.map((r) => r.title);
      const titleToId = new Map<string, string>();
      let i = 0;
      for (const row of refs.rows) {
        if (i < seedOrder.length) titleToId.set(seedOrder[i], row.id);
        i++;
      }
      const byTitle = new Map(SEED_REFERENCES.map((r) => [r.id, titleToId.get(r.title)]));
      await pool.query(
        `INSERT INTO daily_pulls (pull_day, reference_id) VALUES ($1, $2) ON CONFLICT (pull_day) DO NOTHING`,
        [pull.pull_day, byTitle.get(pull.reference_id) ?? pull.reference_id]);
    }
  } finally {
    await pool.query(`SELECT pg_advisory_unlock(hashtext('stowdeck-seed'))`);
  }
}
