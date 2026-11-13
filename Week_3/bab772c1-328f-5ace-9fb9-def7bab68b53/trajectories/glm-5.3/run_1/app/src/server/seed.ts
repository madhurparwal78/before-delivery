// The seeds: mission Tessera-3, its pass and its event, written once on first
// start against an empty database.

import { Buffer } from "node:buffer";
import { db, withTransaction } from "./db.js";
import { recordChange } from "./change.js";
import { sha256Hex } from "./passLifecycle.js";
import { getCapture, putCapture } from "./storage.js";
import { recordPendingWrite } from "./searchWriter.js";
import { ensureIndex } from "./search.js";
import { randomUUID } from "node:crypto";
import { epochMsToIso } from "../shared/format.js";

const SEED_MISSION_NAME = "Tessera-3";
const SEED_EPOCH = "2026-03-14T00:00:00Z";
const SEED_FILENAME = "tessera3-orbit1.cap";
const SEED_REQUEST_KEY = "seed-tessera3-orbit1";
const SEED_EVENT_TITLE = "Perilune pass";
const SEED_EVENT_MET = 7200;
const SEED_EVENT_NOTE = "Check against Kestrel log sheet 14 before publishing.";

function halfAway(value: number, digits = 1): string {
  const factor = Math.pow(10, digits);
  const scaled = value * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled + 1e-9 * Math.sign(scaled)));
  const out = rounded / factor;
  if (out === 0) return `0.${"0".repeat(digits)}`;
  return out.toFixed(digits);
}

