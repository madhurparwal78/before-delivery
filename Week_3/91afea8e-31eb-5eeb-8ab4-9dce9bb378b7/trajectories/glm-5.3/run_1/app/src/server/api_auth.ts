import { Router } from "./http.js";
import { ApiError, copy, forbidden, notFound, signedOut, validationFailed } from "./errors.js";
import { config } from "./config.js";
import * as auth from "./auth.js";
import { one, query, withTransaction } from "./db.js";
import { id, code6, sha256, verifyPassword } from "./crypto.js";
import { sendSms } from "./providers.js";
import { readBody, requireAccount, requireFields, str, codePoints } from "./api_catalog.js";

const router = new Router();
export default router;

function accountView(a: { account_id: string; name: string; role: string }): { id: string; name: string; first_name: string; role: string } {
  return { id: a.account_id, name: a.name, first_name: a.name.split(" ")[0], role: a.role };
}

interface AddressView { address_id: string; label: string; name: string; line1: string; line2: string; city: string; state: string; pincode: string; phone: string }
function addressView(a: Record<string, unknown>): AddressView {
  return {
    address_id: a.address_id as string, label: a.label as string, name: a.name as string,
    line1: a.line1 as string, line2: a.line2 as string, city: a.city as string,
    state: a.state as string, pincode: a.pincode as string, phone: a.phone as string,
  };
}

/** Sign-up sends exactly one text in every case, so probing answers identically. */
router.add("POST", "/api/auth/signup", async (ctx) => {
  const body = await readBody(ctx);
  requireFields(body, ["name", "email", "phone", "password"]);
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const phoneRaw = str(body.phone);
  const password = str(body.password);
  const fields: Record<string, string> = {};
  if (codePoints(name) < 1 || codePoints(name) > 60) fields.name = copy.field.minLength("Name", 1);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "Enter a valid email address.";
  if (!/^\+91[6-9]\d{9}$/.test(phoneRaw)) fields.phone = copy.field.badPhone;
  if (password.length < 10 || password.length > 128) fields.password = copy.field.minLength("Password", 10);
  if (Object.keys(fields).length) throw validationFailed(fields);

  const phone = phoneRaw;
  const sends = await auth.countSends(phone);
  if (sends >= 3) throw new ApiError(429, "too_many_codes", copy.tooManyCodes, { retryAfter: await auth.oldestSendAge(phone) });

  const existing = await one<{ account_id: string }>(
    "SELECT account_id FROM shoppers WHERE email = $1 OR phone = $2", [email, phone],
  );
  const pendingId = id("PD");
  const code = code6();
  if (existing) {
    // the signup_existing text carries no code and no second account is made
    const sms = await sendSms(phone, "signup_existing");
    if (sms.ok) await auth.recordSend(phone, "signup");
    await query(
      `INSERT INTO pending_signins (pending_id, account_id, role, identifier, code_hash, tries, issued_at, expires_at)
       VALUES ($1,'NONE','shopper',$2,$3,0,now(),now() + ($4 || ' seconds')::interval)`,
      [pendingId, phone, sha256("none"), String(config.timing.otpTtlSeconds)],
    );
    ctx.setCookies.push(auth.setPendingCookie(pendingId));
    ctx.res.statusCode = 202;
    return { status: "code_sent", message: copy.codeSentGeneric };
  }
  const sms = await sendSms(phone, "signup_code", code);
  if (!sms.ok) throw new ApiError(503, "sms_unavailable", copy.smsUnavailable);
  await auth.recordSend(phone, "signup");
  ctx.setCookies.push(auth.setPendingCookie(pendingId));
  const { hashPassword } = await import("./crypto.js");
  await query(
    `INSERT INTO pending_signins (pending_id, account_id, role, identifier, code_hash, tries, issued_at, expires_at)
     VALUES ($1,'NONE','shopper',$2,$3,0,now(),now() + ($4 || ' seconds')::interval)`,
    [pendingId, phone, sha256(code), String(config.timing.otpTtlSeconds)],
  );
  await query(
    `INSERT INTO signup_drafts (pending_id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (pending_id) DO NOTHING`,
    [pendingId, name, email, phone, hashPassword(password)],
  );
  ctx.res.statusCode = 202;
  return { status: "code_sent", message: copy.codeSentGeneric };
});

