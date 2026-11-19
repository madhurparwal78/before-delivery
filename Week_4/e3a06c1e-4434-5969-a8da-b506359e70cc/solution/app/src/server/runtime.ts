// The session state machine and the recognizer stand-in. Only this module moves a session between
// states: connecting -> live -> closed | idle_closed | quota_halted | revoked.
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { CloseReason, SessionState } from "../shared/types";
import { billableSeconds, type Plan } from "../shared/billing";
import { config } from "./config";
import { one, pool, rows } from "./db";
import { publish } from "./events";
import { audioMs, SAMPLE_RATE } from "./audio";
import { SpectrumStream, type SpectrumRow } from "./spectrum";
import type { Cue } from "./sidecar";
import { putObject, sessionPrefix } from "./storage";
import { quotaObject, usedSeconds } from "./quota";
import { machineArtifact, segmentById } from "./transcript";
import { flushUsage } from "./billing";
import { every } from "./schedule";

const INSTANCE = randomUUID();

type EndState = Exclude<SessionState, "connecting" | "live">;
const CLOSE_CODE: Record<EndState, number> = { closed: 1000, idle_closed: 4000, quota_halted: 4002, revoked: 4003 };

interface Runtime {
  id: string;
  projectId: string;
  orgId: string;
  channels: number;
  plan: Plan;
  kind: "live" | "replay";
  spectrum: SpectrumStream;
  cues: Cue[];
  finalised: number;
  receivedBytes: number;
  capture: Buffer[];
  pendingRows: SpectrumRow[];
  lastRow: SpectrumRow | null;
  publishedFrame: number;
  liveAt: number;
  lastAudioAt: number;
  /** The live client's socket; replay and tone sessions have none. */
  socket: WebSocket | null;
  replay: NodeJS.Timeout | null;
  work: Promise<unknown>;
  ending: Promise<void> | null;
}

const runtimes = new Map<string, Runtime>();
/** Live captures whose final upload failed, kept until storage takes them. */
const unsavedCaptures = new Map<string, { key: string; data: Buffer }>();

interface NewSession {
  id: string;
  projectId: string;
  orgId: string;
  keyId: string;
  kind: "live" | "replay";
  source: "live" | "tone" | "upload";
  label: string;
  channels: number;
  cues: Cue[];
}

/** Creates the session in `connecting` under the organisation's confirmed plan at this moment. */
export async function openSession(input: NewSession): Promise<void> {
  const row = await one<{ plan: Plan }>(
    `INSERT INTO sessions (id, project_id, key_id, kind, source, label, state, channels, plan, owner)
     VALUES ($1, $2, $3, $4, $5, $6, 'connecting', $7, (SELECT plan FROM orgs WHERE id = $8), $9)
     RETURNING plan`,
    [input.id, input.projectId, input.keyId, input.kind, input.source, input.label, input.channels, input.orgId, INSTANCE],
  );
  const now = Date.now();
  runtimes.set(input.id, {
    id: input.id,
    projectId: input.projectId,
    orgId: input.orgId,
    channels: input.channels,
    plan: row!.plan,
    kind: input.kind,
    spectrum: new SpectrumStream(input.channels),
    cues: input.cues,
    finalised: 0,
    receivedBytes: 0,
    capture: [],
    pendingRows: [],
    lastRow: null,
    publishedFrame: -1,
    liveAt: now,
    lastAudioAt: now,
    socket: null,
    replay: null,
    work: Promise.resolve(),
    ending: null,
  });
}

function tell(rt: Runtime, message: object): void {
  if (rt.socket?.readyState === rt.socket?.OPEN) rt.socket?.send(JSON.stringify(message));
}

/**
 * The capture object (the uploaded file, or an empty live capture) exists in storage: the session is
 * live. A replay starts its real-time feed here and stores its first row before the announcement, so
 * every view that sees it live has a front row to mirror.
 */
export async function goLive(id: string, source: { socket: WebSocket } | { replay: Buffer }): Promise<void> {
  const rt = runtimes.get(id)!;
  rt.liveAt = Date.now();
  rt.lastAudioAt = rt.liveAt;
  if ("socket" in source) rt.socket = source.socket;
  else {
    startReplay(rt, source.replay);
    await flush(rt);
  }
  const moved = await pool.query("UPDATE sessions SET state = 'live', live_at = now() WHERE id = $1 AND state = 'connecting'", [id]);
  if (!moved.rowCount) return;
  publish(id, { event: "state", data: { state: "live", close_reason: null } });
  tell(rt, { type: "state", state: "live", close_reason: null });
}

export function setCues(id: string, cues: Cue[]): void {
  runtimes.get(id)!.cues = cues;
}

