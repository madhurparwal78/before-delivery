// Signing links and signing. Only the newest link works; it expires at send time plus its lifetime or at the hold
// deadline, whichever is first. Signing stores the agreement PDF before anything is committed.

import { createHash } from "node:crypto";
import type { User } from "../../shared/api.js";
import { formatDateTime, isoSecond } from "../../shared/storeTime.js";
import { instrumentLabel } from "../../shared/vocabulary.js";
import { config } from "../config.js";
import { now, nowSecond, serverNowStamp, storeToday } from "../clock.js";
import { inTransaction, pool, query, transaction, withClient, withContractLock, type Db } from "../db/pool.js";
import { ApiError, invalidTransition, notFound, validationFailed } from "../http/errors.js";
import { fieldOf, randomToken, trimmedText } from "../http/fields.js";
import { appLink, queueEmail } from "../services/mail.js";
import { agreementKey, deleteWritten, putObject } from "../services/storage.js";
import { lockedRow, ownerActor } from "./closing.js";
import { moveContract } from "./contractStates.js";
import { contractBody, freshContractBody, loadContractRow, requireVisible, type ContractRow } from "./contracts.js";
import { agreementPdf } from "./documents.js";
import { contractTerms, inForceOn, loadPriceLists } from "./terms.js";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function sendSigningLink(user: User, id: string): Promise<unknown> {
  await requireVisible(user, id);
  return transaction(async (db) => {
    await db.query("SELECT 1 FROM contracts WHERE id = $1 FOR UPDATE", [id]);
    const row = await lockedRow(db, id);
    if (row.status !== "reserved" && row.status !== "agreement_sent") throw invalidTransition();
    const sentAt = nowSecond();
    const lifetimeEnd = new Date(sentAt.getTime() + config.signingLinkSeconds * 1000);
    const expiresAt = row.hold_expires_at !== null && row.hold_expires_at < lifetimeEnd ? row.hold_expires_at : lifetimeEnd;
    const token = randomToken(24);
    await db.query("UPDATE signing_links SET state = 'replaced' WHERE contract_id = $1 AND state = 'live'", [id]);
    await db.query("INSERT INTO signing_links (token_hash, contract_id, sent_at, expires_at, state) VALUES ($1, $2, $3, $4, 'live')",
      [tokenHash(token), id, sentAt, expiresAt]);
    await moveContract(db, { id, from: row.status, to: "agreement_sent", actor: ownerActor(user), at: sentAt });
    const label = instrumentLabel(row.instrument_type, row.size);
    await queueEmail(db, {
      to: row.parent_email, subject: `Sign your rental agreement — ${row.student_name}, ${label}`,
      body: [`Dear ${row.parent_name},`, "", `Your rental agreement for ${row.student_name}'s ${label} (serial ${row.instrument_serial}) is ready to sign.`,
        "", `Sign it here: ${appLink(`/sign/${token}`)}`, "", `This link works until ${formatDateTime(expiresAt)}.`, "",
        "Keel & Bell Music"].join("\n"),
    });
    return { contract: await freshContractBody(db, id) };
  });
}

export async function revokeSigningLink(user: User, id: string): Promise<unknown> {
  await requireVisible(user, id);
  return transaction(async (db) => {
    await db.query("SELECT 1 FROM contracts WHERE id = $1 FOR UPDATE", [id]);
    const revoked = await db.query(`UPDATE signing_links l SET state = 'revoked' FROM contracts c
      WHERE l.contract_id = $1 AND c.id = l.contract_id AND l.state = 'live' AND l.expires_at > $2
        AND c.status = 'agreement_sent'`, [id, now()]);
    if (revoked.rowCount === 0) throw new ApiError(409, "no_live_link", "There is no live signing link to revoke.");
    return { contract: await freshContractBody(db, id) };
  });
}

interface LinkRecord { contract_id: string; state: "live" | "revoked" | "used" | "replaced"; expires_at: Date }

/** The 404 and 410 checks of a signing token, in order; returns the link's contract when the link is live. */
async function liveLink(db: Db, token: string): Promise<{ link: LinkRecord; row: ContractRow }> {
  const [link] = await query<LinkRecord>(db,
    "SELECT contract_id, state, expires_at FROM signing_links WHERE token_hash = $1", [tokenHash(token)]);
  if (link === undefined || link.state === "revoked" || link.state === "replaced") {
    throw notFound("link_not_found", "This signing link is not valid.");
  }
  if (link.state === "used") throw new ApiError(410, "link_used", "This agreement has already been signed.");
  const row = await loadContractRow(db, link.contract_id);
  if (row === undefined || link.expires_at <= now() || row.status !== "agreement_sent") {
    throw new ApiError(410, "link_expired", "This signing link has expired.");
  }
  return { link, row };
}

export async function readAgreement(token: string): Promise<unknown> {
  return withClient(async (db) => {
    const { link, row } = await liveLink(db, token);
    return {
      agreement: {
        contract_id: row.id, student_name: row.student_name, school_name: row.school_name,
        instrument_label: instrumentLabel(row.instrument_type, row.size), serial: row.instrument_serial,
        waiver: row.waiver, terms: (await contractBody(db, row)).terms, link_expires_at: isoSecond(link.expires_at),
        status: "agreement_sent",
      },
      server_now: serverNowStamp(),
    };
  });
}

export async function signAgreement(token: string, body: unknown): Promise<unknown> {
  const [found] = await query<{ contract_id: string }>(pool, "SELECT contract_id FROM signing_links WHERE token_hash = $1",
    [tokenHash(token)]);
  if (found === undefined) throw notFound("link_not_found", "This signing link is not valid.");
  return withContractLock(found.contract_id, async (db) => {
    const { row } = await liveLink(db, token);
    const fullName = trimmedText(fieldOf(body, "full_name"), 2, 120);
    const fields: Record<string, string> = {};
    if (fullName === null) fields.full_name = "invalid";
    if (fieldOf(body, "agree") !== true) fields.agree = "invalid";
    if (fullName === null || Object.keys(fields).length > 0) throw validationFailed(fields);
    const signedAt = nowSecond();
    const lists = await loadPriceLists(db);
    const today = storeToday();
    const bound = inForceOn(lists, today);
    const terms = contractTerms({ instrument_type: row.instrument_type, price_list_id: bound.id }, lists, today);
    const key = agreementKey(row.id);
    await putObject(key, agreementPdf(row, terms, fullName, signedAt), "application/pdf");
    try {
      await inTransaction(db, async () => {
        await db.query("UPDATE signing_links SET state = 'used' WHERE token_hash = $1", [tokenHash(token)]);
        await moveContract(db, { id: row.id, from: "agreement_sent", to: "signed",
          actor: { actor: "parent", actor_name: fullName }, at: signedAt,
          set: { signed_at: signedAt, price_list_id: bound.id, signer_name: fullName, agreement_stored: true } });
      });
    } catch (error) {
      await deleteWritten([key]);
      throw error;
    }
    return { agreement: { contract_id: row.id, status: "signed", signed_at: isoSecond(signedAt) } };
  });
}
