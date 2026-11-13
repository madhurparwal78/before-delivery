/** The seeded Tessera-3 mission and its one pass, created once per installation. */

import { formatScaled, scaleRoundHalfAway } from "../shared/decimal.js";
import { parseIsoInstant } from "../shared/doy.js";
import { pool } from "./db/pool.js";
import { SEED_LOCK, withAdvisoryLock } from "./db/locks.js";
import { createMission } from "./domain/missions.js";
import { findMissionRow, type MissionRow } from "./domain/missionRead.js";
import { admitUpload, discardAdmitted, finishUpload, sha256Hex } from "./domain/passes.js";
import { beginRequestKey, uploadFingerprint } from "./domain/requestKeys.js";
import { pinEvent, snapSample } from "./domain/events.js";

const MISSION_NAME = "Tessera-3";
const EPOCH = "2026-03-14T00:00:00Z";
const CAPTURE_NAME = "tessera3-orbit1.cap";
const REQUEST_KEY = "seed-tessera3-orbit1";
const EVENT_TITLE = "Perilune pass";
const EVENT_NOTE = "Check against Kestrel log sheet 14 before publishing.";
const EVENT_MET = 7200;

const TRANSCRIPT: ReadonlyMap<number, { speaker: string; text: string }> = new Map([
  [0, { speaker: "KESTREL", text: "Tessera, Kestrel. Acquisition of signal, loud and clear." }],
  [120, { speaker: "TESSERA", text: "Kestrel, Tessera. Star tracker locked, attitude nominal." }],
  [
    355,
    {
      speaker: "KESTREL",
      text: "Coming up on perilune. Altimeter should read two zero kilometres.",
    },
  ],
  [360, { speaker: "TESSERA", text: "Perilune. Doppler steady, all channels green." }],
  [600, { speaker: "KESTREL", text: "Two minutes to loss of signal." }],
  [719, { speaker: "TESSERA", text: "Kestrel, Tessera. See you on the next pass." }],
]);

function oneDecimal(value: number): string {
  return formatScaled(scaleRoundHalfAway(value, 1n, 1n, 1), 1);
}

function sampleUtc(k: number): string {
  const base = parseIsoInstant("2026-03-14T01:00:00Z") as number;
  return `${new Date(base + k * 10_000).toISOString().slice(0, 19)}Z`;
}

export function seedCapture(): Buffer {
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  const lines = [
    "# Tessera-3 orbit 1, Kestrel Ground capture (invented demo data)",
    "# frame: Moon-centred Moon-fixed; metres and metres per second",
    "# S,utc,x_m,y_m,z_m,vx_m_s,vy_m_s,vz_m_s",
  ];
  for (let k = 0; k < 720; k += 1) {
    const theta = (2 * Math.PI * k) / 720;
    const r = 1_797_400 + 40_000 * Math.cos(theta);
    const speed = 1650 - 50 * Math.cos(theta);
    const utc = sampleUtc(k);
    lines.push(
      [
        "S",
        utc,
        oneDecimal(r * Math.cos(theta)),
        oneDecimal(r * Math.sin(theta) * cos30),
        oneDecimal(r * Math.sin(theta) * sin30),
        oneDecimal(-speed * Math.sin(theta)),
        oneDecimal(speed * Math.cos(theta) * cos30),
        oneDecimal(speed * Math.cos(theta) * sin30),
      ].join(","),
    );
    const line = TRANSCRIPT.get(k);
    if (line) {
      lines.push(["T", utc, line.speaker, line.text].join(","));
    }
  }
  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

async function seedMission(): Promise<MissionRow> {
  const held = await pool.query<{ value: string }>(
    "select value from app_singletons where name = 'seed.mission'",
  );
  const existingId = held.rows[0]?.value;
  if (existingId) {
    const row = await findMissionRow(pool, existingId);
    if (row) {
      return row;
    }
  }
  const row = await createMission(MISSION_NAME, parseIsoInstant(EPOCH) as number);
  await pool.query(
    `insert into app_singletons (name, value, created_ms) values ('seed.mission', $1, $2)
     on conflict (name) do update set value = $1`,
    [row.id, Date.now()],
  );
  return row;
}

async function seedPass(mission: MissionRow): Promise<void> {
  const existing = await pool.query(
    "select id from passes where mission_id = $1 and is_seed = true and state <> 'deleted'",
    [mission.id],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }
  const bytes = seedCapture();
  const request = {
    mission,
    filename: CAPTURE_NAME,
    declaredSha256: sha256Hex(bytes),
    bytes,
    requestKey: REQUEST_KEY,
    isSeed: true,
  };
  const claim = await beginRequestKey(
    mission.id,
    "upload",
    REQUEST_KEY,
    uploadFingerprint(request.declaredSha256, CAPTURE_NAME),
  );
  if (claim.kind !== "proceed") {
    return;
  }
  const passId = await admitUpload(request);
  try {
    await finishUpload(request, passId);
  } catch (error) {
    await discardAdmitted(mission.id, passId);
    await pool.query(
      "delete from request_keys where mission_id = $1 and route = 'upload' and key = $2",
      [mission.id, REQUEST_KEY],
    );
    throw error;
  }
}

async function seedEvent(mission: MissionRow): Promise<void> {
  const events = await pool.query("select id from events where mission_id = $1", [mission.id]);
  if (events.rowCount && events.rowCount > 0) {
    return;
  }
  const sample = await snapSample(mission.id, EVENT_MET);
  if (!sample) {
    return;
  }
  await pinEvent(mission, `${REQUEST_KEY}-event`, sample, EVENT_TITLE, EVENT_NOTE, {
    seed: true,
  });
}

/** Creates the seed mission and pass, then pins its event once the pass has parsed. */
export async function ensureSeed(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, SEED_LOCK, async () => {
    const mission = await seedMission();
    await seedPass(mission);
    const parsed = await pool.query(
      "select id from passes where mission_id = $1 and is_seed = true and state = 'parsed'",
      [mission.id],
    );
    if (parsed.rowCount && parsed.rowCount > 0) {
      await seedEvent(mission);
    }
  });
}