/** Takes received or replayed audio through the spectrum and finalises the segments it passes. */
export function feed(id: string, pcm: Buffer): void {
  const rt = runtimes.get(id);
  if (!rt || rt.ending) return;
  rt.receivedBytes += pcm.length;
  rt.lastAudioAt = Date.now();
  if (rt.kind === "live") rt.capture.push(pcm);
  const produced = rt.spectrum.feed(pcm);
  if (produced.length) {
    rt.pendingRows.push(...produced);
    rt.lastRow = produced[produced.length - 1];
  }
  const ms = audioMs(rt.receivedBytes, rt.channels);
  while (rt.finalised < rt.cues.length && rt.cues[rt.finalised].end_ms <= ms) insertSegment(rt, rt.finalised++);
  if (ms >= config.sessionCapSeconds * 1000) void end(id, "closed", "cap");
}

function insertSegment(rt: Runtime, index: number): void {
  const cue = rt.cues[index];
  rt.work = rt.work.then(async () => {
    const row = await one<{ id: string }>(
      "INSERT INTO segments (session_id, idx, start_ms, end_ms, words, text) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id",
      [rt.id, index, cue.start_ms, cue.end_ms, JSON.stringify(cue.words), cue.words.map((w) => w.text).join(" ")],
    );
    if (!row) return;
    publish(rt.id, { event: "segment", data: { segment_id: row.id } });
    if (rt.socket) tell(rt, { type: "segment", segment: await segmentById(rt.id, row.id) });
  });
}

async function flush(rt: Runtime): Promise<void> {
  const batch = rt.pendingRows.splice(0);
  const last = rt.lastRow;
  if (batch.length) {
    await pool.query(
      `INSERT INTO spectrum_rows (session_id, frame, bins)
       SELECT $1, (r->>'f')::int, ARRAY(SELECT jsonb_array_elements_text(r->'b')::smallint)
         FROM jsonb_array_elements($2::jsonb) r ON CONFLICT DO NOTHING`,
      [rt.id, JSON.stringify(batch.map((row) => ({ f: row.frame, b: row.bins.map((v) => Math.round(v * 1000)) })))],
    );
  }
  await pool.query("UPDATE sessions SET audio_ms = $2, frame = $3, peak_bin = $4, mean = $5 WHERE id = $1 AND ended_at IS NULL", [
    rt.id,
    audioMs(rt.receivedBytes, rt.channels),
    last?.frame ?? 0,
    last?.peak_bin ?? 0,
    rt.spectrum.mean(),
  ]);
}

/** Replay and tone sessions run through the recognizer at real time: one second of audio per second, from the first row on. */
function startReplay(rt: Runtime, pcm: Buffer): void {
  const id = rt.id;
  const frameBytes = 2 * rt.channels;
  let fed = Math.min(pcm.length, Math.floor(SAMPLE_RATE / 30) * frameBytes);
  feed(id, pcm.subarray(0, fed));
  rt.replay = setInterval(() => {
    const due = Math.min(pcm.length, Math.floor(((Date.now() - rt.liveAt) * SAMPLE_RATE) / 1000) * frameBytes);
    if (due > fed) {
      feed(id, pcm.subarray(fed, due));
      fed = due;
    }
    if (fed >= pcm.length) void end(id, "closed", "end_of_audio");
  }, 1000 / 30);
}

export function isLocal(id: string): boolean {
  return runtimes.has(id);
}

/**
 * The one write that ends a session: its final state, billable seconds under its plan and billing
 * state, then the announcement. False when the session had already ended.
 */
async function recordEnd(id: string, state: EndState, reason: CloseReason | null, usage: { plan: Plan; ms: number; channels: number }, artifactStored: boolean): Promise<boolean> {
  const billable = billableSeconds(usage.plan, usage.ms, usage.channels);
  const ended = await pool.query(
    `UPDATE sessions SET state = $2, close_reason = $3, ended_at = now(), audio_ms = $4, billable_seconds = $5,
            billing_state = $6, owner = NULL, artifact_stored = $7 WHERE id = $1 AND ended_at IS NULL`,
    [id, state, reason, usage.ms, billable, billable > 0 ? "pending" : "not_billable", artifactStored],
  );
  if (!ended.rowCount) return false;
  publish(id, { event: "state", data: { state, close_reason: reason } });
  if (billable > 0) void flushUsage(id).catch(() => undefined);
  return true;
}

/** Ends a session once; a second call waits for the first. Final segments, rows and stored artifacts come first. */
export function end(id: string, state: EndState, reason: CloseReason | null, closeCode = CLOSE_CODE[state]): Promise<void> {
  const rt = runtimes.get(id);
  if (!rt) return Promise.resolve();
  rt.ending ??= finish(rt, state, reason, closeCode);
  return rt.ending;
}

