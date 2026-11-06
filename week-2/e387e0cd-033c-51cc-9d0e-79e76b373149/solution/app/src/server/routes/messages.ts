// Signed messages from counterparty exchanges: verified on the raw bytes, kept byte for byte in MinIO before the
// desk answers, worked from a separate parsed copy. Also the data request pages and their certificates.
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { allow, digest, staff } from "../auth.js";
import { lockName, one, pool, rows, tx } from "../db.js";
import { FieldCheck, refuse } from "../errors.js";
import { stringifyMoneyJson } from "../../shared/json.js";
import { type Reply, type Router } from "../http.js";
import { sniffImage, withoutLocation } from "../images.js";
import { isValidAddress } from "../lei.js";
import { isAsset, parseAmount } from "../money.js";
import { parseMultipart } from "../multipart.js";
import { codePoints, compareNames, initials, type NameCheck } from "../names.js";
import { storage, StorageUnreachable } from "../s3.js";
import { verifySignature } from "../signature.js";
import { workspaceBySlug, type Workspace } from "../workspaces.js";
import { CASE_SELECT, pageStatus, type CaseRow, type RequestPageRow } from "../cases/record.js";
import { answerExpected, applyAnswer, isUuid } from "../cases/transitions.js";
import { amountText } from "../money.js";
import { isoInstant, maskAddress, secondsUntil, stamp } from "../../shared/format.js";

const CERTIFICATE_MAX = 5_000_000;
const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

interface MessageRow {
  id: string;
  message_id: string;
  type: "transfer" | "answer";
  received_at: Date;
  working: Record<string, unknown>;
  outcome: string;
  customer_id: string | null;
  counterparty_id: string;
  first_status: number;
  first_body: string;
  sha256: string;
  size_bytes: number;
  object_key: string;
  deleted_at: Date | null;
  cp_name: string;
}

const MESSAGE_SELECT = `
  SELECT m.*, o.sha256, o.size_bytes, o.object_key, o.deleted_at, cp.legal_name AS cp_name
    FROM messages m JOIN stored_objects o ON o.id = m.id JOIN counterparties cp ON cp.id = m.counterparty_id`;

const messageSummary = (m: MessageRow) => ({
  id: m.id, messageId: m.message_id, type: m.type, receivedAt: isoInstant(m.received_at.getTime()), sha256: m.sha256,
  sizeBytes: m.size_bytes, counterparty: { id: m.counterparty_id, name: m.cp_name }, outcome: m.outcome,
});

/** Stores bytes in MinIO, answering the published 503 (with nothing recorded) when storage is unreachable. */
async function store(key: string, data: Buffer, contentType: string): Promise<void> {
  try {
    await storage.put(key, data, contentType);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw refuse.storageUnreachable();
    throw error;
  }
}

async function recordObject(db: PoolClient, workspace: Workspace, id: string, kind: "message" | "certificate", key: string,
  data: Buffer, contentType: string, caseId: string | null): Promise<void> {
  await db.query(
    `INSERT INTO stored_objects (id, workspace_slug, kind, object_key, case_id, sha256, size_bytes, content_type, stored_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`, [id, workspace.slug, kind, key, caseId, sha256(data), data.length, contentType]);
}

interface Sender {
  id: string;
  signing_value: string;
}

