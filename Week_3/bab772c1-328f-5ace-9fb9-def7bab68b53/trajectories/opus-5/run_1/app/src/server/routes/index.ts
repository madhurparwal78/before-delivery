/** The request dispatcher: one error builder, one precedence order, one origin. */

import { pages } from "../../shared/copy.js";
import { isPlanId } from "../../shared/plans.js";
import type { JsonValue } from "../../shared/canonical.js";
import {
  ApiError,
  billingUnavailable,
  DependencyDown,
  internalError,
  notFound,
  rendererUnavailable,
  searchUnavailable,
  storageUnavailable,
  validation,
  webhooksUnavailable,
} from "../errors.js";
import {
  isShareRoute,
  readJsonBody,
  sendError,
  sendHtml,
  sendJson,
  type Context,
} from "../http/context.js";
import { appShell, fixedPage } from "../html.js";
import { isAssetPath, serveAsset } from "../assets.js";
import { pool } from "../db/pool.js";
import { findMissionRow } from "../domain/missionRead.js";
import { changePlan, readPlan } from "../domain/plan.js";
import { probeStorage } from "../services/storage.js";
import { probeSearch } from "../services/search.js";
import { probeQueue } from "../services/broker.js";
import { probeCache } from "../services/cache.js";
import { probeBilling } from "../services/billing.js";
import { probeWebhooks } from "../services/webhooks.js";
import { missionApi, missionsCollection } from "./missionApi.js";
import { passApi } from "./passApi.js";
import { shareApi, sharePage } from "./shareApi.js";
import { isObject } from "./validate.js";
import { methods } from "./common.js";

function mapDependency(error: DependencyDown): ApiError {
  switch (error.service) {
    case "storage":
      return storageUnavailable();
    case "search":
      return searchUnavailable();
    case "renderer":
      return rendererUnavailable();
    case "billing":
      return billingUnavailable();
    case "webhooks":
      return webhooksUnavailable();
    default:
      return internalError();
  }
}

export async function handleRequest(context: Context): Promise<void> {
  try {
    await dispatch(context);
  } catch (error) {
    if (context.response.headersSent) {
      context.response.end();
      return;
    }
    const api = error instanceof ApiError ? error : null;
    const dependency = error instanceof DependencyDown ? mapDependency(error) : null;
    const answer = api ?? dependency ?? internalError();
    if (!api && !dependency) {
      process.stderr.write(`unexpected failure: ${String(error)}\n`);
    }
    if (context.path.startsWith("/api/") || context.path === "/api" || isShareRoute(context)) {
      sendError(context, answer);
      return;
    }
    sendHtml(context, answer.status === 404 ? 404 : answer.status, fixedPage(
      pages.notFound.heading,
      pages.notFound.line,
    ));
  }
}

async function dispatch(context: Context): Promise<void> {
  const [first, ...rest] = context.segments;
  if (first === "api") {
    await apiRoutes(context, rest);
    return;
  }
  if (first === "s") {
    await sharePage(context, rest);
    return;
  }
  if (isAssetPath(context.path)) {
    await serveAsset(context);
    return;
  }
  if (context.segments.length === 0) {
    sendHtml(context, 200, appShell({ title: "Missions \u00b7 Perilune Ledger", screen: "missions" }));
    return;
  }
  if (first === "missions" && rest.length === 1) {
    const mission = await findMissionRow(pool, rest[0]);
    if (!mission) {
      sendHtml(context, 404, fixedPage(pages.unknownMission.heading, pages.unknownMission.line));
      return;
    }
    sendHtml(
      context,
      200,
      appShell({
        title: `${mission.name} \u00b7 Perilune Ledger`,
        screen: "author",
        missionId: mission.id,
      }),
    );
    return;
  }
  sendHtml(context, 404, fixedPage(pages.notFound.heading, pages.notFound.line));
}

async function apiRoutes(context: Context, segments: string[]): Promise<void> {
  const [first, ...rest] = segments;
  if (first === "health" && rest.length === 0) {
    await methods(context, { GET: async (ctx) => sendJson(ctx, 200, { status: "ok" }) });
    return;
  }
  if (first === "status" && rest.length === 0) {
    await methods(context, { GET: statusHandler });
    return;
  }
  if (first === "plan" && rest.length === 0) {
    await methods(context, {
      GET: async (ctx) => sendJson(ctx, 200, await readPlan()),
      PUT: planHandler,
    });
    return;
  }
  if (first === "missions" && rest.length === 0) {
    await missionsCollection(context);
    return;
  }
  if (first === "missions" && rest.length >= 1) {
    await missionApi(context, rest[0], rest.slice(1));
    return;
  }
  if (first === "passes" && rest.length >= 1) {
    await passApi(context, rest[0], rest.slice(1));
    return;
  }
  if (first === "share" && rest.length >= 1) {
    await shareApi(context, rest[0], rest.slice(1));
    return;
  }
  throw notFound();
}

async function statusHandler(context: Context): Promise<void> {
  const [storage, search, queue, cache, billing, webhooks] = await Promise.all([
    probeStorage(),
    probeSearch(),
    probeQueue(),
    probeCache(),
    probeBilling(),
    probeWebhooks(),
  ]);
  const flag = (up: boolean): "up" | "down" => (up ? "up" : "down");
  sendJson(context, 200, {
    storage: flag(storage),
    search: flag(search),
    queue: flag(queue),
    cache: flag(cache),
    billing: flag(billing),
    webhooks: flag(webhooks),
  });
}

async function planHandler(context: Context): Promise<void> {
  const body: JsonValue | undefined = await readJsonBody(context, ["application/json"]);
  const fields = isObject(body) ? body : ({} as Record<string, JsonValue>);
  if (!isPlanId(fields.plan)) {
    throw validation({ plan: "Choose archive-free, archive-1 or archive-10-annual." });
  }
  sendJson(context, 200, await changePlan(fields.plan));
}
