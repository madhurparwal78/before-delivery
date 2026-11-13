// The pass state machine. Each transition is decided in exactly one place;
// routes and consumers never set a pass state directly.

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { recordChange } from "./change.js";
import { REASON_TEXT, parseCapture, type ParsedLine, type ParsedSample } from "./parse.js";

export interface StoreUploadParams {
  missionId: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  bytes: Buffer;
}

// uploading -> stored. Only after storage acknowledges the write and the object
// read back hashes to the declared checksum.
export async function transitionStored(
  client: PoolClient,
  pass: { id: string; missionId: string; filename: string; sizeBytes: number; sha256: string },
  bytes: Buffer,
): Promise<void> {
  // The caller has already verified storage and the read-back hash.
  const outboxId = randomUUID();
  await client.query(
    `INSERT INTO outbox (id, kind, pass_id, created_at) VALUES ($1, 'pass.parse', $2, $3)`,
    [outboxId, pass.id, new Date().toISOString()],
  );
  await recordChange(
    client,
    pass.missionId,
    {
      kind: "pass.stored",
      data: {
        pass_id: pass.id,
        filename: pass.filename,
        size_bytes: pass.sizeBytes,
        sha256: pass.sha256,
      },
    },
    { bumpVersion: false },
  );
}

// stored -> parsed or rejected. Called only from the parse consumer.
export interface SettleResult {
  state: "parsed" | "rejected";
  sampleCount: number;
  lineCount: number;
  rejectedLine: number | null;
  rejectedReason: string | null;
  version: number;
}

export async function transitionSettled(
  client: PoolClient,
  pass: {
    id: string;
    missionId: string;
    filename: string;
    sha256: string;
    sizeBytes: number;
  },
  samples: ParsedSample[],
  lines: ParsedLine[],
  rejection: { line: number; reason: keyof typeof REASON_TEXT } | null,
  searchConfirmed: boolean,
): Promise<SettleResult> {
  const epochMs = await missionEpochMs(client, pass.missionId);

  if (rejection === null) {
    // Insert samples and lines, then the audit entry and webhook outbox row in
    // this same transaction.
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      await client.query(
        `INSERT INTO samples (pass_id, mission_id, seq, utc_ms, met, x, y, z, vx, vy, vz,
                               lat_deg, lon_deg, altitude_m, speed_m_s, residual_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NULL)`,
        [
          pass.id,
          pass.missionId,
          i,
          s.utcMs,
          Math.round((s.utcMs - epochMs) / 1000),
          s.x,
          s.y,
          s.z,
          s.vx,
          s.vy,
          s.vz,
          s.lat_deg,
          s.lon_deg,
          s.altitude_m,
          s.speed_m_s,
        ],
      );
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const met = Math.round((l.utcMs - epochMs) / 1000);
      await client.query(
        `INSERT INTO transcript_lines (id, pass_id, mission_id, seq, utc_ms, met, speaker, text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), pass.id, pass.missionId, i, l.utcMs, met, l.speaker, l.text],
      );
    }
    await client.query(
      `UPDATE passes SET state = 'parsed', sample_count = $2, transcript_line_count = $3 WHERE id = $1`,
      [pass.id, samples.length, lines.length],
    );
    const parsed = await recordParsedChange(client, pass, samples.length, lines.length);
    return {
      state: "parsed",
      sampleCount: samples.length,
      lineCount: lines.length,
      rejectedLine: null,
      rejectedReason: null,
      version: parsed.version,
    };
  }

  await client.query(
    `UPDATE passes SET state = 'rejected', rejected_line = $2, rejected_reason = $3 WHERE id = $1`,
    [pass.id, rejection.line, rejection.reason],
  );
  const rejected = await recordRejectedChange(client, pass, rejection.line, rejection.reason);
  return {
    state: "rejected",
    sampleCount: 0,
    lineCount: 0,
    rejectedLine: rejection.line,
    rejectedReason: rejection.reason,
    version: rejected.version,
  };
}

async function recordParsedChange(
  client: PoolClient,
  pass: { id: string; missionId: string; filename: string; sizeBytes: number; sha256: string },
  sampleCount: number,
  lineCount: number,
): Promise<{ version: number }> {
  const change = await recordChange(
    client,
    pass.missionId,
    {
      kind: "pass.parsed",
      data: {
        pass_id: pass.id,
        sample_count: sampleCount,
        transcript_line_count: lineCount,
      },
      webhook: {
        event: "pass.parsed",
        payloadData: {
          pass: {
            id: pass.id,
            filename: pass.filename,
            size_bytes: pass.sizeBytes,
            sha256: pass.sha256,
            sample_count: sampleCount,
            transcript_line_count: lineCount,
          },
        },
      },
    },
    { bumpVersion: true },
  );
  return { version: change.version };
}

async function recordRejectedChange(
  client: PoolClient,
  pass: { id: string; missionId: string; filename: string; sha256: string; sizeBytes: number },
  rejectedLine: number | null,
  rejectedReason: string,
): Promise<{ version: number }> {
  const change = await recordChange(
    client,
    pass.missionId,
    {
      kind: "pass.rejected",
      data: {
        pass_id: pass.id,
        rejected_line: rejectedLine,
        rejected_reason: rejectedReason,
      },
      webhook: {
        event: "pass.rejected",
        payloadData: {
          pass: {
            id: pass.id,
            filename: pass.filename,
            size_bytes: pass.sizeBytes,
            sha256: pass.sha256,
            rejected_line: rejectedLine,
            rejected_reason: rejectedReason,
          },
        },
      },
    },
    { bumpVersion: true },
  );
  return { version: change.version };
}

export async function transitionParserFailed(
  client: PoolClient,
  pass: { id: string; missionId: string; filename: string; sha256: string; sizeBytes: number },
): Promise<void> {
  await client.query(
    `UPDATE passes SET state = 'rejected', rejected_line = NULL, rejected_reason = 'parser_failed' WHERE id = $1`,
    [pass.id],
  );
  await recordRejectedChange(client, pass, null, "parser_failed");
}

async function missionEpochMs(client: PoolClient, missionId: string): Promise<number> {
  const result = await client.query("SELECT epoch_ms FROM missions WHERE id = $1", [missionId]);
  return Number(result.rows[0].epoch_ms);
}

// parsed or rejected -> deleted.
export async function transitionDeleted(
  client: PoolClient,
  pass: { id: string; missionId: string },
): Promise<void> {
  await recordChange(
    client,
    pass.missionId,
    {
      kind: "pass.deleted",
      data: { pass_id: pass.id },
      webhook: { event: "pass.deleted", payloadData: { pass_id: pass.id } },
    },
    { bumpVersion: true },
  );
  await client.query("UPDATE passes SET deleted = TRUE WHERE id = $1", [pass.id]);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function rejectionReasonText(reason: string): string {
  if (reason === "parser_failed") return "the parser stopped unexpectedly";
  if (reason in REASON_TEXT) return REASON_TEXT[reason as keyof typeof REASON_TEXT];
  return reason;
}

export { parseCapture };
