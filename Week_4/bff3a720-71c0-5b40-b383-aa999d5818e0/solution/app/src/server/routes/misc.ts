import { isoBrussels } from "../../shared/time";
import type { Wallet } from "../../shared/api";
import { now } from "../clock";
import { apiErrors } from "../http/errors";
import { filePart } from "../http/multipart";
import { route, type Route } from "../http/pipeline";
import { ALL_BOOKING_STATES } from "../domain/bookingStates";
import { getObject, StorageUnavailable } from "../s3";
import { earningsCsv, earningsFor, MONTH_PATTERN } from "../services/earnings";
import { emitWallet } from "../services/events";
import { checkSize, currentDocument, decideDocument, documentById, fileById, pendingDocuments, sniff, storeFile, type FileKind } from "../services/files";
import { recordTopUp, walletBalance, walletLines } from "../services/ledger";
import { moveClock } from "../services/jobs";
import { createRecords } from "../services/records";
import { monthKey } from "../../shared/time";
import { getMemberRow, memberView } from "../services/views";
import { bodyOf, hasRole, memberOf, requireRole } from "./support";
import { isInt } from "../http/guards";

async function walletView(db: Parameters<typeof walletBalance>[0], memberId: string): Promise<Wallet> {
  const lines = await walletLines(db, memberId);
  return {
    balance_cents: await walletBalance(db, memberId),
    lines: lines.map((line) => ({ id: line.id, entry_id: line.entry_id, label: line.label, amount_cents: line.amount_cents, at: isoBrussels(line.at) })),
  };
}

function uploadRoute(pattern: string, kind: FileKind): Route {
  return route<Buffer | undefined>({
    method: "POST",
    pattern,
    body: "multipart",
    load: async (ctx) => filePart(ctx.raw, ctx.req.headers["content-type"] ?? "")?.data,
    validate: async (_ctx, file) => {
      if (!file) throw apiErrors.validation({ file: "Choose a file to upload." });
      sniff(file, kind);
      checkSize(file, kind);
    },
    run: async (ctx, file) => {
      const data = file as Buffer;
      const { fileId, documentId } = await storeFile(ctx.db, memberOf(ctx), kind, data, sniff(data, kind));
      if (kind === "photo") return { status: 201, body: { file_id: fileId, photo_url: `/api/files/${fileId}` } };
      return { status: 201, body: { document_id: documentId, file_id: fileId, id_state: "pending" } };
    },
  });
}