async function receive(workspace: Workspace, sender: Sender, raw: Buffer, parsed: Record<string, unknown>): Promise<Reply> {
  const messageId = parsed.messageId;
  if (typeof messageId !== "string" || messageId.length < 1 || messageId.length > 100) {
    throw refuse.invalid({ messageId: "Send a message id of 1 to 100 characters." });
  }
  return tx(async (db) => {
    await lockName(db, `message:${workspace.slug}:${sender.id}:${messageId}`);
    const seen = await one<MessageRow>(db, `${MESSAGE_SELECT} WHERE m.workspace_slug = $1 AND m.counterparty_id = $2 AND m.message_id = $3`,
      [workspace.slug, sender.id, messageId]);
    if (seen) {
      if (seen.sha256 !== sha256(raw)) {
        throw refuse.conflict("message_id_reused", "This message id was already received with different content.");
      }
      return { status: seen.first_status, body: seen.first_body, headers: { "Content-Type": "application/json; charset=utf-8" } };
    }
    const now = Date.now();
    const check = new FieldCheck();
    let customer: { id: string; name: string } | null = null;
    let target: CaseRow | null = null;
    if (parsed.type === "transfer") {
      if (!isAsset(parsed.asset)) check.fail("asset", "Send BTC, ETH, USDC or SOL.");
      else if (typeof parsed.amount !== "string" || parseAmount(parsed.asset, parsed.amount) === null) {
        check.fail("amount", "Send an amount greater than zero within the asset's decimals.");
      }
      customer = isValidAddress(parsed.destinationAddress)
        ? await one(db, "SELECT id, name FROM customers WHERE workspace_slug = $1 AND deposit_address = $2",
          [workspace.slug, parsed.destinationAddress])
        : null;
      if (!customer) check.fail("destinationAddress", "No customer holds this deposit address.");
      const beneficiary = parsed.beneficiary as { name?: unknown } | undefined;
      if (typeof beneficiary?.name !== "string" || beneficiary.name.trim() === "") {
        check.fail("beneficiary", "Send the beneficiary's name.");
      }
    } else if (parsed.type === "answer") {
      target = typeof parsed.caseReference === "string"
        ? await one<CaseRow>(db, `${CASE_SELECT} WHERE c.workspace_slug = $1 AND c.reference = $2 AND c.counterparty_id = $3
            AND c.data_sent_channel IS NOT NULL FOR UPDATE OF c`, [workspace.slug, parsed.caseReference, sender.id])
        : null;
      if (!target) check.fail("caseReference", "No case with this reference was sent to you.");
      else if (!answerExpected(target, now)) throw refuse.conflict("answer_not_expected", "This case is not waiting for your answer.");
      if (parsed.decision !== "accepted" && parsed.decision !== "rejected") check.fail("decision", "Send accepted or rejected.");
    } else {
      check.fail("type", "Send a transfer or an answer.");
    }
    check.throwIfAny();
    const id = randomUUID();
    const key = `${workspace.slug}/messages/${id}`;
    await store(key, raw, "application/json");
    let outcome: string;
    let nameCheck: NameCheck | null = null;
    if (target) {
      outcome = await applyAnswer(db, target, parsed.decision as "accepted" | "rejected", "network", now);
    } else {
      nameCheck = compareNames((parsed.beneficiary as { name: string }).name, customer!.name);
      outcome = nameCheck;
    }
    await recordObject(db, workspace, id, "message", key, raw, "application/json", target?.id ?? null);
    const cp = await one<{ legal_name: string }>(db, "SELECT legal_name FROM counterparties WHERE id = $1", [sender.id]);
    const receivedAt = stamp(now);
    const body = {
      message: {
        id, messageId, type: parsed.type, receivedAt: isoInstant(receivedAt.getTime()), sha256: sha256(raw), sizeBytes: raw.length,
        counterparty: { id: sender.id, name: cp!.legal_name }, outcome,
      },
    };
    await db.query(
      `INSERT INTO messages (id, workspace_slug, counterparty_id, message_id, type, received_at, working, outcome, case_id,
         customer_id, first_status, first_body) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 201, $11)`,
      [id, workspace.slug, sender.id, messageId, parsed.type, receivedAt, JSON.stringify(parsed), outcome, target?.id ?? null,
        customer?.id ?? null, stringifyMoneyJson(body)]);
    await db.query("INSERT INTO metered_messages (workspace_slug, at, direction) VALUES ($1, $2, 'received')", [workspace.slug, receivedAt]);
    return { status: 201, json: body };
  });
}

function maskWorking(working: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(working);
  for (const party of ["originator", "beneficiary"]) {
    const value = copy[party] as { name?: unknown } | undefined;
    if (value && typeof value.name === "string") value.name = initials(value.name);
  }
  return copy;
}

interface PageRow extends RequestPageRow {
  workspace_slug: string;
  answer_note: string | null;
}

async function findPage(token: string): Promise<PageRow> {
  const page = await one<PageRow>(pool, "SELECT * FROM request_pages WHERE token_hash = $1", [digest(token)]);
  if (!page) throw refuse.notFound();
  if (pageStatus(page, Date.now()) === "ended") {
    throw refuse.gone("request_page_ended", "This data request page has ended. Ask the requesting exchange for a new one.");
  }
  return page;
}

