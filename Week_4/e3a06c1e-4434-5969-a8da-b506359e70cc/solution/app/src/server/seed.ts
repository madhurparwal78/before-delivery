// Seed data, created once and idempotently at start; seeded audio and artifacts are uploaded
// whenever they are missing, retried until storage is reachable.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { billableSeconds, type Plan } from "../shared/billing";
import { hashPassword, sha256 } from "./access";
import { rows, pool } from "./db";
import type { Role, Voice } from "../shared/types";
import { audioMs, interleave, speechTrack, wavFile, type Spoken } from "./audio";
import { nameKey } from "../shared/text";
import { parseSidecar, type Cue } from "./sidecar";
import { SpectrumStream, type SpectrumRow } from "./spectrum";
import { objectExists, putObject, sessionPrefix } from "./storage";
import { machineArtifact } from "./transcript";

const PASSWORD = "lowfield-demo-2026";

interface SeedRecording {
  label: string;
  plan: Plan;
  channels: number;
  sidecar: string;
  pcm: Buffer;
}

function vtt(cues: [string, string, string][]): string {
  return `WEBVTT\n\n${cues.map(([from, to, words]) => `${from} --> ${to}\n${words}`).join("\n\n")}\n`;
}

/** Each cue's words voiced across most of their slot, so the spectrum shows speech where the transcript has words. */
function voiced(cues: Cue[], voice: Voice, gain: number): Spoken[] {
  return cues.flatMap((cue) => cue.words.map((word) => ({ text: word.text, start_ms: word.start_ms, duration_ms: Math.round((word.end_ms - word.start_ms) * 0.85), voice, gain })));
}

const DICTATION_VTT = vtt([
  ["00:00.000", "00:03.000", "patient@0.97 reports@0.95 dizziness@0.91"],
  ["00:03.000", "00:06.000", "after@0.93 starting@0.88 lisinopril@0.52"],
  ["00:06.000", "00:09.000", "fifteen@0.71 milligrams@0.90 daily@0.94"],
  ["00:09.000", "00:12.000", "review@0.96 in@0.93 two@0.58 weeks@0.90"],
]);

const CALL_VTT = vtt([
  ["00:00.000", "00:05.000", "thanks@0.96 for@0.95 calling@0.94 corvane@0.62"],
  ["00:05.000", "00:10.000", "your@0.93 policy@0.90 number@0.88 is@0.97 four@0.55 one@0.91 seven@0.89"],
]);

/** The rest of the call after the captioned opening: alternating speakers with deterministic phrases. */
function callConversation(): { agent: Spoken[]; caller: Spoken[] } {
  const vocabulary = ["account", "renewal", "address", "confirm", "payment", "thank", "today", "update", "number", "policy", "cover", "monthly"];
  const agent: Spoken[] = [];
  const caller: Spoken[] = [];
  let state = 7;
  for (let turn = 0, at = 10_500; at < 74_000; turn++) {
    const words = 3 + (state % 4);
    for (let w = 0; w < words && at < 74_400; w++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      const word: Spoken = { text: vocabulary[state % vocabulary.length], start_ms: at, duration_ms: 320, voice: turn % 2 ? "lumen" : "basalt", gain: 0.2 };
      (turn % 2 ? caller : agent).push(word);
      at += 340 + (state % 120);
    }
    at += 600;
  }
  return { agent, caller };
}

const recordings: SeedRecording[] = (() => {
  const dictationCues = parseSidecar(DICTATION_VTT)!;
  const callCues = parseSidecar(CALL_VTT)!;
  const conversation = callConversation();
  return [
    { label: "Seed dictation 01", plan: "pilot", channels: 1, sidecar: DICTATION_VTT, pcm: interleave([speechTrack(12_000, voiced(dictationCues, "lumen", 0.24), 1)]) },
    {
      label: "Seed call 01",
      plan: "scale",
      channels: 2,
      sidecar: CALL_VTT,
      pcm: interleave([speechTrack(75_000, [...voiced(callCues, "basalt", 0.22), ...conversation.agent], 2), speechTrack(75_000, conversation.caller, 3)]),
    },
  ];
})();

