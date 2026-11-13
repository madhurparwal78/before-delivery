import { MODEL_VERSION } from "../shared/constants";
import { replayLocalMatch } from "../shared/shot";
import type { LoggedShot } from "../shared/shot";
import type { Format, Seat, ShotEvents } from "../shared/types";
import { sendLink } from "./auth";
import { config } from "./config";
import { databaseAnswers, transaction } from "./db";
import { ApiError } from "./errors";
import * as grading from "./grading";
import { LOCAL_BODY_LIMIT } from "./http";
import type { Ctx, Reply } from "./http";
import { LOCAL_CHALK, LOCAL_DAILY_LIMIT, equip, ledgerJson, movementsToday, purchase, recordMovement, shopJson } from "./ledger";
import { gradingShot, insertMatch, loadMatch, matchJson, parseShotBody, preview, resign, seatOf, sendEmote, setReady, submitShot } from "./matches";
import type { ShotBody } from "./matches";
import {
  chooseName,
  historyJson,
  leaderboardJson,
  meJson,
  playerById,
  playerByName,
  publicPlayerJson,
  setAvatar,
  skipName,
} from "./players";
import { enterQueue, leaveQueue, queueStatus } from "./queue";
import type { QueueMode } from "./queue";
import { cancelRoom, createRoom, joinRoom, rematch, roomJson } from "./rooms";
import { fingerprint } from "./util";

interface Route {
  method: string;
  pattern: RegExp;
  handle: (ctx: Ctx) => Promise<Reply>;
  maxBody?: number;
  grading?: boolean;
}

type Json = Record<string, unknown>;

function fields(body: unknown): Json {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ApiError(400, "INVALID_PAYLOAD");
  return body as Json;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const noContent: Reply = { status: 204 };

async function localMatch(ctx: Ctx): Promise<Reply> {
  const player = await ctx.player();
  const input = fields(ctx.body);
  const key = input.idempotencyKey;
  const format = input.format;
  const names = input.players;
  const shots = input.shots;
  const claimed = input.claimed === undefined ? null : fields(input.claimed);
  const validNames =
    Array.isArray(names) && names.length === 2 && names.every((n) => typeof fields(n).name === "string" && (fields(n).name as string).trim().length > 0 && (fields(n).name as string).length <= 40);
  if (typeof key !== "string" || key.length === 0 || (format !== "quick" && format !== "classic") || !validNames || !Array.isArray(shots) || !claimed) {
    throw new ApiError(400, "INVALID_PAYLOAD");
  }
  const print = fingerprint(input);
  const stored = await transaction(async (db) => {
    await db.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [player.id]);
    const seen = (await db.query("SELECT fingerprint, response FROM idempotent_requests WHERE player_id = $1 AND scope = 'local' AND key = $2", [player.id, key])).rows[0];
    if (seen) {
      if (seen.fingerprint !== print) throw new ApiError(409, "IDEMPOTENCY_CONFLICT");
      return seen.response as { matchId: string; chalkEarned: number };
    }
    if (input.modelVersion !== MODEL_VERSION) throw new ApiError(409, "CLIENT_OUTDATED");
    const resignedSeat = input.resignedSeat === 0 || input.resignedSeat === 1 ? (input.resignedSeat as Seat) : null;
    if (!(shots as unknown[]).every(isLoggedShot)) throw new ApiError(400, "INVALID_PAYLOAD");
    const replay = replayLocalMatch(format as Format, shots as LoggedShot[], resignedSeat);
    const scores = Array.isArray(claimed.scores) ? claimed.scores : [];
    if (!replay.valid || claimed.winnerSeat !== replay.state.winnerSeat || scores[0] !== replay.state.scores[0] || scores[1] !== replay.state.scores[1]) {
      throw new ApiError(422, "RESULT_MISMATCH");
    }
    const matchId = await insertMatch(db, {
      mode: "local",
      format: format as Format,
      seats: [player.id, null],
      status: replay.state.endReason === "played" ? "completed" : "forfeit",
      state: replay.state,
      opponentName: ((names as Json[])[1] as Json).name as string,
      endedAt: new Date(),
    });
    let chalkEarned = 0;
    if ((await movementsToday(db, player.id, "local")) < LOCAL_DAILY_LIMIT) {
      await recordMovement(db, player.id, LOCAL_CHALK, "local", { matchId });
      chalkEarned = LOCAL_CHALK;
    }
    const body = { matchId, chalkEarned };
    await db.query("INSERT INTO idempotent_requests (player_id, scope, key, fingerprint, response) VALUES ($1, 'local', $2, $3, $4)", [player.id, key, print, JSON.stringify(body)]);
    return body;
  });
  return { status: 201, body: stored };
}

