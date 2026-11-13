import type { IncomingMessage } from "node:http";
import type { ClientConfig } from "../shared/protocol";
import * as accounts from "./accounts";
import type { Viewer } from "./auth";
import { clearedCookie, endSession } from "./auth";
import { BOARD_LENGTHS, boardRows, publicRow } from "./boards";
import { config } from "./config";
import { fail, json, noContent } from "./http";
import type { JsonBody, Reply } from "./http";
import { gradingNextText, gradingSetup } from "./grading";
import * as rooms from "./rooms";
import { readHistory, readRun, submitRun } from "./runs";
import { issueTicket } from "./tickets";

interface Context<Who extends Viewer | null> {
  readonly req: IncomingMessage;
  readonly url: URL;
  readonly params: readonly string[];
  readonly viewer: Who;
  readonly body: JsonBody | null;
}

/** A route anyone may call (the viewer is whoever has a session, if any), or the grading routes behind their key. */
interface PublicRoute {
  readonly method: string;
  readonly pattern: RegExp;
  readonly access: "open" | "grading";
  readonly handler: (context: Context<Viewer | null>) => Reply | Promise<Reply>;
}

export interface PrivateRoute {
  readonly method: string;
  readonly pattern: RegExp;
  readonly access: "signed-in" | "verified";
  /** The body is a keystroke log: a log that is too long is refused before anything else looks at it. */
  readonly carriesLog: boolean;
  readonly handler: (context: Context<Viewer>) => Reply | Promise<Reply>;
}

type Route = PublicRoute | PrivateRoute;

export function isPublic(route: Route): route is PublicRoute {
  return route.access === "open" || route.access === "grading";
}

const clientConfig: ClientConfig = {
  focusWarningMs: config.focusWarningMs,
  maxExtraLetters: config.maxExtraLetters,
  raceCountdownSeconds: config.raceCountdownSeconds,
  raceRejoinSeconds: config.raceRejoinSeconds,
};

const EMPTY = Buffer.alloc(0);
const CODE = "([^/]+)";

function open(method: string, path: string, handler: PublicRoute["handler"]): PublicRoute {
  return { method, pattern: new RegExp(`^${path}$`), access: "open", handler };
}

function signedIn(method: string, path: string, handler: PrivateRoute["handler"], access: PrivateRoute["access"] = "signed-in", carriesLog = false): PrivateRoute {
  return { method, pattern: new RegExp(`^${path}$`), access, carriesLog, handler };
}

function grading(path: string, handler: PublicRoute["handler"]): PublicRoute {
  return { method: "POST", pattern: new RegExp(`^${path}$`), access: "grading", handler };
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

export const routes: readonly Route[] = [
  open("GET", "/api/config", () => json(200, clientConfig)),
  open("POST", "/api/signup", (c) => accounts.signUp(c.body?.value)),
  open("POST", "/api/verify", (c) => accounts.verifyEmail(c.body?.value)),
  open("POST", "/api/session", (c) => accounts.signIn(c.body?.value)),
  open("DELETE", "/api/session", async (c) => {
    if (c.viewer) await endSession(c.viewer.sessionHash);
    return { ...noContent, headers: { "Set-Cookie": clearedCookie } };
  }),
  signedIn("GET", "/api/me", (c) => accounts.me(c.viewer)),
  open("POST", "/api/password-reset", (c) => accounts.requestReset(c.body?.value)),
  open("POST", "/api/password-reset/confirm", (c) => accounts.confirmReset(c.body?.value)),
  signedIn("GET", "/api/settings", (c) => accounts.readSettings(c.viewer)),
  signedIn("PUT", "/api/settings", (c) => accounts.writeSettings(c.viewer, c.body?.value)),
  open("POST", "/api/tickets", (c) => issueTicket(c.body?.value, c.viewer)),
  signedIn("POST", "/api/runs", (c) => submitRun(c.viewer, c.body?.raw ?? EMPTY, c.body?.value), "verified", true),
  signedIn("GET", `/api/runs/${CODE}`, (c) => readRun(c.viewer, c.params[0] ?? "")),
  signedIn("GET", "/api/history", (c) =>
    readHistory(c.viewer, {
      mode: oneOf(c.url.searchParams.get("mode"), ["time", "words", "quote", "custom"]),
      length: c.url.searchParams.get("length"),
      verdict: oneOf(c.url.searchParams.get("verdict"), ["counted", "not_counted"]),
      page: Math.max(1, Math.floor(Number(c.url.searchParams.get("page"))) || 1),
    }),
  ),
  signedIn("GET", "/api/account", (c) => accounts.accountOf(c.viewer)),
  open("GET", "/api/boards", async (c) => {
    const board = oneOf(c.url.searchParams.get("board"), ["daily", "alltime"]);
    const length = BOARD_LENGTHS.find((candidate) => String(candidate) === c.url.searchParams.get("length"));
    if (!board || length === undefined) return fail(422, "invalid_board");
    return json(200, { rows: (await boardRows(board, length)).map(publicRow) });
  }),
  signedIn("POST", "/api/rooms", (c) => json(201, { code: rooms.createRoom(c.viewer) })),
  signedIn("GET", `/api/rooms/${CODE}`, (c) => rooms.readRoom(c.viewer, c.params[0] ?? "")),
  signedIn("POST", `/api/rooms/${CODE}/join`, (c) => rooms.joinRoom(c.viewer, c.params[0] ?? "")),
  signedIn("POST", `/api/rooms/${CODE}/start`, (c) => rooms.startRace(c.viewer, c.params[0] ?? "")),
  signedIn("POST", `/api/rooms/${CODE}/finish`, (c) => rooms.finishRace(c.viewer, c.params[0] ?? "", c.body?.raw ?? EMPTY, c.body?.value), "signed-in", true),
  grading("/api/grading/setup", (c) => gradingSetup(c.body?.value)),
  grading("/api/grading/next-text", (c) => gradingNextText(c.body?.value)),
];
