// Schema and seed data, applied idempotently on every start. Records the operator changed or withdrew
// are never recreated: each seed row is inserted only when its key is absent.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { SCHEMA, withStartupLock } from "./db.js";
import { receiptLetter } from "./letters.js";
import { queueMail } from "./mail.js";
import { MONTH_STATE_VIEW } from "./routes/months.js";
import { stemKey } from "./routes/projects.js";
import { hashPassword } from "./routes/session.js";
import { putObject } from "./storage.js";
import { synthesizeStem, type Voice } from "./synth.js";
import { LAYERS } from "../shared/credits.js";
import { addMonths, monthKeyAt } from "../shared/dates.js";

const OPERATOR = { email: "operator@kettlehole.example", password: "ladder-console-2026" };
const TIME_ZONE = "America/Toronto";

interface SeedProject {
  position: number;
  slug: string;
  title: string;
  creditType: "shipped" | "jam" | "redesign";
  creditLine: string;
  role: string;
  visibility: "public" | "nda";
  status: "published" | "draft";
  thresholds: [number, number, number];
  tags: string[];
  blurb: string;
  voice: Voice;
}

const PROJECTS: SeedProject[] = [
  {
    position: 1, slug: "salt-flats-chase", title: "Salt Flats Chase", creditType: "shipped",
    creditLine: "Ferrous Run, Brackwater Games, 2025", role: "Composer and audio implementer",
    visibility: "public", status: "published", thresholds: [25, 50, 75], tags: ["chase", "synth", "adaptive"],
    blurb: "A pursuit across white salt at noon. The score tracks distance to the rival car, so the lead only arrives once you can see their tail lights.",
    voice: { root: 55, beats: 16, melody: [0, 3, 7, 10, 12, 10, 7, 5], seed: 11 },
  },
  {
    position: 2, slug: "lantern-moth", title: "Lantern Moth", creditType: "jam",
    creditLine: "48-hour jam build, 2026", role: "Solo audio",
    visibility: "public", status: "published", thresholds: [20, 45, 80], tags: ["ambient", "jam"],
    blurb: "A moth follows the last lit window in a sleeping village. Built in two days around one breathing pad that opens as the light gets closer.",
    voice: { root: 65.41, beats: 8, melody: [0, 2, 4, 7, 9, 7, 4, 2], seed: 23 },
  },
  {
    position: 3, slug: "dredge-yard", title: "Dredge Yard", creditType: "redesign",
    creditLine: "Audio redesign of a public gameplay capture", role: "Sound designer",
    visibility: "public", status: "published", thresholds: [25, 50, 75], tags: ["industrial", "redesign"],
    blurb: "Cranes, chain and wet steel, rebuilt from silence over someone else's footage. Every hit in the yard is placed by hand.",
    voice: { root: 49, beats: 12, melody: [0, 1, 5, 6, 0, 8, 6, 1], seed: 37 },
  },
  {
    position: 4, slug: "glasshouse", title: "Glasshouse", creditType: "shipped",
    creditLine: "Adaptive score for an unannounced title", role: "Composer",
    visibility: "nda", status: "published", thresholds: [30, 55, 85], tags: ["orchestral"],
    blurb: "Strings under glass for a game that has not been announced. Shared only through private listening links.",
    voice: { root: 73.42, beats: 8, melody: [0, 4, 7, 11, 12, 11, 7, 4], seed: 41 },
  },
  {
    position: 5, slug: "kiln-interior", title: "Kiln Interior", creditType: "redesign",
    creditLine: "Work in progress", role: "Sound designer",
    visibility: "public", status: "draft", thresholds: [25, 50, 75], tags: [],
    blurb: "The roar and tick of a brick kiln cooling overnight, still being shaped.",
    voice: { root: 41.2, beats: 8, melody: [0, 5, 7, 5], seed: 53 },
  },
];

