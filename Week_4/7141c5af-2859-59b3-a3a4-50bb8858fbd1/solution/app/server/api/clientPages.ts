import { randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { one, query, tx } from "../db/pool.ts";
import { clientMail } from "../domain/clientMail.ts";
import { clientCopy, copy, townCopy } from "../domain/copy.ts";
import { storedPictureType, photographKey } from "../domain/files.ts";
import { foldName } from "../domain/folding.ts";
import { printAmount, splitMilestones } from "../domain/money.ts";
import { readSeatHeight } from "../domain/seatHeight.ts";
import { type Language, TOWNS, type Town, directionOf } from "../domain/towns.ts";
import { addSeconds, instant, timeCopy, wallInstant, wholeSecond } from "../domain/time.ts";
import { ApiError, conflict, invalid, notFound } from "../http/errors.ts";
import { bytes, type Ctx, empty, json, route } from "../http/router.ts";
import { ProviderDown } from "../providers/call.ts";
import { queueMail } from "../providers/mail.ts";
import { getObject } from "../providers/s3.ts";
import type { EstimateRow } from "./estimates.ts";
import { bodyOf } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

const TOKEN_BYTES = 24;
const LAST_SECOND = "23:59:59";

interface PageRow {
  token: string;
  piece_id: string;
  address: string | null;
  language: Language;
  sent_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  seat_height_cm: string | null;
  seat_height_typed: string | null;
  answered_at: Date | null;
  signed_name: string | null;
  signed_at: Date | null;
  signed_estimate_id: string | null;
  desk_id: string;
  title: string;
  due_date: string | null;
  client_name: string;
  town: Town;
  client_state: string;
}

/** An ended page's language still decides its copy, so the row comes back either way. */
export async function findPage(token: string): Promise<PageRow | null> {
  // Tokens are base64url; anything else (a NUL byte included) is unknown before Postgres sees it.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(token)) return null;
  return one<PageRow>(
    `SELECT cp.*, p.desk_id, p.title, p.due_date, c.name AS client_name, c.town, c.state AS client_state
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.token = $1 AND c.state NOT IN ('erasing', 'erased')`,
    [token],
  );
}

/** A page ends at its instant exactly, so a request at that instant finds it ended. */
export function hasEnded(page: Pick<PageRow, "ended_at" | "ends_at">): boolean {
  return page.ended_at !== null || page.ends_at.getTime() <= Date.now();
}

function answerBody(page: PageRow) {
  if (!page.answered_at) return null;
  return { seatHeightCm: page.seat_height_cm, typed: page.seat_height_typed, answeredAt: instant(page.answered_at) };
}

function signedCopy(id: "C16" | "C17", page: PageRow, at: Date): string {
  return clientCopy(id, page.language, { time: timeCopy(at, TOWNS[page.town].zone), town: townCopy(page.town, page.language) });
}

/** The page body: only the published keys, never a rate or hours. */
export async function pageBody(page: PageRow) {
  const estimate = await one<EstimateRow>("SELECT * FROM estimates WHERE piece_id = $1 AND state <> 'replaced' ORDER BY version DESC LIMIT 1", [page.piece_id]);
  const notes = await query<{ kind: string; note: string }>("SELECT kind, note FROM pins WHERE piece_id = $1 AND signed ORDER BY y_tenths, x_tenths", [page.piece_id]);
  const print = (minor: bigint): string => printAmount(minor, (estimate as EstimateRow).currency);
  return {
    language: page.language,
    dir: directionOf(page.language),
    clientName: page.client_name,
    pieceTitle: page.title,
    dueDate: page.due_date,
    endsAt: instant(page.ends_at),
    estimateId: estimate?.id ?? null,
    material: estimate?.material_code ? { name: estimate.material_name, code: estimate.material_code, lot: estimate.lot } : null,
    estimate: estimate
      ? {
          material: print(estimate.material_minor),
          labour: print(estimate.labour_minor),
          subtotal: print(estimate.subtotal_minor),
          tax: print(estimate.tax_minor),
          total: print(estimate.total_minor),
          milestones: splitMilestones(estimate.total_minor).map((milestone) => print(milestone.amountMinor)),
        }
      : null,
    notes,
    answer: answerBody(page),
    signOff: page.signed_at ? { at: instant(page.signed_at), message: signedCopy("C16", page, page.signed_at) } : null,
  };
}

function lastInstant(dueDate: string, town: Town, sentAt: Date): Date {
  const dueEnd = wallInstant(dueDate, LAST_SECOND, TOWNS[town].zone) as Date;
  const lifetimeEnd = addSeconds(sentAt, config.clientPageSeconds);
  return dueEnd.getTime() < lifetimeEnd.getTime() ? dueEnd : lifetimeEnd;
}

/** The `resource` step of the client's endpoints: 404 for an unknown token, 410 in the page's language once ended. */
async function pageResource(ctx: Ctx): Promise<void> {
  const page = await findPage(ctx.params.token as string);
  if (!page) throw notFound();
  if (hasEnded(page)) throw new ApiError(410, "pageEnded", clientCopy("C20", page.language));
  ctx.loaded.page = page;
}

function pageOf(ctx: Ctx): PageRow {
  return ctx.loaded.page as PageRow;
}

function required(field: string, language: Language): ApiError {
  return invalid(field, clientCopy("C23", language), "required");
}

function requiredString(value: unknown, field: string, language: Language): string {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) throw required(field, language);
  return typeof value === "string" ? value : "";
}