function spectrumOf(recording: SeedRecording): { rows: SpectrumRow[]; mean: number[] } {
  const stream = new SpectrumStream(recording.channels);
  const produced = stream.feed(recording.pcm);
  return { rows: produced, mean: stream.mean() };
}

let demoRows: number[][] | null = null;

/** The public demo spectrum: the spectrum of the Seed dictation 01 audio. */
export function demoSpectrumRows(): number[][] {
  demoRows ??= spectrumOf(recordings[0]).rows.map((row) => row.bins);
  return demoRows;
}

const ORGS: { name: string; slug: string; plan: Plan; projects: { name: string; quota: number; key: string; keyName: string }[]; members: { name: string; email: string; role: Role; projects: string[] }[] }[] = [
  {
    name: "Harbourline Health",
    slug: "harbourline",
    plan: "pilot",
    projects: [
      { name: "Ward Dictation", quota: 600, key: "lf_live_00000000000000000000000000000a01", keyName: "Seed ward key" },
      { name: "Clinic Intake", quota: 120, key: "lf_live_00000000000000000000000000000a02", keyName: "Seed intake key" },
    ],
    members: [
      { name: "Ines Okafor", email: "ines.okafor@harbourline.example", role: "admin", projects: [] },
      { name: "Teo Marlow", email: "teo.marlow@harbourline.example", role: "developer", projects: ["Ward Dictation", "Clinic Intake"] },
      { name: "Rhea Santos", email: "rhea.santos@harbourline.example", role: "reviewer", projects: ["Ward Dictation"] },
      { name: "Ari Lindqvist", email: "ari.lindqvist@harbourline.example", role: "approver", projects: ["Ward Dictation"] },
      { name: "Jo Adeyemi", email: "jo.adeyemi@harbourline.example", role: "reviewer", projects: ["Clinic Intake"] },
      { name: "Kim Baptiste", email: "kim.baptiste@harbourline.example", role: "billing", projects: [] },
    ],
  },
  {
    name: "Corvane Contact",
    slug: "corvane",
    plan: "scale",
    projects: [{ name: "Agent Assist EU", quota: 3000, key: "lf_live_00000000000000000000000000000c01", keyName: "Seed assist key" }],
    members: [
      { name: "Nadia Voss", email: "nadia.voss@corvane.example", role: "admin", projects: [] },
      { name: "Sam Ruiz", email: "sam.ruiz@corvane.example", role: "developer", projects: ["Agent Assist EU"] },
      { name: "Lee Chandra", email: "lee.chandra@corvane.example", role: "reviewer", projects: ["Agent Assist EU"] },
    ],
  },
];

const SEED_SESSIONS: { recording: SeedRecording; project: string }[] = [
  { recording: recordings[0], project: "Ward Dictation" },
  { recording: recordings[1], project: "Agent Assist EU" },
];

