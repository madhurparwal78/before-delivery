/** Settling a stored pass: the parse transaction, its search writes and its push alert. */

import { pool, withTransaction } from "../db/pool.js";
import { DependencyDown } from "../errors.js";
import { getCapture } from "../services/storage.js";
import { parseCapture, ParserFailure } from "./captureFormat.js";
import { findMissionRow, findPassRow, metOf } from "./missionRead.js";
import { recordMissionChange } from "./changes.js";
import { lineId } from "./ids.js";
import { indexOrPend, lineDocument, writePendingWrites } from "./searchWrites.js";
import { loadReferenceVectors, residualOf } from "./residuals.js";
import { sendParseAlert } from "./alerts.js";
import { kickRelay } from "./outbox.js";
import type { RejectionReason } from "../../shared/model.js";

export type ParseJobResult = "settled" | "skipped" | "storage_down";

export async function runParseJob(passId: string): Promise<ParseJobResult> {
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

  const vectors =
    mission.reference_state === "ready" ? await loadReferenceVectors(pool, mission.id) : [];
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
