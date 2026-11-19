import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import { config, newToken } from "../config.js";
import { sendMail } from "../providers/mail.js";
import { clientCopy, townNames, type ClientLang } from "../client-copy.js";
import { endOfDayTurin, fmtDateByLang, isoZ, localTimeHM, townZone } from "../time.js";
import { decParse } from "../decimal.js";
import { nameMatches } from "../stamps.js";

export const clientPageRouter = Router({ mergeParams: true });

export const tokenPage = async (token: string) =>
  q1<{
    token: string; piece_id: string; desk_id: string; ends_at: Date; sent_at: Date; state: string;
    answer: { seatHeight: string; typed: string; at: string } | null;
    sign_off: { typedName: string; at: string } | null;
    title: string; due_date: string | null; client_name: string; town: string; language: string; email: string;
  }>(
    `SELECT cp.token, cp.piece_id, cp.desk_id, cp.ends_at, cp.sent_at, cp.state, cp.answer, cp.sign_off,
            p.title, p.due_date::text AS due_date, c.name AS client_name, c.town, c.language, c.email
     FROM client_pages cp JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.token = $1`, [token]
  );

clientPageRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  void body;
  const client = piece.client_id ? await q1<{ id: string; name: string; town: string; language: string; email: string; state: string }>("SELECT id, name, town, language, email, state FROM clients WHERE id = $1 AND desk_id = $2", [piece.client_id, session.deskId]) : null;
  if (!piece.due_date) throw err.state("F-62", apiMessages.needDueDate);
  if (!client || !client.email) throw err.state("F-63", apiMessages.needEmail);
  const token = newToken(32);
  const dueEnd = endOfDayTurin(piece.due_date as unknown as string);
  const fromSend = new Date(Date.now() + config.timers.clientPage * 1000);
  const endsAt = dueEnd.getTime() < fromSend.getTime() ? dueEnd : fromSend;
  const origin = config.publicUrl || `http://${req.headers.host}`;
  const address = `${origin}/c/${token}`;
  await q("UPDATE client_pages SET state='ended' WHERE piece_id=$1", [piece.id]);
  await q(
    "INSERT INTO client_pages (piece_id, desk_id, token, address, ends_at, sent_at, state) VALUES ($1,$2,$3,$4,$5,$6,'live')",
    [piece.id, session.deskId, token, address, endsAt.toISOString(), new Date().toISOString()]
  );
  const lang = client.language as ClientLang;
  const copy = clientCopy[lang];
  const dueDateText = fmtDateByLang[lang]!(new Date(`${String(piece.due_date).slice(0, 10)}T12:00:00Z`), townZone[client.town as "Turin"]);
  const sent = await sendMail({
    to: client.email,
    subject: copy.M1.replace("<title>", piece.title as string),
    text: `${copy.M3.replace("<name>", client.name)}\n\n${copy.M4.replace("<address>", address)}\n\n${copy.C19.replace("<date>", dueDateText)}\n`,
  });
  void sent;
  res.status(201).json({ clientPage: { address, endsAt: isoZ(endsAt), sentAt: isoZ(new Date()) } });
}));

clientPageRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const row = await q1<{ token: string; address: string; ends_at: Date; sent_at: Date; state: string; answer: unknown; sign_off: unknown }>(
    "SELECT token, address, ends_at, sent_at, state, answer, sign_off FROM client_pages WHERE piece_id=$1 ORDER BY sent_at DESC LIMIT 1", [piece.id]
  );
  if (!row) {
    res.json({ clientPage: { address: null, endsAt: null, sentAt: null, state: null, answer: null, signOff: null } });
    return;
  }
  res.json({
    clientPage: {
      address: row.state === "ended" ? null : row.address,
      endsAt: isoZ(row.ends_at),
      sentAt: isoZ(row.sent_at),
      state: row.state,
      answer: row.answer,
      signOff: row.sign_off,
    },
  });
}));

clientPageRouter.delete("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  await q("UPDATE client_pages SET state='ended' WHERE piece_id=$1", [piece.id]);
  res.status(204).end();
}));

// ---- Token-addressed endpoints (no session) ----

export const tokenRouter = Router({ mergeParams: true });

const endedResponse = (res: Response, lang: string): void => {
  const copy = clientCopy[(lang as ClientLang) ?? "en"];
  res.status(410).json({ error: { code: "ended", message: copy.C20 } });
};

