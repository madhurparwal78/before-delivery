import { timingSafeEqual } from "node:crypto";
import { copy } from "../../shared/copy";
import type { Account } from "../../shared/types";
import { startSession } from "../auth";
import { checkClassroomStates } from "../classroom-events";
import { serverNow, setServerTime } from "../clock";
import { config } from "../config";
import { sha256Hex } from "../digest";
import { databaseReady, first, pool } from "../db";
import { ApiError, validationError } from "../errors";
import type { Route } from "../http-types";
import { pingStorage } from "../s3";
import { seed } from "../seed";

const HEALTH_TIMEOUT_MS = 2000;
const HOME_ROUTES: Record<Account["kind"], string> = { educator: "/dashboard", personal: "/projects", student: "/class" };

/** Fails if the work has not finished within the time. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

const health: Route = {
  method: "GET",
  pattern: "/api/health",
  withoutSession: true,
  withoutDatabase: true,
  async handler() {
    const checks = [
      within(HEALTH_TIMEOUT_MS, databaseReady() ? pool.query("SELECT 1") : Promise.reject(new Error("database not ready"))),
      within(HEALTH_TIMEOUT_MS, pingStorage(HEALTH_TIMEOUT_MS)),
    ];
    const answered = (await Promise.allSettled(checks)).every((check) => check.status === "fulfilled");
    return { status: 200, body: { status: answered ? "ok" : "unavailable" } };
  },
};

const clientConfig: Route = {
  method: "GET",
  pattern: "/api/config",
  withoutSession: true,
  withoutDatabase: true,
  handler: () => ({ status: 200, body: config.client }),
};

function assertGradingToken(candidate: string | string[] | null | undefined): void {
  const digest = (value: string) => Buffer.from(sha256Hex(value));
  if (typeof candidate !== "string" || !timingSafeEqual(digest(candidate), digest(config.gradingToken))) throw new ApiError("forbidden");
}

const gradingSeed: Route = {
  method: "POST",
  pattern: "/api/grading/seed",
  withoutSession: true,
  async handler(req) {
    assertGradingToken(req.headers["x-grading-token"]);
    return { status: 200, body: await seed() };
  },
};

const gradingSession: Route = {
  method: "GET",
  pattern: "/api/grading/session",
  withoutSession: true,
  async handler(req) {
    assertGradingToken(req.query.get("token"));
    const account = await first<{ id: string; kind: Account["kind"] }>(pool, "SELECT id, kind FROM accounts WHERE id = $1", [req.query.get("user")]);
    if (!account) throw new ApiError("not_found");
    const cookie = await startSession(req, { accountId: account.id });
    return { status: 302, headers: { Location: HOME_ROUTES[account.kind], "Set-Cookie": cookie } };
  },
};

const gradingClock: Route = {
  method: "POST",
  pattern: "/api/grading/clock",
  withoutSession: true,
  async handler(req) {
    assertGradingToken(req.headers["x-grading-token"]);
    const { now } = req.jsonObject();
    const instant = typeof now === "string" ? new Date(now) : null;
    if (now !== null && (instant === null || Number.isNaN(instant.getTime()))) throw validationError({ now: copy.validation });
    setServerTime(instant);
    await checkClassroomStates(true);
    return { status: 200, body: { now: serverNow().toISOString() } };
  },
};

export const systemRoutes: Route[] = [health, clientConfig, gradingSeed, gradingSession, gradingClock];