function isLoggedShot(value: unknown): value is LoggedShot {
  if (typeof value !== "object" || value === null) return false;
  const shot = value as Record<string, unknown>;
  return (shot.seat === 0 || shot.seat === 1) && ["x", "dx", "dy", "p"].every((k) => typeof shot[k] === "number");
}

function shotBody(ctx: Ctx): ShotBody {
  return parseShotBody(fields(ctx.body));
}

export const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/health$/, handle: async () => ok({ status: (await databaseAnswers()) ? "ok" : "unavailable" }) },
  {
    method: "GET",
    pattern: /^\/api\/config$/,
    handle: async () =>
      ok({
        verdictBannerMs: config.verdictBannerMs,
        shotTimerSeconds: config.shotTimerSeconds,
        reconnectSeconds: config.reconnectSeconds,
        rematchSeconds: config.rematchSeconds,
        roomExpirySeconds: config.roomExpirySeconds,
        bandWidenSeconds: config.bandWidenSeconds,
        modelVersion: MODEL_VERSION,
      }),
  },
  { method: "GET", pattern: /^\/api\/me$/, handle: async (ctx) => ok(await meJson(await ctx.player())) },
  {
    method: "POST",
    pattern: /^\/api\/me\/name$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const input = fields(ctx.body);
      if (typeof input.name !== "string") throw new ApiError(422, "NAME_INVALID");
      await chooseName(player, input.name, input.avatar === undefined ? undefined : (input.avatar as number));
      return ok(await meJson((await playerById(player.id)) ?? player));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/me\/skip$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      await skipName(player);
      return ok(await meJson((await playerById(player.id)) ?? player));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/me\/avatar$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      await setAvatar(player, fields(ctx.body).avatar);
      return ok(await meJson((await playerById(player.id)) ?? player));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/players\/by-name\/([^/]+)$/,
    handle: async (ctx) => {
      let name = "";
      try {
        name = decodeURIComponent(ctx.params[0] as string);
      } catch {
        throw new ApiError(404, "NOT_FOUND");
      }
      const found = await playerByName(name);
      if (!found) throw new ApiError(404, "NOT_FOUND");
      return ok(publicPlayerJson(found));
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/players\/([0-9a-f-]{36})\/history$/,
    handle: async (ctx) => {
      if (!(await playerById(ctx.params[0] as string))) throw new ApiError(404, "NOT_FOUND");
      return ok(await historyJson(ctx.params[0] as string));
    },
  },
  { method: "GET", pattern: /^\/api\/leaderboard$/, handle: async (ctx) => ok(await leaderboardJson(await ctx.player())) },
  {
    method: "POST",
    pattern: /^\/api\/auth\/link$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      await sendLink(player, fields(ctx.body).email);
      return { status: 202, body: { status: "sent" } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/rooms$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const format = fields(ctx.body).format;
      if (format !== "quick" && format !== "classic") throw new ApiError(400, "INVALID_PAYLOAD");
      return { status: 201, body: await createRoom(player, format) };
    },
  },
  { method: "GET", pattern: /^\/api\/rooms\/([A-Za-z0-9]{1,12})$/, handle: async (ctx) => ok(await roomJson((ctx.params[0] as string).toUpperCase())) },
  {
    method: "POST",
    pattern: /^\/api\/rooms\/([A-Za-z0-9]{1,12})\/join$/,
    handle: async (ctx) => ok(await joinRoom(await ctx.player(), (ctx.params[0] as string).toUpperCase())),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/rooms\/([A-Za-z0-9]{1,12})$/,
    handle: async (ctx) => {
      await cancelRoom(await ctx.player(), (ctx.params[0] as string).toUpperCase());
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/queue$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const mode = fields(ctx.body).mode;
      if (mode !== "casual" && mode !== "ranked") throw new ApiError(400, "INVALID_PAYLOAD");
      return { status: 202, body: await enterQueue(player, mode as QueueMode) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/queue$/,
    handle: async (ctx) => {
      const status = await queueStatus((await ctx.player()).id);
      if (!status) throw new ApiError(404, "NOT_FOUND");
      return ok(status);
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/queue$/,
    handle: async (ctx) => {
      await leaveQueue((await ctx.player()).id);
      return noContent;
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const match = await loadMatch(null, ctx.params[0] as string);
      if (!match) throw new ApiError(404, "NOT_FOUND");
      seatOf(match, player.id);
      return ok(await matchJson(match));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/ready$/,
    handle: async (ctx) => ok(await setReady((await ctx.player()).id, ctx.params[0] as string)),
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/preview$/,
    handle: async (ctx) => {
      await preview((await ctx.player()).id, ctx.params[0] as string, fields(ctx.body));
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/shots$/,
    handle: async (ctx) => ok(await submitShot((await ctx.player()).id, ctx.params[0] as string, shotBody(ctx))),
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/emotes$/,
    handle: async (ctx) => {
      await sendEmote((await ctx.player()).id, ctx.params[0] as string, fields(ctx.body).emote);
      return noContent;
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/resign$/,
    handle: async (ctx) => ok(await resign((await ctx.player()).id, ctx.params[0] as string)),
  },
  {
    method: "POST",
    pattern: /^\/api\/matches\/([0-9a-f-]{36})\/rematch$/,
    handle: async (ctx) => {
      const accept = fields(ctx.body).accept;
      if (typeof accept !== "boolean") throw new ApiError(400, "INVALID_PAYLOAD");
      return ok(await rematch(await ctx.player(), ctx.params[0] as string, accept));
    },
  },
  { method: "POST", pattern: /^\/api\/local-matches$/, handle: localMatch, maxBody: LOCAL_BODY_LIMIT },
  {
    method: "GET",
    pattern: /^\/api\/shop$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      return ok(await shopJson(player.id, player.equipped));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/shop\/purchase$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const input = fields(ctx.body);
      if (typeof input.itemId !== "string" || typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0) {
        throw new ApiError(400, "INVALID_PAYLOAD");
      }
      const { itemId, idempotencyKey } = input;
      return ok(await transaction((db) => purchase(db, player.id, itemId, idempotencyKey)));
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/shop\/equip$/,
    handle: async (ctx) => {
      const player = await ctx.player();
      const itemId = fields(ctx.body).itemId;
      if (typeof itemId !== "string") throw new ApiError(400, "INVALID_PAYLOAD");
      return ok({ equipped: await equip(player.id, itemId) });
    },
  },
  { method: "GET", pattern: /^\/api\/me\/ledger$/, handle: async (ctx) => ok(await ledgerJson((await ctx.player()).id)) },
  {
    method: "POST",
    pattern: /^\/api\/grading\/players$/,
    grading: true,
    handle: async (ctx) => ({ status: 201, body: await grading.createPlayer(ctx.body) }),
  },
  {
    method: "POST",
    pattern: /^\/api\/grading\/matches$/,
    grading: true,
    handle: async (ctx) => ({ status: 201, body: await grading.createMatch(ctx.body) }),
  },
  {
    method: "POST",
    pattern: /^\/api\/grading\/matches\/([0-9a-f-]{36})\/shots$/,
    grading: true,
    handle: async (ctx) => {
      const input = fields(ctx.body);
      const events = fields(input.events) as unknown as ShotEvents;
      const seat = input.seat === 1 ? 1 : 0;
      const final = Array.isArray(input.final) ? (input.final as { id: never; x: number; y: number }[]) : [];
      return ok(await gradingShot(ctx.params[0] as string, seat, events, final));
    },
  },
  { method: "POST", pattern: /^\/api\/grading\/simulate$/, grading: true, handle: async (ctx) => ok(grading.simulateJson(ctx.body)) },
];

