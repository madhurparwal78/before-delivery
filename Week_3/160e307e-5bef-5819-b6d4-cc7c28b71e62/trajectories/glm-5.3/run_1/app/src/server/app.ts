import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { makeStaticHandler } from "./client-files.js";
import { sendMail, isValidEmail } from "./mail.js";
import { rateMatch, tierOf } from "./rating.js";
import {
  newId,
  findPlayerById,
  findPlayerByName,
  createGuest,
  chalkBalance,
  ownedItems,
  equippedRow,
  addChalk,
  loadMatchRow,
  loadSeats,
  loadPieces,
  savePieces,
  loadQueen,
  fullPiecesFromPartial,
  type PlayerRow,
  type MatchRow,
  type SeatRow,
} from "./store.js";
import {
  MODEL_VERSION,
  simulate,
  strikeBodies,
  intentValid,
  isPlacementLegal,
  ruleShot,
  boardEndCheck,
  matchOverCheck,
  openingBoardPieces,
  extraBoardNeeded,
  nextBoard,
  coinsLeft,
  seatColour,
  boardLabel,
  mm,
  offsetToBoardX,
  strikerBaselineY,
  openingLayout,
  type Piece,
  type PieceId,
  type Seat,
  type Format,
  type SimEvent,
  type SimFrame,
  type BoardState,
  type BoardEnd,
  type Ruling,
} from "../shared/rules.js";
import type pg from "pg";

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const BLOCKLIST = ["admin", "referee", "duecoin", "tamarind", "moderator"];
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMOTES = ["nice-shot", "well-played", "oops", "thinking", "good-game", "hello"];
const CATALOG = [
  { id: "striker-ply", kind: "striker", name: "Plain Ply", price: 0 },
  { id: "striker-tomato", kind: "striker", name: "Tomato Lacquer", price: 120 },
  { id: "striker-cobalt", kind: "striker", name: "Cobalt Ring", price: 250 },
  { id: "striker-brass", kind: "striker", name: "Brass Inlay", price: 420 },
  { id: "board-ply", kind: "board", name: "Light Ply", price: 0 },
  { id: "board-chalk", kind: "board", name: "Chalk Line", price: 150 },
  { id: "board-walnut", kind: "board", name: "Walnut Night", price: 200 },
  { id: "coins-ivory", kind: "coins", name: "Ivory and Ink", price: 0 },
  { id: "coins-shell", kind: "coins", name: "Shell and Slate", price: 180 },
];

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  body: Record<string, unknown> | null;
  playerId: string | null;
  rawBody: string | null;
  cookies: Record<string, string>;
}

interface ApiError {
  status: number;
  body: Record<string, unknown>;
}

function apiError(status: number, code: string, extra?: Record<string, unknown>): ApiError {
  return { status, body: { error: code, ...extra } };
}

interface HubConn {
  ws: WebSocket;
  playerId: string;
  matchIds: Set<string>;
  roomCodes: Set<string>;
  queue: boolean;
  lastSeen: number;
  pongPending: boolean;
  matchId: string | null;
}

/** The application: routes, match rulings, rooms, queue, shop and sockets. */
export class App {
  private readonly config: Config;
  private readonly db: Db;
  private readonly serveStatic: (p: string, res: http.ServerResponse) => boolean;
  private readonly conns = new Set<HubConn>();
  private wss: WebSocketServer | null = null;
  private readonly previewCounts = new Map<string, number[]>();
  private readonly emoteTimes = new Map<string, number>();
  private readonly turnExpired = new Set<string>();
  private readonly lastShotResult = new Map<string, StoredShot>();
  private readonly chalkSeeds = new Set<string>();

  constructor(config: Config, db: Db) {
    this.config = config;
    this.db = db;
    this.serveStatic = makeStaticHandler();
  }

  setWebSocketServer(wss: WebSocketServer): void {
    this.wss = wss;
  }

  async seedCatalog(): Promise<void> {
    // Catalog is code, not data. Price-0 items are owned by every player;
    // owned rows are created lazily at first load to stay idempotent.
  }

  // -------------------------------------------------------------------------
  // Request handling.
  // -------------------------------------------------------------------------

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = (req.method ?? "GET").toUpperCase();

    // Same origin only: a state-changing request from another origin.
    const origin = req.headers.origin;
    if (origin !== undefined && method !== "GET" && method !== "HEAD" && origin !== new URL(this.config.publicUrl).origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      const allowedHosts = this.publicHosts();
      const originHost = safeHost(origin);
      if (!allowedHosts.includes(originHost)) {
        res.writeHead(403, JSON_HEADERS);
        res.end(JSON.stringify({ error: "CROSS_ORIGIN" }));
        return;
      }
    }

