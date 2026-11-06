// Read-only compliance links for inspectors and landlords, and what a live link shows.

import { randomBytes, randomUUID } from "node:crypto";
import type { ComplianceLinkView, ShareView, SharedDocumentView } from "../../shared/api.js";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, isDocumentCurrent } from "../../shared/documents.js";
import { iso, kitchenToday, now } from "../clock.js";
import { one, only, pool, rows } from "../db.js";
import { isLinkLive } from "../../shared/complianceLinks.js";
import type { JsonObject } from "../http/body.js";
import { FieldErrors, fail, notFound } from "../http/errors.js";
import type { DocumentRow } from "./documents.js";

interface LinkRow {
  id: string;
  label: string;
  token: string;
  expires_in_seconds: number;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function linkView(row: LinkRow): ComplianceLinkView {
  return {
    id: row.id,
    label: row.label,
    token: row.token,
    url: `/share/${row.token}`,
    expires_in_seconds: row.expires_in_seconds,
    expires_at: iso(row.expires_at),
    revoked_at: row.revoked_at ? iso(row.revoked_at) : null,
    created_at: iso(row.created_at),
  };
}

const newToken = (): string => randomBytes(32).toString("base64url");

export async function createLink(body: JsonObject): Promise<ComplianceLinkView> {
  const errors = new FieldErrors();
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (label.length < 1 || label.length > 80) errors.add("label", "Give the link a label of up to 80 characters.");
  const seconds = body.expires_in_seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 30 || seconds > 2_592_000) {
    errors.add("expires_in_seconds", "Choose an expiry from 30 seconds to 30 days.");
  }
  if (typeof seconds !== "number" || !errors.empty) throw errors.error();
  const at = now();
  return linkView(
    await only<LinkRow>(
      pool,
      `INSERT INTO compliance_links (id, label, token, expires_in_seconds, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), label, newToken(), seconds, iso(at + seconds * 1000), iso(at)],
    ),
  );
}

export async function listLinks(): Promise<ComplianceLinkView[]> {
  return (await rows<LinkRow>(pool, "SELECT * FROM compliance_links ORDER BY created_at DESC")).map(linkView);
}

/** Changes a link that is not revoked; a revoked one answers already_revoked (the guard is in the UPDATE). */
async function changeUnrevoked(sql: string, params: unknown[]): Promise<ComplianceLinkView> {
  const row = await one<LinkRow>(pool, sql, params);
  if (!row) throw fail(409, "already_revoked");
  return linkView(row);
}

export function revokeLink(linkId: string): Promise<ComplianceLinkView> {
  return changeUnrevoked("UPDATE compliance_links SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *", [linkId, iso(now())]);
}

/** A new token valid for the link's original span from now; the old token dies at once. */
export function regenerateLink(linkId: string): Promise<ComplianceLinkView> {
  return changeUnrevoked(
    `UPDATE compliance_links SET token = $2, expires_at = $3::timestamptz + make_interval(secs => expires_in_seconds)
      WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
    [linkId, newToken(), iso(now())],
  );
}

/** A link is live while it is not revoked and the clock is strictly before its expiry. */
async function liveLink(token: string): Promise<LinkRow> {
  const row = await one<LinkRow>(pool, "SELECT * FROM compliance_links WHERE token = $1", [token]);
  if (!row || !isLinkLive(row.revoked_at !== null, row.expires_at.getTime(), now())) throw notFound();
  return row;
}

interface SharedDocumentRow extends DocumentRow {
  business_name: string;
}

/** Each active or suspended renter's latest current approved document of each kind. */
async function sharedDocuments(token: string): Promise<{ business_name: string; documents: SharedDocumentView[] }[]> {
  const today = kitchenToday();
  const found = await rows<SharedDocumentRow>(
    pool,
    `SELECT d.*, r.business_name FROM documents d JOIN renters r ON r.id = d.renter_id
      WHERE r.status IN ('active', 'suspended') AND d.status = 'approved'
      ORDER BY r.business_name, r.id, d.seq DESC`,
  );
  const byRenter = new Map<string, { business_name: string; documents: SharedDocumentView[] }>();
  for (const document of found.filter((d) => isDocumentCurrent(d, today))) {
    const entry = byRenter.get(document.renter_id) ?? { business_name: document.business_name, documents: [] };
    if (!entry.documents.some((shown) => shown.kind === document.kind)) {
      entry.documents.push({
        id: document.id,
        kind: document.kind,
        label: DOCUMENT_LABEL[document.kind],
        expires_on: document.expires_on,
        file_url: `/api/share/${token}/documents/${document.id}`,
      });
    }
    byRenter.set(document.renter_id, entry);
  }
  return [...byRenter.values()].map((entry) => ({
    ...entry,
    documents: [...entry.documents].sort((a, b) => DOCUMENT_KINDS.indexOf(a.kind) - DOCUMENT_KINDS.indexOf(b.kind)),
  }));
}

export async function shareView(token: string): Promise<ShareView> {
  await liveLink(token);
  const kitchen = await only<{ name: string; address: string }>(pool, "SELECT name, address FROM kitchen");
  return { kitchen, renters: await sharedDocuments(token) };
}

/** The object key of a document the live link lists, or 404. */
export async function sharedDocumentKey(token: string, documentId: string): Promise<string> {
  await liveLink(token);
  for (const renter of await sharedDocuments(token)) {
    if (renter.documents.some((document) => document.id === documentId)) {
      return (await only<{ object_key: string }>(pool, "SELECT object_key FROM documents WHERE id = $1", [documentId])).object_key;
    }
  }
  throw notFound();
}