export function buildSeedCapture(): Buffer {
  const lines: string[] = [
    "# Tessera-3 orbit 1, Kestrel Ground capture (invented demo data)",
    "# frame: Moon-centred Moon-fixed; metres and metres per second",
    "# S,utc,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s",
  ];
  const transcripts = new Map<number, [string, string]>([
    [0, ["KESTREL", "Tessera, Kestrel. Acquisition of signal, loud and clear."]],
    [120, ["TESSERA", "Kestrel, Tessera. Star tracker locked, attitude nominal."]],
    [355, ["KESTREL", "Coming up on perilune. Altimeter should read two zero kilometres."]],
    [360, ["TESSERA", "Perilune. Doppler steady, all channels green."]],
    [600, ["KESTREL", "Two minutes to loss of signal."]],
    [719, ["TESSERA", "Kestrel, Tessera. See you on the next pass."]],
  ]);
  for (let k = 0; k <= 719; k++) {
    const theta = (2 * Math.PI * k) / 720;
    const r = 1797400 + 40000 * Math.cos(theta);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta) * Math.cos((30 * Math.PI) / 180);
    const z = r * Math.sin(theta) * Math.sin((30 * Math.PI) / 180);
    const s = 1650 - 50 * Math.cos(theta);
    const vx = -s * Math.sin(theta);
    const vy = s * Math.cos(theta) * Math.cos((30 * Math.PI) / 180);
    const vz = s * Math.cos(theta) * Math.sin((30 * Math.PI) / 180);
    const utc = epochMsToIso(Date.UTC(2026, 2, 14, 1, 0, 0) + k * 10000);
    lines.push(
      `S,${utc},${halfAway(x)},${halfAway(y)},${halfAway(z)},${halfAway(vx)},${halfAway(vy)},${halfAway(vz)}`,
    );
    const transcript = transcripts.get(k);
    if (transcript) {
      lines.push(`T,${utc},${transcript[0]},${transcript[1]}`);
    }
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

export async function seedIfNeeded(): Promise<void> {
  const pool = db();
  const claimed = await pool.query<{ claimed: boolean }>(
    `INSERT INTO meta (key, value) VALUES ('seed', 'running')
     ON CONFLICT (key) DO NOTHING
     RETURNING (xmax = 0) AS claimed`,
  );
  if (claimed.rows.length === 0) return;
  try {
    await seedNow();
    // Seeding leaves change_version at 0 and sends no webhook.
    await pool.query("UPDATE missions SET change_version = 0");
    await pool.query("DELETE FROM outbox WHERE kind = 'webhook.send'");
    await pool.query("UPDATE meta SET value = 'done' WHERE key = 'seed'");
  } catch (err) {
    await pool.query("DELETE FROM meta WHERE key = 'seed'");
    throw err;
  }
}

async function seedNow(): Promise<void> {
  const capture = buildSeedCapture();
  const sha = sha256Hex(capture);
  const missionId = await withTransaction(async (client) => {
    const missionId = randomUUID();
    const created = epochMsToIso(Date.now());
    await client.query(
      `INSERT INTO missions (id, name, epoch_utc, epoch_ms, distance_unit, speed_unit, created_at)
       VALUES ($1, $2, $3, $4, 'km', 'm_s', $5)`,
      [missionId, SEED_MISSION_NAME, SEED_EPOCH, Date.parse(SEED_EPOCH), created],
    );
    await recordChange(
      client,
      missionId,
      { kind: "mission.created", data: { name: SEED_MISSION_NAME, epoch_utc: SEED_EPOCH } },
      { bumpVersion: false },
    );
    return missionId;
  });

  // Create the pass row first, then store the object under its key.
  const passId = randomUUID();
  let stored = false;
  for (let attempt = 0; attempt < 600 && !stored; attempt++) {
    try {
      await putCapture(missionId, passId, capture);
      const readBack = await getCapture(missionId, passId);
      if (sha256Hex(readBack) === sha) stored = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!stored) {
    throw new Error("seed capture could not be stored");
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO passes (id, mission_id, filename, state, size_bytes, sha256, upload_order, created_at)
       VALUES ($1, $2, $3, 'stored', $4, $5, 1, $6)`,
      [passId, missionId, SEED_FILENAME, capture.length, sha, epochMsToIso(Date.now())],
    );
    // The seed uses the normal outbox path.
    await client.query(
      `INSERT INTO outbox (id, kind, pass_id, created_at) VALUES ($1, 'pass.parse', $2, $3)`,
      [randomUUID(), passId, epochMsToIso(Date.now())],
    );
    await recordChange(
      client,
      missionId,
      {
        kind: "pass.stored",
        data: { pass_id: passId, filename: SEED_FILENAME, size_bytes: capture.length, sha256: sha },
      },
      { bumpVersion: false },
    );
    await client.query(
      `INSERT INTO request_keys (key, mission_id, route, state, fingerprint, status, pass_id, created_at)
       VALUES ($1, $2, 'pass.upload', 'kept', $3, 202, $4, $5)`,
      [SEED_REQUEST_KEY, missionId, `${sha}:${SEED_FILENAME}`, passId, epochMsToIso(Date.now())],
    );
  });

  // Parse it in-process if search answers; otherwise leave pending writes that
  // the consumer path will complete. The relay will deliver the parse job.
  await settleSeedPass(missionId, passId, capture);

  // Pin the seed event after the pass has settled.
  for (let attempt = 0; attempt < 120; attempt++) {
    const settled = await db().query<{ state: string }>(
      "SELECT state FROM passes WHERE id = $1",
      [passId],
    );
    const state = settled.rows[0]?.state;
    if (state === "parsed" || state === "rejected") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await withTransaction(async (client) => {
    const snap = await client.query<{ met: number }>(
      "SELECT met FROM samples WHERE pass_id = $1 AND met <= $2 ORDER BY met DESC LIMIT 1",
      [passId, SEED_EVENT_MET],
    );
    if (snap.rows.length === 0) return;
    const sampleMet = Number(snap.rows[0].met);
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO events (id, mission_id, pass_id, met, title, note, sample_met, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        eventId,
        missionId,
        passId,
        sampleMet,
        SEED_EVENT_TITLE,
        SEED_EVENT_NOTE,
        sampleMet,
        epochMsToIso(Date.now()),
      ],
    );
    await recordChange(
      client,
      missionId,
      {
        kind: "event.pinned",
        data: { event_id: eventId, pass_id: passId, met: sampleMet, title: SEED_EVENT_TITLE },
      },
      { bumpVersion: false },
    );
    // The seed pass's search documents: the event title becomes indexed when
    // the engine answers, or stays pending until then.
    await recordPendingWrite(
      client,
      missionId,
      "event",
      eventId,
      { pass_id: passId, met: sampleMet, text: SEED_EVENT_TITLE },
    );
  });
}

// Seeding leaves change_version at 0 and sends no webhook.
async function settleSeedPass(missionId: string, passId: string, capture: Buffer): Promise<void> {
  // The parse itself happens through the normal queue path; here we only
  // ensure the search index is created so its documents are searchable.
  try {
    await ensureIndex();
  } catch {
    // The parse consumer will retry.
  }
  void missionId;
  void passId;
  void capture;
}

export const SEEDS = {
  missionName: SEED_MISSION_NAME,
  epoch: SEED_EPOCH,
  filename: SEED_FILENAME,
  requestKey: SEED_REQUEST_KEY,
};