const pageJson = async (row: NonNullable<Awaited<ReturnType<typeof tokenPage>>>) => {
  const latestEstimate = await q1<{ id: string; currency: string; material_code: string | null; lot: string | null; material_minor: number; labour_minor: number; subtotal_minor: number; tax_minor: number; total_minor: number; milestones: { percent: number; amountMinor: number }[] }>(
    `SELECT id, currency, material_code, lot, material_minor, labour_minor, subtotal_minor, tax_minor, total_minor, milestones
     FROM estimates WHERE piece_id=$1 AND state IN ('open','signedOff') ORDER BY version DESC LIMIT 1`, [row.piece_id]
  );
  const material = latestEstimate?.material_code
    ? await q1<{ code: string; name: string }>("SELECT code, name FROM materials WHERE desk_id=$1 AND code=$2", [row.desk_id, latestEstimate.material_code])
    : null;
  const notes = await q<{ kind: string; note: string }>(
    "SELECT kind, note FROM pins WHERE piece_id=$1 AND signed=true ORDER BY y, x", [row.piece_id]
  );
  const { printMinor } = await import("../decimal.js");
  const currency = (latestEstimate?.currency ?? "EUR") as "EUR" | "GBP" | "USD" | "JPY" | "AED";
  return {
    language: row.language,
    dir: row.language === "ar" ? "rtl" : "ltr",
    clientName: row.client_name,
    pieceTitle: row.title,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    endsAt: isoZ(row.ends_at),
    estimateId: latestEstimate?.id ?? null,
    material: material ? { name: material.name, code: material.code, lot: latestEstimate?.lot } : null,
    estimate: latestEstimate
      ? {
          material: printMinor(latestEstimate.material_minor, currency),
          labour: printMinor(latestEstimate.labour_minor, currency),
          subtotal: printMinor(latestEstimate.subtotal_minor, currency),
          tax: printMinor(latestEstimate.tax_minor, currency),
          total: printMinor(latestEstimate.total_minor, currency),
          milestones: (latestEstimate.milestones ?? []).map((m) => printMinor(m.amountMinor, currency)),
        }
      : null,
    notes: notes.map((n) => ({ kind: n.kind, note: n.note })),
    answer: row.answer,
    signOff: row.sign_off,
  };
};

tokenRouter.get("/:token", asyncHandler(async (req: Request, res: Response) => {
  const row = await tokenPage(req.params.token!);
  if (!row) throw err.notFound();
  if (row.state === "ended" || row.ends_at.getTime() <= Date.now()) {
    endedResponse(res, row.language);
    return;
  }
  res.json({ page: await pageJson(row) });
}));

/** Parse a seat height as typed in the page's language; returns the decimal string or a refusal. */
export function parseSeatHeight(raw: string, lang: string): { value: string } | { refusal: "C13" | "C23" } {
  if (raw.trim() === "") return { refusal: "C23" };
  let digits = "";
  if (lang === "ja" || lang === "en") {
    const full = raw.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)).replace(/．/g, ".");
    if (!/^\d+(\.\d)?$/.test(full)) return { refusal: "C13" };
    digits = full;
  } else if (lang === "ar") {
    if (/^[\u0660-\u0669]+(\u066b[\u0660-\u0669])?$/.test(raw)) {
      digits = raw.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\u066b/, ".");
    } else if (/^\d+(\.\d)?$/.test(raw)) {
      digits = raw;
    } else return { refusal: "C13" };
  } else if (lang === "it") {
    if (!/^\d+(,\d)?$/.test(raw)) return { refusal: "C13" };
    digits = raw.replace(",", ".");
  } else {
    if (!/^\d+(\.\d)?$/.test(raw)) return { refusal: "C13" };
    digits = raw;
  }
  const d = decParse(digits);
  if (d === null) return { refusal: "C13" };
  if (d.v < decParse("30")!.v || d.v > decParse("60")!.v) return { refusal: "C13" };
  return { value: digits };
}