async function finish(rt: Runtime, state: EndState, reason: CloseReason | null, closeCode: number): Promise<void> {
  if (rt.replay) clearInterval(rt.replay);
  const ms = audioMs(rt.receivedBytes, rt.channels);
  while (rt.finalised < rt.cues.length && rt.cues[rt.finalised].start_ms < ms) insertSegment(rt, rt.finalised++);
  await rt.work.catch(() => undefined);
  await flush(rt).catch(() => undefined);
  const prefix = sessionPrefix(rt.orgId, rt.projectId, rt.id);
  const artifact = await machineArtifact(rt.id);
  const capture = rt.kind === "live" ? Buffer.concat(rt.capture) : null;
  const [artifactSaved, captureSaved] = await Promise.all([
    putObject(`${prefix}machine-transcript.json`, artifact, "application/json").then(() => true, () => false),
    capture ? putObject(`${prefix}capture.pcm`, capture, "application/octet-stream").then(() => true, () => false) : true,
  ]);
  if (capture && !captureSaved) unsavedCaptures.set(rt.id, { key: `${prefix}capture.pcm`, data: capture });
  await recordEnd(rt.id, state, reason, { plan: rt.plan, ms, channels: rt.channels }, artifactSaved);
  runtimes.delete(rt.id);
  tell(rt, { type: "state", state, close_reason: reason });
  rt.socket?.close(closeCode);
}

/** The live capture held by this instance: still streaming, or ended and waiting for storage. */
export function heldCapture(id: string): Buffer | undefined {
  const rt = runtimes.get(id);
  if (rt?.kind === "live") return Buffer.concat(rt.capture);
  return unsavedCaptures.get(id)?.data;
}

/** Every 250 ms: persist rows, then enforce close requests, revocation, the quota, the idle close and the time cap. */
async function tick(): Promise<void> {
  const local = [...runtimes.values()].filter((rt) => rt.ending === null);
  if (local.length === 0) return;
  await Promise.all(local.map((rt) => flush(rt).catch(() => undefined)));
  const status = await rows<{ id: string; close_requested: boolean; revoked: boolean; project_id: string; quota_minutes: number }>(
    `SELECT s.id, s.close_requested, k.revoked_at IS NOT NULL AS revoked, s.project_id, p.quota_minutes
       FROM sessions s JOIN api_keys k ON k.id = s.key_id JOIN projects p ON p.id = s.project_id
      WHERE s.id = ANY($1::uuid[]) AND s.ended_at IS NULL`,
    [local.map((rt) => rt.id)],
  );
  const used = await usedSeconds([...new Set(status.map((s) => s.project_id))]);
  const now = Date.now();
  for (const s of status) {
    const rt = runtimes.get(s.id);
    if (!rt) continue;
    if (s.revoked) void end(s.id, "revoked", null);
    else if (quotaObject(s.quota_minutes, used.get(s.project_id) ?? 0).exhausted) void end(s.id, "quota_halted", null);
    else if (s.close_requested) void end(s.id, "closed", "client");
    else if (rt.kind === "live" && now - rt.lastAudioAt >= config.idleSeconds * 1000) void end(s.id, "idle_closed", null);
    else if (now - rt.liveAt >= config.sessionCapSeconds * 1000) void end(s.id, "closed", "cap");
  }
}

/** Publishes each session's newest row at most 30 times a second. */
function publishFrames(): void {
  for (const rt of runtimes.values()) {
    const row = rt.lastRow;
    if (!row || row.frame === rt.publishedFrame || rt.ending) continue;
    rt.publishedFrame = row.frame;
    publish(rt.id, { event: "frame", data: { frame: row.frame, audio_ms: audioMs(rt.receivedBytes, rt.channels), peak_bin: row.peak_bin, bins: row.bins } });
  }
}

/** Sessions whose owning instance stopped answering are ended as disconnected, as any dropped stream is. */
async function reapOrphans(): Promise<void> {
  await pool.query("INSERT INTO instances (id, seen_at) VALUES ($1, now()) ON CONFLICT (id) DO UPDATE SET seen_at = now()", [INSTANCE]);
  const orphans = await rows<{ id: string; plan: Plan; audio_ms: number; channels: number }>(
    `SELECT s.id, s.plan, s.audio_ms, s.channels FROM sessions s LEFT JOIN instances i ON i.id = s.owner
      WHERE s.ended_at IS NULL AND (i.id IS NULL OR i.seen_at < now() - interval '15 seconds')`,
  );
  for (const orphan of orphans) {
    await recordEnd(orphan.id, "closed", "disconnect", { plan: orphan.plan, ms: orphan.audio_ms, channels: orphan.channels }, false);
  }
}

/** Ended sessions whose artifact or capture did not reach storage yet. */
async function storeMissingArtifacts(): Promise<void> {
  for (const [id, capture] of unsavedCaptures) {
    await putObject(capture.key, capture.data, "application/octet-stream");
    unsavedCaptures.delete(id);
  }
  const missing = await rows<{ id: string; project_id: string; org_id: string }>(
    "SELECT s.id, s.project_id, p.org_id FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.ended_at IS NOT NULL AND NOT s.artifact_stored LIMIT 50",
  );
  for (const session of missing) {
    await putObject(`${sessionPrefix(session.org_id, session.project_id, session.id)}machine-transcript.json`, await machineArtifact(session.id), "application/json");
    await pool.query("UPDATE sessions SET artifact_stored = true WHERE id = $1", [session.id]);
  }
}

export function startRuntime(): void {
  every(250, tick);
  setInterval(publishFrames, 1000 / 30).unref();
  every(2000, reapOrphans);
  every(5000, storeMissingArtifacts);
}
