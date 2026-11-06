// Exhibit uploads: filing-safe checks decided from the body alone, then
// staging, read-back verification and create-only publishing. Each upload
// adds its own pending and final versions, serialised by the row lock.

import type { Request, Response } from "express";
import { pool, withTransaction } from "./db.js";
import { errors } from "./errors.js";
import { checkFilingSafe, FILING_SAFE_MESSAGES } from "./filingsafe.js";
import { stageIncoming, publishExhibit } from "./vault.js";
import { writeAudit } from "./audit.js";
import { readExhibitBody } from "./http.js";
import type { RestatementState } from "./types.js";
import { restatementBody } from "./serialize.js";
import { marketNow } from "./clock.js";
import * as staff from "./staff.js";
import { checkRole } from "./restatement.js";

export async function handleExhibitUpload(req: Request, res: Response): Promise<void> {
  const token = cookieToken(req);
  const auth = await staff.authenticate(token);
  if (!auth) throw errors.unauthenticated();
  const userId = auth.user.id;
  checkRole(auth.user.roles, "treasury_analyst");

  const shaHeader = req.header("x-exhibit-sha256");
  const fields: Record<string, string> = {};
  if (shaHeader === undefined || !/^[0-9a-f]{64}$/.test(shaHeader)) {
    fields.sha256 = "Send the file's SHA-256 in the X-Exhibit-SHA256 header.";
  }

  const body = await readExhibitBody(req);
  const restatementId = req.params.id ?? "";

  // Decided from the database and body alone, before the vault is contacted.
  const record = await lockRestatement(restatementId);
  if (record.prepared_by !== userId) throw errors.notPreparer();
  if (record.state !== "draft" && record.state !== "returned") throw errors.invalidTransition();
  if (record.accession === null) {
    fields.accession = "Save the accession number before attaching an exhibit.";
  }
  const filingSafe = checkFilingSafe(body);
  if (!filingSafe.ok) {
    fields.file = FILING_SAFE_MESSAGES[filingSafe.reason ?? "incomplete_pdf"];
  }
  if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);

  // Stage, read back and verify.
  let staged: { key: string; sha256: string };
  try {
    staged = await stageIncoming(restatementId, body);
  } catch {
    throw errors.vaultUnavailable();
  }

  const now = await marketNow();
  const verified = staged.sha256 === shaHeader;
  const exhibitKey = verified ? `exhibits/${record.accession}/${staged.sha256}.pdf` : null;

  if (verified) {
    try {
      await publishExhibit(record.accession as string, staged.sha256, body);
    } catch {
      throw errors.vaultUnavailable();
    }
  }

  // Both steps are stored only after the vault has answered every step of
  // the upload. The row lock keeps simultaneous uploads in order.
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT version, state FROM restatements WHERE id = $1 FOR UPDATE`, [
      restatementId,
    ]);
    const current = rows[0] as { version: number; state: RestatementState };
    if (current.state !== "draft" && current.state !== "returned") throw errors.invalidTransition();
    const pendingVersion = current.version + 1;
    await writeAudit(client, restatementId, pendingVersion, "exhibit_pending", userId, now, current.state, current.state, null);
    const finalVersion = pendingVersion + 1;
    await client.query(
      `UPDATE restatements SET version = $2, updated_at = $3,
          exhibit_sha256 = $4, exhibit_status = $5, exhibit_bytes = $6, exhibit_key = $7
        WHERE id = $1`,
      [
        restatementId,
        finalVersion,
        String(now),
        verified ? staged.sha256 : (shaHeader as string),
        verified ? "verified" : "rejected",
        body.length,
        verified ? exhibitKey : null,
      ],
    );
    await writeAudit(
      client,
      restatementId,
      finalVersion,
      verified ? "exhibit_verified" : "exhibit_rejected",
      userId,
      now,
      current.state,
      current.state,
      null,
    );
  });

  if (!verified) {
    throw errors.validationFailed({ sha256: "The vault copy's SHA-256 does not match the file you chose." });
  }

  const { rows: fresh } = await pool.query(`SELECT id FROM restatements WHERE id = $1`, [restatementId]);
  if (fresh.length === 0) throw errors.notFound();
  const { getRestatement } = await import("./restatement.js");
  res.status(201).json({ restatement: restatementBody(await getRestatement(restatementId)) });
}

interface LockedRecord {
  prepared_by: string;
  state: string;
  accession: string | null;
  exhibit_sha256: string | null;
  exhibit_bytes: number | null;
  exhibit_key: string | null;
}

async function lockRestatement(id: string): Promise<LockedRecord> {
  const { rows } = await pool.query(`SELECT prepared_by, state, accession, exhibit_sha256, exhibit_bytes, exhibit_key FROM restatements WHERE id = $1`, [id]);
  if (rows.length === 0) throw errors.notFound();
  return rows[0] as LockedRecord;
}

function cookieToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "tw_session") return rest.join("=");
  }
  return undefined;
}
