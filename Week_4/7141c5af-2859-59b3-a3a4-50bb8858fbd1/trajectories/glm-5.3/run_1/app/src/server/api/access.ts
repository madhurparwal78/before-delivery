import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { requireSession, loadSession } from "../session.js";
import { apiMessages, texts } from "../copy.js";
import { sha256, newToken, config } from "../config.js";
import { seedMaterials, seedRates } from "../seed-data.js";
import { q as query } from "../db.js";
import { todayTurin } from "../db.js";
import { isoZ, localTimeHM } from "../time.js";

export const accessRouter = Router({ mergeParams: true });

const NAME_MAX = 120;
const EMAIL_MAX = 254;

const hashPassword = (pw: string) => sha256(`semenza:${pw}`);

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const requireStr = (v: unknown): string => {
  if (typeof v !== "string") throw err.field({ ["" ]: apiMessages.fieldRequired });
  return v;
};

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= EMAIL_MAX;

function sessionCookie(id: string): string {
  return `semenza_session=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax`;
}

export const clientBody = (desk: { id: string; name: string; email: string }) => ({
  deskId: desk.id,
  name: desk.name,
  email: desk.email,
});

accessRouter.post("/sign-up", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const name = str(body.name);
  const email = str(body.email);
  const password = str(body.password);
  const fields: Record<string, string> = {};
  const nameV = name ?? "";
  const emailV = (email ?? "").trim();
  if (nameV.trim() === "") fields.name = apiMessages.fieldRequired;
  else if (nameV.length > NAME_MAX) fields.name = apiMessages.fieldLong(NAME_MAX);
  if (emailV === "") fields.email = apiMessages.fieldRequired;
  else if (!emailOk(emailV)) fields.email = apiMessages.email;
  const passwordV = password ?? "";
  if (passwordV.length < 10) fields.password = apiMessages.shortPassword;
  if (Object.keys(fields).length) throw err.field(fields);
  const existing = await q1<{ id: string }>("SELECT id FROM desks WHERE lower(email) = lower($1)", [emailV]);
  if (existing) throw err.state("F-109", apiMessages.emailTaken);
  const deskId = newToken(8);
  const deskName = nameV.trim();
  await query("INSERT INTO desks (id, name, email, password_hash) VALUES ($1,$2,$3,$4)", [deskId, deskName, emailV, hashPassword(passwordV)]);
  await seedMaterials(deskId);
  await seedRates(deskId);
  const sid = newToken(24);
  const endsAt = new Date(Date.now() + config.timers.session * 1000);
  await query("INSERT INTO sessions (id, desk_id, started_at, ends_at) VALUES ($1,$2,$3,$4)", [sid, deskId, new Date().toISOString(), endsAt.toISOString()]);
  res.setHeader("Set-Cookie", sessionCookie(sid));
  res.status(201).json({ session: { ...clientBody({ id: deskId, name: deskName, email: emailV }), landing: "/pieces" } });
}));

accessRouter.post("/session", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const emailV2 = (str(body.email) ?? "").trim();
  const password = str(body.password) ?? "";
  const returnTo = str(body.returnTo);
  const email = emailV2;
  const fields: Record<string, string> = {};
  if (email === "") fields.email = apiMessages.fieldRequired;
  if (password === "") fields.password = apiMessages.fieldRequired;
  if (Object.keys(fields).length) throw err.field(fields);
  const desk = await q1<{ id: string; name: string; email: string }>("SELECT id, name, email FROM desks WHERE lower(email) = lower($1)", [email]);
  if (!desk || hashPassword(password) !== (await q1<{ password_hash: string }>("SELECT password_hash FROM desks WHERE id = $1", [desk.id]))?.password_hash) {
    throw err.wrongPair();
  }
  const honoured = returnTo && /^\/[^\/\\]*$/.test(returnTo) ? returnTo : "/pieces";
  const sid = newToken(24);
  const endsAt = new Date(Date.now() + config.timers.session * 1000);
  await query("INSERT INTO sessions (id, desk_id, started_at, ends_at) VALUES ($1,$2,$3,$4)", [sid, desk.id, new Date().toISOString(), endsAt.toISOString()]);
  res.setHeader("Set-Cookie", sessionCookie(sid));
  res.status(200).json({ session: { ...clientBody(desk), landing: honoured } });
}));

accessRouter.get("/session", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const latestAnswer = await q1<{ id: string; at: Date; name: string | null; title: string | null }>(
    `SELECT a.id, a.at, c.name, p.title
     FROM answers a JOIN client_pages cp ON cp.token = a.page_token
     JOIN pieces p ON p.id = cp.piece_id JOIN clients c ON c.id = p.client_id
     WHERE cp.desk_id = $1 ORDER BY a.at DESC LIMIT 1`, [session.deskId]
  );
  const today = todayTurin();
  res.json({
    session: {
      deskId: session.deskId,
      name: session.name,
      email: session.email,
      today,
      latestAnswer: latestAnswer
        ? {
            id: latestAnswer.id,
            message: texts.F46
              .replace("<name>", latestAnswer.name ?? "")
              .replace("<title>", latestAnswer.title ?? "")
              .replace("<time>", localTimeHM(latestAnswer.at, "Europe/Rome")),
            at: isoZ(latestAnswer.at),
          }
        : null,
    },
  });
}));

accessRouter.delete("/session", asyncHandler(async (req: Request, res: Response) => {
  const session = await loadSession(req);
  if (session) {
    await query("UPDATE sessions SET ended_at = now() WHERE id = $1", [session.id]);
  }
  res.setHeader("Set-Cookie", "semenza_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.status(204).end();
}));

accessRouter.post("/password", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const currentPassword = str(body.currentPassword) ?? "";
  const newPassword = str(body.newPassword) ?? "";
  const fields: Record<string, string> = {};
  if (currentPassword === "") fields.currentPassword = apiMessages.fieldRequired;
  if (newPassword === "") fields.newPassword = apiMessages.fieldRequired;
  else if (newPassword.length < 10) fields.newPassword = apiMessages.shortPassword;
  if (Object.keys(fields).length) throw err.field(fields);
  const row = await q1<{ password_hash: string }>("SELECT password_hash FROM desks WHERE id = $1", [session.deskId]);
  if (!row || row.password_hash !== hashPassword(currentPassword)) {
    throw err.field({ currentPassword: apiMessages.wrongPair });
  }
  await query("UPDATE desks SET password_hash = $1 WHERE id = $2", [hashPassword(newPassword), session.deskId]);
  await query("UPDATE sessions SET ended_at = now() WHERE desk_id = $1 AND id <> $2", [session.deskId, session.id]);
  res.status(204).end();
}));

void requireStr;