export function registerMessages(router: Router): void {
  router.add("POST", "/api/network/:slug/messages", async (ctx) => {
    const workspace = workspaceBySlug(ctx.params.slug);
    if (!workspace) throw refuse.notFound();
    if (ctx.bodyTooLarge) throw refuse.tooLarge();
    const lei = (ctx.header("lanternline-sender") ?? "").toUpperCase();
    const sender = await one<Sender>(pool,
      "SELECT id, signing_value FROM counterparties WHERE workspace_slug = $1 AND lei = $2 AND network = 'on_network' AND signing_value IS NOT NULL",
      [workspace.slug, lei]);
    if (!sender || !verifySignature(ctx.body, ctx.header("lanternline-signature"), sender.signing_value, Math.floor(Date.now() / 1000))) {
      throw refuse.badSignature();
    }
    const parsed = ctx.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw refuse.invalid({ type: "Send a transfer or an answer." });
    return receive(workspace, sender, ctx.body, parsed as Record<string, unknown>);
  }, 256_000);

  router.add("GET", "/api/w/:slug/messages", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst", "operations_lead", "support_agent");
    const found = await rows<MessageRow>(pool, `${MESSAGE_SELECT} WHERE m.workspace_slug = $1 ORDER BY m.received_at DESC, m.id`,
      [who.workspace.slug]);
    return { status: 200, json: { messages: found.map(messageSummary) } };
  });

  router.add("GET", "/api/w/:slug/messages/:messageId", async (ctx) => {
    const who = await staff(ctx);
    const m = isUuid(ctx.params.messageId)
      ? await one<MessageRow>(pool, `${MESSAGE_SELECT} WHERE m.id = $1 AND m.workspace_slug = $2`, [ctx.params.messageId, who.workspace.slug])
      : null;
    if (!m) throw refuse.notFound();
    allow(who, "compliance_officer", "compliance_analyst", "operations_lead", "support_agent");
    const masked = who.member.role === "support_agent";
    const customer = m.customer_id
      ? await one<{ id: string; name: string }>(pool, "SELECT id, name FROM customers WHERE id = $1", [m.customer_id])
      : null;
    return {
      status: 200,
      json: {
        message: {
          ...messageSummary(m),
          working: masked ? maskWorking(m.working) : m.working,
          nameCheck: customer
            ? { result: m.outcome, customerId: customer.id, customerName: masked ? initials(customer.name) : customer.name }
            : null,
        },
      },
    };
  });

  router.add("GET", "/api/w/:slug/messages/:messageId/original", async (ctx) => {
    const who = await staff(ctx);
    const m = isUuid(ctx.params.messageId)
      ? await one<MessageRow>(pool, `${MESSAGE_SELECT} WHERE m.id = $1 AND m.workspace_slug = $2`, [ctx.params.messageId, who.workspace.slug])
      : null;
    if (!m) throw refuse.notFound();
    allow(who, "compliance_officer", "compliance_analyst");
    if (m.deleted_at) throw refuse.gone("original_erased", "This original was erased under the retention rule.");
    let bytes: Buffer;
    try {
      bytes = await storage.get(m.object_key);
    } catch (error) {
      if (error instanceof StorageUnreachable) throw refuse.storageUnreachable();
      throw error;
    }
    return {
      status: 200,
      body: bytes,
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${m.message_id}.json"` },
    };
  });

  router.add("GET", "/api/request-pages/:token", async (ctx) => {
    const page = await findPage(ctx.params.token);
    const c = (await one<CaseRow>(pool, `${CASE_SELECT} WHERE c.id = $1`, [page.case_id]))!;
    const workspace = workspaceBySlug(page.workspace_slug)!;
    const now = Date.now();
    return {
      status: 200,
      json: {
        page: {
          caseReference: c.reference, asset: c.asset, amount: amountText(c.asset, BigInt(c.amount_atomic)),
          fromAddressMasked: maskAddress(c.sending_address), toAddressMasked: maskAddress(c.destination_address),
          requestingExchange: workspace.legalName, status: pageStatus(page, now), endsAt: isoInstant(page.ends_at.getTime()),
          remainingSeconds: secondsUntil(page.ends_at, now), now: isoInstant(now),
        },
      },
    };
  });

  router.add("POST", "/api/request-pages/:token/answer", async (ctx) => {
    const page = await findPage(ctx.params.token);
    ctx.expectBody("multipart/form-data");
    const parts = parseMultipart(ctx.body, ctx.header("content-type") ?? "");
    if (!parts) throw refuse.badForm();
    const field = (name: string) => parts.find((p) => p.name === name);
    const certificate = field("certificate");
    const file = certificate && certificate.data.length > 0 ? certificate.data : null;
    if (file && file.length > CERTIFICATE_MAX) {
      throw refuse.fileTooLarge();
    }
    const type = file ? sniffImage(file) : null;
    if (file && !type) throw refuse.unsupportedFile();
    const workspace = workspaceBySlug(page.workspace_slug)!;
    return tx(async (db) => {
      const c = (await one<CaseRow>(db, `${CASE_SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [page.case_id]))!;
      const locked = (await one<PageRow>(db, "SELECT * FROM request_pages WHERE id = $1 FOR UPDATE", [page.id]))!;
      const now = Date.now();
      if (locked.answered_at) throw refuse.conflict("already_answered", "This page has already been answered.");
      if (!answerExpected(c, now)) throw refuse.conflict("answer_not_expected", "This case is not waiting for your answer.");
      const decision = field("answer")?.data.toString("utf8");
      const note = field("note")?.data.toString("utf8") ?? "";
      const check = new FieldCheck();
      if (decision !== "accepted" && decision !== "rejected") check.fail("answer", "Choose Accepted or Rejected.");
      if (!file || !type) check.fail("certificate", "Attach the licence certificate.");
      if (codePoints(note) > 1000) check.fail("note", "Keep the note to 1,000 characters.");
      check.throwIfAny();
      const stored = withoutLocation(type!, file!);
      const id = randomUUID();
      const key = `${workspace.slug}/certificates/${id}`;
      await store(key, stored, type!);
      await recordObject(db, workspace, id, "certificate", key, stored, type!, c.id);
      await applyAnswer(db, c, decision as "accepted" | "rejected", "request_page", now);
      const receivedAt = stamp(now);
      await db.query("UPDATE request_pages SET answered_at = $2, answer_note = $3 WHERE id = $1", [page.id, receivedAt, note || null]);
      return {
        status: 201,
        json: {
          answer: {
            decision, receivedAt: isoInstant(receivedAt.getTime()),
            certificate: { id, contentType: type, sizeBytes: stored.length, sha256: sha256(stored) },
          },
        },
      };
    });
  }, 6_000_000);
}