router.add("POST", "/api/auth/signup/verify", async (ctx) => {
  const body = await readBody(ctx);
  const code = str(body.code);
  const pending = await auth.loadPending(ctx.cookies);
  if (!pending) throw new ApiError(401, "invalid_code", copy.invalidCode);
  const draft = await one<{ name: string; email: string; phone: string; password_hash: string }>(
    "SELECT * FROM signup_drafts WHERE pending_id = $1", [pending.pending_id],
  );
  if (!draft) throw new ApiError(401, "invalid_code", copy.invalidCode);
  if (pending.tries >= 5) throw new ApiError(401, "invalid_code", copy.invalidCode);
  if (sha256(code) !== pending.code_hash) {
    await query("UPDATE pending_signins SET tries = tries + 1 WHERE pending_id = $1", [pending.pending_id]);
    throw new ApiError(401, "invalid_code", copy.invalidCode);
  }
  const accountId = id("U");
  const sessionId = id("SES");
  await withTransaction(async (client) => {
    await client.query("DELETE FROM pending_signins WHERE pending_id = $1", [pending.pending_id]);
    await client.query("DELETE FROM signup_drafts WHERE pending_id = $1", [pending.pending_id]);
    await client.query(
      `INSERT INTO shoppers (account_id, name, email, phone, password_hash, balance_paise, role) VALUES ($1,$2,$3,$4,$5,0,'shopper')`,
      [accountId, draft.name, draft.email, draft.phone, draft.password_hash],
    );
    await client.query(
      `INSERT INTO sessions (session_id, account_id, role, expires_at) VALUES ($1,$2,'shopper', now() + ($3 || ' seconds')::interval)`,
      [sessionId, accountId, String(config.timing.sessionTtlSeconds)],
    );
  });
  ctx.setCookies.push(...auth.setSessionCookies(sessionId));
  ctx.setCookies.push(auth.clearPendingCookie());
  ctx.res.statusCode = 201;
  return { account: { id: accountId, name: draft.name, first_name: draft.name.split(" ")[0], role: "shopper" } };
});

router.add("POST", "/api/auth/signin", async (ctx) => {
  const body = await readBody(ctx);
  const identifier = str(body.identifier);
  const password = str(body.password);
  const result = await auth.beginSignin(identifier, password);
  ctx.setCookies.push(auth.setPendingCookie(result.pendingId));
  ctx.res.statusCode = 202;
  return { status: "code_sent", message: copy.stepOnePassed, resend_in: result.resendIn };
});

router.add("POST", "/api/auth/signin/verify", async (ctx) => {
  const body = await readBody(ctx);
  const code = str(body.code);
  const pending = await auth.loadPending(ctx.cookies);
  if (!pending) throw new ApiError(401, "invalid_code", copy.invalidCode);
  const result = await auth.finishPending(pending, code);
  ctx.setCookies.push(...auth.setSessionCookies(result.sessionId));
  ctx.setCookies.push(auth.clearPendingCookie());
  return { account: accountView(result.account) };
});

router.add("POST", "/api/auth/code/resend", async (ctx) => {
  const pending = await auth.loadPending(ctx.cookies);
  if (!pending) throw new ApiError(401, "invalid_code", copy.invalidCode);
  const result = await auth.resendPendingCode(pending);
  ctx.res.statusCode = 202;
  return { status: "code_sent", resend_in: result.resendIn };
});

/** Forgot-password answers the same 202 for any well-formed identifier, even while SMS is down. */
router.add("POST", "/api/auth/password/forgot", async (ctx) => {
  const body = await readBody(ctx);
  const identifier = str(body.identifier);
  const norm = auth.normalizeIdentifier(identifier);
  const fields: Record<string, string> = {};
  if (!norm.email && !/^\+91[6-9]\d{9}$/.test(norm.phone ?? "")) {
    fields.identifier = norm.identifier.includes("@") ? "Enter a valid email address." : copy.field.badPhone;
  }
  if (Object.keys(fields).length) throw validationFailed(fields);
  const sends = await auth.countSends(identifier);
  if (sends >= 3) throw new ApiError(429, "too_many_codes", copy.tooManyCodes, { retryAfter: await auth.oldestSendAge(identifier) });
  const account = await auth.accountByIdOrIdentifier(identifier);
  if (account) {
    const code = code6();
    const sms = await sendSms(account.phone, "reset_code", code);
    if (sms.ok) {
      await query(
        `INSERT INTO pending_signins (pending_id, account_id, role, identifier, code_hash, tries, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,0,now(),now() + ($6 || ' seconds')::interval)`,
        [id("PD"), account.account_id, account.role, identifier, sha256(code), String(config.timing.otpTtlSeconds)],
      );
    }
  }
  await auth.recordSend(identifier, "forgot");
  ctx.res.statusCode = 202;
  return { status: "code_sent", message: copy.codeSentGeneric };
});

