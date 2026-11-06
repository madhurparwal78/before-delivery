import { ApiError } from "../errors.js";
import { json, parseJsonBody, route, requireOperator, requireUser, renterScoped, type RouteContext } from "../router.js";
import { one, rows } from "../db.js";
import { kitchenToday } from "../kitchenTime.js";
import { putObject, signedUrl } from "../storage.js";
import { ledgerForAccount, availableAccount } from "../ledger.js";
import { loadDocuments, latestApprovedByKind, isCurrent, type DocumentKind } from "../compliance.js";
import { randomToken } from "../util.js";
import { createSubscription, cancelSubscription, getSubscription, ensureAccount } from "../killbill.js";


const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const KIND_LABELS: Record<DocumentKind, string> = {
  coi: "certificate of insurance",
  food_handler_card: "food-handler card",
  business_licence: "business licence",
};

// ---------- Statements ----------

route("POST", "/api/renters/{renter_id}/statements", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  if (user.role === "renter") renterScoped(ctx, renterId);
  else requireOperator(ctx);
  const body = parseJsonBody<{ month?: unknown }>(ctx);
  const month = text(body.month);
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
  if (!monthMatch) throw ApiError.validationError({ month: "Enter the statement month as YYYY-MM." });
  const today = kitchenToday(ctx.now);
  if (month > today.slice(0, 7)) throw ApiError.validationError({ month: "The month is in the future." });
  const renter = await one<{ id: string; business_name: string }>(
    ctx.db,
    "select id, business_name from renters where id = $1",
    [renterId],
  );
  if (!renter) throw ApiError.notFound();
  const statementRows = await rows<{ id: string; created_at: Date }>(
    ctx.db,
    "insert into statements (renter_id, month, object_key) values ($1, $2, '') returning id, created_at",
    [renterId, month],
  );

  const statementId = statementRows[0]!.id;
  const objectKey = `renters/${renterId}/statements/${month}-${statementId}.pdf`;
  await ctx.db.query("update statements set object_key = $1 where id = $2", [objectKey, statementId]);
  const pdf = await buildStatementPdf(renter.business_name, month, renterId, ctx.db);
  const stored = await putObject(objectKey, pdf, "application/pdf");
  if (stored.kind === "unavailable") {
    await ctx.db.query("delete from statements where id = $1", [statementId]);
    throw ApiError.storageUnavailable();
  }
  return json(
    {
      statement: {
        id: statementId,
        renter_id: renterId,
        month,
        created_at: statementRows[0]!.created_at.toISOString(),
      },
    },
    201,
  );
});

