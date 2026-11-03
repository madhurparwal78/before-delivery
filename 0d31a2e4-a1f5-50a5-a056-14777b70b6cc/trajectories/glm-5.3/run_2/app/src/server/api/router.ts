import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { ApiError, err, readJsonBody, sendError, sendJson } from "../http.js";
import { hueFor } from "../../shared/domain.js";
import {
  confirmPasswordReset,
  createMailSender,
  login,
  requestPasswordReset,
  resendVerification,
  signup,
  verifyToken
} from "./accounts.js";
import {
  acceptFriendRequest,
  blockPlayer,
  declineFriendRequest,
  listFriends,
  removeFriend,
  sendFriendRequest,
  unblockPlayer,
  withdrawFriendRequest
} from "./friends.js";
import {
  acceptInvite,
  cancelQueue,
  declineInvite,
  handOverLeadership,
  inviteToParty,
  leaveLobby,
  leaveParty,
  listInvites,
  loadLobby,
  loadParty,
  partyOfUser,
  queueParty
} from "./parties.js";
import { listConversations, listDmMessages, listPartyMessages, sendDmMessage, sendPartyMessage } from "./chat.js";
import { profileView } from "./profiles.js";
import { exportInputs, framesAtTick, loadMatch, runSimulate } from "./matches.js";
import type { Hub } from "./hub.js";
import type { MatchRunner } from "./runner.js";
import { seatQueuedParties } from "./matchmaker.js";

export type RouterDeps = {
  pool: Pool;
  hub: Hub;
  runner: MatchRunner;
  baseUrl: string;
  smtpHost: string;
  smtpPort: number;
  ownOrigin: string;
  sessionOf: (token: string) => Promise<number | null>;
  cookie: (res: ServerResponse, token: string | null) => void;
};

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  userId: number | null;
  me: { id: number; email_verified: boolean } | null;
  deps: RouterDeps;
};

type Handler = (ctx: RequestContext, params: string[]) => Promise<void>;

export type Route = { method: string; pattern: RegExp; handler: Handler };

export type RouteTable = {
  route: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  routes: Route[];
};

function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  sendJson(res, status, body, headers);
}

/** The origin this request was addressed to; APP_PUBLIC_URL is only the link base. */
function ownOriginOf(req: IncomingMessage, fallback: string): string {
  const host = req.headers["host"];
  if (typeof host !== "string" || host.length === 0) return fallback;
  return `http://${host}`;
}

function sessionTokenOf(req: IncomingMessage): string | null {
  const header = String(req.headers["cookie"] ?? "");
  const match = /(?:^|;\s*)pc_session=([^;]+)/.exec(header);
  return match ? decodeURIComponent(match[1] as string) : null;
}