tokenRouter.post("/:token/answer", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const row = await tokenPage(req.params.token!);
  if (!row) throw err.notFound();
  if (row.state === "ended" || row.ends_at.getTime() <= Date.now()) {
    endedResponse(res, row.language);
    return;
  }
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const copy = clientCopy[row.language as ClientLang];
  const raw = typeof body.seatHeight === "string" ? body.seatHeight : "";
  const parsed = parseSeatHeight(raw, row.language);
  if ("refusal" in parsed) {
    const message = parsed.refusal === "C13" ? copy.C13 : copy.C23;
    throw err.field({ seatHeight: message });
  }
  const at = new Date();
  await q("UPDATE client_pages SET answer=$1 WHERE token=$2", [JSON.stringify({ seatHeightCm: parsed.value, typed: raw, answeredAt: isoZ(at) }), row.token]);
  const id = newToken(8);
  await q("INSERT INTO answers (id, page_token, desk_id, seat_height, typed, at) VALUES ($1,$2,$3,$4,$5,$6)", [id, row.token, row.desk_id, parsed.value, raw, at.toISOString()]);
  res.json({ answer: { seatHeightCm: parsed.value, typed: raw, answeredAt: isoZ(at) } });
}));

tokenRouter.post("/:token/sign-off", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const row = await tokenPage(req.params.token!);
  if (!row) throw err.notFound();
  if (row.state === "ended" || row.ends_at.getTime() <= Date.now()) {
    endedResponse(res, row.language);
    return;
  }
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const copy = clientCopy[row.language as ClientLang];
  const typedName = typeof body.typedName === "string" ? body.typedName : "";
  const estimateId = typeof body.estimateId === "string" ? body.estimateId : "";
  if (typedName.trim() === "") throw err.field({ typedName: copy.C23 });
  if (!nameMatches(typedName, row.client_name)) throw err.field({ typedName: copy.C14 });
  const current = await q1<{ state: string; version: number }>(
    "SELECT state, version FROM estimates WHERE piece_id=$1 AND state IN ('open','signedOff') ORDER BY version DESC LIMIT 1", [row.piece_id]
  );
  if (!current || estimateId !== (await q1<{ id: string }>("SELECT id FROM estimates WHERE piece_id=$1 AND state IN ('open','signedOff') ORDER BY version DESC LIMIT 1", [row.piece_id]))?.id) {
    const newer = await q1<{ at: Date }>("SELECT created_at AS at FROM estimates WHERE piece_id=$1 AND state IN ('open','signedOff') ORDER BY version DESC LIMIT 1", [row.piece_id]);
    throw err.state("estimateReplaced", copy.C18.replace("<time>", newer ? localTimeHM(newer.at, "Europe/Rome") : ""));
  }
  if (current.state === "signedOff") {
    const signedAt = (row.sign_off as { at: string } | null)?.at;
    const townLabel = townNames[row.language as ClientLang][row.town] ?? row.town;
    throw err.state("alreadySignedOff", copy.C17.replace("<time>", signedAt ? localTimeHM(new Date(signedAt), townZone[row.town as "Turin"]) : "").replace("<town>", townLabel));
  }
  const at = new Date();
  await q("UPDATE estimates SET state='signedOff' WHERE piece_id=$1 AND version=$2", [row.piece_id, current.version]);
  await q("UPDATE client_pages SET sign_off=$1 WHERE token=$2", [JSON.stringify({ typedName, at: isoZ(at) }), row.token]);
  res.json({ signOff: { at: isoZ(at) } });
}));

tokenRouter.get("/:token/photographs/:side", asyncHandler(async (req: Request, res: Response) => {
  const row = await tokenPage(req.params.token!);
  if (!row) throw err.notFound();
  if (row.state === "ended" || row.ends_at.getTime() <= Date.now()) {
    endedResponse(res, row.language);
    return;
  }
  const side = req.params.side === "after" ? "after" : "before";
  const { s3 } = await import("../providers/s3.js");
  const photo = await q1<{ sha256: string }>("SELECT sha256 FROM photographs WHERE piece_id=$1 AND side=$2 AND state='stored' ORDER BY number DESC LIMIT 1", [row.piece_id, side]);
  if (!photo) throw err.notFound();
  const bytes = await s3.get(`photographs/${row.desk_id}/${row.piece_id}/${photo.sha256}`);
  if (!bytes) throw err.unavailable(apiMessages.storageDown);
  res.setHeader("Content-Type", "image/png");
  res.send(bytes);
}));
