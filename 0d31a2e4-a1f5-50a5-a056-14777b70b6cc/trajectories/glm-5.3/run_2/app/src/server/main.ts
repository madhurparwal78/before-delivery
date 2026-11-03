import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadConfig } from "./config.js";
import { applySchema } from "./schema.js";
import { seed } from "./api/seed.js";
import { ApiError, err, sendError } from "./http.js";
import { createRouter, announceSeatings, type RouterDeps } from "./api/router.js";
import { Hub } from "./api/hub.js";
import { MatchRunner } from "./api/runner.js";
import { partyOfUser } from "./api/parties.js";
import { seatQueuedParties } from "./api/matchmaker.js";
import { COOKIE_NAME } from "../shared/domain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "../client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

  let schemaReady = false;
  while (!schemaReady) {
    try {
      await pool.query("SELECT 1");
      await applySchema(pool);
      schemaReady = true;
    } catch {
      console.log("postgres unreachable; retrying in 2s");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const runner = new MatchRunner(pool, {
    onRoundStarted: (matchId, round) => hub.announceRound(matchId, round),
    onTick: (matchId, round, tick, beans, slotsLeft) => hub.announceTick(matchId, round, tick, beans, slotsLeft),
    onRoundResolved: (matchId, round) => hub.announceRound(matchId, round),
    onMatchFinished: async (matchId, participants, winnerId) => {
      for (const userId of participants) {
        const party = await partyOfUser(pool, userId);
        if (party) await hub.announceParty(party);
      }
      hub.announceMatchFinished(matchId, participants, winnerId);
    }
  });

  const partiesOf = async (userId: number) => {
    const party = await partyOfUser(pool, userId);
    if (!party) return null;
    const members = party.members.map((m) => m.user.id);
    return { id: party.id, state: party.state, memberIds: members };
  };

  const hub = new Hub(
    pool,
    async (token) => {
      const found = await pool.query<{ user_id: number }>("SELECT user_id FROM sessions WHERE token = $1", [token]);
      return found.rows[0]?.user_id ?? null;
    },
    partiesOf,
    {
      onInput: (userId, matchId, round, tick, buttons) => {
        void runner.acceptInput(matchId, round, userId, tick, buttons).then((result) => {
          if (!result.ok) {
            hub.sendToUser(userId, { type: "input_rejected", tick, reason: result.reason });
          }
        });
      },
      onVoiceSignal: (from, to, data) => {
        if (!from.inVoice) {
          hub.send(from.ws, { type: "error", code: "not_in_voice" });
          return;
        }
        const targetState = hub.voiceStateOf(to);
        const sameParty = hub.isOnline(to);
        if (!targetState.inVoice || !sameParty) {
          hub.send(from.ws, { type: "error", code: "not_in_voice" });
          return;
        }
        hub.sendToUser(to, { type: "voice_signal", from: from.userId, data });
      }
    }
  );

  const deps: RouterDeps = {
    pool,
    hub,
    runner,
    baseUrl: config.publicUrl,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    ownOrigin: config.publicUrl,
    sessionOf: async (token) => {
      const found = await pool.query<{ user_id: number }>("SELECT user_id FROM sessions WHERE token = $1", [token]);
      return found.rows[0]?.user_id ?? null;
    },
    cookie: (res, token) => {
      const value = token ? `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax` : `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
      res.setHeader("set-cookie", value);
    },
  };

  const router = createRouter(deps);

  async function sweepQueues(): Promise<void> {
    await seatQueuedParties(pool);
    await announceSeatings(deps);
    await scheduleCountdowns();
  }

  /** Starts lobby countdowns when full, and matches when countdowns end. */
  async function scheduleCountdowns(): Promise<void> {
    const countdowns = await pool.query<{ id: number; countdown_ends_at: Date }>(
      "SELECT id, countdown_ends_at FROM lobbies WHERE state = 'countdown' AND countdown_ends_at IS NOT NULL"
    );
    const now = Date.now();
    for (const lobby of countdowns.rows) {
      const endsAt = lobby.countdown_ends_at.getTime();
      const delay = Math.max(0, endsAt - now);
      if (startedCountdowns.has(lobby.id)) continue;
      startedCountdowns.add(lobby.id);
      setTimeout(() => {
        void startMatchFor(lobby.id).catch(() => undefined);
      }, delay + 5);
    }
    const fillings = await pool.query<{ id: number; seats: number }>(
      `SELECT l.id, count(s.seat)::int AS seats FROM lobbies l
         LEFT JOIN lobby_seats s ON s.lobby_id = l.id
        WHERE l.state = 'filling'
        GROUP BY l.id`
    );
    for (const lobby of fillings.rows) {
      if (lobby.seats >= 12) {
        await pool.query("UPDATE lobbies SET state = 'countdown', countdown_ends_at = $1 WHERE id = $2 AND state = 'filling'", [
          new Date(Date.now() + 10000),
          lobby.id
        ]);
      }
    }
  }

  const startedCountdowns = new Set<number>();

  async function startMatchFor(lobbyId: number): Promise<void> {
    startedCountdowns.delete(lobbyId);
    const lobby = await pool.query<{ id: number; state: string; match_id: number | null }>(
      "SELECT id, state, match_id FROM lobbies WHERE id = $1",
      [lobbyId]
    );
    const row = lobby.rows[0];
    if (!row || row.state !== "countdown" || row.match_id) return;
    const client = await pool.connect();
    let matchId: number;
    let participants: number[];
    try {
      await client.query("BEGIN");
      const created = await client.query<{ id: number }>(
        "INSERT INTO matches (name, state, lobby_id) VALUES ('Cup #', 'running', $1) RETURNING id",
        [lobbyId]
      );
      matchId = (created.rows[0] as { id: number }).id;
      await client.query("UPDATE matches SET name = $1 WHERE id = $2", [`Cup #${matchId}`, matchId]);
      await client.query("UPDATE lobbies SET state = 'running', match_id = $1 WHERE id = $2", [matchId, lobbyId]);
      await client.query(
        "UPDATE parties SET state = 'in_match', match_id = $1 WHERE id IN (SELECT party_id FROM lobby_seats WHERE lobby_id = $2)",
        [matchId, lobbyId]
      );
      const seats = await client.query<{ user_id: number }>("SELECT user_id FROM lobby_seats WHERE lobby_id = $1 ORDER BY seat", [
        lobbyId
      ]);
      participants = seats.rows.map((row) => row.user_id);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw e;
    }
    client.release();
    hub.registerParticipants(matchId, participants);
    await runner.startMatch(matchId, lobbyId, participants);
    for (const userId of participants) {
      const party = await partyOfUser(pool, userId);
      if (party) await hub.announceParty(party);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const handled = await router.route(req, res);
      if (handled) return;
      await serveStatic(req, res);
    } catch (e) {
      if (e instanceof ApiError) {
        sendError(res, e);
      } else {
        sendError(res, err("server_error"));
      }
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const origin = req.headers["origin"] ?? null;
    const host = req.headers["host"];
    const own = typeof host === "string" && host.length > 0 ? `http://${host}` : config.publicUrl;
    hub.handleUpgrade(req, socket, head, origin, own);
  });

  async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const shell = (): void => {
      const body = fs.readFileSync(path.join(clientDir, "index.html"));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store"
      });
      res.end(body);
    };
    if (pathname.startsWith("/api/") || pathname === "/ws") {
      sendError(res, new ApiError(404, "not_found", "Not found."));
      return;
    }
    // The server never serves source, manifests, lockfiles or node_modules.
    const base = path.basename(pathname);
    if (
      pathname.startsWith("/src") ||
      pathname.startsWith("/node_modules") ||
      base.endsWith(".ts") ||
      base.endsWith(".tsx") ||
      base.endsWith(".map") ||
      base === ".env" ||
      base === "package.json" ||
      base === "package-lock.json" ||
      base === "run.json"
    ) {
      const body = fs.readFileSync(path.join(clientDir, "index.html"));
      res.writeHead(404, {
        "content-type": "text/html; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store"
      });
      res.end(body);
      return;
    }
    if (pathname.includes("..")) {
      sendError(res, new ApiError(404, "not_found", "Not found."));
      return;
    }
    let filePath = path.join(clientDir, pathname === "/" ? "index.html" : pathname);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      shell();
      return;
    }
    const finalExt = path.extname(filePath);
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      "content-type": MIME[finalExt] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": finalExt === ".html" ? "no-store" : "public, max-age=300"
    });
    res.end(body);
  }

  setInterval(() => {
    void sweepQueues().catch(() => undefined);
  }, 1000);

  await seed(pool);
  await sweepQueues();

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`pratfall cup serving on ${config.port}`);
  });
}

void main();