    const cookies = parseCookies(req.headers.cookie ?? "");
    const ctx: Ctx = {
      req,
      res,
      url,
      method,
      body: null,
      playerId: cookies.dc_session ?? null,
      rawBody: null,
      cookies,
    };

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      await this.handleApi(ctx);
      return;
    }

    if (url.pathname === "/ws") {
      // handled on upgrade
      res.writeHead(426, JSON_HEADERS);
      res.end(JSON.stringify({ error: "UPGRADE_REQUIRED" }));
      return;
    }

    if (url.pathname.startsWith("/auth/link/")) {
      await this.handleMagicLink(ctx);
      return;
    }

    if (!this.serveStatic(url.pathname, res)) {
      await this.servePage(url.pathname, ctx);
    }
  }

  private publicHosts(): string[] {
    const hosts: string[] = [];
    try {
      hosts.push(new URL(this.config.publicUrl).host);
    } catch {
      // ignore a bad public url
    }
    return hosts;
  }

  private async servePage(pathname: string, ctx: Ctx): Promise<void> {
    const routes: Record<string, string> = {
      "/": "/client/index.html",
      "/welcome": "/client/welcome.html",
      "/play/local": "/client/local.html",
      "/join": "/client/join.html",
      "/leaderboard": "/client/leaderboard.html",
      "/shop": "/client/shop.html",
    };
    let file = routes[pathname];
    if (file === undefined) {
      const roomMatch = /^\/room\/([A-Za-z0-9]+)$/.exec(pathname);
      if (roomMatch !== null) file = "/client/room.html";
      const joinMatch = /^\/join\/([A-Za-z0-9]+)$/.exec(pathname);
      if (joinMatch !== null) file = "/client/join.html";
      const queueMatch = /^\/queue\/(casual|ranked)$/.exec(pathname);
      if (queueMatch !== null) file = "/client/queue.html";
      const matchMatch = /^\/match\/([A-Za-z0-9_]+)$/.exec(pathname);
      if (matchMatch !== null) file = "/client/match.html";
      const profileMatch = /^\/profile\/([^/]+)$/.exec(pathname);
      if (profileMatch !== null) file = "/client/profile.html";
    }
    if (file === undefined) {
      this.serveStatic("/client/404.html", ctx.res);
      return;
    }
    if (!this.serveStatic(file, ctx.res)) {
      ctx.res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      ctx.res.end("Not found");
    }
  }

  private async handleMagicLink(ctx: Ctx): Promise<void> {
    const token = ctx.url.pathname.slice("/auth/link/".length);
    const redirect = (banner: string) => {
      ctx.res.writeHead(302, { location: `/?banner=${encodeURIComponent(banner)}` });
      ctx.res.end();
    };
    let rows: { rows: { token: string; email: string; used: boolean; expires_at: Date; email_player_id: string | null }[] };
    try {
      rows = await this.db.query<{ token: string; email: string; used: boolean; expires_at: Date; email_player_id: string | null }>(
        "select token, email, used, expires_at, email_player_id from link_tokens where token = $1",
        [token]
      );
    } catch {
      await redirect("database");
      return;
    }
    const row = rows.rows[0];
    if (row === undefined || row.used || row.expires_at.getTime() < Date.now()) {
      if (!this.serveStatic("/client/expired.html", ctx.res)) {
        ctx.res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        ctx.res.end("Not found");
      }
      return;
    }
    // The current browser's player, from the session cookie.
    const currentToken = ctx.cookies.dc_session;
    let currentPlayerId: string | null = null;
    if (currentToken !== undefined) {
      try {
        const sessionRow = await this.db.query<{ player_id: string }>(
          "select player_id from sessions where token = $1",
          [currentToken]
        );
        currentPlayerId = sessionRow.rows[0]?.player_id ?? null;
      } catch {
        await redirect("database");
        return;
      }
    }
    try {
      const banner = await this.db.tx(async (client) => {
        await client.query("update link_tokens set used = true where token = $1", [token]);
        if (row.email_player_id !== null) {
          // The email already belongs to another player: sign this browser in as them.
          await this.setSessionCookie(ctx, row.email_player_id);
          return `Signed in as ${await playerName(client, row.email_player_id)}`;
        }
        let playerId = currentPlayerId;
        if (playerId !== null) {
          const player = await findPlayerById(client, playerId);
          if (player === null) playerId = null;
        }
        if (playerId === null) {
          const guest = await createGuest(client);
          playerId = guest.id;
        }
        await client.query("update players set email = $1 where id = $2", [row.email, playerId]);
        await this.setSessionCookie(ctx, playerId);
        return `Email linked: ${row.email}`;
      });
      redirect(banner);
    } catch {
      redirect("database");
    }
  }

  private async setSessionCookie(ctx: Ctx, playerId: string): Promise<void> {
    const token = newId("s");
    await this.db.query(
      "insert into sessions (token, player_id) values ($1, $2) on conflict (token) do update set player_id = excluded.player_id",
      [token, playerId]
    );
    ctx.res.setHeader("set-cookie", `dc_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    ctx.cookies.dc_session = token;
    ctx.playerId = token;
  }

  // -------------------------------------------------------------------------
  // API.
  // -------------------------------------------------------------------------

  private async handleApi(ctx: Ctx): Promise<void> {
    const { res, method } = ctx;
    const path = ctx.url.pathname;

    const finish = (status: number, body: unknown) => {
      res.writeHead(status, JSON_HEADERS);
      res.end(JSON.stringify(body));
    };

    try {
      // Body limits and content type for writes.
      if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
        const contentType = ctx.req.headers["content-type"] ?? "";
        if (!contentType.includes("application/json")) {
          finish(415, { error: "UNSUPPORTED_MEDIA_TYPE" });
          return;
        }
        const limit = path === "/api/local-matches" ? 1000000 : 65536;
        const raw = await readBody(ctx.req, limit);
        if (raw === null) {
          finish(413, { error: "PAYLOAD_TOO_LARGE" });
          return;
        }
        ctx.rawBody = raw;
        if (raw.length > 0) {
          try {
            ctx.body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            finish(400, { error: "INVALID_PAYLOAD" });
            return;
          }
        } else {
          ctx.body = {};
        }
      }

      // A session is created on the first request without a valid cookie, except
      // for the health check, which never needs the database to answer.
      if (path !== "/api/health") {
        const playerId = await this.resolvePlayer(ctx);
        if (playerId !== null) ctx.playerId = playerId;
      }

      const grading = path.startsWith("/api/grading/");
      if (grading) {
        const key = ctx.req.headers["x-grading-key"];
        if (this.config.gradingKey === null || key !== this.config.gradingKey) {
          finish(404, { error: "NOT_FOUND" });
          return;
        }
      }

      const route = this.matchApiRoute(path, method);
      if (route === null) {
        finish(404, { error: "NOT_FOUND" });
        return;
      }
      const out = await route(ctx);
      finish(out.status, out.body);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("API:")) {
        const payload = JSON.parse(err.message.slice(4)) as ApiError;
        finish(payload.status, payload.body);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ECONNREFUSED") || message.includes("terminated") || message.includes("ENOTFOUND")) {
        finish(503, { error: "DATABASE_UNAVAILABLE" });
        return;
      }
      throw err;
    }
  }

  private async resolvePlayer(ctx: Ctx): Promise<string | null> {
    const token = ctx.cookies.dc_session;
    if (token !== undefined) {
      const res = await this.db.query<{ player_id: string }>(
        "select player_id from sessions where token = $1",
        [token]
      );
      const row = res.rows[0];
      if (row !== undefined) return row.player_id;
    }
    // create a guest + session
    const id = await this.db.tx(async (client) => {
      const guest = await createGuest(client);
      const token = newId("s");
      await client.query("insert into sessions (token, player_id) values ($1, $2)", [token, guest.id]);
      return { id: guest.id, token };
    });
    ctx.res.setHeader("set-cookie", `dc_session=${id.token}; HttpOnly; SameSite=Lax; Path=/`);
    ctx.cookies.dc_session = id.token;
    return id.id;
  }

  private matchApiRoute(
    path: string,
    method: string
  ): ((ctx: Ctx) => Promise<{ status: number; body: unknown }>) | null {
    const routes: [string, string, (ctx: Ctx) => Promise<{ status: number; body: unknown }>][] = [
      ["GET", "/api/health", () => this.apiHealth()],
      ["GET", "/api/config", () => this.apiConfig()],
      ["GET", "/api/me", (c) => this.apiMe(c)],
      ["POST", "/api/me/name", (c) => this.apiMeName(c)],
      ["POST", "/api/me/skip", (c) => this.apiMeSkip(c)],
      ["POST", "/api/me/avatar", (c) => this.apiMeAvatar(c)],
      ["GET", "/api/players/by-name/:name", (c) => this.apiPlayerByName(c)],
      ["GET", "/api/players/:id/history", (c) => this.apiHistory(c)],
      ["GET", "/api/leaderboard", (c) => this.apiLeaderboard(c)],
      ["POST", "/api/auth/link", (c) => this.apiAuthLink(c)],
      ["POST", "/api/rooms", (c) => this.apiRoomCreate(c)],
      ["GET", "/api/rooms/:code", (c) => this.apiRoomGet(c)],
      ["POST", "/api/rooms/:code/join", (c) => this.apiRoomJoin(c)],
      ["DELETE", "/api/rooms/:code", (c) => this.apiRoomCancel(c)],
      ["POST", "/api/queue", (c) => this.apiQueueEnter(c)],
      ["GET", "/api/queue", (c) => this.apiQueueGet(c)],
      ["DELETE", "/api/queue", (c) => this.apiQueueLeave(c)],
      ["GET", "/api/matches/:id", (c) => this.apiMatchGet(c)],
      ["POST", "/api/matches/:id/ready", (c) => this.apiMatchReady(c)],
      ["POST", "/api/matches/:id/preview", (c) => this.apiMatchPreview(c)],
      ["POST", "/api/matches/:id/shots", (c) => this.apiMatchShot(c)],
      ["POST", "/api/matches/:id/emotes", (c) => this.apiMatchEmote(c)],
      ["POST", "/api/matches/:id/resign", (c) => this.apiMatchResign(c)],
      ["POST", "/api/matches/:id/rematch", (c) => this.apiMatchRematch(c)],
      ["POST", "/api/local-matches", (c) => this.apiLocalMatch(c)],
      ["GET", "/api/shop", (c) => this.apiShop(c)],
      ["POST", "/api/shop/purchase", (c) => this.apiShopPurchase(c)],
      ["POST", "/api/shop/equip", (c) => this.apiShopEquip(c)],
      ["GET", "/api/me/ledger", (c) => this.apiLedger(c)],
      ["POST", "/api/grading/players", (c) => this.apiGradingPlayers(c)],
      ["POST", "/api/grading/matches", (c) => this.apiGradingMatches(c)],
      ["POST", "/api/grading/matches/:id/shots", (c) => this.apiGradingShot(c)],
      ["POST", "/api/grading/simulate", (c) => this.apiGradingSimulate(c)],
    ];
    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      if (this.pathMatches(pattern, path)) return handler;
    }
    return null;
  }

  private pathMatches(pattern: string, path: string): boolean {
    const a = pattern.split("/");
    const b = path.split("/");
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].startsWith(":")) continue;
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  private pathParam(pattern: string, path: string, name: string): string {
    const a = pattern.split("/");
    const b = path.split("/");
    const i = a.indexOf(`:${name}`);
    return b[i] ?? "";
  }

  // ---- config and health ----

  private async apiHealth(): Promise<{ status: number; body: unknown }> {
    // Health always answers 200, whatever the database says.
    let ok = false;
    try {
      ok = await this.db.healthy();
    } catch {
      ok = false;
    }
    return { status: 200, body: { status: ok ? "ok" : "unavailable" } };
  }

  private async apiConfig(): Promise<{ status: number; body: unknown }> {
    return {
      status: 200,
      body: {
        verdictBannerMs: this.config.verdictBannerMs,
        shotTimerSeconds: this.config.shotTimerSeconds,
        reconnectSeconds: this.config.reconnectSeconds,
        rematchSeconds: this.config.rematchSeconds,
        roomExpirySeconds: this.config.roomExpirySeconds,
        bandWidenSeconds: this.config.bandWidenSeconds,
        modelVersion: MODEL_VERSION,
      },
    };
  }

  // ---- session and profile ----

  private async apiMe(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const equipped = await this.db.tx((client) => equippedRow(client, player.id));
    return {
      status: 200,
      body: {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        chosen: player.chosen,
        email: player.email,
        linked: player.email !== null,
        rating: round2(player.rating),
        rd: round2(player.rd),
        tier: tierOf(player.rating),
        rankedGames: player.ranked_games,
        chalk: await this.db.tx((client) => chalkBalance(client, player.id)),
        equipped,
      },
    };
  }

  private async apiMeName(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const name = str(ctx.body?.name);
    const avatar = ctx.body?.avatar;
    const errors = this.nameError(name);
    if (errors !== null) throw api(errors.status, errors.body);
    const base = name.slice(0, 13);
    const suggestions: string[] = [];
    for (let i = 1; i <= 99 && suggestions.length < 3; i++) {
      suggestions.push(`${base}_${String(i).padStart(2, "0")}`);
    }
    await this.db.tx(async (client) => {
      const existing = await client.query<{ id: string }>(
        "select id from players where name_lower = $1 and id <> $2",
        [name.toLowerCase(), player.id]
      );
      if (existing.rows.length > 0) {
        const free: string[] = [];
        for (const candidate of this.allSuggestions(base)) {
          const taken = await client.query("select 1 from players where name_lower = $1", [
            candidate.toLowerCase(),
          ]);
          if (taken.rows.length === 0) free.push(candidate);
          if (free.length === 3) break;
        }
        throw api(409, { error: "NAME_TAKEN", suggestions: free });
      }
      await client.query("update players set name = $1, name_lower = $2, chosen = true where id = $3", [
        name,
        name.toLowerCase(),
        player.id,
      ]);
      if (typeof avatar === "number") {
        if (avatar < 1 || avatar > 24 || !Number.isInteger(avatar)) {
          throw api(422, { error: "AVATAR_INVALID" });
        }
        await client.query("update players set avatar = $1 where id = $2", [avatar, player.id]);
      }
    });
    return this.apiMe(ctx);
  }

  private allSuggestions(base: string): string[] {
    const out: string[] = [];
    for (let i = 1; i <= 99; i++) {
      out.push(`${base}_${String(i).padStart(2, "0")}`);
    }
    return out;
  }

  private nameError(name: string): { status: number; body: Record<string, unknown> } | null {
    if (!NAME_RE.test(name)) {
      return { status: 422, body: { error: "NAME_INVALID" } };
    }
    const lower = name.toLowerCase();
    for (const blocked of BLOCKLIST) {
      if (lower.includes(blocked)) {
        return {
          status: 422,
          body: { error: "NAME_BLOCKED", suggestions: this.nameSuggestions("Player") },
        };
      }
    }
    return null;
  }

  private nameSuggestions(base: string): string[] {
    const cut = base.slice(0, 13);
    const out: string[] = [];
    for (let i = 1; i <= 99 && out.length < 3; i++) {
      const candidate = `${cut}_${String(i).padStart(2, "0")}`;
      out.push(candidate);
    }
    return out;
  }

  private async apiMeSkip(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    for (let attempt = 0; attempt < 50; attempt++) {
      const digits = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      const name = `Guest-${digits}`;
      try {
        await this.db.query(
          "update players set name = $1, name_lower = $2, chosen = true where id = $3",
          [name, name.toLowerCase(), player.id]
        );
        return this.apiMe(ctx);
      } catch {
        // taken, try again
      }
    }
    throw api(500, { error: "INTERNAL" });
  }

  private async apiMeAvatar(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const avatar = num(ctx.body?.avatar);
    if (avatar === null || !Number.isInteger(avatar) || avatar < 1 || avatar > 24) {
      throw api(422, { error: "AVATAR_INVALID" });
    }
    await this.db.query("update players set avatar = $1 where id = $2", [avatar, player.id]);
    return { status: 200, body: {} };
  }

  private async apiPlayerByName(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const name = this.pathParam("/api/players/by-name/:name", ctx.url.pathname, "name");
    const row = await this.db.tx(async (client) => findPlayerByName(client, decodeURIComponent(name)));
    if (row === null) throw api(404, { error: "NOT_FOUND" });
    return {
      status: 200,
      body: {
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        rating: round2(row.rating),
        rd: round2(row.rd),
        tier: tierOf(row.rating),
        rankedGames: row.ranked_games,
      },
    };
  }

  private async apiHistory(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const id = this.pathParam("/api/players/:id/history", ctx.url.pathname, "id");
    const res = await this.db.query(
      `select match_id, mode, format, opponent, result, your_score, their_score, rating_delta, end_reason, ended_at
       from history_rows where player_id = $1 and end_reason <> 'abandoned'
       order by ended_at desc limit 50`,
      [id]
    );
    return {
      status: 200,
      body: {
        matches: res.rows.map((r) => ({
          matchId: r.match_id,
          mode: r.mode,
          format: r.format,
          opponent: r.opponent,
          result: r.result,
          yourScore: r.your_score,
          theirScore: r.their_score,
          ratingDelta: r.rating_delta === null ? null : round2(r.rating_delta),
          endReason: r.end_reason,
          endedAt: r.ended_at instanceof Date ? r.ended_at.toISOString() : String(r.ended_at),
        })),
      },
    };
  }

  private async apiLeaderboard(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const res = await this.db.query(
      `select id, name, rating, rd, ranked_games from players
       where ranked_games >= 10 and rd < 150
       order by rating desc, name_lower asc limit 100`
    );
    const rows = res.rows.map((r, i) => ({
      rank: i + 1,
      playerId: r.id,
      name: r.name,
      rating: round2(r.rating),
      tier: tierOf(r.rating),
      rankedGames: r.ranked_games,
    }));
    let you: (typeof rows)[number] | null = null;
    if (ctx.playerId !== null) {
      const me = rows.find((r) => r.playerId === ctx.playerId) ?? null;
      if (me === null) {
        const mine = await this.db.query(
          "select id, name, rating, rd, ranked_games from players where id = $1",
          [ctx.playerId]
        );
        const r = mine.rows[0];
        if (r !== undefined) {
          you = {
            rank: rows.length + 1,
            playerId: r.id,
            name: r.name,
            rating: round2(r.rating),
            tier: tierOf(r.rating),
            rankedGames: r.ranked_games,
          };
        }
      } else {
        you = me;
      }
    }
    return { status: 200, body: { rows, you } };
  }

  // ---- email link ----

  private async apiAuthLink(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const email = str(ctx.body?.email);
    if (!isValidEmail(email)) throw api(422, { error: "EMAIL_INVALID" });
    if (player.email !== null && player.email !== email) {
      throw api(409, { error: "ALREADY_LINKED" });
    }
    const token = newId("t");
    const expires = new Date(Date.now() + this.config.magicLinkSeconds * 1000);
    const owner = await this.db.tx(async (client) => findPlayerByEmail(client, email));
    await this.db.query(
      "insert into link_tokens (token, email, player_id, email_player_id, used, expires_at) values ($1, $2, $3, $4, false, $5)",
      [token, email, player.id, owner, expires]
    );
    const link = `${this.config.publicUrl}/auth/link/${token}`;
    const accepted = await sendMail(
      this.config.smtpHost,
      this.config.smtpPort,
      this.config.mailFrom,
      email,
      "Your Due Coin sign-in link",
      `Open this link to sign in: ${link}`
    );
    if (!accepted) {
      await this.db.query("delete from link_tokens where token = $1", [token]);
      throw api(503, { error: "MAIL_UNAVAILABLE" });
    }
    return { status: 202, body: { status: "sent" } };
  }

  // ---- rooms ----

  private async apiRoomCreate(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const formatRaw = str(ctx.body?.format);
    if (formatRaw !== "quick" && formatRaw !== "classic") {
      throw api(422, { error: "FORMAT_INVALID" });
    }
    const format: Format = formatRaw;
    let code = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = Array.from(
        { length: 6 },
        () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
      ).join("");
      try {
        const expires = new Date(Date.now() + this.config.roomExpirySeconds * 1000);
        const res = await this.db.query(
          "insert into rooms (code, format, status, host_player_id, expires_at) values ($1, $2, 'open', $3, $4) returning code",
          [candidate, format, player.id, expires]
        );
        code = res.rows[0].code;
        break;
      } catch {
        // collision, retry
      }
    }
    if (code === "") throw api(500, { error: "INTERNAL" });
    const match = await this.createMatch({
      mode: "private",
      format,
      playerIds: [player.id],
      whiteSeat: 0,
      turn: 0,
      boardNumber: 1,
      status: "waiting",
      roomCode: code,
    });
    await this.db.query("update rooms set match_id = $1 where code = $2", [match.id, code]);
    return { status: 201, body: { code, url: `/join/${code}`, matchId: match.id } };
  }

  private async apiRoomGet(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const code = this.pathParam("/api/rooms/:code", ctx.url.pathname, "code").toUpperCase();
    const room = await this.loadRoom(code);
    if (room === null) throw api(404, { error: "ROOM_NOT_FOUND" });
    if (room.status === "open" && room.expires_at.getTime() < Date.now()) {
      await this.db.query("update rooms set status = 'closed' where code = $1", [code]);
      room.status = "closed";
    }
    return { status: 200, body: this.roomBody(room) };
  }

  private roomBody(room: RoomRow): Record<string, unknown> {
    const expiresIn =
      room.status === "open" && room.expires_at.getTime() > Date.now()
        ? Math.max(0, Math.ceil((room.expires_at.getTime() - Date.now()) / 1000) * 1000)
        : null;
    return {
      code: room.code,
      format: room.format,
      status: room.status,
      host: { id: room.host_player_id, name: room.host_name },
      guest:
        room.guest_player_id === null
          ? null
          : { id: room.guest_player_id, name: room.guest_name ?? "" },
      expiresInMs: expiresIn,
      matchId: room.rematch_match_id ?? room.match_id,
    };
  }

  private async loadRoom(code: string): Promise<RoomRow | null> {
    const res = await this.db.query(
      `select r.code, r.format, r.status, r.host_player_id, r.guest_player_id, r.match_id,
              r.rematch_match_id, r.expires_at, h.name as host_name, g.name as guest_name
       from rooms r join players h on h.id = r.host_player_id
       left join players g on g.id = r.guest_player_id
       where r.code = $1`,
      [code]
    );
    const r = res.rows[0];
    if (r === undefined) return null;
    return r as RoomRow;
  }

  private async apiRoomJoin(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const playerRow = await this.requirePlayer(ctx);
    const player = playerRow;
    const code = this.pathParam("/api/rooms/:code", ctx.url.pathname, "code").toUpperCase();
    const room = await this.loadRoom(code);
    if (room === null) throw api(404, { error: "ROOM_NOT_FOUND" });
    if (room.status === "closed" || (room.status === "open" && room.expires_at.getTime() < Date.now())) {
      await this.db.query("update rooms set status = 'closed' where code = $1", [code]);
      throw api(410, { error: "ROOM_CLOSED" });
    }
    if (room.host_player_id === player.id) return { status: 200, body: { matchId: room.match_id } };
    if (room.guest_player_id !== null && room.guest_player_id !== player.id) {
      throw api(409, { error: "ROOM_FULL" });
    }
    // atomic single joiner
    const updated = await this.db.query(
      "update rooms set status = 'full', guest_player_id = $1 where code = $2 and status = 'open' and guest_player_id is null returning status",
      [player.id, code]
    );
    if (updated.rows.length === 0) {
      throw api(409, { error: "ROOM_FULL" });
    }
    await this.addSeat(room.match_id, player.id, 1);
    this.pushRoom(code);
    return { status: 200, body: { matchId: room.match_id } };
  }

  private async apiRoomCancel(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const code = this.pathParam("/api/rooms/:code", ctx.url.pathname, "code").toUpperCase();
    const room = await this.loadRoom(code);
    if (room === null) throw api(404, { error: "ROOM_NOT_FOUND" });
    if (room.host_player_id !== player.id) throw api(403, { error: "NOT_HOST" });
    await this.db.query("update rooms set status = 'closed' where code = $1", [code]);
    this.pushRoom(code);
    return { status: 204, body: null };
  }

  private pushRoom(code: string): void {
    void (async () => {
      const room = await this.loadRoom(code);
      if (room === null) return;
      this.broadcastRoom(code, { type: "roomStatus", ...this.roomBody(room) });
    })();
  }

  // ---- queue ----

  private async apiQueueEnter(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const modeRaw = str(ctx.body?.mode);
    if (modeRaw !== "casual" && modeRaw !== "ranked") {
      throw api(422, { error: "MODE_INVALID" });
    }
    if (modeRaw === "ranked" && player.email === null) {
      throw api(403, { error: "LINK_REQUIRED" });
    }
    // leaving an earlier entry
    await this.db.query("delete from queue_entries where player_id = $1", [player.id]);
    const near = Math.round(player.rating);
    await this.db.query(
      "insert into queue_entries (player_id, mode, near, band, waited_from) values ($1, $2, $3, 100, now())",
      [player.id, modeRaw, near]
    );
    await this.pairQueue(modeRaw);
    return { status: 202, body: { mode: modeRaw, near, band: { low: near - 100, high: near + 100 } } };
  }

  private async apiQueueGet(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const res = await this.db.query(
      "select mode, near, band, waited_from, match_id from queue_entries where player_id = $1",
      [playerId]
    );
    const row = res.rows[0];
    if (row === undefined) throw api(404, { error: "NOT_FOUND" });
    const waited = waitedSeconds(row.waited_from);
    const band = currentBand(row.band, waited, this.config.bandWidenSeconds);
    return {
      status: 200,
      body: {
        mode: row.mode,
        near: row.near,
        band: row.mode === "casual" ? null : { low: row.near - band, high: row.near + band },
        waitedSeconds: waited,
        matchId: row.match_id ?? null,
      },
    };
  }

  private async apiQueueLeave(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    await this.db.query("delete from queue_entries where player_id = $1", [playerId]);
    return { status: 204, body: null };
  }

  /** One atomic pairing claim: every waiting player is paired exactly once. */
  private async pairQueue(mode: "casual" | "ranked"): Promise<void> {
    await this.db.tx(async (client) => {
      // Serialise pairing so concurrent callers never pair the same two players.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`queue:${mode}`]);
      const res = await client.query(
        "select player_id, near, band, waited_from from queue_entries where mode = $1 and match_id is null order by waited_from asc, player_id asc",
        [mode]
      );
      const waiting = res.rows;
      const used = new Set<string>();
      for (const a of waiting) {
        if (used.has(a.player_id)) continue;
        for (const b of waiting) {
          if (b.player_id === a.player_id || used.has(b.player_id)) continue;
          if (!this.canPair(mode, a, b)) continue;
          used.add(a.player_id);
          used.add(b.player_id);
          const whiteSeat: Seat = this.tossWinner() === 0 ? 0 : 1;
          const breaker: Seat = whiteSeat;
          const players = [a.player_id, b.player_id] as [string, string];
          const match = await this.createMatchTx(client, {
            mode,
            format: "quick",
            playerIds: players,
            whiteSeat: breaker,
            turn: breaker,
            boardNumber: 1,
            status: "active",
            roomCode: null,
          });
          await client.query("update queue_entries set match_id = $1 where player_id = any($2)", [
            match.id,
            players,
          ]);
          this.pushQueue(players, match.id);
          break;
        }
      }
    });
  }

  private canPair(mode: string, a: QueueRow, b: QueueRow): boolean {
    if (mode === "casual") return true;
    const bandA = currentBand(a.band, waitedSeconds(a.waited_from), this.config.bandWidenSeconds);
    const bandB = currentBand(b.band, waitedSeconds(b.waited_from), this.config.bandWidenSeconds);
    const diff = Math.abs(a.near - b.near);
    return diff <= bandA && diff <= bandB;
  }

  private tossWinner(): Seat {
    if (this.config.tossSeed === 0) return 0;
    if (this.config.tossSeed === 1) return 1;
    return Math.random() < 0.5 ? 0 : 1;
  }

  private pushQueue(playerIds: string[], matchId: string): void {
    for (const id of playerIds) {
      this.broadcastToPlayer(id, { type: "matchFound", matchId });
    }
    this.widenBands().catch(() => {
      // the database is unreachable; the next tick retries
    });
  }

  /** Widens bands as time passes and pairs again, all on server time. */
  private async widenBands(): Promise<void> {
    for (const mode of ["casual", "ranked"] as const) {
      await this.pairQueue(mode).catch(() => {
        // the database is unreachable; the next tick retries
      });
    }
  }

  // ---- matches ----

  private async createMatch(opts: {
    mode: "private" | "casual" | "ranked";
    format: Format;
    playerIds: string[];
    whiteSeat: Seat;
    turn: Seat;
    boardNumber: number;
    status: "waiting" | "active";
    roomCode: string | null;
  }): Promise<{ id: string }> {
    return this.db.tx((client) => this.createMatchTx(client, opts));
  }

  private async createMatchTx(
    client: pg.PoolClient,
    opts: {
      mode: "private" | "casual" | "ranked";
      format: Format;
      playerIds: string[];
      whiteSeat: Seat;
      turn: Seat;
      boardNumber: number;
      status: "waiting" | "active";
      roomCode: string | null;
    }
  ): Promise<{ id: string }> {
    const id = newId("mt");
    const pieces = openingBoardPieces(opts.turn);
    await client.query(
      `insert into matches (id, mode, format, status, board, turn, phase, shot_seq, break_attempt,
         queen_state, queen_seat, scores, dues, timeouts, white_seat, room_code, first_breaker)
       values ($1, $2, $3, $4, $5, $6, 'aim', 0, 1, 'board', null, '[0,0]', '[0,0]', '[0,0]', $7, $8, $9)`,
      [
        id,
        opts.mode,
        opts.format,
        opts.status,
        opts.boardNumber,
        opts.turn,
        opts.whiteSeat,
        opts.roomCode,
        opts.turn,
      ]
    );
    for (let i = 0; i < opts.playerIds.length; i++) {
      const skin = await equippedRow(client, opts.playerIds[i]);
      await client.query(
        "insert into match_seats (match_id, seat, player_id, striker_skin, connected, ready) values ($1, $2, $3, $4, false, $5)",
        [id, i, opts.playerIds[i], skin.striker, opts.status === "active"]
      );
    }
    await client.query("insert into boards (match_id, board_number, pieces) values ($1, $2, $3)", [
      id,
      opts.boardNumber,
      JSON.stringify(pieces),
    ]);
    return { id };
  }

  private async addSeat(matchId: string, playerId: string, seat: Seat): Promise<void> {
    await this.db.tx(async (client) => {
      const skin = await equippedRow(client, playerId);
      await client.query(
        `insert into match_seats (match_id, seat, player_id, striker_skin, connected, ready)
         values ($1, $2, $3, $4, false, false)
         on conflict (match_id, seat) do nothing`,
        [matchId, seat, playerId, skin.striker]
      );
    });
  }

  private async apiMatchGet(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const match = await this.matchJson(id, playerId);
    if (match === null) throw api(404, { error: "NOT_FOUND" });
    return { status: 200, body: match };
  }

  private async matchJson(id: string, viewerId: string | null): Promise<Record<string, unknown> | null> {
    return this.db.tx(async (client) => this.matchJsonTx(client, id, viewerId));
  }

  private async matchJsonTx(
    client: pg.PoolClient,
    id: string,
    viewerId: string | null
  ): Promise<Record<string, unknown> | null> {
    const row = await loadMatchRow(client, id);
    if (row === null) return null;
    const seats = await loadSeats(client, id);
    const pieces = await loadPieces(client, id);
    const queen = await loadQueen(client, id);
    const seatView = seats.map((s) => ({
      seat: s.seat,
      playerId: s.player_id,
      name: s.name,
      avatar: s.avatar,
      color: s.seat === row.white_seat ? "white" : "black",
      score: row.scores[s.seat],
      coinsLeft: pieces.filter(
        (p) =>
          p.state === "board" &&
          p.id !== "striker" &&
          p.id !== "queen" &&
          (p.id.startsWith("w") ? "white" : "black") === (s.seat === row.white_seat ? "white" : "black")
      ).length,
      dues: row.dues[s.seat],
      timeouts: row.timeouts[s.seat],
      connected: s.connected,
      ready: s.ready,
      strikerSkin: s.striker_skin,
    }));
    const remaining =
      row.turn_deadline !== null
        ? Math.max(0, row.turn_deadline.getTime() - Date.now())
        : null;
    return {
      id: row.id,
      mode: row.mode,
      format: row.format,
      status: row.status,
      board: row.board,
      turn: row.turn,
      phase: row.status === "waiting" ? "waiting" : row.phase,
      shotSeq: row.shot_seq,
      breakAttempt: row.break_attempt,
      seats: seatView,
      queen,
      pieces,
      turnDeadline: row.turn_deadline === null ? null : row.turn_deadline.toISOString(),
      turnRemainingMs: remaining,
      winnerSeat: row.winner_seat,
      endReason: row.end_reason,
      roomCode: row.room_code,
      viewerSeat: viewerId === null ? null : seats.find((s) => s.player_id === viewerId)?.seat ?? null,
    };
  }

  private async apiMatchReady(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const out = await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, id);
      if (row === null) throw api(404, { error: "NOT_FOUND" });
      const seats = await loadSeats(client, id);
      const mine = seats.find((s) => s.player_id === playerId);
      if (mine === undefined) throw api(403, { error: "NOT_IN_MATCH" });
      if (row.status !== "waiting") throw api(409, { error: "MATCH_NOT_WAITING" });
      await client.query("update match_seats set ready = true where match_id = $1 and seat = $2", [
        id,
        mine.seat,
      ]);
      const after = await loadSeats(client, id);
      if (after.length === 2 && after.every((s) => s.ready)) {
        await client.query(
          "update matches set status = 'active', turn_deadline = now() + ($1 || ' seconds')::interval where id = $2",
          [String(this.config.shotTimerSeconds), id]
        );
      }
    });
    this.pushMatch(id);
    const match = await this.matchJson(id, playerId);
    if (match === null) throw api(404, { error: "NOT_FOUND" });
    return { status: 200, body: match };
  }

  private async apiMatchPreview(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const seat = await this.seatOf(id, playerId);
    if (seat === null) throw api(403, { error: "NOT_IN_MATCH" });
    const now = Date.now();
    const key = `${id}:${seat}`;
    const arr = this.previewCounts.get(key) ?? [];
    while (arr.length > 0 && now - arr[0] > 1000) arr.shift();
    if (arr.length >= 15) throw api(429, { error: "RATE_LIMITED" });
    arr.push(now);
    this.previewCounts.set(key, arr);
    const x = num(ctx.body?.x);
    const dx = num(ctx.body?.dx);
    const dy = num(ctx.body?.dy);
    const p = num(ctx.body?.p);
    if (x === null || dx === null || dy === null || p === null) {
      throw api(422, { error: "INVALID_INTENT" });
    }
    this.broadcastMatchExcluding(id, playerId, {
      type: "preview",
      seat,
      x,
      dx,
      dy,
      p,
    });
    return { status: 204, body: null };
  }

  private async apiMatchShot(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const body = ctx.body ?? {};
    const shotSeq = num(body.shotSeq);
    const x = num(body.x);
    const dx = num(body.dx);
    const dy = num(body.dy);
    const p = num(body.p);
    const modelVersion = str(body.modelVersion);
    if (shotSeq === null) throw api(422, { error: "INVALID_INTENT" });

    // idempotent replay of the last ruled shot
    const stored = this.lastShotResult.get(`${id}:${shotSeq}`);
    if (stored !== undefined && stored.playerId === playerId) {
      return { status: 200, body: stored.result };
    }

    const result = await this.ruleShotHttp(id, playerId, {
      shotSeq,
      x: x ?? 0,
      dx: dx ?? 0,
      dy: dy ?? 0,
      p: p ?? 0,
      modelVersion,
    });
    return { status: 200, body: result };
  }

  private async ruleShotHttp(
    id: string,
    playerId: string,
    intent: { shotSeq: number; x: number; dx: number; dy: number; p: number; modelVersion: string }
  ): Promise<Record<string, unknown>> {
    if (intent.modelVersion !== MODEL_VERSION) throw api(409, { error: "CLIENT_OUTDATED" });
    const outcome = await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, id);
      if (row === null) throw api(404, { error: "NOT_FOUND" });
      const seats = await loadSeats(client, id);
      const mine = seats.find((s) => s.player_id === playerId);
      if (mine === undefined) throw api(403, { error: "NOT_IN_MATCH" });
      if (row.status !== "active" && row.status !== "waiting") {
        throw api(409, { error: "MATCH_NOT_ACTIVE" });
      }
      if (row.shot_seq !== intent.shotSeq - 1) {
        if (intent.shotSeq === row.shot_seq) {
          return { replay: true as const };
        }
        if (this.turnExpired.has(`${id}:${playerId}`) && row.turn === mine.seat) {
          throw api(409, { error: "TURN_EXPIRED" });
        }
        throw api(409, { error: "STALE_SEQ" });
      }
      if (row.turn !== mine.seat) {
        if (this.turnExpired.has(`${id}:${playerId}`)) {
          throw api(409, { error: "TURN_EXPIRED" });
        }
        throw api(409, { error: "NOT_YOUR_TURN" });
      }
      if (!intentValid(intent)) throw api(422, { error: "INVALID_INTENT" });
      const pieces = await loadPieces(client, id);
      if (!isPlacementLegal(pieces, mine.seat, intent.x)) {
        throw api(422, { error: "ILLEGAL_PLACEMENT" });
      }
      // rule the shot
      const bodies = strikeBodies(pieces, mine.seat, intent.x, intent.dx, intent.dy, intent.p);
      const sim = simulate(bodies, true);
      const boardState = await this.boardStateTx(client, row, pieces);
      const events: SimEvent = sim.events;
      // apply sim positions to pieces
      const moved = pieces.map((piece) => {
        const final = sim.final.find((f) => f.id === piece.id);
        if (final === undefined) return piece;
        return {
          ...piece,
          x: final.x ?? piece.x,
          y: final.y ?? piece.y,
          state: final.state,
        };
      });
      const stateAfterSim = { ...boardState, pieces: moved };
      const ruling = ruleShot(stateAfterSim, events);
      const result = await this.commitRuling(client, row, seats, ruling, sim.frames, events);
      return { replay: false as const, result };
    });
    if (outcome.replay) {
      const stored = this.lastShotResult.get(`${id}:${intent.shotSeq}`);
      if (stored !== undefined) return stored.result;
      throw api(409, { error: "STALE_SEQ" });
    }
    this.turnExpired.delete(`${id}:${playerId}`);
    this.lastShotResult.set(`${id}:${intent.shotSeq}`, {
      result: outcome.result,
      playerId,
    });
    this.pushShot(id, outcome.result);
    void this.awardChalkForMatch(id);
    return outcome.result;
  }

  private async boardStateTx(
    client: pg.PoolClient,
    row: MatchRow,
    pieces: Piece[]
  ): Promise<BoardState> {
    return {
      pieces,
      turn: row.turn,
      scores: row.scores,
      dues: row.dues,
      timeouts: row.timeouts,
      queen: await loadQueen(client, row.id),
      breakAttempt: row.break_attempt,
      boardNumber: row.board,
      format: row.format,
      whiteSeat: row.white_seat,
    };
  }

  private async commitRuling(
    client: pg.PoolClient,
    row: MatchRow,
    seats: SeatRow[],
    ruling: Ruling,
    frames: SimFrame[],
    events: SimEvent
  ): Promise<Record<string, unknown>> {
    const matchId = row.id;
    let pieces = ruling.pieces;

    if (ruling.boardEnd !== null && !ruling.matchOver) {
      // board ends but the match goes on: set up the next board at once
      const stateBefore = await this.boardStateTx(client, row, await loadPieces(client, matchId));
      const nb = nextBoard(stateBefore, ruling.boardEnd, row.board + 1);
      if (extraBoardNeeded(stateBefore, ruling.boardEnd)) {
        nb.boardNumber = 9;
      }
      await client.query(
        `update matches set board = $1, turn = $2, scores = $3, dues = $4, timeouts = $5,
           queen_state = 'board', queen_seat = null, break_attempt = 1, white_seat = $6,
           shot_seq = $7, turn_deadline = now() + ($8 || ' seconds')::interval
         where id = $9`,
        [
          nb.boardNumber,
          nb.turn,
          JSON.stringify(nb.scores),
          JSON.stringify(nb.dues),
          JSON.stringify(nb.timeouts),
          nb.whiteSeat,
          row.shot_seq + 1,
          String(this.config.shotTimerSeconds),
          matchId,
        ]
      );
      await savePieces(client, matchId, nb.boardNumber, nb.pieces);
      pieces = nb.pieces;
    } else {
      await client.query(
        `update matches set turn = $1, dues = $2, queen_state = $3, queen_seat = $4,
           break_attempt = $5, shot_seq = $6,
           turn_deadline = now() + ($7 || ' seconds')::interval
         where id = $8`,
        [
          ruling.turn,
          JSON.stringify(ruling.dues),
          ruling.queen.state,
          ruling.queen.seat,
          ruling.breakAttempt,
          row.shot_seq + 1,
          String(this.config.shotTimerSeconds),
          matchId,
        ]
      );
      await savePieces(client, matchId, row.board, pieces);
      if (ruling.matchOver && ruling.boardEnd !== null) {
        const fresh = await loadMatchRow(client, matchId);
        if (fresh === null) throw new Error("match vanished");
        await this.finishMatchTx(client, fresh, seats, ruling.boardEnd, "played", ruling.turn);
      }
    }

    const shotSeq = row.shot_seq + 1;
    const shooterSeat = row.turn;
    const match = await this.matchJsonTx(client, matchId, null);
    const result = {
      shotSeq,
      seat: shooterSeat,
      events: {
        firstContact: events.firstContact,
        pocketed: events.pocketed,
        strikerPocketed: events.strikerPocketed,
      },
      verdict: { word: ruling.word, line: ruling.line },
      frames,
      final: pieces.map((p) => ({
        id: p.id,
        x: p.state === "pocketed" ? null : mm(p.x),
        y: p.state === "pocketed" ? null : mm(p.y),
        state: p.state,
      })),
      match,
      boardEnd: ruling.boardEnd,
      matchOver: ruling.matchOver,
    };
    await client.query(
      "insert into shots (id, match_id, shot_seq, seat, request, result) values ($1, $2, $3, $4, $5, $6)",
      [
        newId("sh"),
        matchId,
        shotSeq,
        shooterSeat,
        JSON.stringify({ ...ruling }),
        JSON.stringify(result),
      ]
    );
    return result as Record<string, unknown>;
  }

  private async finishMatchTx(
    client: pg.PoolClient,
    row: MatchRow,
    seats: SeatRow[],
    boardEnd: BoardEnd | null,
    endReason: "played" | "left" | "timeouts" | "resigned",
    resignerSeat: Seat | null
  ): Promise<void> {
    if (row.status === "completed" || row.status === "forfeit" || row.status === "abandoned") return;
    const winnerSeat =
      endReason === "played" && boardEnd !== null
        ? boardEnd.winnerSeat
        : resignerSeat === null
          ? row.turn
          : ((1 - resignerSeat) as Seat);
    const status = endReason === "played" ? "completed" : "forfeit";
    let scores = row.scores;
    if (boardEnd !== null) {
      scores = [...row.scores] as [number, number];
      scores[boardEnd.winnerSeat] += boardEnd.points;
    }
    await client.query(
      "update matches set status = $1, phase = 'match-over', winner_seat = $2, end_reason = $3, scores = $4, turn_deadline = null where id = $5",
      [status, winnerSeat, endReason, JSON.stringify(scores), row.id]
    );

    const winnerId = seats.find((s) => s.seat === winnerSeat)?.player_id ?? null;
    const loserId =
      seats.find((s) => s.seat === (1 - winnerSeat))?.player_id ?? null;

    // history rows (both sides, in one transaction)
    if (winnerId !== null && loserId !== null) {
      const names = new Map(seats.map((s) => [s.seat, s.name] as const));
      for (const seat of [0, 1] as Seat[]) {
        const other = (1 - seat) as Seat;
        await client.query(
          `insert into history_rows (id, player_id, match_id, mode, format, opponent, result, your_score, their_score, rating_delta, end_reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10)`,
          [
            newId("h"),
            seats.find((s) => s.seat === seat)?.player_id ?? "",
            row.id,
            row.mode,
            row.format,
            names.get(other) ?? "",
            seat === winnerSeat ? "won" : "lost",
            scores[seat],
            scores[other],
            endReason,
          ]
        );
      }
    }

    // ratings for ranked matches
    if (row.mode === "ranked" && winnerId !== null && loserId !== null) {
      const winner = await findPlayerById(client, winnerId);
      const loser = await findPlayerById(client, loserId);
      if (winner !== null && loser !== null) {
        const before = { winner: { ...winner }, loser: { ...loser } };
        const after = rateMatch(
          { rating: winner.rating, rd: winner.rd, volatility: winner.volatility },
          { rating: loser.rating, rd: loser.rd, volatility: loser.volatility }
        );
        await client.query(
          "update players set rating = $1, rd = $2, ranked_games = ranked_games + 1 where id = $3",
          [after.winner.rating, after.winner.rd, winnerId]
        );
        await client.query(
          "update players set rating = $1, rd = $2, ranked_games = ranked_games + 1 where id = $3",
          [after.loser.rating, after.loser.rd, loserId]
        );
        const deltaW = after.winner.rating - before.winner.rating;
        const deltaL = after.loser.rating - before.loser.rating;
        await client.query(
          "insert into rating_changes (id, player_id, match_id, rating, rd, delta) values ($1, $2, $3, $4, $5, $6), ($7, $8, $3, $9, $10, $11)",
          [
            newId("rc"),
            winnerId,
            row.id,
            after.winner.rating,
            after.winner.rd,
            deltaW,
            newId("rc"),
            loserId,
            after.loser.rating,
            after.loser.rd,
            deltaL,
          ]
        );
        await client.query(
          "update history_rows set rating_delta = $1 where match_id = $2 and player_id = $3",
          [deltaW, row.id, winnerId]
        );
        await client.query(
          "update history_rows set rating_delta = $1 where match_id = $2 and player_id = $3",
          [deltaL, row.id, loserId]
        );
      }
    }
  }

  /** Chalk awards, once per player, only for finished online matches. */
  private async awardChalkForMatch(matchId: string): Promise<void> {
    try {
      await this.db.tx(async (client) => {
        const row = await loadMatchRow(client, matchId);
        if (row === null) return;
        if (row.status !== "completed" && row.status !== "forfeit") return;
        const seats = await loadSeats(client, matchId);
        const winnerSeat = row.winner_seat;
        const day = utcDay();
        const seedKey = `match:${matchId}`;
        if (this.chalkSeeds.has(seedKey)) return;
        for (const seat of seats) {
          const isWinner = seat.seat === winnerSeat;
          const forfeited = row.end_reason !== "played" && !isWinner;
          if (forfeited) continue;
          await addChalk(client, seat.player_id, 20, "match", null);
          if (isWinner) {
            await addChalk(client, seat.player_id, 30, "win", null);
            const exists = await client.query(
              "select 1 from chalk_days where player_id = $1 and day = $2 and kind = 'daily'",
              [seat.player_id, day]
            );
            if (exists.rows.length === 0) {
              await client.query(
                "insert into chalk_days (player_id, day, kind) values ($1, $2, 'daily') on conflict do nothing",
                [seat.player_id, day]
              );
              await addChalk(client, seat.player_id, 50, "daily", null);
            }
          }
        }
        this.chalkSeeds.add(seedKey);
      });
    } catch (err) {
      console.error("chalk award failed", err);
    }
  }

  private async apiMatchEmote(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const seat = await this.seatOf(id, playerId);
    if (seat === null) throw api(403, { error: "NOT_IN_MATCH" });
    const emote = str(ctx.body?.emote);
    if (!EMOTES.includes(emote)) throw api(422, { error: "INVALID_EMOTE" });
    const now = Date.now();
    const last = this.emoteTimes.get(playerId) ?? 0;
    if (now - last < 3000) throw api(429, { error: "RATE_LIMITED" });
    this.emoteTimes.set(playerId, now);
    this.broadcastMatchExcluding(id, playerId, { type: "emote", seat, emote });
    return { status: 204, body: null };
  }

  private async apiMatchResign(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, id);
      if (row === null) throw api(404, { error: "NOT_FOUND" });
      const seats = await loadSeats(client, id);
      const mine = seats.find((s) => s.player_id === playerId);
      if (mine === undefined) throw api(403, { error: "NOT_IN_MATCH" });
      if (row.status !== "active" && row.status !== "waiting") {
        throw api(409, { error: "MATCH_NOT_ACTIVE" });
      }
      await this.finishMatchTx(client, row, seats, null, "resigned", mine.seat);
    });
    this.pushMatch(id);
    void this.awardChalkForMatch(id);
    const match = await this.matchJson(id, playerId);
    if (match === null) throw api(404, { error: "NOT_FOUND" });
    return { status: 200, body: match };
  }

  private async apiMatchRematch(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const playerId = player.id;
    const id = this.pathParam("/api/matches/:id", ctx.url.pathname, "id");
    const accept = ctx.body?.accept === true;
    const out = await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, id);
      if (row === null) throw api(404, { error: "NOT_FOUND" });
      if (row.mode !== "private") throw api(409, { error: "REMATCH_UNAVAILABLE" });
      if (row.status !== "completed" && row.status !== "forfeit") {
        throw api(409, { error: "REMATCH_UNAVAILABLE" });
      }
      if (row.room_code === null) throw api(409, { error: "REMATCH_UNAVAILABLE" });
      const seats = await loadSeats(client, id);
      const mine = seats.find((s) => s.player_id === playerId);
      if (mine === undefined) throw api(403, { error: "NOT_IN_MATCH" });
      const roomRes = await client.query(
        "select code, status, match_id, rematch_match_id from rooms where code = $1",
        [row.room_code]
      );
      const room = roomRes.rows[0];
      if (room === undefined || room.status === "closed") {
        throw api(409, { error: "REMATCH_UNAVAILABLE" });
      }
      if (!accept) {
        await client.query(
          "update matches set rematch_offer_seat = null, rematch_deadline = null where id = $1",
          [id]
        );
        return { status: "declined", matchId: null };
      }
      const existing = await client.query(
        "select rematch_offer_seat, rematch_deadline from matches where id = $1",
        [id]
      );
      const offerSeat = existing.rows[0]?.rematch_offer_seat ?? null;
      if (offerSeat === null) {
        await client.query(
          "update matches set rematch_offer_seat = $1, rematch_deadline = now() + ($2 || ' seconds')::interval where id = $3",
          [mine.seat, String(this.config.rematchSeconds), id]
        );
        return { status: "offered", matchId: null };
      }
      if (offerSeat === mine.seat) {
        return { status: "offered", matchId: null };
      }
      // both accepted: fresh match, breaker swapped
      const firstBreaker = row.first_breaker ?? 0;
      const breaker = (1 - firstBreaker) as Seat;
      const playerIds = seats.map((s) => s.player_id);
      const newMatch = await this.createMatchTx(client, {
        mode: "private",
        format: row.format,
        playerIds,
        whiteSeat: breaker,
        turn: breaker,
        boardNumber: 1,
        status: "active",
        roomCode: row.room_code,
      });
      await client.query(
        "update matches set rematch_offer_seat = null, rematch_deadline = null where id = $1",
        [id]
      );
      await client.query("update rooms set rematch_match_id = $1 where code = $2", [
        newMatch.id,
        row.room_code,
      ]);
      return { status: "accepted", matchId: newMatch.id };
    });
    this.pushMatch(id);
    if (out.matchId !== null) {
      this.pushRoom(out.matchId);
      this.pushMatch(out.matchId);
    }
    return { status: 200, body: out };
  }

  private pushRoomByMatch(matchId: string): void {
    void (async () => {
      const row = await this.db.query<{ room_code: string | null }>(
        "select room_code from matches where id = $1",
        [matchId]
      );
      const code = row.rows[0]?.room_code;
      if (code !== null && code !== undefined) this.pushRoom(code);
    })();
  }

  private async seatOf(matchId: string, playerId: string): Promise<Seat | null> {
    const res = await this.db.query<{ seat: number }>(
      "select seat from match_seats where match_id = $1 and player_id = $2",
      [matchId, playerId]
    );
    const row = res.rows[0];
    return row === undefined ? null : (row.seat as Seat);
  }

  private async requirePlayer(ctx: Ctx): Promise<PlayerRow> {
    if (ctx.playerId === null) throw api(503, { error: "DATABASE_UNAVAILABLE" });
    const row = await this.db.tx((client) => findPlayerById(client, ctx.playerId as string));
    if (row === null) throw api(503, { error: "DATABASE_UNAVAILABLE" });
    return row;
  }

  // ---- pass and play ----

  private async apiLocalMatch(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const body = ctx.body ?? {};
    const formatRaw = str(body.format);
    if (formatRaw !== "quick" && formatRaw !== "classic") {
      throw api(422, { error: "RESULT_MISMATCH" });
    }
    const modelVersion = str(body.modelVersion);
    if (modelVersion !== MODEL_VERSION) throw api(409, { error: "CLIENT_OUTDATED" });
    const idempotencyKey = str(body.idempotencyKey);
    const claimed = body.claimed as { winnerSeat: number; scores: [number, number] } | undefined;
    const resignedSeat = num(body.resignedSeat);
    const shots = (body.shots as { seat: number; x: number; dx: number; dy: number; p: number }[]) ?? [];
    const playersRaw = (body.players as { name: string }[]) ?? [];
    if (idempotencyKey === "" || claimed === undefined) {
      throw api(422, { error: "RESULT_MISMATCH" });
    }

    // idempotency
    const stored = await this.db.query<{ response: string }>(
      "select response from idempotency where key = $1",
      [idempotencyKey]
    );
    if (stored.rows[0] !== undefined) {
      return { status: 201, body: JSON.parse(stored.rows[0].response) as Record<string, unknown> };
    }

    // replay from the opening layout with the shared model
    const replay = replayLocalMatch(formatRaw, shots, resignedSeat);
    const ok =
      replay.finished &&
      replay.winnerSeat === claimed.winnerSeat &&
      replay.scores[0] === claimed.scores[0] &&
      replay.scores[1] === claimed.scores[1];
    if (!ok) throw api(422, { error: "RESULT_MISMATCH" });

    const out = await this.db.tx(async (client) => {
      const matchId = newId("mt");
      const opponent = playersRaw[1]?.name ?? "Player 2";
      const day = utcDay();
      const countRes = await client.query<{ count: string }>(
        "select count from local_days where player_id = $1 and day = $2",
        [player.id, day]
      );
      const count = Number(countRes.rows[0]?.count ?? 0);
      let chalkEarned = 0;
      if (count < 5) {
        chalkEarned = 10;
        await addChalk(client, player.id, 10, "local", null);
        await client.query(
          `insert into local_days (player_id, day, count) values ($1, $2, 1)
           on conflict (player_id, day) do update set count = local_days.count + 1`,
          [player.id, day]
        );
      }
      await client.query(
        `insert into history_rows (id, player_id, match_id, mode, format, opponent, result, your_score, their_score, rating_delta, end_reason)
         values ($1, $2, $3, 'local', $4, $5, $6, $7, $8, null, $9)`,
        [
          newId("h"),
          player.id,
          matchId,
          formatRaw,
          opponent,
          claimed.winnerSeat === 0 ? "won" : "lost",
          claimed.scores[0],
          claimed.scores[1],
          resignedSeat === null ? "played" : "resigned",
        ]
      );
      const response = { matchId, chalkEarned };
      await client.query("insert into idempotency (key, response) values ($1, $2)", [
        idempotencyKey,
        JSON.stringify(response),
      ]);
      return response;
    });
    return { status: 201, body: out };
  }

  // ---- shop ----

  private async apiShop(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const out = await this.db.tx(async (client) => {
      const chalk = await chalkBalance(client, player.id);
      const ownedRows = await ownedItems(client, player.id);
      const owned = new Set(ownedRows);
      // Price-0 items are owned by every player, and never billed.
      for (const item of CATALOG.filter((i) => i.price === 0)) {
        if (!owned.has(item.id)) {
          await client.query(
            "insert into owned_items (player_id, item_id) values ($1, $2) on conflict do nothing",
            [player.id, item.id]
          );
          owned.add(item.id);
        }
      }
      const equipped = await equippedRow(client, player.id);
      return {
        chalk,
        items: CATALOG.map((item) => ({
          ...item,
          owned: owned.has(item.id),
          equipped: equipped[item.kind as "striker" | "board" | "coins"] === item.id,
        })),
      };
    });
    return { status: 200, body: out };
  }

  private async apiShopPurchase(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const itemId = str(ctx.body?.itemId);
    const idempotencyKey = str(ctx.body?.idempotencyKey);
    const item = CATALOG.find((i) => i.id === itemId);
    if (item === undefined) throw api(404, { error: "ITEM_NOT_FOUND" });
    if (idempotencyKey === "") throw api(422, { error: "IDEMPOTENCY_KEY_REQUIRED" });

    const stored = await this.db.query<{ response: string }>(
      "select response from idempotency where key = $1",
      [idempotencyKey]
    );
    if (stored.rows[0] !== undefined) {
      return { status: 200, body: JSON.parse(stored.rows[0].response) as Record<string, unknown> };
    }

    const out = await this.db.tx(async (client) => {
      const owned = new Set(await ownedItems(client, player.id));
      if (owned.has(itemId)) throw api(409, { error: "ALREADY_OWNED" });
      const chalk = await chalkBalance(client, player.id);
      if (chalk < item.price) {
        throw api(402, { error: "INSUFFICIENT_CHALK", needed: item.price - chalk });
      }
      await addChalk(client, player.id, -item.price, "purchase", itemId);
      await client.query(
        "insert into owned_items (player_id, item_id) values ($1, $2) on conflict do nothing",
        [player.id, itemId]
      );
      const response = { chalk: chalk - item.price, owned: [...owned, itemId] };
      await client.query("insert into idempotency (key, response) values ($1, $2)", [
        idempotencyKey,
        JSON.stringify(response),
      ]);
      return response;
    });
    return { status: 200, body: out };
  }

  private async apiShopEquip(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const itemId = str(ctx.body?.itemId);
    const item = CATALOG.find((i) => i.id === itemId);
    if (item === undefined) throw api(404, { error: "ITEM_NOT_FOUND" });
    const out = await this.db.tx(async (client) => {
      const owned = new Set(await ownedItems(client, player.id));
      if (!owned.has(itemId)) throw api(403, { error: "NOT_OWNED" });
      await equippedRow(client, player.id);
      await client.query(
        `update equipped set striker = $1, board = $2, coins = $3 where player_id = $4`,
        [
          item.kind === "striker" ? itemId : null,
          item.kind === "board" ? itemId : null,
          item.kind === "coins" ? itemId : null,
          player.id,
        ]
      );
      // fix nulls back to current values
      await client.query(
        `update equipped set striker = coalesce(striker, (select striker from equipped e where e.player_id = equipped.player_id)) where player_id = $1`,
        [player.id]
      );
      const row = await equippedRow(client, player.id);
      return { equipped: row };
    });
    return { status: 200, body: out };
  }

  private async apiLedger(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const player = await this.requirePlayer(ctx);
    const res = await this.db.query(
      `select movement_id, account, player_id, delta, reason, item_id, created_at from ledger
       where (account = 'player' and player_id = $1) or account = 'house'
       order by created_at asc, movement_id asc`,
      [player.id]
    );
    let sum = 0;
    const entries = res.rows
      .filter((r) => r.account === "player" && r.player_id === player.id)
      .map((r) => {
        sum += r.delta;
        return {
          movementId: r.movement_id,
          account: "player" as const,
          delta: r.delta,
          reason: r.reason,
          itemId: r.item_id,
          createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        };
      });
    return { status: 200, body: { entries, sum } };
  }

  // ---- grading ----

  private async apiGradingPlayers(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const body = ctx.body ?? {};
    const name = str(body.name);
    if (name === "") throw api(422, { error: "NAME_INVALID" });
    const avatar = num(body.avatar) ?? 1;
    const out = await this.db.tx(async (client) => {
      const existing = await findPlayerByName(client, name);
      if (existing !== null) throw api(409, { error: "NAME_TAKEN" });
      const id = newId("p");
      const rating = num(body.rating) ?? 1500;
      const rd = num(body.rd) ?? 350;
      const volatility = num(body.volatility) ?? 0.06;
      const rankedGames = num(body.rankedGames) ?? 0;
      const email = body.email === undefined ? null : str(body.email);
      await client.query(
        `insert into players (id, name, name_lower, avatar, chosen, email, rating, rd, volatility, ranked_games)
         values ($1, $2, $3, $4, true, $5, $6, $7, $8, $9)`,
        [id, name, name.toLowerCase(), avatar, email, rating, rd, volatility, rankedGames]
      );
      const chalk = num(body.chalk) ?? 0;
      if (chalk > 0) await addChalk(client, id, chalk, "grant", null);
      for (const item of CATALOG.filter((i) => i.price === 0)) {
        await client.query(
          "insert into owned_items (player_id, item_id) values ($1, $2) on conflict do nothing",
          [id, item.id]
        );
      }
      await client.query(
        "insert into equipped (player_id, striker, board, coins) values ($1, 'striker-ply', 'board-ply', 'coins-ivory') on conflict do nothing",
        [id]
      );
      const token = newId("s");
      await client.query("insert into sessions (token, player_id) values ($1, $2)", [token, id]);
      return { id, name, sessionCookie: token };
    });
    return { status: 201, body: out };
  }

  private async apiGradingMatches(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const body = ctx.body ?? {};
    const modeRaw = str(body.mode);
    if (modeRaw !== "private" && modeRaw !== "casual" && modeRaw !== "ranked") {
      throw api(422, { error: "MODE_INVALID" });
    }
    const formatRaw = str(body.format);
    if (formatRaw !== "quick" && formatRaw !== "classic") {
      throw api(422, { error: "FORMAT_INVALID" });
    }
    const playerIds = (body.players as string[]) ?? [];
    if (playerIds.length !== 2) throw api(422, { error: "PLAYERS_INVALID" });
    const white = (num(body.white) ?? 0) as Seat;
    const turn = (num(body.turn) ?? 0) as Seat;
    const board = num(body.board) ?? 1;
    const scores = (body.scores as [number, number]) ?? [0, 0];
    const dues = (body.dues as [number, number]) ?? [0, 0];
    const timeouts = (body.timeouts as [number, number]) ?? [0, 0];
    const breakAttempt = num(body.breakAttempt);
    const queenRaw = body.queen as { state: string; seat: number | null } | undefined;

    const piecesInput = body.pieces as { id: string; x: number; y: number; state?: string; pocketedBy?: number | null }[] | undefined;
    let pieces: Piece[];
    if (piecesInput === undefined) {
      pieces = openingBoardPieces(turn);
    } else {
      const listed = new Map(piecesInput.map((p) => [p.id, p]));
      pieces = fullPiecesFromPartial(
        piecesInput.map((p) => ({ id: p.id, x: p.x, y: p.y }))
      );
      // Grading lists the queen and coins with their state; unlisted ones are
      // pocketed and credited to the owner of their colour.
      for (const p of pieces) {
        const given = listed.get(p.id);
        if (given !== undefined) {
          p.x = given.x;
          p.y = given.y;
          p.state = given.state === "pocketed" ? "pocketed" : "board";
          p.pocketedBy =
            given.state === "pocketed" ? ((given.pocketedBy ?? null) as Seat | null) : null;
        } else {
          p.state = "pocketed";
          const ownerSeat = p.id.startsWith("w") ? white : ((1 - white) as Seat);
          p.pocketedBy = ownerSeat;
        }
      }
      const striker = { id: "striker" as const, x: 0, y: strikerBaselineY(turn), state: "board" as const, pocketedBy: null };
      pieces = [striker, ...pieces];
    }

    const out = await this.db.tx(async (client) => {
      const id = newId("mt");
      const queen = queenRaw ?? { state: "board", seat: null };
      await client.query(
        `insert into matches (id, mode, format, status, board, turn, phase, shot_seq, break_attempt,
           queen_state, queen_seat, scores, dues, timeouts, white_seat, turn_deadline, first_breaker)
         values ($1, $2, $3, 'active', $4, $5, 'aim', 0, $6, $7, $8, $9, $10, $11, $12, null, $12)`,
        [
          id,
          modeRaw,
          formatRaw,
          board,
          turn,
          breakAttempt,
          queen.state,
          queen.seat,
          JSON.stringify(scores),
          JSON.stringify(dues),
          JSON.stringify(timeouts),
          white,
        ]
      );
      for (let i = 0; i < 2; i++) {
        const skin = await equippedRow(client, playerIds[i]);
        await client.query(
          "insert into match_seats (match_id, seat, player_id, striker_skin, connected, ready) values ($1, $2, $3, $4, false, true)",
          [id, i, playerIds[i], skin.striker]
        );
      }
      await client.query("insert into boards (match_id, board_number, pieces) values ($1, $2, $3)", [
        id,
        board,
        JSON.stringify(pieces),
      ]);
      let code: string | null = null;
      if (modeRaw === "private") {
        code = Array.from(
          { length: 6 },
          () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
        ).join("");
        await client.query(
          `insert into rooms (code, format, status, host_player_id, match_id, expires_at)
           values ($1, $2, 'full', $3, $4, now() + interval '600 seconds')`,
          [code, formatRaw, playerIds[0], id]
        );
        await client.query("update matches set room_code = $1 where id = $2", [code, id]);
      }
      return { id, code };
    });
    return { status: 201, body: { id: out.id, url: `/match/${out.id}`, code: out.code } };
  }

  private async apiGradingShot(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const id = this.pathParam("/api/grading/matches/:id", ctx.url.pathname, "id");
    const body = ctx.body ?? {};
    const seat = (num(body.seat) ?? 0) as Seat;
    const events = body.events as
      | { firstContact: string | null; pocketed: { id: string; pocket: string }[]; strikerPocketed: boolean }
      | undefined;
    const finalInput = (body.final as { id: string; x: number; y: number }[] | undefined) ?? [];
    if (events === undefined) throw api(422, { error: "INVALID_EVENTS" });
    const outcome = await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, id);
      if (row === null) throw api(404, { error: "NOT_FOUND" });
      if (row.turn !== seat) throw api(409, { error: "NOT_YOUR_TURN" });
      const pieces = await loadPieces(client, id);
      // apply final positions; pocketed pieces leave the board
      const finalMap = new Map(finalInput.map((f) => [f.id, f]));
      const moved = pieces.map((piece) => {
        if (piece.id === "striker") return piece;
        const f = finalMap.get(piece.id);
        if (f !== undefined) {
          return { ...piece, x: f.x, y: f.y, state: "board" as const, pocketedBy: null };
        }
        return piece;
      });
      for (const pocket of events.pocketed) {
        const piece = moved.find((p) => p.id === pocket.id);
        if (piece !== undefined) {
          piece.state = "pocketed";
          piece.pocketedBy =
            pocket.id === "queen"
              ? seat
              : pocket.id.startsWith("w")
                ? (row.white_seat === seat ? seat : ((1 - seat) as Seat))
                : (row.white_seat === seat ? ((1 - seat) as Seat) : seat);
        }
      }
      const state = await this.boardStateTx(client, row, moved);
      const simEvent: SimEvent = {
        firstContact:
          events.firstContact === null
            ? null
            : events.firstContact === "cushion"
              ? "cushion"
              : (events.firstContact as PieceId),
        pocketed: events.pocketed.map((p) => ({
          id: p.id as PieceId,
          pocket: p.pocket as "nw" | "ne" | "sw" | "se",
        })),
        strikerPocketed: events.strikerPocketed,
      };
      const ruling = ruleShot(state, simEvent);
      const result = await this.commitRuling(client, row, await loadSeats(client, id), ruling, [], simEvent);
      return result;
    });
    this.pushShot(id, outcome);
    void this.awardChalkForMatch(id);
    return { status: 200, body: outcome };
  }

  private async apiGradingSimulate(ctx: Ctx): Promise<{ status: number; body: unknown }> {
    const body = ctx.body ?? {};
    const piecesInput = (body.pieces as { id: string; x: number; y: number; vx?: number; vy?: number }[]) ?? [];
    const intent = body.intent as { seat: Seat; x: number; dx: number; dy: number; p: number } | undefined;
    let bodies;
    if (intent !== undefined) {
      const layout: Piece[] = piecesInput.map((p) => ({
        id: p.id as PieceId,
        x: p.x,
        y: p.y,
        state: "board",
        pocketedBy: null,
      }));
      bodies = strikeBodies(layout, intent.seat, intent.x, intent.dx, intent.dy, intent.p);
    } else {
      bodies = piecesInput.map((p) => ({
        id: p.id as PieceId,
        x: p.x,
        y: p.y,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        radius: p.id === "striker" ? 20.65 : 15.5,
        mass: p.id === "striker" ? 15 : 5.5,
      }));
    }
    const sim = simulate(bodies, true);
    return {
      status: 200,
      body: {
        events: sim.events,
        frames: sim.frames,
        final: sim.final,
        durationSeconds: sim.durationSeconds,
        maxSpeedAtRest: sim.maxSpeedAtRest,
      },
    };
  }

  // -------------------------------------------------------------------------
  // WebSocket hub.
  // -------------------------------------------------------------------------

  handleUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const host = req.headers.host ?? "";
      if (origin !== `http://${host}` && origin !== `https://${host}`) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    if (this.wss === null) {
      this.wss = new WebSocketServer({ noServer: true });
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, req);
    });
  }

  private onConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const cookies = parseCookies(req.headers.cookie ?? "");
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const matchParam = url.searchParams.get("match");
    const conn: HubConn = {
      ws,
      playerId: "",
      matchIds: new Set<string>(),
      roomCodes: new Set<string>(),
      queue: false,
      lastSeen: Date.now(),
      pongPending: false,
      matchId: matchParam,
    };
    void (async () => {
      const token = cookies.dc_session;
      if (token !== undefined) {
        const res = await this.db.query<{ player_id: string }>(
          "select player_id from sessions where token = $1",
          [token]
        );
        if (res.rows[0] !== undefined) conn.playerId = res.rows[0].player_id;
      }
      if (conn.playerId === "") {
        const id = await this.db.tx(async (client) => {
          const guest = await createGuest(client);
          const token = newId("s");
          await client.query("insert into sessions (token, player_id) values ($1, $2)", [token, guest.id]);
          return { id: guest.id, token };
        });
        conn.playerId = id.id;
        ws.send(JSON.stringify({ type: "session", sessionCookie: id.token }));
      }
      this.conns.add(conn);
      this.send(ws, { type: "ping" });
      if (conn.matchId !== null) {
        await this.joinMatchSocket(conn, conn.matchId);
      }
      void this.sendStateTo(conn);
    })();

    ws.on("message", (data) => {
      void this.onSocketMessage(conn, data.toString("utf8"));
    });
    ws.on("close", () => {
      this.conns.delete(conn);
      void this.onSocketClose(conn);
    });
    ws.on("pong", () => {
      conn.pongPending = false;
      conn.lastSeen = Date.now();
    });
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private async onSocketMessage(conn: HubConn, raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = str(msg.type);
    conn.lastSeen = Date.now();
    switch (type) {
      case "pong":
        conn.pongPending = false;
        return;
      case "ready": {
        const matchId = conn.matchId;
        if (matchId !== null) {
          await this.db.tx(async (client) => {
            const row = await loadMatchRow(client, matchId);
            if (row === null || row.status !== "waiting") return;
            const seats = await loadSeats(client, matchId);
            const mine = seats.find((s) => s.player_id === conn.playerId);
            if (mine === undefined) return;
            await client.query("update match_seats set ready = true where match_id = $1 and seat = $2", [
              matchId,
              mine.seat,
            ]);
            const after = await loadSeats(client, matchId);
            if (after.length === 2 && after.every((s) => s.ready)) {
              await client.query(
                "update matches set status = 'active', turn_deadline = now() + ($1 || ' seconds')::interval where id = $2",
                [String(this.config.shotTimerSeconds), matchId]
              );
            }
          });
          this.pushMatch(matchId);
        }
        return;
      }
      case "place":
      case "aim": {
        const matchId = conn.matchId;
        if (matchId !== null) {
          const seat = await this.seatOf(matchId, conn.playerId);
          if (seat !== null) {
            this.broadcastMatchExcluding(matchId, conn.playerId, {
              type: "preview",
              seat,
              x: num(msg.x) ?? 0,
              dx: num(msg.dx) ?? 0,
              dy: num(msg.dy) ?? 0,
              p: num(msg.p) ?? 0,
            });
          }
        }
        return;
      }
      case "shoot": {
        const matchId = conn.matchId;
        if (matchId === null) return;
        try {
          await this.ruleShotHttp(matchId, conn.playerId, {
            shotSeq: num(msg.shotSeq) ?? 0,
            x: num(msg.x) ?? 0,
            dx: num(msg.dx) ?? 0,
            dy: num(msg.dy) ?? 0,
            p: num(msg.p) ?? 0,
            modelVersion: str(msg.modelVersion),
          });
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("API:")) {
            const payload = JSON.parse(err.message.slice(4)) as ApiError;
            this.send(conn.ws, { type: "error", code: payload.body.error });
          }
        }
        return;
      }
      case "emote": {
        const matchId = conn.matchId;
        if (matchId === null) return;
        const seat = await this.seatOf(matchId, conn.playerId);
        const emote = str(msg.emote);
        if (seat !== null && EMOTES.includes(emote)) {
          this.broadcastMatchExcluding(matchId, conn.playerId, { type: "emote", seat, emote });
        }
        return;
      }
      case "resign": {
        const matchId = conn.matchId;
        if (matchId === null) return;
        await this.db.tx(async (client) => {
          const row = await loadMatchRow(client, matchId);
          if (row === null || (row.status !== "active" && row.status !== "waiting")) return;
          const seats = await loadSeats(client, matchId);
          const mine = seats.find((s) => s.player_id === conn.playerId);
          if (mine === undefined) return;
          await this.finishMatchTx(client, row, seats, null, "resigned", mine.seat);
        });
        this.pushMatch(matchId);
        void this.awardChalkForMatch(matchId);
        return;
      }
      case "rematch": {
        const matchId = conn.matchId;
        if (matchId === null) return;
        await this.apiMatchRematchSocket(conn, msg);
        return;
      }
      default:
        return;
    }
  }

  private async apiMatchRematchSocket(conn: HubConn, msg: Record<string, unknown>): Promise<void> {
    const matchId = conn.matchId;
    if (matchId === null) return;
    try {
      await this.db.tx(async (client) => {
        const row = await loadMatchRow(client, matchId);
        if (row === null || row.mode !== "private" || (row.status !== "completed" && row.status !== "forfeit")) return;
        const seats = await loadSeats(client, matchId);
        const mine = seats.find((s) => s.player_id === conn.playerId);
        if (mine === undefined) return;
        const accept = msg.accept === true;
        if (!accept) {
          await client.query("update matches set rematch_offer_seat = null where id = $1", [matchId]);
          return;
        }
        const offerRow = await client.query<{ rematch_offer_seat: number | null }>(
          "select rematch_offer_seat from matches where id = $1",
          [matchId]
        );
        const offer = offerRow.rows[0]?.rematch_offer_seat ?? null;
        if (offer === null) {
          await client.query("update matches set rematch_offer_seat = $1 where id = $2", [mine.seat, matchId]);
          return;
        }
        if (offer === mine.seat) return;
        const firstBreaker = row.first_breaker ?? 0;
        const breaker = (1 - firstBreaker) as Seat;
        const newMatch = await this.createMatchTx(client, {
          mode: "private",
          format: row.format,
          playerIds: seats.map((s) => s.player_id),
          whiteSeat: breaker,
          turn: breaker,
          boardNumber: 1,
          status: "active",
          roomCode: row.room_code,
        });
        await client.query("update matches set rematch_offer_seat = null where id = $1", [matchId]);
        if (row.room_code !== null) {
          await client.query("update rooms set rematch_match_id = $1 where code = $2", [
            newMatch.id,
            row.room_code,
          ]);
        }
      });
      this.pushMatch(matchId);
    } catch (err) {
      console.error("rematch failed", err);
    }
  }

  private async joinMatchSocket(conn: HubConn, matchId: string): Promise<void> {
    conn.matchIds.add(matchId);
    await this.db.tx(async (client) => {
      await client.query(
        "update match_seats set connected = true where match_id = $1 and player_id = $2",
        [matchId, conn.playerId]
      );
      const row = await loadMatchRow(client, matchId);
      if (row !== null && row.turn_deadline === null && row.status === "active") {
        await client.query(
          "update matches set turn_deadline = now() + ($1 || ' seconds')::interval where id = $2",
          [String(this.config.shotTimerSeconds), matchId]
        );
      }
    });
    this.pushMatch(matchId);
    void this.sendStateTo(conn);
  }

  private async onSocketClose(conn: HubConn): Promise<void> {
    for (const matchId of conn.matchIds) {
      await this.db.tx(async (client) => {
        await client.query(
          "update match_seats set connected = false where match_id = $1 and player_id = $2",
          [matchId, conn.playerId]
        );
      });
      this.pushMatch(matchId);
      void this.scheduleForfeitCheck(matchId);
    }
  }

  private async scheduleForfeitCheck(matchId: string): Promise<void> {
    setTimeout(() => {
      void this.forfeitCheck(matchId);
    }, this.config.reconnectSeconds * 1000);
  }

  private async forfeitCheck(matchId: string): Promise<void> {
    await this.db.tx(async (client) => {
      const row = await loadMatchRow(client, matchId);
      if (row === null || row.status !== "active") return;
      const seats = await loadSeats(client, matchId);
      const away = seats.filter((s) => !s.connected);
      if (away.length === 0) return;
      if (away.length === 2) {
        await client.query(
          "update matches set status = 'abandoned', end_reason = 'abandoned', turn_deadline = null where id = $1",
          [matchId]
        );
        return;
      }
      const awaySeat = away[0].seat;
      await this.finishMatchTx(client, row, seats, null, "left", awaySeat);
    });
    this.pushMatch(matchId);
    void this.awardChalkForMatch(matchId);
  }

  private async sendStateTo(conn: HubConn): Promise<void> {
    const matchId = conn.matchId;
    if (matchId === null) return;
    const match = await this.matchJson(matchId, conn.playerId);
    if (match !== null) this.send(conn.ws, { type: "state", ...match });
  }

  private broadcastMatch(matchId: string, message: Record<string, unknown>): void {
    for (const conn of this.conns) {
      if (conn.matchIds.has(matchId)) this.send(conn.ws, message);
    }
  }

  private broadcastMatchExcluding(matchId: string, playerId: string, message: Record<string, unknown>): void {
    for (const conn of this.conns) {
      if (conn.matchIds.has(matchId) && conn.playerId !== playerId) this.send(conn.ws, message);
    }
  }

  private broadcastToPlayer(playerId: string, message: Record<string, unknown>): void {
    for (const conn of this.conns) {
      if (conn.playerId === playerId) this.send(conn.ws, message);
    }
  }

  private broadcastRoom(code: string, message: Record<string, unknown>): void {
    for (const conn of this.conns) {
      if (conn.roomCodes.has(code)) this.send(conn.ws, message);
    }
  }

  private pushMatch(matchId: string): void {
    void (async () => {
      for (const conn of [...this.conns]) {
        if (!conn.matchIds.has(matchId)) continue;
        const match = await this.matchJson(matchId, conn.playerId);
        if (match !== null) this.send(conn.ws, { type: "state", ...match });
      }
    })();
  }

  private pushShot(matchId: string, result: Record<string, unknown>): void {
    this.broadcastMatch(matchId, { type: "shotResult", ...result });
  }

  /** The socket heartbeat and the server's timers. */
  startTimers(): void {
    // The socket heartbeat: a conn that answers nothing for 5 seconds after a
    // ping is closed, which marks the seat disconnected and starts the window.
    setInterval(() => {
      const now = Date.now();
      for (const conn of [...this.conns]) {
        if (now - conn.lastSeen > 5000) {
          if (conn.pongPending) {
            try {
              conn.ws.terminate();
            } catch {
              // already closed
            }
            continue;
          }
          conn.pongPending = true;
          this.send(conn.ws, { type: "ping" });
        }
      }
    }, 2000);
    setInterval(() => {
      this.tickTurnDeadlines().catch(() => {
        // the database is unreachable; the next tick retries
      });
    }, 1000);
    setInterval(() => {
      this.tickRooms().catch(() => {
        // the database is unreachable; the next tick retries
      });
    }, 1000);
    setInterval(() => {
      this.widenBands().catch(() => {
        // the database is unreachable; the next tick retries
      });
    }, 1000);
  }

  private async tickTurnDeadlines(): Promise<void> {
    const res = await this.db.query<{ id: string; turn: number }>(
      "select id, turn from matches where status = 'active' and turn_deadline is not null and turn_deadline < now()"
    );
    for (const row of res.rows) {
      await this.db.tx(async (client) => {
        const match = await loadMatchRow(client, row.id);
        if (match === null || match.status !== "active" || match.turn_deadline === null) return;
        if (match.turn_deadline.getTime() > Date.now()) return;
        const seats = await loadSeats(client, row.id);
        const shooterSeat = seats.find((s) => s.seat === match.turn);
        if (shooterSeat === undefined) return;
        const timeouts = [...match.timeouts] as [number, number];
        timeouts[match.turn] += 1;
        const nextTurn = (1 - match.turn) as Seat;
        const shooterAway = !shooterSeat.connected;
        if (timeouts[match.turn] >= 3 && !shooterAway) {
          await client.query(
            "update matches set timeouts = $1, turn = $2, turn_deadline = null where id = $3",
            [JSON.stringify(timeouts), nextTurn, row.id]
          );
          const fresh = await loadMatchRow(client, row.id);
          if (fresh !== null) await this.finishMatchTx(client, fresh, seats, null, "timeouts", match.turn);
          return;
        }
        await client.query(
          `update matches set timeouts = $1, turn = $2, shot_seq = $3,
             turn_deadline = now() + ($4 || ' seconds')::interval where id = $5`,
          [
            JSON.stringify(timeouts),
            nextTurn,
            match.shot_seq + 1,
            String(this.config.shotTimerSeconds),
            row.id,
          ]
        );
        await this.pushTimeoutVerdict(row.id, match.turn, timeouts[match.turn] >= 3);
        for (const seat of seats) {
          if (seat.seat === match.turn) this.turnExpired.add(`${row.id}:${seat.player_id}`);
        }
      });
      this.pushMatch(row.id);
    }
  }

  private async pushTimeoutVerdict(matchId: string, seat: Seat, forfeited: boolean): Promise<void> {
    const seats = await this.db.tx(async (client) => loadSeats(client, matchId));
    const name = seats.find((s) => s.seat === seat)?.name ?? "";
    const line = forfeited
      ? `${name} forfeited: 3 timeouts in a row`
      : `Time's up. The turn passes.`;
    this.broadcastMatch(matchId, {
      type: "shotResult",
      verdict: { word: "TIME UP", line },
      timeout: true,
      seat,
    });
  }

  private async tickRooms(): Promise<void> {
    const res = await this.db.query<{ code: string }>(
      "select code from rooms where status = 'open' and expires_at < now()"
    );
    for (const row of res.rows) {
      await this.db.query("update rooms set status = 'closed' where code = $1", [row.code]);
      this.pushRoom(row.code);
    }
    // rematch expiry
    const expired = await this.db.query<{ id: string }>(
      "select id from matches where rematch_offer_seat is not null and rematch_deadline is not null and rematch_deadline < now()"
    );
    for (const row of expired.rows) {
      await this.db.query(
        "update matches set rematch_offer_seat = null, rematch_deadline = null where id = $1",
        [row.id]
      );
      this.pushMatch(row.id);
    }
  }
}

