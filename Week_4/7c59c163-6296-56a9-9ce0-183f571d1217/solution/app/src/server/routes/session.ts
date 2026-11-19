import { createHash, randomUUID } from "node:crypto";
import { clearedSessionCookie, endSession, hash, randomToken, requireRole, SESSION_COOKIE, sessionCookie, signedIn } from "../auth.js";
import { Check } from "../body.js";
import { one, pool, rows } from "../db.js";
import { config } from "../config.js";
import { HttpError, notFound, ProviderDown } from "../errors.js";
import { json, servePage, UPLOAD_LIMIT, type Ctx, type Route } from "../http.js";
import { inviteByToken, sessionFromToken } from "../identity.js";
import * as keycloak from "../keycloak.js";
import { putObject } from "../s3.js";
import { iso, memberById, venueById } from "../views.js";

const AUTH_COOKIE = "pv_auth";
const ATTEMPT_TTL_SECONDS = 600;

async function meView(memberId: string, roles: string[], venueId: string | null) {
  const member = await memberById(pool, memberId);
  const venue = venueId ? await venueById(pool, venueId) : null;
  return {
    id: member.id,
    username: member.username,
    display_name: member.display_name,
    email: member.email,
    roles,
    venue: venue ? { id: venue.id, slug: venue.slug, name: venue.name, time_zone: venue.time_zone } : null,
  };
}

/** `next` must be a same-site path. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

async function login(ctx: Ctx) {
  if (!(await keycloak.reachable())) {
    await servePage(ctx.res, 503, "signin-unavailable");
    return { status: 0, sent: true };
  }
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const binding = randomToken();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${ctx.origin}/auth/callback`;
  await pool.query(
    "INSERT INTO sign_in_attempts (state, binding_hash, verifier, nonce, next_path, redirect_uri) VALUES ($1, $2, $3, $4, $5, $6)",
    [state, hash(binding), verifier, nonce, safeNext(ctx.query.get("next")), redirectUri],
  );
  const target = new URL(keycloak.AUTHORIZE_URL);
  target.search = new URLSearchParams({
    client_id: config.keycloak.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": `${AUTH_COOKIE}=${binding}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${ATTEMPT_TTL_SECONDS}`,
      "Cache-Control": "no-store",
    },
  };
}

/**
 * Accepted once, only with a state matching this browser's cookie, within 10 minutes. Anything else
 * shows the sign-in error page, sets no session and never exchanges the code.
 */
async function callback(ctx: Ctx) {
  const state = ctx.query.get("state") ?? "";
  const binding = ctx.cookies[AUTH_COOKIE] ?? "";
  const attempt = await one<{ verifier: string; nonce: string; next_path: string; redirect_uri: string }>(
    pool,
    `UPDATE sign_in_attempts SET used_at = now()
      WHERE state = $1 AND binding_hash = $2 AND used_at IS NULL AND created_at > now() - make_interval(secs => $3)
      RETURNING verifier, nonce, next_path, redirect_uri`,
    [state, hash(binding), ATTEMPT_TTL_SECONDS],
  );
  const code = ctx.query.get("code");
  if (!attempt || !state || !binding || !code) {
    await servePage(ctx.res, 400, "signin-error");
    return { status: 0, sent: true };
  }
  try {
    const tokens = await keycloak.exchangeCode(code, attempt.verifier, attempt.redirect_uri);
    if (!tokens?.id_token || keycloak.claimsOf(tokens.id_token).nonce !== attempt.nonce) {
      await servePage(ctx.res, 400, "signin-error");
      return { status: 0, sent: true };
    }
    const { sessionId } = await sessionFromToken(tokens.access_token);
    return {
      status: 302,
      headers: {
        Location: attempt.next_path,
        "Set-Cookie": sessionCookie(sessionId),
        "Cache-Control": "no-store",
      },
    };
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    await servePage(ctx.res, 503, "signin-unavailable");
    return { status: 0, sent: true };
  }
}

async function passwordSession(ctx: Ctx) {
  const check = new Check(ctx.body, ["username", "password"]);
  const username = check.text("username", 1, 65_536, false);
  const password = check.text("password", 1, 65_536, false);
  check.done();
  const tokens = await keycloak.passwordGrant(username, password);
  if (!tokens) throw new HttpError(401, { error: "invalid_credentials" });
  const { sessionId, memberId } = await sessionFromToken(tokens.access_token);
  const session = await one<{ roles: string[]; venue_id: string | null }>(pool, "SELECT roles, venue_id FROM sessions WHERE id_hash = $1", [hash(sessionId)]);
  return json(200, await meView(memberId, session?.roles ?? [], session?.venue_id ?? null), { "Set-Cookie": sessionCookie(sessionId) });
}

async function deleteSession(ctx: Ctx) {
  signedIn(ctx);
  await endSession(ctx.cookies[SESSION_COOKIE] ?? "");
  return { status: 204, headers: { "Set-Cookie": clearedSessionCookie } };
}