async function seedRecords(client: PoolClient): Promise<void> {
  await client.query(SCHEMA);
  await client.query(MONTH_STATE_VIEW);
  await client.query("INSERT INTO operators (email, password_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [OPERATOR.email, hashPassword(OPERATOR.password)]);
  await client.query("INSERT INTO settings (id, time_zone, operator_email) VALUES (1, $1, $2) ON CONFLICT DO NOTHING",
    [TIME_ZONE, OPERATOR.email]);
  for (const p of PROJECTS) {
    await client.query(
      `INSERT INTO projects (id, slug, title, credit_type, credit_line, role, blurb, tags, visibility, position,
         threshold_pulse, threshold_lead, threshold_stinger, status, seeded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true) ON CONFLICT (slug) DO NOTHING`,
      [randomUUID(), p.slug, p.title, p.creditType, p.creditLine, p.role, p.blurb, p.tags, p.visibility, p.position,
        ...p.thresholds, p.status],
    );
  }
  await client.query(
    `INSERT INTO listening_links (id, project_id, label, token, expires_at)
     SELECT $1, id, 'Seed preview', 'glasshouse-seed-preview', '2030-01-01T00:00:00.000Z' FROM projects
     WHERE slug = 'glasshouse' AND seeded ON CONFLICT (token) DO NOTHING`,
    [randomUUID()],
  );
  const marked = await client.query("INSERT INTO seed_marks (mark) VALUES ('months') ON CONFLICT DO NOTHING RETURNING mark");
  if (marked.rowCount) {
    const current = monthKeyAt(new Date(), TIME_ZONE);
    for (let i = 1; i <= 6; i += 1) {
      await client.query("INSERT INTO production_months (month, capacity) VALUES ($1, 2) ON CONFLICT DO NOTHING", [addMonths(current, i)]);
    }
  }
  const enquiryId = randomUUID();
  const seeded = await client.query(
    `INSERT INTO enquiries (id, reference_number, name, email, studio, brief, sender_ip, pacing_policy, triage_notes, fit_score, rate_floor_cents)
     VALUES ($1, 1, 'Imogen Hale', 'imogen.hale@brackwater.example', 'Brackwater Games',
       'Looking for an adaptive combat score for a roguelite with four intensity tiers.', 'seed', 'seed',
       'SEED-PRIVATE-NOTE budget looks thin', 3, 800000)
     ON CONFLICT (reference_number) DO NOTHING RETURNING id`,
    [enquiryId],
  );
  if (seeded.rowCount) {
    const director = {
      id: enquiryId, reference: "ENQ-000001", name: "Imogen Hale", email: "imogen.hale@brackwater.example",
      studio: "Brackwater Games", brief: "Looking for an adaptive combat score for a roguelite with four intensity tiers.",
      preferredMonth: null, projectSlug: null, attachment: null,
    };
    await queueMail(client, receiptLetter(director), "sent");
  }
}

export async function applySchemaAndSeed(): Promise<void> {
  await withStartupLock(async (client) => {
    await client.query("BEGIN");
    try {
      await seedRecords(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

/** Stores the synthesized stems of published seed projects that have none yet. */
async function seedStemsOnce(): Promise<void> {
  return withStartupLock(async (client) => {
    const pending = await client.query<{ id: string; slug: string }>(
      `SELECT p.id, p.slug FROM projects p WHERE p.seeded AND p.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM stems s WHERE s.project_id = p.id)`,
    );
    for (const project of pending.rows) {
      const voice = PROJECTS.find((p) => p.slug === project.slug)?.voice;
      if (!voice) continue;
      const rows: unknown[][] = [];
      for (const layer of LAYERS) {
        const id = randomUUID();
        const bytes = synthesizeStem(voice, layer);
        const key = stemKey(project.id, id, "wav");
        await putObject(key, bytes, "audio/wav");
        rows.push([id, project.id, layer, "wav", bytes.length, 8000, key]);
      }
      await client.query("BEGIN");
      for (const row of rows) {
        await client.query(
          "INSERT INTO stems (id, project_id, layer, format, bytes, duration_ms, object_key) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          row,
        );
      }
      await client.query("COMMIT");
    }
  });
}

/** Seeds stems now, and every 10 seconds while storage is unreachable. */
export function seedStems(): void {
  seedStemsOnce().catch(() => {
    setTimeout(seedStems, 10_000).unref();
  });
}
