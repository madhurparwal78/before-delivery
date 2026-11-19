// Idempotent seed data, fixtures and the demo spectrum.

import { randomUUID } from 'node:crypto';
import type { Db } from './db';
import { Storage } from './storage';
import { hashApiKey, hashPassword } from './auth';
import { foldName } from '../src-shared/text';
import { foldEmail } from './auth';
import { seedAudio, toneFixture, parseWav } from '../src-shared/audio';
import { parseSidecar, type SidecarCue } from '../src-shared/vtt';
import { createSpectrumComputer, rowPeakBin, FRAME_ROWS_PER_SECOND } from '../src-shared/spectrum';
import { billableSeconds } from '../src-shared/billing';

const DEMO_PASSWORD = 'lowfield-demo-2026';

export type SeedResult = {
  seedSessionIds: string[];
  demoSpectrum: { frame_rate: number; rows: number[][] };
  toneFixture: Buffer;
};

const SEED_WARD_VTT = `WEBVTT

00:00.000 --> 00:03.000
patient@0.97 reports@0.95 dizziness@0.91

00:03.000 --> 00:06.000
after@0.93 starting@0.88 lisinopril@0.52

00:06.000 --> 00:09.000
fifteen@0.71 milligrams@0.90 daily@0.94

00:09.000 --> 00:12.000
review@0.96 in@0.93 two@0.58 weeks@0.90
`;

const SEED_CALL_VTT = `WEBVTT

00:00.000 --> 00:05.000
thanks@0.96 for@0.95 calling@0.94 corvane@0.62

00:05.000 --> 00:10.000
your@0.93 policy@0.90 number@0.88 is@0.97 four@0.55 one@0.91 seven@0.89
`;

