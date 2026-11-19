import { Router, type Request, type Response } from "express";
import { q1, q } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { meili } from "../providers/meili.js";
import { assertOrigin, readJsonBody, asBody, assertDepth, bumpCount, countAndLimit } from "../request.js";
import { config } from "../config.js";
import { sendMail } from "../providers/mail.js";
import { fmtDateEn, fmtMinuteTurin } from "../time.js";

export const searchRouter = Router({ mergeParams: true });

searchRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const raw = typeof req.query.q === "string" ? req.query.q : "";
  if (raw === "") {
    res.json({ results: [] });
    return;
  }
  if (raw.length > 200) throw err.field({ q: apiMessages.fieldLong(200) });
  const hits = await meili.search(raw, session.deskId);
  if (!hits) {
    const down = await q1<{ n: number }>("SELECT 1 AS n FROM search_sync WHERE desk_id=$1 AND pending=true LIMIT 1", [session.deskId]);
    throw err.unavailable(apiMessages.searchDown);
  }
  res.json({ results: hits.map((h) => ({ kind: h.kind, id: h.refId, label: h.label, href: h.href })) });
}));

// ---- Enquiries ----

export const enquiriesRouter = Router({ mergeParams: true });

const NAME_MAX = 120;
const MESSAGE_MAX = 5000;
const EMAIL_MAX = 254;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= EMAIL_MAX;

enquiriesRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const name = (str(body.name) ?? "").trim();
  const email = (str(body.email) ?? "").trim();
  const message = (str(body.message) ?? "").trim();
  const fields: Record<string, string> = {};
  if (name === "") fields.name = apiMessages.fieldRequired;
  else if (name.length > NAME_MAX) fields.name = apiMessages.fieldLong(NAME_MAX);
  if (email === "" || !emailOk(email)) fields.email = email === "" ? apiMessages.fieldRequired : apiMessages.email;
  if (message === "") fields.message = apiMessages.fieldRequired;
  else if (message.length > MESSAGE_MAX) fields.message = apiMessages.fieldLong(MESSAGE_MAX);
  if (Object.keys(fields).length) throw err.field(fields);
  const windowSeconds = config.timers.enquiryWindow;
  await countAndLimit(email.toLowerCase(), "enquiries_log", "email", windowSeconds, 3, (retry) => apiMessages.enquiryLimited.replace("<minute>", retryMinute(retry)));
  await bumpCount("enquiries_log", "email", email.toLowerCase(), windowSeconds);
  const oneLineName = name.replace(/\s+/g, " ").trim();
  await sendMail({
    to: "agnese@bottega-semenza.example",
    subject: `Enquiry from ${oneLineName}`,
    text: `${oneLineName}\n${email}\n\n${message}`,
    replyTo: email,
  });
  res.status(202).json({ received: true });
}));

const retryMinute = (retry: number) => fmtMinuteTurin(new Date(Date.now() + retry * 1000));
void q;
void fmtDateEn;