const buildStatementPdf = async (
  businessName: string,
  month: string,
  renterId: string,
  db: Parameters<typeof one>[0],
): Promise<Buffer> => {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "LETTER", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  doc.fontSize(16).text(`Statement for ${businessName}`);
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Month: ${month} (America/Chicago)`);
  doc.moveDown();
  const entries = await ledgerForAccount(db, renterId, availableAccount(renterId));
  const monthStart = `${month}-01`;
  const [year, monthNum] = month.split("-").map(Number);
  const endDate = new Date(Date.UTC(year!, monthNum!, 0));
  const monthEnd = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, "0")}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
  const monthEntries = entries.filter((entry) => {
    const raw = entry.created_at instanceof Date ? entry.created_at.toISOString() : String(entry.created_at);
    const entryDate = raw.slice(0, 10);
    return entryDate >= monthStart && entryDate <= monthEnd;
  });
  let running = 0;
  const opening = monthEntries.length > 0 ? openingBalanceFor(entries, monthStart) : 0;
  running = opening;
  doc.text(`Opening balance: ${(opening / 60).toFixed(2)} hours`);
  doc.moveDown(0.3);
  for (const entry of monthEntries) {
    const signed = entry.direction === "credit" ? entry.minutes : -entry.minutes;
    running += signed;
    const when = entry.created_at instanceof Date ? entry.created_at.toISOString() : String(entry.created_at);
    doc.text(
      `${when.slice(0, 16).replace("T", " ")}  ${entry.kind}  ${(signed / 60).toFixed(2)} h  balance ${(running / 60).toFixed(2)} h`,
    );
  }
  doc.moveDown(0.3);
  doc.text(`Closing balance: ${(running / 60).toFixed(2)} hours`);
  doc.end();
  return done;
};

const openingBalanceFor = (
  entries: { created_at: string | Date; direction: string; minutes: number }[],
  monthStart: string,
): number => {
  let balance = 0;
  for (const entry of entries) {
    const raw = entry.created_at instanceof Date ? entry.created_at.toISOString() : String(entry.created_at);
    if (raw.slice(0, 10) < monthStart) {
      balance += entry.direction === "credit" ? entry.minutes : -entry.minutes;
    }
  }
  return balance;
};

route("GET", "/api/renters/{renter_id}/statements", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  if (user.role === "renter") renterScoped(ctx, renterId);
  else if (user.role !== "operator" && user.role !== "shift_lead") throw ApiError.forbidden();
  const statements = await rows<{ id: string; renter_id: string; month: string; created_at: Date }>(
    ctx.db,
    "select id, renter_id, month, created_at from statements where renter_id = $1 order by created_at desc, id desc",
    [renterId],
  );
  return json({
    statements: statements.map((row) => ({
      id: row.id,
      renter_id: row.renter_id,
      month: row.month,
      created_at: row.created_at.toISOString(),
    })),
  });
});

route("GET", "/api/statements/{statement_id}/file", "any", async (ctx: RouteContext) => {
  const user = requireUser(ctx);
  const statementId = ctx.url.pathname.split("/")[3]!;
  const found = await one<{ renter_id: string; object_key: string }>(
    ctx.db,
    "select renter_id, object_key from statements where id = $1",
    [statementId],
  );
  if (!found) throw ApiError.notFound();
  if (user.role === "renter") renterScoped(ctx, found.renter_id);
  else if (user.role !== "operator" && user.role !== "shift_lead") throw ApiError.forbidden();
  const url = await signedUrl(found.object_key);
  if (!url) throw ApiError.storageUnavailable();
  return new Response(null, { status: 302, headers: { Location: url } });
});

// ---------- Shelf subscriptions ----------

route("POST", "/api/renters/{renter_id}/shelf-subscription", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  const body = parseJsonBody<{ shelf_label?: unknown }>(ctx);
  const shelfLabel = text(body.shelf_label);
  if (shelfLabel.length < 1 || shelfLabel.length > 40) {
    throw ApiError.validationError({ shelf_label: "Enter the shelf label, 1 to 40 characters." });
  }
  const renter = await one<{ id: string; status: string; business_name: string; email: string }>(
    ctx.db,
    "select id, status, business_name, email from renters where id = $1",
    [renterId],
  );
  if (!renter) throw ApiError.notFound();
  if (renter.status !== "active") throw ApiError.renterNotActive();

  // Reconcile with Kill Bill first: a direct cancellation ends the subscription.
  const stored = await one<{ id: string; killbill_subscription_id: string; state: string }>(
    ctx.db,
    "select id, killbill_subscription_id, state from shelf_subscriptions where renter_id = $1 and state = 'active' order by created_at desc limit 1",
    [renterId],
  );
  if (stored) {
    const remote = await getSubscription(stored.killbill_subscription_id);
    if (remote.kind === "unavailable") throw ApiError.billingUnavailable();
    if (remote.value && remote.value.state !== "CANCELLED") {
      throw ApiError.alreadySubscribed();
    }
    await ctx.db.query("update shelf_subscriptions set state = 'cancelled', ended_at = now() where id = $1", [
      stored.id,
    ]);
  }

  const sequenceRows = await rows<{ count: string }>(
    ctx.db,
    "select count(*)::text as count from shelf_subscriptions where renter_id = $1",
    [renterId],
  );
  // The sequence counts every shelf subscription ever started for this renter,
  // so retries of a failed start reuse the same external key and Kill Bill's
  // own uniqueness is respected.
  let sequenceNo = Number(sequenceRows[0]!.count) + 1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const externalKey = `shelf-${renterId}-${sequenceNo}`;
    const today = kitchenToday(ctx.now);
    const account = await ensureAccount(`renter-${renterId}`, renter.business_name, renter.email);
    if (account.kind === "unavailable") throw ApiError.billingUnavailable();
    const created = await createSubscription(account.value.accountId, externalKey, today);
    if (created.kind === "ok") {
      await ctx.db.query(
        `insert into shelf_subscriptions (renter_id, shelf_label, external_key, killbill_subscription_id, sequence_no, state)
         values ($1, $2, $3, $4, $5, 'active')`,
        [renterId, shelfLabel, externalKey, created.value.subscriptionId, sequenceNo],
      );
      return json(
        {
          subscription: {
            shelf_label: shelfLabel,
            plan: "walk-in-shelf-monthly",
            external_key: externalKey,
            killbill_subscription_id: created.value.subscriptionId,
            state: "active",
            billing_state: "ACTIVE",
          },
        },
        201,
      );
    }
    sequenceNo += 1;
  }
  throw ApiError.billingUnavailable();
});

route("DELETE", "/api/renters/{renter_id}/shelf-subscription", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const renterId = ctx.url.pathname.split("/")[3]!;
  const stored = await one<{ id: string; shelf_label: string; external_key: string; killbill_subscription_id: string }>(
    ctx.db,
    "select id, shelf_label, external_key, killbill_subscription_id from shelf_subscriptions where renter_id = $1 and state = 'active' order by created_at desc limit 1",
    [renterId],
  );
  if (!stored) throw ApiError.notSubscribed();
  const cancelled = await cancelSubscription(stored.killbill_subscription_id);
  if (cancelled.kind === "unavailable") throw ApiError.billingUnavailable();
  await ctx.db.query("update shelf_subscriptions set state = 'cancelled', ended_at = now() where id = $1", [
    stored.id,
  ]);
  return json({
    subscription: {
      shelf_label: stored.shelf_label,
      plan: "walk-in-shelf-monthly",
      external_key: stored.external_key,
      killbill_subscription_id: stored.killbill_subscription_id,
      state: "cancelled",
      billing_state: "CANCELLED",
    },
  });
});

// ---------- Compliance links ----------

route("POST", "/api/compliance-links", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const body = parseJsonBody<{ label?: unknown; expires_in_seconds?: unknown }>(ctx);
  const label = text(body.label);
  const seconds = Number(body.expires_in_seconds);
  const errors: Record<string, string> = {};
  if (label.length < 1 || label.length > 80) errors.label = "Enter the label, 1 to 80 characters.";
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 2592000) {
    errors.expires_in_seconds = "Choose an expiry.";
  }
  if (Object.keys(errors).length > 0) throw ApiError.validationError(errors);
  const token = randomToken(32);
  const expiresAt = new Date(ctx.now.getTime() + seconds * 1000);
  const inserted = await rows<{ id: string; created_at: Date }>(
    ctx.db,
    "insert into compliance_links (label, token, expires_in_seconds, expires_at) values ($1, $2, $3, $4) returning id, created_at",
    [label, token, seconds, expiresAt.toISOString()],
  );
  return json(
    {
      link: linkObject({
        id: inserted[0]!.id,
        label,
        token,
        expires_in_seconds: seconds,
        expires_at: expiresAt,
        revoked_at: null,
        created_at: inserted[0]!.created_at,
      }),
    },
    201,
  );
});

const linkObject = (row: { id: string; label: string; token: string; expires_in_seconds: number; expires_at: Date; revoked_at: Date | null; created_at: Date }) => ({
  id: row.id,
  label: row.label,
  token: row.token,
  url: `/share/${row.token}`,
  expires_in_seconds: row.expires_in_seconds,
  expires_at: row.expires_at.toISOString(),
  revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
  created_at: row.created_at.toISOString(),
});

route("GET", "/api/compliance-links", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const links = await rows<{
    id: string;
    label: string;
    token: string;
    expires_in_seconds: number;
    expires_at: Date;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    ctx.db,
    "select id, label, token, expires_in_seconds, expires_at, revoked_at, created_at from compliance_links order by created_at desc",
  );
  return json({ links: links.map(linkObject) });
});

route("POST", "/api/compliance-links/{link_id}/revoke", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const linkId = ctx.url.pathname.split("/")[3]!;
  const found = await one<{ id: string; revoked_at: Date | null }>(
    ctx.db,
    "select id, revoked_at from compliance_links where id = $1",
    [linkId],
  );
  if (!found) throw ApiError.notFound();
  if (found.revoked_at) throw ApiError.alreadyRevoked();
  await ctx.db.query("update compliance_links set revoked_at = now() where id = $1", [linkId]);
  const after = await one<{
    id: string;
    label: string;
    token: string;
    expires_in_seconds: number;
    expires_at: Date;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    ctx.db,
    "select id, label, token, expires_in_seconds, expires_at, revoked_at, created_at from compliance_links where id = $1",
    [linkId],
  );
  return json({ link: linkObject(after!) });
});

route("POST", "/api/compliance-links/{link_id}/regenerate", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const linkId = ctx.url.pathname.split("/")[3]!;
  const found = await one<{
    id: string;
    label: string;
    token: string;
    expires_in_seconds: number;
    expires_at: Date;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    ctx.db,
    "select id, label, token, expires_in_seconds, expires_at, revoked_at, created_at from compliance_links where id = $1",
    [linkId],
  );
  if (!found) throw ApiError.notFound();
  if (found.revoked_at) throw ApiError.alreadyRevoked();
  const token = randomToken(32);
  const expiresAt = new Date(ctx.now.getTime() + found.expires_in_seconds * 1000);
  await ctx.db.query("update compliance_links set token = $1, expires_at = $2 where id = $3", [
    token,
    expiresAt.toISOString(),
    linkId,
  ]);
  const after = await one<{
    id: string;
    label: string;
    token: string;
    expires_in_seconds: number;
    expires_at: Date;
    revoked_at: Date | null;
    created_at: Date;
  }>(
    ctx.db,
    "select id, label, token, expires_in_seconds, expires_at, revoked_at, created_at from compliance_links where id = $1",
    [linkId],
  );
  return json({ link: linkObject(after!) });
});

// ---------- Notifications ----------

route("GET", "/api/notifications", "operator", async (ctx: RouteContext) => {
  requireOperator(ctx);
  const notifications = await rows<{
    id: string;
    kind: string;
    to_address: string;
    subject: string;
    status: string;
    attempts: number;
    created_at: Date;
    sent_at: Date | null;
  }>(
    ctx.db,
    "select id, kind, to_address, subject, status, attempts, created_at, sent_at from notifications order by created_at desc, id desc",
  );
  return json({
    notifications: notifications.map((row) => ({
      id: row.id,
      kind: row.kind,
      to: row.to_address,
      subject: row.subject,
      status: row.status,
      attempts: row.attempts,
      created_at: row.created_at.toISOString(),
      sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    })),
  });
});

// ---------- Share (public) ----------

route("GET", "/api/share/{token}", "none", async (ctx: RouteContext) => {
  const token = ctx.url.pathname.split("/")[3]!;
  const link = await one<{ id: string; expires_at: Date; revoked_at: Date | null }>(
    ctx.db,
    "select id, expires_at, revoked_at from compliance_links where token = $1",
    [token],
  );
  if (!link || link.revoked_at || link.expires_at.getTime() <= ctx.now.getTime()) {
    throw ApiError.notFound();
  }
  const today = kitchenToday(ctx.now);
  const renters = await rows<{ id: string; business_name: string; status: string }>(
    ctx.db,
    "select id, business_name, status from renters where status in ('active','suspended') order by business_name asc",
  );
  const result = [];
  for (const renter of renters) {
    const documents = await loadDocuments(ctx.db, renter.id);
    const approved = latestApprovedByKind(documents);
    const current = (["coi", "food_handler_card", "business_licence"] as DocumentKind[])
      .map((kind) => approved.get(kind))
      .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc && isCurrent(doc, today)));
    if (current.length === 0) continue;
    result.push({
      business_name: renter.business_name,
      documents: current.map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        label: KIND_LABELS[doc.kind],
        expires_on: doc.expires_on,
        file_url: `/api/share/${token}/documents/${doc.id}`,
      })),
    });
  }
  return json({
    kitchen: { name: "Brigade & Bench Commissary", address: "1187 West Larkin Avenue, Chicago, IL 60622" },
    renters: result,
  });
});

route("GET", "/api/share/{token}/documents/{document_id}", "none", async (ctx: RouteContext) => {
  const token = ctx.url.pathname.split("/")[3]!;
  const documentId = ctx.url.pathname.split("/")[5]!;
  const link = await one<{ id: string; expires_at: Date; revoked_at: Date | null }>(
    ctx.db,
    "select id, expires_at, revoked_at from compliance_links where token = $1",
    [token],
  );
  if (!link || link.revoked_at || link.expires_at.getTime() <= ctx.now.getTime()) {
    throw ApiError.notFound();
  }
  const today = kitchenToday(ctx.now);
  const document = await one<{ id: string; renter_id: string; kind: string; status: string; expires_on: string | null; object_key: string }>(
    ctx.db,
    "select id, renter_id, kind, status, expires_on::text as expires_on, object_key from documents where id = $1",
    [documentId],
  );
  if (!document || document.status !== "approved" || (document.expires_on !== null && document.expires_on < today)) {
    throw ApiError.notFound();
  }
  const renter = await one<{ id: string; status: string }>(ctx.db, "select id, status from renters where id = $1", [
    document.renter_id,
  ]);
  if (!renter || (renter.status !== "active" && renter.status !== "suspended")) throw ApiError.notFound();
  const documents = await loadDocuments(ctx.db, renter.id);
  const approved = latestApprovedByKind(documents);
  const listed = (["coi", "food_handler_card", "business_licence"] as DocumentKind[])
    .map((kind) => approved.get(kind))
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc && isCurrent(doc, today)));
  if (!listed.some((doc) => doc.id === documentId)) throw ApiError.notFound();
  const url = await signedUrl(document.object_key);
  if (!url) throw ApiError.storageUnavailable();
  return new Response(null, { status: 302, headers: { Location: url } });
});

