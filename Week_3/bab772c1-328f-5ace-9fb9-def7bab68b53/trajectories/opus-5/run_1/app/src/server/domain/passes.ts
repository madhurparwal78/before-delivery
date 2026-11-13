/** The pass state machine: the only place a pass changes state. */

import { createHash } from "node:crypto";
import { pool, withTransaction, type Queryable } from "../db/pool.js";
import { QUOTA_LOCK } from "../db/locks.js";
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
  probeStorage,
  putCapture,
} from "../services/storage.js";
import { deletePassDocuments } from "../services/search.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import { keepRequestKey } from "./requestKeys.js";
import {
  findPassRow,
  PASS_COLUMNS,
  toPass,
  type MissionRow,
  type PassRow,
} from "./missionRead.js";
import { pendRestoreOfPass } from "./searchWrites.js";
import { quotaBytes, usedBytes } from "./plan.js";
import { kickRelay } from "./outbox.js";
import type { Pass } from "../../shared/model.js";

export type UploadRequest = {
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
  if (!(await probeStorage())) {
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
  await withTransaction(async (tx) => {
    const claimed = await tx.query(
      `update passes set state = 'deleted' where id = $1 and state in ('parsed', 'rejected')
       returning id`,
      [pass.id],
    );
    if (claimed.rowCount !== 1) {
      throw gone("pass_deleted");
    }
    await tx.query("delete from samples where pass_id = $1", [pass.id]);
    await tx.query("delete from transcript_lines where pass_id = $1", [pass.id]);
    await tx.query("delete from events where pass_id = $1", [pass.id]);
    await tx.query("delete from pending_search_writes where pass_id = $1", [pass.id]);
    await tx.query("delete from outbox where kind = 'pass.parse' and pass_id = $1", [pass.id]);
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "pass.deleted",
      data: { pass_id: pass.id },
      bumpVersion: true,
      webhook: { eventType: "pass.deleted", data: { pass_id: pass.id } },
    });
  });
  await deleteCapture(mission.id, pass.id).catch(() => undefined);
  kickRelay();
}

export async function reloadPass(passId: string): Promise<PassRow | null> {
  return findPassRow(pool, passId);
}

/** Counts one parse attempt that ended in a parser failure. */
export async function recordParserFailure(passId: string): Promise<number> {
  const result = await pool.query<{ parse_attempts: number }>(
    "update passes set parse_attempts = parse_attempts + 1 where id = $1 returning parse_attempts",
    [passId],
  );
  return result.rows[0]?.parse_attempts ?? 0;
}

/** Settles a dead-lettered pass as `parser_failed`; true when this call settled it. */
export async function markParserFailed(passId: string): Promise<boolean> {
  const pass = await findPassRow(pool, passId);
  if (!pass || pass.state !== "stored") {
    return false;
  }
  const settled = await withTransaction(async (tx: Queryable) => {
    const claimed = await tx.query(
      `update passes set state = 'rejected', rejected_line = null, rejected_reason = 'parser_failed'
       where id = $1 and state = 'stored' returning id`,
      [passId],
    );
    if (claimed.rowCount !== 1) {
      return false;
    }
    await recordMissionChange(tx, {
      missionId: pass.mission_id,
      kind: "pass.rejected",
      data: { pass_id: passId, rejected_line: null, rejected_reason: "parser_failed" },
      bumpVersion: !pass.is_seed,
      ...(pass.is_seed
        ? {}
        : {
            webhook: {
              eventType: "pass.rejected" as const,
              data: {
                pass: {
                  id: passId,
                  filename: pass.filename,
                  size_bytes: pass.size_bytes,
                  sha256: pass.sha256,
                  rejected_line: null,
                  rejected_reason: "parser_failed",
                },
              },
            },
          }),
    });
    return true;
  });
  if (settled) {
    kickRelay();
  }
  return settled;
}
