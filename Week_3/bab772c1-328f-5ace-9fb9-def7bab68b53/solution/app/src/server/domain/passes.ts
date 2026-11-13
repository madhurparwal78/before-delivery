/** The pass state machine: the only place a pass changes state. */

import { createHash } from "node:crypto";
import { pool, withTransaction } from "../db/pool.js";
import { PASS_LOCK, QUOTA_LOCK, withAdvisoryLock } from "../db/locks.js";
import {
  conflict,
  DependencyDown,
  gone,
  searchUnavailable,
  storageUnavailable,
} from "../errors.js";
import {
  deleteCapture,
  getCapture,
  putCapture,
} from "../services/storage.js";
import { deletePassDocuments } from "../services/search.js";
import { recordMissionChange } from "./changes.js";
import { lineId, newId } from "./ids.js";
import { keepRequestKey } from "./requestKeys.js";
import {
  findPassRow,
  findMissionRow,
  metOf,
  PASS_COLUMNS,
  toPass,
  type MissionRow,
  type PassRow,
} from "./missionRead.js";
import { indexOrPend, lineDocument, writePendingWrites, pendRestoreOfPass } from "./searchWrites.js";
import { quotaBytes, usedBytes } from "./plan.js";
import { kickRelay } from "./outbox.js";
import { parseCapture, ParserFailure } from "./captureFormat.js";
import { loadReferenceVectors, residualOf } from "./residuals.js";
import { sendParseAlert } from "./alerts.js";
import type { Pass, RejectionReason } from "../../shared/model.js";

type UploadRequest = {
  mission: MissionRow;
  filename: string;
  declaredSha256: string;
  bytes: Buffer;
  requestKey: string;
  isSeed?: boolean;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Admits the upload against the duplicate and quota rules, as `uploading`. */
export async function admitUpload(request: UploadRequest): Promise<string> {
  return withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1, $2)", [QUOTA_LOCK, QUOTA_LOCK]);
    const duplicate = await tx.query<{ id: string }>(
      `select id from passes where mission_id = $1 and sha256 = $2 and state <> 'deleted' limit 1`,
      [request.mission.id, request.declaredSha256],
    );
    if (duplicate.rows[0]) {
      throw conflict("duplicate_capture", { pass_id: duplicate.rows[0].id });
    }
    const used = await usedBytes(tx);
    const quota = await quotaBytes(tx);
    if (used + request.bytes.length > quota) {
      throw conflict("quota_exceeded", { quota_bytes: quota, used_bytes: used });
    }
    const id = newId();
    await tx.query(
      `insert into passes (id, mission_id, filename, state, size_bytes, sha256, is_seed, created_ms)
       values ($1, $2, $3, 'uploading', $4, $5, $6, $7)`,
      [
        id,
        request.mission.id,
        request.filename,
        request.bytes.length,
        request.declaredSha256,
        request.isSeed === true,
        Date.now(),
      ],
    );
    return id;
  });
}

export async function discardAdmitted(missionId: string, passId: string): Promise<void> {
  await pool.query("delete from passes where id = $1", [passId]);
  await deleteCapture(missionId, passId).catch(() => undefined);
}

/**
 * Stores the capture and settles it as `stored`, queued for parsing in the same
 * transaction. Any failure leaves no pass, object or kept request key behind.
 */
export async function finishUpload(request: UploadRequest, passId: string): Promise<Pass> {
  try {
    await putCapture(request.mission.id, passId, request.bytes);
    const readBack = await getCapture(request.mission.id, passId);
    if (!readBack || sha256Hex(readBack) !== request.declaredSha256) {
      throw new DependencyDown("storage", "stored object does not match its checksum");
    }
  } catch (error) {
    await discardAdmitted(request.mission.id, passId);
    if (error instanceof DependencyDown) {
      throw storageUnavailable();
    }
    throw error;
  }
  try {
    const pass = await withTransaction(async (tx) => {
      const stored = await tx.query<PassRow>(
        `update passes set state = 'stored' where id = $1 and state = 'uploading'
         returning ${PASS_COLUMNS}`,
        [passId],
      );
      const row = stored.rows[0];
      await tx.query(
        "insert into outbox (id, kind, pass_id) values ($1, 'pass.parse', $2)",
        [newId(), passId],
      );
      await recordMissionChange(tx, {
        missionId: request.mission.id,
        kind: "pass.stored",
        data: {
          pass_id: passId,
          filename: request.filename,
          size_bytes: request.bytes.length,
          sha256: request.declaredSha256,
        },
        bumpVersion: false,
      });
      await keepRequestKey(tx, request.mission.id, "upload", request.requestKey, 202, {
        passId,
      });
      return toPass(row);
    });
    kickRelay();
    return pass;
  } catch (error) {
    await discardAdmitted(request.mission.id, passId);
    throw error;
  }
}