export const miscRoutes: Route[] = [
  route({ method: "GET", pattern: "/api/wallet", run: async (ctx) => ({ status: 200, body: await walletView(ctx.db, memberOf(ctx).id) }) }),

  route({
    method: "POST",
    pattern: "/api/wallet/top-ups",
    validate: async (ctx) => {
      const amount = bodyOf(ctx).amount_cents;
      if (!isInt(amount) || amount % 500 !== 0 || amount < 500 || amount > 20_000) throw apiErrors.validation({ amount_cents: "Add from €5 to €200 in steps of €5." });
    },
    run: async (ctx) => {
      const member = memberOf(ctx);
      await recordTopUp(ctx.db, member.id, bodyOf(ctx).amount_cents as number, now());
      ctx.db.afterCommit(() => emitWallet(member.id));
      return { status: 201, body: await walletView(ctx.db, member.id) };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/driver/earnings",
    role: (ctx) => requireRole(memberOf(ctx), "driver"),
    validate: async (ctx) => {
      if (!MONTH_PATTERN.test(ctx.url.searchParams.get("month") ?? monthKey(now()))) throw apiErrors.validation({ month: "Choose a month." });
    },
    run: async (ctx) => ({ status: 200, body: await earningsFor(ctx.db, memberOf(ctx).id, ctx.url.searchParams.get("month") ?? monthKey(now())) }),
  }),

  route({
    method: "GET",
    pattern: "/api/driver/earnings.csv",
    role: (ctx) => requireRole(memberOf(ctx), "driver"),
    validate: async (ctx) => {
      if (!MONTH_PATTERN.test(ctx.url.searchParams.get("month") ?? monthKey(now()))) throw apiErrors.validation({ month: "Choose a month." });
    },
    run: async (ctx) => {
      const month = ctx.url.searchParams.get("month") ?? monthKey(now());
      return {
        status: 200,
        raw: earningsCsv(await earningsFor(ctx.db, memberOf(ctx).id, month)),
        contentType: "text/csv; charset=utf-8",
        headers: { "content-disposition": `attachment; filename="longseat-earnings-${month}.csv"` },
      };
    },
  }),

  uploadRoute("/api/me/photo", "photo"),
  uploadRoute("/api/me/id-document", "id_document"),

  route({
    method: "GET",
    pattern: "/api/me/id-document",
    run: async (ctx) => {
      const member = memberOf(ctx);
      const document = await currentDocument(ctx.db, member.id);
      return { status: 200, body: { id_state: member.id_state, reason: member.id_state === "rejected" ? member.id_reason : null, file_id: document?.file_id ?? null } };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/files/:id",
    load: async (ctx) => {
      const file = await fileById(ctx.db, ctx.params.id as string);
      const member = memberOf(ctx);
      if (!file || (file.kind === "id_document" && file.owner_id !== member.id && !hasRole(member, "founder"))) throw apiErrors.notFound();
      return file;
    },
    run: async (_ctx, file) => {
      try {
        return { status: 200, raw: await getObject(file.object_key), contentType: file.content_type, headers: { "cache-control": "private, max-age=300" } };
      } catch (error) {
        if (error instanceof StorageUnavailable) throw apiErrors.storageUnavailable();
        throw error;
      }
    },
  }),

  route({
    method: "GET",
    pattern: "/api/founder/id-reviews",
    role: (ctx) => requireRole(memberOf(ctx), "founder"),
    run: async (ctx) => {
      const documents = [];
      for (const document of await pendingDocuments(ctx.db)) {
        const member = await getMemberRow(ctx.db, document.member_id);
        if (member) documents.push({ id: document.id, member: await memberView(ctx.db, member), file_id: document.file_id, uploaded_at: isoBrussels(document.uploaded_at) });
      }
      return { status: 200, body: { documents } };
    },
  }),

  ...(["approve", "reject"] as const).map((decision) =>
    route({
      method: "POST",
      pattern: `/api/founder/id-reviews/:id/${decision}`,
      load: async (ctx) => {
        const document = await documentById(ctx.db, ctx.params.id as string, true);
        if (!document) throw apiErrors.notFound();
        return document;
      },
      role: (ctx) => requireRole(memberOf(ctx), "founder"),
      conflicts: async (_ctx, document) => {
        if (document.state !== "pending") throw apiErrors.alreadyDecided();
      },
      validate: async (ctx) => {
        if (decision === "approve") return;
        const reason = bodyOf(ctx).reason;
        if (typeof reason !== "string" || reason.trim().length < 1 || reason.trim().length > 200) throw apiErrors.validation({ reason: "Give a reason of 1 to 200 characters." });
      },
      run: async (ctx, document) => {
        const member = (await getMemberRow(ctx.db, document.member_id)) as NonNullable<Awaited<ReturnType<typeof getMemberRow>>>;
        await decideDocument(ctx.db, document, member, decision === "approve" ? null : (bodyOf(ctx).reason as string).trim());
        return { status: 200, body: { id_state: decision === "approve" ? "verified" : "rejected" } };
      },
    }),
  ),

  route({
    method: "GET",
    pattern: "/api/founder/outbox",
    role: (ctx) => requireRole(memberOf(ctx), "founder"),
    run: async (ctx) => {
      const { rows } = await ctx.db.query<{ id: string; kind: string; to_email: string; subject: string; status: string; attempts: number; last_attempt_at: Date | null }>(
        "SELECT id, kind, to_email, subject, status, attempts, last_attempt_at FROM outbox ORDER BY seq DESC LIMIT 200",
      );
      return { status: 200, body: { items: rows.map((row) => ({ id: row.id, kind: row.kind, to: row.to_email, subject: row.subject, status: row.status, attempts: row.attempts, last_attempt_at: row.last_attempt_at ? isoBrussels(row.last_attempt_at) : null })) } };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/founder/bookings-by-state",
    role: (ctx) => requireRole(memberOf(ctx), "founder"),
    run: async (ctx) => {
      const { rows } = await ctx.db.query<{ state: string; total: number }>("SELECT state, COUNT(*)::bigint AS total FROM bookings GROUP BY state");
      const counts = Object.fromEntries(ALL_BOOKING_STATES.map((state) => [state, rows.find((row) => row.state === state)?.total ?? 0]));
      return { status: 200, body: { counts } };
    },
  }),

  route({
    method: "POST",
    pattern: "/api/grading/setup",
    auth: "grading",
    run: async (ctx) => ({ status: 201, body: await createRecords(ctx.db, ctx.body, { sessions: true }) }),
  }),

  route({
    method: "POST",
    pattern: "/api/grading/clock",
    auth: "grading",
    validate: async (ctx) => {
      const seconds = bodyOf(ctx).advance_seconds;
      if (!isInt(seconds) || seconds < 0 || seconds > 31_536_000) throw apiErrors.validation({ advance_seconds: "Send whole seconds from 0 to 31,536,000." });
    },
    run: async (ctx) => {
      ctx.db.afterCommit(async () => {
        await moveClock(bodyOf(ctx).advance_seconds as number);
      });
      return { status: 200, finalize: async () => ({ now: isoBrussels(now()) }) };
    },
  }),
];