async function signOff(page: PageRow, estimateId: string, typedName: string): Promise<Date> {
  return tx(async (client) => {
    const estimates = await query<EstimateRow>("SELECT * FROM estimates WHERE piece_id = $1 ORDER BY version DESC FOR UPDATE", [page.piece_id], client);
    const chosen = estimates.find((estimate) => estimate.id === estimateId);
    if (chosen?.state === "signedOff") {
      const signed = await one<{ signed_at: Date }>("SELECT signed_at FROM client_pages WHERE signed_estimate_id = $1 ORDER BY signed_at LIMIT 1", [chosen.id], client);
      throw conflict("alreadySignedOff", signedCopy("C17", page, signed?.signed_at ?? chosen.created_at));
    }
    const newest = estimates[0];
    if (!newest) throw required("estimateId", page.language);
    if (chosen?.state !== "open") throw conflict("estimateReplaced", clientCopy("C18", page.language, { time: timeCopy(newest.created_at) }));
    const at = wholeSecond();
    await client.query("UPDATE estimates SET state = 'signedOff' WHERE id = $1", [chosen.id]);
    await client.query("UPDATE client_pages SET signed_name = $1, signed_at = $2, signed_estimate_id = $3 WHERE token = $4", [typedName, at, chosen.id, page.token]);
    return at;
  });
}

