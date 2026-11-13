import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.js";
import { ApiError, ValidationError, bad, validation } from "../errors.js";
import { db } from "../db.js";
import { sendMail } from "../providers/mail.js";
import { formatDateTime } from "../../shared/format.js";
import { meInfo, signIn, signUp, verify, resendConfirmation } from "../accounts.js";
import { createSessionForAccount, destroySession, parseCookieValue, sessionCookieHeader, clearSessionCookieHeader } from "../sessions.js";
import type { UploadedFile } from "../multipart.js";
import type { AccountRow } from "../auth-types.js";
import { studioDateKey, workspaceNow } from "../clock.js";

export function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...(headers ?? {}),
  });
  res.end(payload);
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
  account: AccountRow | null;
  linkToken: string | null;
  actorName: string;
  cookie: string | undefined;
  uploads?: UploadedFile[];
}

export type Handler = (ctx: Ctx, ...params: string[]) => Promise<void>;

export async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError("bad_request"));
      }
    });
    req.on("error", () => reject(new ApiError("bad_request")));
  });
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof ValidationError) {
    json(res, 422, { errors: err.errors });
    return;
  }
  if (err instanceof ApiError) {
    json(res, err.status, { error: err.code, ...err.extra });
    return;
  }
  process.stderr.write(`internal: ${err instanceof Error ? err.stack : String(err)}\n`);
  json(res, 500, { error: "internal" });
}

export function requireAccount(ctx: Ctx): AccountRow {
  if (!ctx.account) throw bad("unauthenticated");
  return ctx.account;
}

export async function handleSignup(ctx: Ctx): Promise<void> {
  const result = await signUp(ctx.body);
  json(ctx.res, 201, result);
}

export async function handleVerify(ctx: Ctx): Promise<void> {
  const body = ctx.body as { token?: string };
  if (typeof body?.token !== "string" || body.token === "") throw validation({ token: "This confirmation link is not valid." });
  const outcome = await verify(body.token);
  if (outcome.kind === "unknown") throw bad("not_found");
  if (outcome.kind === "expired") throw bad("verify_link_expired", { email: outcome.email });
  if (outcome.kind === "replaced") throw bad("verify_link_replaced", { email: outcome.email });
  json(ctx.res, 200, { verified: true, email: outcome.email });
}

export async function handleResend(ctx: Ctx): Promise<void> {
  const body = ctx.body as { email?: string; token?: string };
  let email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (typeof body?.token === "string" && body.token !== "" && email === "") {
    const row = await db.one<{ email: string }>(
      `select a.email from confirm_tokens t join accounts a on a.id = t.account_id where t.id = $1`,
      [body.token],
    );
    if (row) email = row.email;
  }
  if (email === "") throw validation({ email: "Enter a valid email address." });
  const status = await resendConfirmation(email);
  if (status === "not_sent") throw bad("mail_unavailable");
  json(ctx.res, 202, { email_status: "sent" });
}

export async function handleSignin(ctx: Ctx): Promise<void> {
  const body = ctx.body as { email?: string; password?: string };
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const outcome = await signIn(email, password);
  if (!outcome.ok) {
    if (outcome.error === "signin_locked") {
      throw bad("signin_locked", { retry_after_seconds: (outcome.minutes ?? 1) * 60 });
    }
    if (outcome.error === "unverified") throw bad("unverified", { email: outcome.email });
    throw bad("invalid_credentials");
  }
  const account = outcome.account!;
  const token = await createSessionForAccount(account.id);
  const info = await meInfo(account);
  json(
    ctx.res,
    200,
    {
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        time_zone: account.time_zone,
        verified: true,
      },
      trial: info.trial,
      now: info.now,
    },
    { "set-cookie": sessionCookieHeader(token) },
  );
}

export async function handleSignout(ctx: Ctx): Promise<void> {
  const token = parseCookieValue(ctx.cookie);
  if (token) await destroySession(token);
  json(ctx.res, 204, null, { "set-cookie": clearSessionCookieHeader() });
}

export async function handleMe(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const info = await meInfo(account);
  json(ctx.res, 200, info);
}

export async function handleQuote(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const { epochMs } = await workspaceNow(account.workspace_id);
  const dateKey = studioDateKey(epochMs, account.time_zone);
  const existing = await db.one<{ count: string }>(
    `select count(*) as count from quotes where workspace_id = $1 and date_key = $2`,
    [account.workspace_id, dateKey],
  );
  const seq = Number(existing?.count ?? 0) + 1;
  const number = `Q-${dateKey.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
  const sent = await sendMail({
    to: account.email,
    subject: "Your Corbel Draft Pro quote",
    text: `$12.00 per month\n${number}\n${dateKey}`,
  });
  if (!sent) throw bad("mail_unavailable");
  await db.run(
    `insert into quotes (workspace_id, number, date_key, seq, sent_to, sent_epoch) values ($1, $2, $3, $4, $5, $6)`,
    [account.workspace_id, number, dateKey, seq, account.email, epochMs],
  );
  json(ctx.res, 201, {
    quote: { number, amount: "12.00", currency: "USD", sent_to: account.email },
  });
}

export async function handleTrialEvent(ctx: Ctx): Promise<void> {
  const account = requireAccount(ctx);
  const info = await meInfo(account);
  json(ctx.res, 200, { trial: info.trial });
}

export function formatAccountDates(epochMs: number, zone: string): string {
  return formatDateTime(epochMs, zone);
}

export const accountRoutes: Record<string, Handler> = {
  "POST /api/auth/signup": handleSignup,
  "POST /api/auth/verify": handleVerify,
  "POST /api/auth/verify/resend": handleResend,
  "POST /api/auth/signin": handleSignin,
  "POST /api/auth/signout": handleSignout,
  "GET /api/me": handleMe,
  "POST /api/quotes": handleQuote,
};

export function publicUrl(): string {
  return config.publicUrl;
}
