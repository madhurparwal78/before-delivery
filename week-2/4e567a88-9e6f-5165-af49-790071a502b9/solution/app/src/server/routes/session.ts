// Sign-in, the signed-in member, dependency status and the team list.

import { authenticate, clearedCookie, sessionCookie, signIn, signOut } from "../auth";
import { pool, rows } from "../db";
import { fail, invalid } from "../errors";
import { json, noContent, route } from "../http";
import { dependencyState } from "../services/status";

route("GET", "/api/health", "none", async () => json(200, { status: "ok" }));

route("POST", "/api/session", "json", async (req) => {
  const body = (req.json ?? {}) as { email?: unknown; passcode?: unknown };
  const errors: Record<string, string> = {};
  if (typeof body.email !== "string" || !body.email) errors.email = "Required.";
  if (typeof body.passcode !== "string" || !body.passcode) errors.passcode = "Required.";
  if (Object.keys(errors).length) invalid(errors);
  const signed = await signIn(body.email as string, body.passcode as string);
  if (!signed) fail("unauthenticated");
  return json(200, { member: signed.member }, { "Set-Cookie": sessionCookie(signed.token) });
});

route("DELETE", "/api/session", "none", async (req) => {
  await authenticate(req);
  await signOut(req);
  return { ...noContent, headers: { "Set-Cookie": clearedCookie } };
});

route("GET", "/api/me", "none", async (req) => {
  const { context: _context, ...member } = await authenticate(req);
  return json(200, { member });
});

route("GET", "/api/system", "none", async (req) => {
  await authenticate(req);
  const state = dependencyState();
  return json(200, { storage: state.storage, billing: state.billing, checked_at: state.checkedAt.toISOString() });
});

route("GET", "/api/teams", "none", async (req) => {
  const caller = await authenticate(req);
  const teams = await rows<{ id: string; name: string }>(pool,
    "SELECT id, name FROM teams WHERE $1::text IS NULL OR id = $1 ORDER BY position", [caller.team_id]);
  return json(200, { teams });
});