export function register(): void {
  route({
    method: "POST",
    pattern: "/api/pieces/:id/client-page",
    resource: pieceResource,
    handle: async (ctx) => {
      const piece = pieceOf(ctx);
      if (!piece.due_date) throw conflict("needsDueDate", copy("F-62"));
      if (!piece.client_email) throw conflict("needsEmail", copy("F-63"));
      const { due_date: dueDate, client_email: email } = piece;
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const address = `${ctx.origin}/c/${token}`;
      const sentAt = wholeSecond();
      const endsAt = lastInstant(dueDate, piece.client_town, sentAt);
      const language = piece.client_language;
      await tx(async (client) => {
        await client.query("SELECT 1 FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
        await client.query("UPDATE client_pages SET ended_at = now() WHERE piece_id = $1 AND ended_at IS NULL", [piece.id]);
        await client.query(
          "INSERT INTO client_pages (token, piece_id, address, language, sent_at, ends_at, reminder_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [token, piece.id, address, language, sentAt, endsAt, addSeconds(sentAt, config.reminderAfterSeconds)],
        );
        const mail = clientMail("M1", { language, clientName: piece.client_name, title: piece.title, address, dueDate });
        await queueMail({ clientId: piece.client_id, to: email, ...mail }, client);
      });
      return json(201, { clientPage: { address, endsAt: instant(endsAt), sentAt: instant(sentAt) } });
    },
  });

  route({
    method: "GET",
    pattern: "/api/pieces/:id/client-page",
    resource: pieceResource,
    handle: async (ctx) => {
      const page = await one<PageRow>("SELECT * FROM client_pages WHERE piece_id = $1 ORDER BY ended_at IS NULL DESC, sent_at DESC LIMIT 1", [pieceOf(ctx).id]);
      const live = page !== null && !hasEnded(page);
      return json(200, {
        clientPage: {
          address: live ? page.address : null,
          endsAt: page ? instant(page.ends_at) : null,
          sentAt: page ? instant(page.sent_at) : null,
          state: live ? "live" : "ended",
          answer: page ? answerBody(page) : null,
          signOff: page?.signed_at ? { typedName: page.signed_name, at: instant(page.signed_at) } : null,
        },
      });
    },
  });

  route({
    method: "DELETE",
    pattern: "/api/pieces/:id/client-page",
    resource: pieceResource,
    handle: async (ctx) => {
      await query("UPDATE client_pages SET ended_at = now() WHERE piece_id = $1 AND ended_at IS NULL", [pieceOf(ctx).id]);
      return empty();
    },
  });

  route({
    method: "GET",
    pattern: "/api/client-pages/:token",
    access: "public",
    resource: pageResource,
    handle: async (ctx) => json(200, { page: await pageBody(pageOf(ctx)) }),
  });

  route({
    method: "POST",
    pattern: "/api/client-pages/:token/answer",
    access: "public",
    resource: pageResource,
    handle: async (ctx) => {
      const page = pageOf(ctx);
      const typed = requiredString(bodyOf(ctx).seatHeight, "seatHeight", page.language);
      const seatHeightCm = readSeatHeight(typed, page.language);
      if (seatHeightCm === null) throw invalid("seatHeight", clientCopy("C13", page.language), "heightRefused");
      const [row] = await query<{ answered_at: Date }>(
        "UPDATE client_pages SET seat_height_cm = $1, seat_height_typed = $2, answered_at = now() WHERE token = $3 RETURNING answered_at",
        [seatHeightCm, typed, page.token],
      );
      return json(200, { answer: { seatHeightCm, typed, answeredAt: instant((row as { answered_at: Date }).answered_at) } });
    },
  });

  route({
    method: "POST",
    pattern: "/api/client-pages/:token/sign-off",
    access: "public",
    resource: pageResource,
    handle: async (ctx) => {
      const page = pageOf(ctx);
      const body = bodyOf(ctx);
      const typedName = requiredString(body.typedName, "typedName", page.language);
      const estimateId = requiredString(body.estimateId, "estimateId", page.language);
      if (foldName(typedName) !== foldName(page.client_name)) throw invalid("typedName", clientCopy("C14", page.language), "nameRefused");
      return json(200, { signOff: { at: instant(await signOff(page, estimateId, typedName.trim())) } });
    },
  });

  for (const side of ["before", "after"]) {
    route({
      method: "GET",
      pattern: `/api/client-pages/:token/photographs/${side}`,
      access: "public",
      resource: pageResource,
      handle: async (ctx) => {
        const page = pageOf(ctx);
        const photograph = await one<{ sha256: string }>(
          "SELECT sha256 FROM photographs WHERE piece_id = $1 AND side = $2 AND state = 'stored' ORDER BY number DESC LIMIT 1",
          [page.piece_id, side],
        );
        if (!photograph) throw notFound();
        try {
          const file = await getObject(photographKey(page.desk_id, page.piece_id, photograph.sha256));
          return bytes(200, storedPictureType(file), file);
        } catch (error) {
          if (error instanceof ProviderDown) throw new ApiError(503, "fileStoreUnavailable", clientCopy("C21", page.language));
          throw error;
        }
      },
    });
  }
}