interface StoredShot {
  result: Record<string, unknown>;
  playerId: string;
}

interface RoomRow {
  code: string;
  format: Format;
  status: "open" | "full" | "closed";
  host_player_id: string;
  guest_player_id: string | null;
  match_id: string;
  rematch_match_id: string | null;
  expires_at: Date;
  host_name: string;
  guest_name: string | null;
}

interface QueueRow {
  player_id: string;
  near: number;
  band: number;
  waited_from: Date;
}

function api(status: number, body: Record<string, unknown>): Error {
  return new Error(`API:${JSON.stringify({ status, body })}`);
}

async function findPlayerByEmail(client: pg.PoolClient, email: string): Promise<string | null> {
  const res = await client.query<{ id: string }>("select id from players where email = $1", [email]);
  return res.rows[0]?.id ?? null;
}

async function playerName(client: pg.PoolClient, id: string): Promise<string> {
  const res = await client.query<{ name: string }>("select name from players where id = $1", [id]);
  return res.rows[0]?.name ?? "";
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function waitedSeconds(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
}

function currentBand(base: number, waited: number, widenSeconds: number): number {
  const periods = Math.floor(waited / Math.max(1, widenSeconds));
  return Math.min(400, base + periods * 50);
}

/** Replays a pass-and-play shot log with the shared model, deciding the result. */
function replayLocalMatch(
  format: Format,
  shots: { seat: number; x: number; dx: number; dy: number; p: number }[],
  resignedSeat: number | null
): {
  finished: boolean;
  winnerSeat: number;
  scores: [number, number];
} {
  let state: BoardState = {
    pieces: openingBoardPieces(0),
    turn: 0,
    scores: [0, 0],
    dues: [0, 0],
    timeouts: [0, 0],
    queen: { state: "board", seat: null },
    breakAttempt: 1,
    boardNumber: 1,
    format,
    whiteSeat: 0,
  };
  for (const shot of shots) {
    if (shot.seat !== state.turn) return { finished: false, winnerSeat: 0, scores: state.scores };
    if (!intentValid(shot)) return { finished: false, winnerSeat: 0, scores: state.scores };
    if (!isPlacementLegal(state.pieces, state.turn, shot.x)) {
      return { finished: false, winnerSeat: 0, scores: state.scores };
    }
    const bodies = strikeBodies(state.pieces, state.turn, shot.x, shot.dx, shot.dy, shot.p);
    const sim = simulate(bodies, false);
    const moved = state.pieces.map((piece) => {
      const final = sim.final.find((f) => f.id === piece.id);
      if (final === undefined) return piece;
      return { ...piece, x: final.x ?? piece.x, y: final.y ?? piece.y, state: final.state };
    });
    const ruling = ruleShot({ ...state, pieces: moved }, sim.events);
    if (ruling.boardEnd !== null && !ruling.matchOver) {
      const nb = nextBoard(state, ruling.boardEnd, state.boardNumber + 1);
      if (extraBoardNeeded(state, ruling.boardEnd)) nb.boardNumber = 9;
      state = nb;
      continue;
    }
    if (ruling.matchOver && ruling.boardEnd !== null) {
      const scores = [...state.scores] as [number, number];
      scores[ruling.boardEnd.winnerSeat] += ruling.boardEnd.points;
      return { finished: true, winnerSeat: ruling.boardEnd.winnerSeat, scores };
    }
    state = { ...state, pieces: ruling.pieces, turn: ruling.turn, dues: ruling.dues, queen: ruling.queen, breakAttempt: ruling.breakAttempt };
  }
  if (resignedSeat !== null) {
    const winner = (1 - resignedSeat) as Seat;
    return { finished: true, winnerSeat: winner, scores: state.scores };
  }
  return { finished: false, winnerSeat: 0, scores: state.scores };
}