/** Removes a settled pass everywhere, or nothing at all. */
export async function deletePass(mission: MissionRow, pass: PassRow): Promise<void> {
  await withAdvisoryLock(PASS_LOCK, pass.id, async () => {
    const current = await findPassRow(pool, pass.id);
    if (current?.state === "deleted") throw gone("pass_deleted");
    let original: Buffer | null;
    try {
      original = await getCapture(mission.id, pass.id);
    } catch {
      throw storageUnavailable();
    }
    let searchConfirmed = false;
    try {
      searchConfirmed = await deletePassDocuments(pass.id);
    } catch {
      searchConfirmed = false;
    }
    if (!searchConfirmed) {
      await pendRestoreOfPass(mission.id, pass.id);
      throw searchUnavailable();
    }
    let removalStarted = false;
    try {
      await withTransaction(async (tx) => {
        await tx.query("select id from missions where id = $1 for no key update", [mission.id]);
        await tx.query("delete from samples where pass_id = $1", [pass.id]);
        await tx.query("delete from transcript_lines where pass_id = $1", [pass.id]);
        await tx.query("delete from events where pass_id = $1", [pass.id]);
        await tx.query("delete from pending_search_writes where pass_id = $1", [pass.id]);
        await tx.query("delete from outbox where kind = 'pass.parse' and pass_id = $1", [pass.id]);
        await tx.query("update passes set state = 'deleted' where id = $1", [pass.id]);
        await recordMissionChange(tx, {
          missionId: mission.id,
          kind: "pass.deleted",
          data: { pass_id: pass.id },
          bumpVersion: true,
          webhook: { eventType: "pass.deleted", data: { pass_id: pass.id } },
        });
        removalStarted = true;
        await deleteCapture(mission.id, pass.id);
      });
    } catch (error) {
      // A lost DELETE response may still have removed the object; restore exact bytes.
      await pendRestoreOfPass(mission.id, pass.id);
      if (removalStarted && original) {
        try { await putCapture(mission.id, pass.id, original); }
        catch { throw storageUnavailable(); }
      }
      if (error instanceof DependencyDown) throw storageUnavailable();
      throw error;
    }
    kickRelay();
  });
}

/** Settles a dead-lettered pass through the same rejection transition. */
export async function markParserFailed(passId: string): Promise<void> {
  await withAdvisoryLock(PASS_LOCK, passId, async () => {
    const pass = await findPassRow(pool, passId);
    if (pass?.state === "stored") await settleRejected(pass.mission_id, pass, null, "parser_failed");
  });
}

type ParseJobResult = "settled" | "skipped" | "storage_down";