router.add("POST", "/api/auth/password/reset", async (ctx) => {
  const body = await readBody(ctx);
  const identifier = str(body.identifier);
  const code = str(body.code);
  const newPassword = str(body.new_password);
  const fields: Record<string, string> = {};
  if (newPassword.length < 10 || newPassword.length > 128) fields.new_password = copy.field.minLength("Password", 10);
  if (Object.keys(fields).length) throw validationFailed(fields);
  const account = await auth.accountByIdOrIdentifier(identifier);
  if (!account) throw new ApiError(401, "invalid_code", copy.invalidCode);
  const pending = await one<{ pending_id: string; code_hash: string; tries: number; expires_at: string }>(
    "SELECT * FROM pending_signins WHERE account_id = $1 AND identifier = $2 ORDER BY issued_at DESC LIMIT 1",
    [account.account_id, identifier],
  );
  if (!pending || pending.tries >= 5 || Date.now() >= new Date(pending.expires_at).getTime() || sha256(code) !== pending.code_hash) {
    throw new ApiError(401, "invalid_code", copy.invalidCode);
  }
  const { hashPassword } = await import("./crypto.js");
  await withTransaction(async (client) => {
    await client.query("DELETE FROM pending_signins WHERE account_id = $1", [account.account_id]);
    await client.query("UPDATE shoppers SET password_hash = $2 WHERE account_id = $1", [account.account_id, hashPassword(newPassword)]);
    await client.query("DELETE FROM sessions WHERE account_id = $1", [account.account_id]);
  });
  return { status: "password_reset" };
});

router.add("POST", "/api/auth/refresh", async (ctx) => {
  const refreshCookie = ctx.cookies[auth.COOKIE_SESSION];
  if (!refreshCookie) throw signedOut();
  const row = await one<{ session_id: string }>(
    "SELECT session_id FROM sessions WHERE session_id = $1 AND expires_at > now()", [refreshCookie],
  );
  if (!row) throw signedOut();
  ctx.setCookies.push(auth.refreshAccessCookie(refreshCookie));
  return { status: "refreshed" };
});

router.add("POST", "/api/auth/signout", async (ctx) => {
  const token = ctx.cookies[auth.COOKIE_SESSION] ?? ctx.cookies[auth.COOKIE_ACCESS];
  if (token) await query("DELETE FROM sessions WHERE session_id = $1", [token]);
  ctx.setCookies.push(...auth.clearSessionCookies());
  ctx.res.statusCode = 204;
  return null;
});

router.add("GET", "/api/me", async (ctx) => {
  requireAccount(ctx);
  const balance = await one<{ balance_paise: string; balance_hold_paise: string }>(
    "SELECT balance_paise, balance_hold_paise FROM shoppers WHERE account_id = $1", [ctx.account!.id],
  );
  return {
    account: accountView({ account_id: ctx.account!.id, name: ctx.account!.name, role: ctx.account!.role }),
    balance_paise: Number(balance?.balance_paise ?? 0) - Number(balance?.balance_hold_paise ?? 0),
  };
});

router.add("POST", "/api/account/password", async (ctx) => {
  requireAccount(ctx);
  const body = await readBody(ctx);
  requireFields(body, ["current_password", "new_password"]);
  const current = str(body.current_password);
  const next = str(body.new_password);
  const fields: Record<string, string> = {};
  if (next.length < 10 || next.length > 128) fields.new_password = copy.field.minLength("Password", 10);
  if (Object.keys(fields).length) throw validationFailed(fields);
  const account = await one<{ password_hash: string }>("SELECT password_hash FROM shoppers WHERE account_id = $1", [ctx.account!.id]);
  if (!account || !verifyPassword(current, account.password_hash)) {
    throw validationFailed({ current_password: copy.field.wrongCurrentPassword });
  }
  const newSession = await auth.changePassword(ctx.account!.id, current, next, ctx.sessionId ?? "");
  if (newSession) ctx.setCookies.push(...auth.setSessionCookies(newSession));
  return { status: "password_changed", message: copy.passwordChanged };
});

router.add("GET", "/api/account/addresses", async (ctx) => {
  requireAccount(ctx);
  const rows = await query<Record<string, unknown>>("SELECT * FROM addresses WHERE account_id = $1 ORDER BY created_seq", [ctx.account!.id]);
  return { addresses: rows.map(addressView) };
});

