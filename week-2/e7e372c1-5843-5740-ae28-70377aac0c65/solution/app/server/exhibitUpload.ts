// Attaching an exhibit: filing-safe checks, staging in the vault, read-back, hash comparison,
// create-only publication, then both version steps stored together under the row lock.

import { createHash, randomUUID } from "node:crypto";
import { withTransaction, type Queryable } from "./db.ts";
import { readMarketClock } from "./clock.ts";
import { SHA256_PATTERN } from "./exhibitAccess.ts";
import { Refusal } from "./errors.ts";
import { filingSafeRefusal } from "./filingSafe.ts";
import { applyChange, factsOf, findRestatement, type Restatement } from "./restatements.ts";
import { decide, type Actor } from "../shared/restatementRules.ts";
import { getObject, putObject, putObjectOnce } from "./vault.ts";

const MISSING_ACCESSION = "Save the accession number before attaching an exhibit.";
const MISMATCH = "The vault copy's SHA-256 does not match the file you chose.";

async function permitted(q: Queryable, id: string, actor: Actor, lock: boolean): Promise<Restatement> {
  const restatement = await findRestatement(q, id, lock);
  if (!restatement) throw new Refusal("not_found");
  const verdict = decide("upload", factsOf(restatement), { actor, marketNow: (await readMarketClock(q)).now });
  if (!verdict.allowed) throw new Refusal(verdict.code);
  return restatement;
}

export async function uploadExhibit(actor: Actor, id: string, body: Buffer, claimedSha256: string | undefined): Promise<Restatement> {
  const restatement = await withTransaction((tx) => permitted(tx, id, actor, false));
  const fields: Record<string, string> = {};
  const fileProblem = filingSafeRefusal(body);
  if (fileProblem) fields["file"] = fileProblem;
  if (restatement.accession === null) fields["accession"] = MISSING_ACCESSION;
  if (claimedSha256 === undefined || !SHA256_PATTERN.test(claimedSha256)) fields["sha256"] = "Send the SHA-256 of the file as 64 lowercase hex characters.";
  if (Object.keys(fields).length > 0 || restatement.accession === null || claimedSha256 === undefined) throw new Refusal("validation_failed", fields);

  const stagingKey = `incoming/${restatement.id}/${randomUUID()}.pdf`;
  await putObject(stagingKey, body, "application/pdf");
  const stagedHash = createHash("sha256").update(await getObject(stagingKey)).digest("hex");
  const matches = stagedHash === claimedSha256;
  const publishedKey = `exhibits/${restatement.accession}/${claimedSha256}.pdf`;
  if (matches) await putObjectOnce(publishedKey, body, "application/pdf");

  const stored = await withTransaction(async (tx) => {
    const locked = await permitted(tx, id, actor, true);
    if (locked.accession !== restatement.accession) throw new Refusal("invalid_transition");
    const at = (await readMarketClock(tx)).now;
    const pending = await applyChange(tx, locked, { action: "exhibit_pending", actorId: actor.id, at, toState: locked.state });
    return applyChange(tx, pending, {
      action: matches ? "exhibit_verified" : "exhibit_rejected",
      actorId: actor.id,
      at,
      toState: pending.state,
      set: {
        exhibit_status: matches ? "verified" : "rejected",
        exhibit_sha256: claimedSha256,
        exhibit_bytes: body.length,
        exhibit_key: matches ? publishedKey : null,
      },
    });
  });
  if (!matches) throw new Refusal("validation_failed", { sha256: MISMATCH });
  return stored;
}