export async function runParseJob(passId: string): Promise<ParseJobResult> {
  return withAdvisoryLock(PASS_LOCK, passId, async () => {
    const pass = await findPassRow(pool, passId);
    if (!pass || pass.state !== "stored") {
      return "skipped";
    }
    const mission = await findMissionRow(pool, pass.mission_id);
    if (!mission) {
      return "skipped";
    }
    let bytes: Buffer | null;
    try {
      bytes = await getCapture(mission.id, passId);
    } catch (error) {
      if (error instanceof DependencyDown) {
        return "storage_down";
      }
      throw error;
    }
    if (!bytes) {
      throw new ParserFailure("the stored capture is missing");
    }
  
    const outcome = parseCapture(bytes);
    if (!outcome.ok) {
      await settleRejected(mission.id, pass, outcome.line, outcome.reason);
      return "settled";
    }
  
    const lines = outcome.lines.map((line) => ({
      id: lineId(passId, line.line_no),
      line_no: line.line_no,
      met: metOf(mission, line.utc_ms),
      utc_ms: line.utc_ms,
      speaker: line.speaker,
      text: line.text,
    }));
    const documents = lines.map((line) => lineDocument(mission.id, passId, line));
    const pending = await indexOrPend(
      mission.id,
      passId,
      documents,
      lines.map((line) => ({
        op: "index_line" as const,
        docId: `line-${line.id}`,
        refId: line.id,
      })),
    );
  
    const settled = await withTransaction(async (tx) => {
      await tx.query("select id from missions where id = $1 for no key update", [mission.id]);
      const current = (await findMissionRow(tx, mission.id)) as MissionRow;
      const vectors = current.reference_state === "ready" ? await loadReferenceVectors(tx, mission.id) : [];
      const claimed = await tx.query(
        `update passes set state = 'parsed', sample_count = $2, transcript_line_count = $3
         where id = $1 and state = 'stored' returning id`,
        [passId, outcome.samples.length, lines.length],
      );
      if (claimed.rowCount !== 1) {
        return false;
      }
      const uploadSeq = (
        await tx.query<{ upload_seq: number }>("select upload_seq from passes where id = $1", [
          passId,
        ])
      ).rows[0].upload_seq;
      await tx.query(
        `insert into samples (pass_id, line_no, mission_id, upload_seq, met, utc_ms,
           x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s, lat_deg, lon_deg, altitude_m, speed_m_s, residual_m)
         select $1, line_no, $2, $3, met, utc_ms, x_m, y_m, z_m, vx, vy, vz, lat, lon, alt, speed, residual
         from unnest($4::int[], $5::bigint[], $6::bigint[], $7::float8[], $8::float8[], $9::float8[],
                     $10::float8[], $11::float8[], $12::float8[], $13::float8[], $14::float8[],
                     $15::float8[], $16::float8[], $17::float8[])
           as t(line_no, met, utc_ms, x_m, y_m, z_m, vx, vy, vz, lat, lon, alt, speed, residual)`,
        [
          passId,
          mission.id,
          uploadSeq,
          outcome.samples.map((sample) => sample.line_no),
          outcome.samples.map((sample) => metOf(mission, sample.utc_ms)),
          outcome.samples.map((sample) => sample.utc_ms),
          outcome.samples.map((sample) => sample.x_m),
          outcome.samples.map((sample) => sample.y_m),
          outcome.samples.map((sample) => sample.z_m),
          outcome.samples.map((sample) => sample.vx_m_s),
          outcome.samples.map((sample) => sample.vy_m_s),
          outcome.samples.map((sample) => sample.vz_m_s),
          outcome.samples.map((sample) => sample.lat_deg),
          outcome.samples.map((sample) => sample.lon_deg),
          outcome.samples.map((sample) => sample.altitude_m),
          outcome.samples.map((sample) => sample.speed_m_s),
          outcome.samples.map((sample) =>
            vectors.length > 0 ? residualOf(vectors, sample) : null,
          ),
        ],
      );
      if (lines.length > 0) {
        await tx.query(
          `insert into transcript_lines (id, pass_id, mission_id, upload_seq, line_no, met, utc_ms, speaker, text)
           select id, $1, $2, $3, line_no, met, utc_ms, speaker, text
           from unnest($4::uuid[], $5::int[], $6::bigint[], $7::bigint[], $8::text[], $9::text[])
             as t(id, line_no, met, utc_ms, speaker, text)`,
          [
            passId,
            mission.id,
            uploadSeq,
            lines.map((line) => line.id),
            lines.map((line) => line.line_no),
            lines.map((line) => line.met),
            lines.map((line) => line.utc_ms),
            lines.map((line) => line.speaker),
            lines.map((line) => line.text),
          ],
        );
      }
      await writePendingWrites(tx, pending);
      await recordMissionChange(tx, {
        missionId: mission.id,
        kind: "pass.parsed",
        data: {
          pass_id: passId,
          sample_count: outcome.samples.length,
          transcript_line_count: lines.length,
        },
        bumpVersion: !pass.is_seed,
        ...(pass.is_seed
          ? {}
          : {
              webhook: {
                eventType: "pass.parsed" as const,
                data: {
                  pass: {
                    id: passId,
                    filename: pass.filename,
                    size_bytes: pass.size_bytes,
                    sha256: pass.sha256,
                    sample_count: outcome.samples.length,
                    transcript_line_count: lines.length,
                  },
                },
              },
            }),
      });
      return true;
    });
  
    if (!settled) {
      return "skipped";
    }
    kickRelay();
    if (!pass.is_seed) {
      await sendParseAlert(mission, pass, {
        kind: "parsed",
        sampleCount: outcome.samples.length,
        lineCount: lines.length,
        firstSampleMet: metOf(mission, outcome.samples[0].utc_ms),
      });
    }
    return "settled";
  });
}

async function settleRejected(
  missionId: string,
  pass: { id: string; filename: string; size_bytes: number; sha256: string; is_seed: boolean },
  line: number | null,
  reason: RejectionReason,
): Promise<void> {
  const mission = await findMissionRow(pool, missionId);
  if (!mission) {
    return;
  }
  const settled = await withTransaction(async (tx) => {
    const claimed = await tx.query(
      `update passes set state = 'rejected', rejected_line = $2, rejected_reason = $3
       where id = $1 and state = 'stored' returning id`,
      [pass.id, line, reason],
    );
    if (claimed.rowCount !== 1) {
      return false;
    }
    await recordMissionChange(tx, {
      missionId,
      kind: "pass.rejected",
      data: { pass_id: pass.id, rejected_line: line, rejected_reason: reason },
      bumpVersion: !pass.is_seed,
      ...(pass.is_seed
        ? {}
        : {
            webhook: {
              eventType: "pass.rejected" as const,
              data: {
                pass: {
                  id: pass.id,
                  filename: pass.filename,
                  size_bytes: pass.size_bytes,
                  sha256: pass.sha256,
                  rejected_line: line,
                  rejected_reason: reason,
                },
              },
            },
          }),
    });
    return true;
  });
  if (!settled) {
    return;
  }
  kickRelay();
  if (!pass.is_seed) {
    await sendParseAlert(mission, pass, { kind: "rejected", line, reason });
  }
}