router.add("POST", "/api/account/addresses", async (ctx) => {
  requireAccount(ctx);
  const body = await readBody(ctx);
  requireFields(body, ["label", "name", "line1", "line2", "city", "pincode", "phone"]);
  const view = await validateAddress(body);
  const addressId = id("AD");
  await query(
    `INSERT INTO addresses (address_id, account_id, label, name, line1, line2, city, state, pincode, phone, created_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, (SELECT coalesce(max(created_seq),0)+1 FROM addresses))`,
    [addressId, ctx.account!.id, view.label, view.name, view.line1, view.line2, view.city, view.state, view.pincode, view.phone],
  );
  ctx.res.statusCode = 201;
  return addressView((await one<Record<string, unknown>>("SELECT * FROM addresses WHERE address_id = $1", [addressId]))!);
});

router.add("DELETE", "/api/account/addresses/:id", async (ctx) => {
  requireAccount(ctx);
  const res = await query("DELETE FROM addresses WHERE address_id = $1 AND account_id = $2 RETURNING address_id", [ctx.params.id, ctx.account!.id]);
  if (res.length === 0) throw notFound();
  ctx.res.statusCode = 204;
  return null;
});

router.add("GET", "/api/account/cards", async (ctx) => {
  requireAccount(ctx);
  const rows = await query<{ card_id: string; network: string; last4: string; expiry_month: number; expiry_year: number; name: string }>("SELECT * FROM saved_cards WHERE account_id = $1 ORDER BY created_seq", [ctx.account!.id]);
  return { cards: rows };
});

router.add("DELETE", "/api/account/cards/:id", async (ctx) => {
  requireAccount(ctx);
  await query("DELETE FROM saved_cards WHERE card_id = $1 AND account_id = $2", [ctx.params.id, ctx.account!.id]);
  ctx.res.statusCode = 204;
  return null;
});

router.add("POST", "/api/balance/redeem", async (ctx) => {
  requireAccount(ctx, ["shopper"]);
  const body = await readBody(ctx);
  requireFields(body, ["code"]);
  const code = str(body.code);
  const rl = await auth.rateLimit(`gift:${ctx.account!.id}`, 10);
  if (!rl.allowed) throw new ApiError(429, "rate_limited", copy.rateLimited(rl.retryAfter), { retryAfter: rl.retryAfter });
  if (!code) throw validationFailed({ code: copy.field.badGiftCard });
  const card = await one<{ code: string; value_paise: string; used_by: string | null }>(
    "SELECT * FROM gift_cards WHERE code = $1", [code],
  );
  if (!card || card.used_by) throw validationFailed({ code: copy.field.badGiftCard });
  await withTransaction(async (client) => {
    const updated = await client.query(
      "UPDATE gift_cards SET used_by = $2, used_at = now() WHERE code = $1 AND used_by IS NULL RETURNING value_paise",
      [code, ctx.account!.id],
    );
    if (updated.rows.length === 0) throw validationFailed({ code: copy.field.badGiftCard });
    await client.query(
      "UPDATE shoppers SET balance_paise = balance_paise + $2 WHERE account_id = $1",
      [ctx.account!.id, updated.rows[0].value_paise],
    );
  });
  const balance = await one<{ balance_paise: string }>("SELECT balance_paise FROM shoppers WHERE account_id = $1", [ctx.account!.id]);
  return { balance_paise: Number(balance?.balance_paise ?? 0) };
});

async function validateAddress(body: Record<string, unknown>): Promise<AddressView> {
  const label = str(body.label), name = str(body.name), line1 = str(body.line1);
  const line2 = str(body.line2), city = str(body.city), pincode = str(body.pincode), phone = str(body.phone);
  const fields: Record<string, string> = {};
  if (!label) fields.label = "Enter a label.";
  if (!name) fields.name = "Enter a name.";
  if (!line1) fields.line1 = "Enter the street.";
  if (!city) fields.city = "Enter a city.";
  if (!/^\d{6}$/.test(pincode) || pincode.startsWith("0")) fields.pincode = copy.field.badPincode;
  if (!/^\+91[6-9]\d{9}$/.test(phone)) fields.phone = copy.field.badPhone;
  if (Object.keys(fields).length) throw validationFailed(fields);
  const pin = await one<{ state: string | null }>("SELECT state FROM pincodes WHERE pincode = $1", [pincode]);
  return { address_id: "", label, name, line1, line2, city, state: pin?.state ?? "", pincode, phone };
}

export { accountView, addressView };