async function getMe(ctx: Ctx) {
  const auth = signedIn(ctx);
  return json(200, await meView(auth.memberId, auth.roles, auth.venueId));
}

async function patchMe(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  const check = new Check(ctx.body, ["display_name"]);
  const name = check.text("display_name", 1, 60);
  check.done();
  await pool.query("UPDATE members SET display_name = $2 WHERE id = $1", [auth.memberId, name]);
  return json(200, await meView(auth.memberId, auth.roles, auth.venueId));
}

// ---- ID documents ----

interface Part {
  name: string;
  filename: string;
  data: Buffer;
}

function multipartPart(ctx: Ctx, field: string): Part | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctx.req.headers["content-type"] ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return undefined;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = ctx.raw.indexOf(delimiter);
  while (start !== -1) {
    const next = ctx.raw.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = ctx.raw.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split !== -1) {
      const head = part.subarray(0, split).toString("utf8");
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      if (name === field) return { name, filename: /filename="([^"]*)"/i.exec(head)?.[1] ?? "document", data: part.subarray(split + 4) };
    }
    start = next;
  }
  return undefined;
}

/** PDF, PNG or JPEG, judged by the bytes. */
function sniff(data: Buffer): string | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

const documentView = (d: { id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: Date }) => ({
  id: d.id,
  filename: d.filename,
  content_type: d.content_type,
  size_bytes: d.size_bytes,
  uploaded_at: iso(d.uploaded_at),
});

async function uploadDocument(ctx: Ctx) {
  const auth = signedIn(ctx);
  const venueId = requireRole(auth);
  const part = multipartPart(ctx, "document");
  if (part && part.data.length > UPLOAD_LIMIT) throw new HttpError(413, { error: "payload_too_large" });
  const check = new Check({}, []);
  const type = part && part.data.length > 0 ? sniff(part.data) : null;
  if (!part) check.fail("document", "invalid");
  else if (!type) check.fail("document", "unsupported_type");
  check.done();
  const id = randomUUID();
  const data = (part as Part).data;
  await putObject(`venues/${venueId}/documents/${auth.memberId}/${id}`, data, type as string);
  const row = await one<{ id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: Date }>(
    pool,
    "INSERT INTO documents (id, venue_id, member_id, filename, content_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
    [id, venueId, auth.memberId, (part as Part).filename.slice(0, 200), type, data.length],
  );
  return json(201, documentView(row as NonNullable<typeof row>));
}

async function listDocuments(ctx: Ctx) {
  const auth = signedIn(ctx);
  requireRole(auth);
  const docs = await rows<{ id: string; filename: string; content_type: string; size_bytes: number; uploaded_at: Date }>(
    pool,
    "SELECT * FROM documents WHERE member_id = $1 ORDER BY uploaded_at DESC",
    [auth.memberId],
  );
  return json(200, { documents: docs.map(documentView) });
}

// ---- invites ----

async function getInvite(ctx: Ctx) {
  const invite = await inviteByToken(pool, ctx.params.token ?? "");
  if (!invite) throw notFound();
  if (invite.expired) throw new HttpError(410, { error: "invite_expired" });
  return json(200, { email: invite.email, venue_name: invite.venue_name });
}

async function acceptInvite(ctx: Ctx) {
  const invite = await inviteByToken(pool, ctx.params.token ?? "");
  if (!invite) throw notFound();
  if (invite.expired) throw new HttpError(410, { error: "invite_expired" });
  const check = new Check(ctx.body, ["password"]);
  const password = check.text("password", 12, 128, false);
  check.done();
  const claimed = await one(pool, "UPDATE invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING 1", [invite.token_hash]);
  if (!claimed) throw notFound();
  try {
    await keycloak.setPassword(invite.member_id, password);
  } catch (error) {
    await pool.query("UPDATE invites SET used_at = NULL WHERE token_hash = $1", [invite.token_hash]);
    throw error;
  }
  return json(200, { email: invite.email });
}

export const sessionRoutes: Route[] = [
  { method: "GET", pattern: "/auth/login", auth: "none", handler: login },
  { method: "GET", pattern: "/auth/callback", auth: "none", handler: callback },
  { method: "POST", pattern: "/api/session", auth: "none", handler: passwordSession, outage: "sign_in_unavailable" },
  { method: "DELETE", pattern: "/api/session", auth: "session", handler: deleteSession },
  { method: "GET", pattern: "/api/me", auth: "session", handler: getMe },
  { method: "PATCH", pattern: "/api/me", auth: "session", handler: patchMe },
  { method: "POST", pattern: "/api/me/documents", auth: "session", body: "multipart", handler: uploadDocument, outage: "documents_unavailable" },
  { method: "GET", pattern: "/api/me/documents", auth: "session", handler: listDocuments },
  { method: "GET", pattern: "/api/invites/{token}", auth: "none", handler: getInvite },
  { method: "POST", pattern: "/api/invites/{token}/accept", auth: "none", handler: acceptInvite, outage: "identity_unavailable" },
];