/** Inserts the seed data inside the schema transaction, once. */
export async function seed(db: pg.PoolClient): Promise<void> {
  const existing = await db.query("SELECT 1 FROM orgs WHERE slug = 'harbourline'");
  if (existing.rowCount) return;
  const passwordHash = await hashPassword(PASSWORD);
  const projectIds = new Map<string, { id: string; org: string; key: string }>();
  for (const org of ORGS) {
    const orgId = (await db.query<{ id: string }>("INSERT INTO orgs (name, slug, plan) VALUES ($1, $2, $3) RETURNING id", [org.name, org.slug, org.plan])).rows[0].id;
    for (const project of org.projects) {
      const id = (await db.query<{ id: string }>("INSERT INTO projects (org_id, name, name_key, quota_minutes) VALUES ($1, $2, $3, $4) RETURNING id", [orgId, project.name, nameKey(project.name), project.quota])).rows[0].id;
      const key = (await db.query<{ id: string }>("INSERT INTO api_keys (project_id, name, prefix, secret_hash) VALUES ($1, $2, $3, $4) RETURNING id", [id, project.keyName, project.key.slice(0, 12), sha256(project.key)])).rows[0].id;
      projectIds.set(project.name, { id, org: orgId, key });
    }
    for (const member of org.members) {
      const id = (await db.query<{ id: string }>("INSERT INTO members (org_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id", [orgId, member.name, member.email, passwordHash, member.role])).rows[0].id;
      for (const name of member.projects) await db.query("INSERT INTO member_projects (member_id, project_id) VALUES ($1, $2)", [id, projectIds.get(name)!.id]);
    }
  }
  for (const { recording, project } of SEED_SESSIONS) {
    const target = projectIds.get(project)!;
    const id = randomUUID();
    const ms = audioMs(recording.pcm.length, recording.channels);
    const spectrum = spectrumOf(recording);
    const last = spectrum.rows[spectrum.rows.length - 1];
    const billable = billableSeconds(recording.plan, ms, recording.channels);
    await db.query(
      `INSERT INTO sessions (id, project_id, key_id, kind, source, label, state, close_reason, channels, audio_ms, frame, peak_bin, mean, plan,
                             started_at, live_at, ended_at, billable_seconds, billing_state)
       VALUES ($1, $2, $3, 'replay', 'upload', $4, 'closed', 'end_of_audio', $5, $6, $7, $8, $9, $10,
               now() - make_interval(secs => ($6::bigint / 1000.0)::float8), now() - make_interval(secs => ($6::bigint / 1000.0)::float8), now(), $11, 'pending')`,
      [id, target.id, target.key, recording.label, recording.channels, ms, last.frame, last.peak_bin, spectrum.mean, recording.plan, billable],
    );
    await db.query(
      `INSERT INTO spectrum_rows (session_id, frame, bins)
       SELECT $1, (r->>'f')::int, ARRAY(SELECT jsonb_array_elements_text(r->'b')::smallint) FROM jsonb_array_elements($2::jsonb) r`,
      [id, JSON.stringify(spectrum.rows.map((row) => ({ f: row.frame, b: row.bins.map((v) => Math.round(v * 1000)) })))],
    );
    for (const [index, cue] of parseSidecar(recording.sidecar)!.entries()) {
      await db.query("INSERT INTO segments (session_id, idx, start_ms, end_ms, words, text) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        index,
        cue.start_ms,
        cue.end_ms,
        JSON.stringify(cue.words),
        cue.words.map((w) => w.text).join(" "),
      ]);
    }
  }
}

/** Uploads seeded audio, sidecars and machine transcripts that storage doesn't have yet. */
export async function uploadSeedObjects(): Promise<void> {
  const seeded = await rows<{ id: string; label: string; project_id: string; org_id: string }>(
    "SELECT s.id, s.label, s.project_id, p.org_id FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.label = ANY($1) AND s.key_id IN (SELECT id FROM api_keys WHERE name LIKE 'Seed %')",
    [SEED_SESSIONS.map((s) => s.recording.label)],
  );
  for (const session of seeded) {
    const recording = recordings.find((r) => r.label === session.label)!;
    const prefix = sessionPrefix(session.org_id, session.project_id, session.id);
    const objects: [string, () => Promise<Buffer>, string][] = [
      ["upload.wav", async () => wavFile(recording.pcm, recording.channels), "audio/wav"],
      ["sidecar.vtt", async () => Buffer.from(recording.sidecar, "utf8"), "text/vtt"],
      ["machine-transcript.json", () => machineArtifact(session.id), "application/json"],
    ];
    for (const [name, body, type] of objects) if (!(await objectExists(prefix + name))) await putObject(prefix + name, await body(), type);
    await pool.query("UPDATE sessions SET artifact_stored = true WHERE id = $1", [session.id]);
  }
}
