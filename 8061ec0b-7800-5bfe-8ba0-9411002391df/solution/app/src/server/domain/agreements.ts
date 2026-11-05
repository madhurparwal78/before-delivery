// Signed agreement objects: streamed when stored; for the three seeded contracts generated once, the first time
// they are needed (a download or an exchange), from the bound version and the seeded signature.

import { storeToday } from "../clock.js";
import { query, withContractLock, type Db } from "../db/pool.js";
import { notFound } from "../http/errors.js";
import type { Reply, Request } from "../http/router.js";
import { agreementKey, getObject, putObject } from "../services/storage.js";
import { lockedRow } from "./closing.js";
import { requireVisible, type ContractRow } from "./contracts.js";
import { agreementPdf } from "./documents.js";
import { contractTerms, loadPriceLists, versionOf } from "./terms.js";

function agreementNotStored(): Error {
  return notFound("agreement_not_stored", "No signed agreement is stored for this contract.");
}

/** The seeded signing time of a seeded contract whose agreement has never been generated, else null. */
export function pendingSeededSignature(row: ContractRow): Date | null {
  return !row.agreement_stored && row.seeded_agreement ? row.signed_at : null;
}

/** Renders a seeded contract's agreement: bound version and its tax rate, the family's parent, the seeded time. */
export async function generateSeededAgreement(db: Db, row: ContractRow, signedAt: Date): Promise<Buffer> {
  const lists = await loadPriceLists(db);
  const terms = contractTerms(row, lists, storeToday());
  return agreementPdf(row, { ...terms, tax_rate_bp: versionOf(lists, terms.price_list_id).tax_rate_bp },
    row.parent_name, signedAt);
}

/** The agreement's bytes for a contract that has one stored. */
export async function storedAgreement(id: string): Promise<Buffer> {
  const bytes = await getObject(agreementKey(id));
  if (bytes === null) throw agreementNotStored();
  return bytes;
}

export async function downloadAgreement(request: Request, id: string): Promise<Reply> {
  const visible = await requireVisible(request.user, id);
  const pdf = (bytes: Buffer): Reply => ({ status: 200, bytes, type: "application/pdf",
    disposition: `inline; filename="agreement-${id}.pdf"` });
  if (visible.agreement_stored) return pdf(await storedAgreement(id));
  if (pendingSeededSignature(visible) === null) throw agreementNotStored();
  return withContractLock(id, async (db) => {
    const row = await lockedRow(db, id);
    const signedAt = pendingSeededSignature(row);
    if (signedAt === null) return pdf(await storedAgreement(id));
    const bytes = await generateSeededAgreement(db, row, signedAt);
    await putObject(agreementKey(id), bytes, "application/pdf");
    await query(db, "UPDATE contracts SET agreement_stored = true WHERE id = $1", [id]);
    return pdf(bytes);
  });
}
