import type { Player } from "../shared/protocol";
import { confirmEmail, confirmReset, endSession, requestReset, resendVerification, signIn, signUp } from "./auth";
import { dailyMonth } from "./calendar";
import { config } from "./config";
import { isDate } from "../shared/dates";
import { postgresReachable } from "./db";
import { createRoom, joinRoom, roomFor } from "./duels";
import { ApiError } from "./errors";
import { createSoloGame, finishGame, getGame, openDailyGame, saveMoves } from "./games";
import { moveClock, seedDailyResult, seedFinishedGame, seedGame, seedPlayers } from "./grading";
import { announceResult, forgetBoardsOf, leaderboardFor } from "./leaderboard";
import { mailReachable } from "./mail";
import { profileOf } from "./profile";
import { valkeyReachable } from "./valkey";

export interface Call {
  body: Record<string, unknown>;
  params: string[];
  query: URLSearchParams;
  /** The origin the request came from, used for the links in mail. */
  origin: string;
  sessionToken: string | null;
}

export interface Reply {
  status: number;
  body?: unknown;
  /** A new session token to set as the cookie, or null to clear it. */
  session?: string | null;
}

/** A route is open, or needs a signed-in player (verified or not) and then receives that player. */
type Route = { method: string; pattern: RegExp } & (
  | { access: "open"; run: (call: Call) => Promise<Reply> }
  | { access: "player" | "verified"; run: (call: Call, player: Player) => Promise<Reply> }
);

const HEALTH_PROBE_MS = 1500;

const within = (probe: Promise<boolean>): Promise<boolean> =>
  Promise.race([probe, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), HEALTH_PROBE_MS))]);

async function health(): Promise<Reply> {
  const [postgres, valkey, mailpit] = await Promise.all([within(postgresReachable()), within(valkeyReachable()), within(mailReachable())]);
  const down = [postgres ? null : "postgres", valkey ? null : "valkey", mailpit ? null : "mailpit"].filter((name) => name !== null);
  return { status: 200, body: down.length === 0 ? { status: "ok" } : { status: "degraded", down } };
}

const pattern = (path: string): RegExp => new RegExp(`^${path}$`);

const open = (method: string, path: string, run: (call: Call) => Promise<Reply>): Route => ({ method, pattern: pattern(path), access: "open", run });

const signedIn = (method: string, path: string, run: (call: Call, player: Player) => Promise<Reply>): Route => ({
  method,
  pattern: pattern(path),
  access: "player",
  run,
});

const verified = (method: string, path: string, run: (call: Call, player: Player) => Promise<Reply>): Route => ({
  method,
  pattern: pattern(path),
  access: "verified",
  run,
});

const ok = (body: unknown, status = 200): Reply => ({ status, body });

const ROUTES: Route[] = [
  open("GET", "/api/health", () => health()),
  open("POST", "/api/auth/signup", async (call) => {
    const { player, session, verificationSent } = await signUp(call.body, call.origin);
    return { status: 201, body: { player, verification_sent: verificationSent }, session };
  }),
  open("POST", "/api/auth/signin", async (call) => {
    const { player, session } = await signIn(call.body);
    return { status: 200, body: { player }, session };
  }),
  open("POST", "/api/auth/signout", async (call) => {
    if (call.sessionToken) await endSession(call.sessionToken);
    return { status: 204, session: null };
  }),
  signedIn("GET", "/api/me", async (_call, player) => ok({ player })),
  signedIn("POST", "/api/auth/verify/resend", async (call, player) => {
    await resendVerification(player, call.origin);
    return ok({ sent: true }, 202);
  }),
  open("POST", "/api/auth/verify", async (call) => {
    const { playerId, displayName } = await confirmEmail(call.body.token);
    await forgetBoardsOf(playerId);
    return ok({ player: { display_name: displayName, verified: true } });
  }),
  open("POST", "/api/auth/reset", async (call) => {
    await requestReset(call.body.email, call.origin);
    return ok({ sent: true }, 202);
  }),
  open("POST", "/api/auth/reset/confirm", async (call) => {
    const { player, session } = await confirmReset(call.body.token, call.body.password);
    return { status: 200, body: { player }, session };
  }),
  signedIn("POST", "/api/games", async (call, player) => ok({ game: await createSoloGame(player, call.body.level) }, 201)),
  signedIn("GET", "/api/games/([^/]+)", async (call, player) => ok({ game: await getGame(player, call.params[0] ?? "") })),
  signedIn("PUT", "/api/games/([^/]+)/moves", async (call, player) => ok({ game: await saveMoves(player, call.params[0] ?? "", call.body) })),
  signedIn("POST", "/api/games/([^/]+)/finish", async (call, player) => {
    const id = call.params[0] ?? "";
    const { result, counted, date } = await finishGame(player, id, call.body);
    if (counted && date && result.daily_state === "solved") await announceResult(player, date);
    return ok({ result });
  }),
  signedIn("GET", "/api/daily", async (call, player) => ok(await dailyMonth(player, call.query.get("month") ?? undefined))),
  signedIn("POST", "/api/daily/([^/]+)/game", async (call, player) => {
    const { game, created } = await openDailyGame(player, call.params[0]);
    return ok({ game }, created ? 201 : 200);
  }),
  signedIn("GET", "/api/leaderboard/([^/]+)", async (call) => {
    const date = call.params[0];
    if (!isDate(date)) throw new ApiError("VALIDATION", { fields: { date: "Use a date written yyyy-mm-dd." } });
    return ok(await leaderboardFor(date));
  }),
  signedIn("GET", "/api/profile", async (_call, player) => ok(await profileOf(player))),
  verified("POST", "/api/duels", async (call, player) => ok({ room: await createRoom(player, call.body.level) }, 201)),
  verified("POST", "/api/duels/join", async (call, player) => ok({ room: await joinRoom(player, call.body.code) })),
  verified("GET", "/api/duels/([^/]+)", async (call, player) => ok({ room: await roomFor(player, call.params[0] ?? "") })),
];

const GRADING_ROUTES: Route[] = [
  open("POST", "/api/grading/players", async (call) => ok(await seedPlayers(call.body), 201)),
  open("POST", "/api/grading/games", async (call) => ok(await seedGame(call.body), 201)),
  open("POST", "/api/grading/finished-games", async (call) => ok(await seedFinishedGame(call.body), 201)),
  open("POST", "/api/grading/daily-results", async (call) => ok(await seedDailyResult(call.body), 201)),
  open("POST", "/api/grading/clock", async (call) => ok(moveClock(call.body))),
];

export const routes: Route[] = config.gradingRoutes ? [...ROUTES, ...GRADING_ROUTES] : ROUTES;