export function createRouter(deps: RouterDeps): RouteTable {
  const routes: Route[] = [];

  const add = (method: string, path: string, handler: Handler) => {
    const source = path.replace(/:(\w+)/g, "([^/]+)");
    routes.push({ method, pattern: new RegExp(`^${source}$`), handler });
  };

  const requireAuth = (ctx: RequestContext): { id: number; email_verified: boolean } => {
    if (!ctx.me) throw err("unauthenticated");
    return ctx.me;
  };

  const requireVerified = (ctx: RequestContext): number => {
    const me = requireAuth(ctx);
    if (!me.email_verified) throw err("email_unverified");
    return me.id;
  };

  const mail = () => createMailSender(deps.smtpHost, deps.smtpPort);

  // ---- Accounts ----
  add("POST", "/api/auth/signup", async (ctx) => {
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await signup(deps.pool, {
      email: String(body["email"] ?? ""),
      handle: String(body["handle"] ?? ""),
      password: String(body["password"] ?? ""),
      baseUrl: deps.baseUrl,
      mail: mail(),
      now: new Date()
    });
    deps.cookie(ctx.res, result.sessionToken);
    json(ctx.res, 201, { user: result.user, verificationEmail: result.verificationEmail });
  });

  add("POST", "/api/auth/verify", async (ctx) => {
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const user = await verifyToken(deps.pool, String(body["token"] ?? ""), new Date());
    json(ctx.res, 200, { user });
  });

  add("POST", "/api/auth/verification/resend", async (ctx) => {
    const me = requireAuth(ctx);
    await readJsonBody(ctx.req, 16384).catch(() => null);
    const email = await resendVerification(deps.pool, me.id, { baseUrl: deps.baseUrl, mail: mail(), now: new Date() });
    json(ctx.res, 202, { verificationEmail: "sent", email: email.email });
  });

  add("POST", "/api/auth/login", async (ctx) => {
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await login(deps.pool, String(body["email"] ?? ""), String(body["password"] ?? ""));
    deps.cookie(ctx.res, result.sessionToken);
    json(ctx.res, 200, { user: result.user });
  });

  add("POST", "/api/auth/logout", async (ctx) => {
    await readJsonBody(ctx.req, 16384).catch(() => null);
    const token = sessionTokenOf(ctx.req);
    if (token) await deps.pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    deps.cookie(ctx.res, null);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  add("GET", "/api/me", async (ctx) => {
    const me = requireAuth(ctx);
    const row = await deps.pool.query<{ id: number; handle: string; email: string; email_verified: boolean }>(
      "SELECT id, handle, email, email_verified FROM users WHERE id = $1",
      [me.id]
    );
    const user = row.rows[0];
    if (!user) throw err("unauthenticated");
    json(ctx.res, 200, {
      user: { id: user.id, handle: user.handle, email: user.email, emailVerified: user.email_verified, hue: hueFor(user.id) }
    });
  });

  add("POST", "/api/auth/password-reset", async (ctx) => {
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    await requestPasswordReset(deps.pool, String(body["email"] ?? ""), { baseUrl: deps.baseUrl, mail: mail(), now: new Date() });
    json(ctx.res, 202, { status: "accepted" });
  });

  add("POST", "/api/auth/password-reset/confirm", async (ctx) => {
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    await confirmPasswordReset(deps.pool, String(body["token"] ?? ""), String(body["password"] ?? ""), new Date());
    json(ctx.res, 200, { status: "password_changed" });
  });

  // ---- Players and friends ----
  add("GET", "/api/users/:handle", async (ctx, params) => {
    const me = requireAuth(ctx);
    const handle = decodeURIComponent(params[0] ?? "");
    const view = await profileView(deps.pool, handle, me.id, deps.hub);
    json(ctx.res, 200, view);
  });

  add("GET", "/api/friends", async (ctx) => {
    const id = requireVerified(ctx);
    json(ctx.res, 200, await listFriends(deps.pool, id, (userId) => deps.hub.presenceOf(userId)));
  });

  add("POST", "/api/friends/requests", async (ctx) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await sendFriendRequest(deps.pool, id, String(body["handle"] ?? ""));
    if (result.kind === "merged") {
      await deps.hub.announceFriendsChanged(id, result.friendship.user.id);
      json(ctx.res, 200, { friendship: result.friendship });
      return;
    }
    if (result.kind === "replay") {
      json(ctx.res, 200, { request: result.request });
      return;
    }
    json(ctx.res, 201, { request: result.request });
  });

  add("POST", "/api/friends/requests/:id/accept", async (ctx, params) => {
    const id = requireVerified(ctx);
    const friendship = await acceptFriendRequest(deps.pool, id, Number(params[0]));
    await deps.hub.announceFriendsChanged(id, friendship.user.id);
    json(ctx.res, 200, { friendship });
  });

  add("POST", "/api/friends/requests/:id/decline", async (ctx, params) => {
    const id = requireVerified(ctx);
    await declineFriendRequest(deps.pool, id, Number(params[0]));
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  add("DELETE", "/api/friends/requests/:id", async (ctx, params) => {
    const id = requireVerified(ctx);
    await withdrawFriendRequest(deps.pool, id, Number(params[0]));
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  add("DELETE", "/api/friends/:userId", async (ctx, params) => {
    const id = requireVerified(ctx);
    const userId = Number(params[0]);
    await removeFriend(deps.pool, id, userId);
    await deps.hub.announceFriendsChanged(id, userId);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  add("POST", "/api/blocks", async (ctx) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await blockPlayer(deps.pool, id, Number(body["userId"]));
    await deps.hub.announceFriendsChanged(id, result.user.id);
    json(ctx.res, result.blocked ? 201 : 200, { blocked: result.user });
  });

  add("DELETE", "/api/blocks/:userId", async (ctx, params) => {
    const id = requireVerified(ctx);
    await unblockPlayer(deps.pool, id, Number(params[0]));
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  // ---- Party and lobby ----
  add("GET", "/api/party", async (ctx) => {
    const id = requireVerified(ctx);
    const party = await partyOfUser(deps.pool, id);
    if (!party) throw err("server_error");
    const invites = await listInvites(deps.pool, id);
    json(ctx.res, 200, { party, invites });
  });

  add("POST", "/api/party/invites", async (ctx) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await inviteToParty(deps.pool, id, Number(body["userId"]));
    if (!result.replay) {
      const inviteeParty = await partyOfUser(deps.pool, result.invite.to.id);
      if (inviteeParty) await deps.hub.announcePartyTo(result.invite.to.id, inviteeParty);
    }
    json(ctx.res, result.replay ? 200 : 201, { invite: result.invite });
  });

  add("POST", "/api/party/invites/:id/accept", async (ctx, params) => {
    const id = requireVerified(ctx);
    const party = await acceptInvite(deps.pool, id, Number(params[0]));
    await deps.hub.announceParty(party);
    json(ctx.res, 200, { party });
  });

  add("POST", "/api/party/invites/:id/decline", async (ctx, params) => {
    const id = requireVerified(ctx);
    await declineInvite(deps.pool, id, Number(params[0]));
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  add("POST", "/api/party/leave", async (ctx) => {
    const id = requireVerified(ctx);
    const before = await partyOfUser(deps.pool, id);
    const lobbyId = before?.lobbyId ?? null;
    const party = await leaveParty(deps.pool, id);
    await deps.hub.announceParty(party);
    if (lobbyId !== null) {
      const lobby = await loadLobby(deps.pool, lobbyId);
      if (lobby) await deps.hub.announceLobby(lobbyId, lobby.lobby);
    }
    json(ctx.res, 200, { party });
  });

  add("POST", "/api/party/leader", async (ctx) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const party = await handOverLeadership(deps.pool, id, Number(body["userId"]));
    await deps.hub.announceParty(party);
    json(ctx.res, 200, { party });
  });

  add("POST", "/api/party/queue", async (ctx) => {
    const id = requireVerified(ctx);
    const party = await queueParty(deps.pool, id);
    await deps.hub.announceParty(party);
    void seatQueuedParties(deps.pool)
      .then(() => announceSeatings(deps))
      .catch(() => undefined);
    json(ctx.res, 202, { party });
  });

  add("POST", "/api/party/queue/cancel", async (ctx) => {
    const id = requireVerified(ctx);
    const party = await cancelQueue(deps.pool, id);
    await deps.hub.announceParty(party);
    json(ctx.res, 200, { party });
  });

  add("POST", "/api/lobby/leave", async (ctx) => {
    const id = requireVerified(ctx);
    const party = await leaveLobby(deps.pool, id);
    await deps.hub.announceParty(party);
    json(ctx.res, 200, { party });
  });

  add("GET", "/api/lobbies/:id", async (ctx, params) => {
    requireAuth(ctx);
    const lobby = await loadLobby(deps.pool, Number(params[0]));
    if (!lobby) throw new ApiError(404, "lobby_not_found", "That lobby doesn't exist.");
    json(ctx.res, 200, lobby);
  });

  // ---- Matches and replays ----
  add("GET", "/api/matches/:id", async (ctx, params) => {
    requireAuth(ctx);
    json(ctx.res, 200, await loadMatch(deps.pool, Number(params[0])));
  });

  add("GET", "/api/matches/:id/rounds/:n/frames", async (ctx, params) => {
    requireAuth(ctx);
    const handles = await handlesMap(deps.pool);
    json(
      ctx.res,
      200,
      await framesAtTick(deps.pool, Number(params[0]), Number(params[1]), ctx.url.searchParams.get("tick"), handles)
    );
  });

  add("GET", "/api/matches/:id/rounds/:n/inputs", async (ctx, params) => {
    requireAuth(ctx);
    json(ctx.res, 200, await exportInputs(deps.pool, Number(params[0]), Number(params[1])));
  });

  add("POST", "/api/matches/:id/forfeit", async (ctx, params) => {
    const me = requireAuth(ctx);
    await readJsonBody(ctx.req, 16384).catch(() => null);
    const result = await deps.runner.forfeit(Number(params[0]), me.id);
    if (!result.ok) throw new ApiError(409, "invalid_transition", "You're not in play.", { state: "running" });
    json(ctx.res, 200, { result: { outcome: "eliminated" } });
  });

  add("POST", "/api/simulate", async (ctx) => {
    requireAuth(ctx);
    const body = await readJsonBody(ctx.req, 256 * 1024);
    json(ctx.res, 200, runSimulate(body));
  });

  // ---- Chat ----
  add("GET", "/api/party/messages", async (ctx) => {
    const id = requireVerified(ctx);
    json(ctx.res, 200, { messages: await listPartyMessages(deps.pool, id) });
  });

  add("POST", "/api/party/messages", async (ctx) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const result = await sendPartyMessage(deps.pool, id, String(body["body"] ?? ""));
    await deps.hub.announceChat(result.message);
    json(ctx.res, 201, { message: result.message });
  });

  add("GET", "/api/dms/:userId/messages", async (ctx, params) => {
    const id = requireVerified(ctx);
    json(ctx.res, 200, { messages: await listDmMessages(deps.pool, id, Number(params[0])) });
  });

  add("POST", "/api/dms/:userId/messages", async (ctx, params) => {
    const id = requireVerified(ctx);
    const body = (await readJsonBody(ctx.req, 16384)) as Record<string, unknown>;
    const message = await sendDmMessage(deps.pool, id, Number(params[0]), String(body["body"] ?? ""));
    await deps.hub.announceChat(message);
    json(ctx.res, 201, { message });
  });

  add("GET", "/api/health", async (ctx) => {
    json(ctx.res, 200, { status: "ok" });
  });

  add("GET", "/api/conversations", async (ctx) => {
    const id = requireVerified(ctx);
    json(ctx.res, 200, { conversations: await listConversations(deps.pool, id) });
  });

  return {
    routes,
    route: async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/api/")) return false;
      const origin = req.headers["origin"] ?? null;
      if (origin && origin !== ownOriginOf(req, deps.ownOrigin)) {
        sendError(res, err("bad_origin"));
        return true;
      }
      const token = sessionTokenOf(req);
      let me: { id: number; email_verified: boolean } | null = null;
      if (token) {
        const userId = await deps.sessionOf(token);
        if (userId) {
          const row = await deps.pool.query<{ email_verified: boolean }>("SELECT email_verified FROM users WHERE id = $1", [
            userId
          ]);
          const found = row.rows[0];
          me = found ? { id: userId, email_verified: found.email_verified } : null;
        }
      }
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        const ctx: RequestContext = { req, res, url, userId: me?.id ?? null, me, deps };
        try {
          await route.handler(ctx, match.slice(1));
        } catch (e) {
          if (e instanceof ApiError) {
            sendError(res, e);
          } else {
            console.error("api error", e);
            sendError(res, err("server_error"));
          }
        }
        return true;
      }
      sendError(res, new ApiError(404, "not_found", "Not found."));
      return true;
    }
  };
}

async function handlesMap(pool: Pool): Promise<Map<number, string>> {
  const rows = await pool.query<{ id: number; handle: string }>("SELECT id, handle FROM users");
  return new Map(rows.rows.map((row) => [row.id, row.handle]));
}

/** Tells every seated party and lobby what changed after a seating sweep. */
export async function announceSeatings(deps: RouterDeps): Promise<void> {
  const parties = await deps.pool.query<{ id: number; lobby_id: number }>(
    "SELECT id, lobby_id FROM parties WHERE state = 'in_lobby' AND lobby_id IS NOT NULL"
  );
  for (const row of parties.rows) {
    const party = await loadParty(deps.pool, row.id);
    if (party) await deps.hub.announceParty(party);
  }
  const lobbyIds = new Set(parties.rows.map((row) => row.lobby_id as number));
  for (const lobbyId of lobbyIds) {
    const lobby = await loadLobby(deps.pool, lobbyId);
    if (lobby) await deps.hub.announceLobby(lobby.lobby.id, lobby.lobby);
  }
}