/** Idempotent seeding: every insert is ON CONFLICT DO NOTHING / guarded by seed flags. */
export async function seed(db: Db, storage: Storage): Promise<SeedResult> {
  const passwordHash = hashPassword(DEMO_PASSWORD);

  // ---- orgs ----
  async function ensureOrg(name: string, slug: string, plan: 'pilot' | 'scale'): Promise<string> {
    const id = randomUUID();
    const res = await db.query(
      `INSERT INTO orgs (id, name, slug, name_folded, plan, seed) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, plan=EXCLUDED.plan
       RETURNING id`,
      [id, name, slug, foldName(name), plan],
    );
    return String(res.rows[0].id);
  }
  const harbourlineId = await ensureOrg('Harbourline Health', 'harbourline', 'pilot');
  const corvaneId = await ensureOrg('Corvane Contact', 'corvane', 'scale');

  // ---- projects ----
  async function ensureProject(name: string, orgId: string, quota: number): Promise<string> {
    const id = randomUUID();
    const res = await db.query(
      `INSERT INTO projects (id, org_id, name, name_folded, monthly_quota_minutes, seed) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (org_id, name_folded) DO UPDATE SET monthly_quota_minutes=EXCLUDED.monthly_quota_minutes
       RETURNING id`,
      [id, orgId, name, foldName(name), quota],
    );
    return String(res.rows[0].id);
  }
  const wardId = await ensureProject('Ward Dictation', harbourlineId, 600);
  const clinicId = await ensureProject('Clinic Intake', harbourlineId, 120);
  const assistId = await ensureProject('Agent Assist EU', corvaneId, 3000);

  // ---- members ----
  async function ensureMember(name: string, email: string, role: string, orgId: string, projectIds: string[]): Promise<string> {
    const id = randomUUID();
    const res = await db.query(
      `INSERT INTO members (id, org_id, name, email_folded, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, email_folded) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role
       RETURNING id`,
      [id, orgId, name, foldEmail(email), passwordHash, role],
    );
    const memberId = String(res.rows[0].id);
    for (const pid of projectIds) {
      await db.query(`INSERT INTO member_projects (member_id, project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [memberId, pid]);
    }
    return memberId;
  }
  await ensureMember('Ines Okafor', 'ines.okafor@harbourline.example', 'admin', harbourlineId, []);
  await ensureMember('Teo Marlow', 'teo.marlow@harbourline.example', 'developer', harbourlineId, [wardId, clinicId]);
  await ensureMember('Rhea Santos', 'rhea.santos@harbourline.example', 'reviewer', harbourlineId, [wardId]);
  await ensureMember('Ari Lindqvist', 'ari.lindqvist@harbourline.example', 'approver', harbourlineId, [wardId]);
  await ensureMember('Jo Adeyemi', 'jo.adeyemi@harbourline.example', 'reviewer', harbourlineId, [clinicId]);
  await ensureMember('Kim Baptiste', 'kim.baptiste@harbourline.example', 'billing', harbourlineId, []);
  await ensureMember('Nadia Voss', 'nadia.voss@corvane.example', 'admin', corvaneId, []);
  await ensureMember('Sam Ruiz', 'sam.ruiz@corvane.example', 'developer', corvaneId, [assistId]);
  await ensureMember('Lee Chandra', 'lee.chandra@corvane.example', 'reviewer', corvaneId, [assistId]);

  // ---- seed API keys ----
  async function ensureKey(secret: string, projectId: string, name: string): Promise<void> {
    await db.query(
      `INSERT INTO api_keys (id, project_id, name, prefix, secret_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [randomUUID(), projectId, name, secret.slice(0, 12), hashApiKey(secret)],
    );
  }
  await ensureKey('lf_live_00000000000000000000000000000a01', wardId, 'Seed ward key');
  await ensureKey('lf_live_00000000000000000000000000000a02', clinicId, 'Seed intake key');
  await ensureKey('lf_live_00000000000000000000000000000c01', assistId, 'Seed assist key');

  // ---- seed sessions (exist in Postgres even while storage is unreachable) ----
  const seedSessionIds: string[] = [];

  async function ensureSeedSession(opts: {
    label: string;
    projectId: string;
    orgId: string;
    plan: 'pilot' | 'scale';
    seconds: number;
    channels: number;
    vtt: string;
    audioSeed: number;
    keyId: string;
  }): Promise<{ id: string; audio: Buffer; cues: SidecarCue[] }> {
    const { rows } = await db.query(`SELECT id FROM sessions WHERE project_id=$1 AND label=$2 AND seed=true`, [opts.projectId, opts.label]);
    let id: string;
    const audio = seedAudio(opts.seconds, opts.channels, opts.audioSeed);
    const cues = parseSidecar(opts.vtt)!;
    if (rows.length > 0) {
      id = String(rows[0].id);
    } else {
      id = randomUUID();
      const now = new Date();
      const startedAt = new Date(now.getTime() - 3600_000);
      const endedAt = new Date(startedAt.getTime() + opts.seconds * 1000);
      const secs = billableSeconds(opts.plan, opts.seconds * 1000, opts.channels);
      const billingState = secs === 0 ? 'not_billable' : 'pending';
      await db.query(
        `INSERT INTO sessions (id, project_id, org_id, kind, source, label, state, close_reason, channels, sample_rate, audio_ms, frame, plan, key_id, started_at, live_at, ended_at, billable_seconds, billing_state, seed, seed_source)
         VALUES ($1,$2,$3,'replay','upload',$4,'closed','end_of_audio',$5,16000,$6,$7,$8,$9,$10,$10,$11,$12,$13,true,'seed')
         ON CONFLICT DO NOTHING`,
        [id, opts.projectId, opts.orgId, opts.label, opts.channels, opts.seconds * 1000, opts.seconds * FRAME_ROWS_PER_SECOND, opts.plan, opts.keyId, startedAt.toISOString(), endedAt.toISOString(), secs, billingState],
      );
      // Frame rows: computed once from the deterministic audio and stored.
      const parsed = parseWav(audio)!;
      const comp = createSpectrumComputer();
      const rowsCount = opts.seconds * FRAME_ROWS_PER_SECOND;
      for (let f = 0; f < rowsCount; f++) {
        const offset = Math.min(Math.max(0, Math.floor((f * parsed.samples.length) / rowsCount)), Math.max(0, parsed.samples.length - 2048));
        const window = parsed.samples.subarray(offset, offset + 2048);
        const row = comp.row(window as Float32Array, 2048);
        await db.query(
          `INSERT INTO spectrum_rows (session_id, frame, bins, peak_bin) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [id, f, JSON.stringify(row), rowPeakBin(row)],
        );
      }
      // Segments from the sidecar.
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const words = cue.words.map((w) => ({ text: w.text, confidence: w.confidence, start_ms: w.start_ms, end_ms: w.end_ms }));
        await db.query(
          `INSERT INTO segments (id, session_id, index_in_session, start_ms, end_ms, machine_words) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (session_id, index_in_session) DO NOTHING`,
          [randomUUID(), id, i, cue.start_ms, cue.end_ms, JSON.stringify(words)],
        );
      }
    }
    // Audio and artifacts are uploaded whenever missing, retrying until storage is reachable.
    const artifact = {
      session_id: id,
      segments: cues.map((c, i) => ({
        index: i, start_ms: c.start_ms, end_ms: c.end_ms,
        words: c.words.map((w) => ({ text: w.text, confidence: w.confidence, start_ms: w.start_ms, end_ms: w.end_ms })),
      })),
    };
    await withRetry(async () => {
      const keys = Storage.sessionKeys(opts.orgId, opts.projectId, id);
      await storage.put(keys.upload, Buffer.from(audio), 'audio/wav');
      await storage.put(keys.sidecar, Buffer.from(opts.vtt, 'utf8'), 'text/vtt; charset=utf-8');
      await storage.put(keys.machineTranscript, Buffer.from(JSON.stringify(artifact), 'utf8'), 'application/json');
    });
    return { id, audio: Buffer.from(audio), cues };
  }

  async function withRetry(fn: () => Promise<void>): Promise<void> {
    for (let i = 0; ; i++) {
      try {
        await fn();
        return;
      } catch {
        if (i > 200) return; // give up silently; a later boot retries
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * i)));
      }
    }
  }

  const { rows: wardKey } = await db.query(`SELECT id FROM api_keys WHERE prefix='lf_live_000' AND name='Seed ward key'`);
  const { rows: assistKey } = await db.query(`SELECT id FROM api_keys WHERE name='Seed assist key'`);
  const ward = await ensureSeedSession({
    label: 'Seed dictation 01', projectId: wardId, orgId: harbourlineId, plan: 'pilot',
    seconds: 12, channels: 1, vtt: SEED_WARD_VTT, audioSeed: 42, keyId: String(wardKey[0]?.id ?? randomUUID()),
  });
  const call = await ensureSeedSession({
    label: 'Seed call 01', projectId: assistId, orgId: corvaneId, plan: 'scale',
    seconds: 75, channels: 2, vtt: SEED_CALL_VTT, audioSeed: 7, keyId: String(assistKey[0]?.id ?? randomUUID()),
  });
  seedSessionIds.push(ward.id, call.id);

  // The public demo spectrum is the spectrum of the Seed dictation 01 audio.
  const wardAudio = Buffer.from(seedAudio(12, 1, 42));
  const wardParsed = parseWav(wardAudio)!;
  const comp = createSpectrumComputer();
  const demoRows: number[][] = [];
  for (let f = 0; f < 12 * FRAME_ROWS_PER_SECOND; f++) {
    const offset = Math.min(Math.floor((f * wardParsed.samples.length) / (12 * FRAME_ROWS_PER_SECOND)), wardParsed.samples.length - 2048);
    const window = wardParsed.samples.subarray(offset, offset + 2048);
    demoRows.push(comp.row(window as Float32Array, 2048));
  }

  return {
    seedSessionIds,
    demoSpectrum: { frame_rate: FRAME_ROWS_PER_SECOND, rows: demoRows },
    toneFixture: Buffer.from(toneFixture()),
  };
}

