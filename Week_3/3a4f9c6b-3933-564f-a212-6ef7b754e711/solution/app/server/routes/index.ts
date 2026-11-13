// Every API route; anything else under /api answers 404.
import type { Ctx, Reply } from "../http.js";
import { agentReport, approvalLink } from "./agent.js";
import { ingestBundle, listBundles, readGraph, readStatus } from "./project.js";
import { act, downloadEvidence, readPromotion } from "./promotions.js";
import { createSession, deleteSession, listProjects, readSession } from "./session.js";
import { editDefaults, listPromotions, promote, readStageHealth, rollBack, windowDecision } from "./stages.js";
import { addWindow, deleteWindow, listClusters, listOpenings, readFreezePolicy, scheduleFreezeVersion } from "./windows.js";

type Handler = (ctx: Ctx, params: string[]) => Promise<Reply>;

const SEGMENT = "([^/]+)";
const PROJECT = `/api/projects/${SEGMENT}`;
const STAGE = `${PROJECT}/stages/${SEGMENT}`;
const CLUSTER = `${PROJECT}/clusters/${SEGMENT}`;
const PROMOTION = `/api/promotions/${SEGMENT}`;

const ROUTES: [string, string, Handler][] = [
  ["POST", "/api/session", createSession],
  ["GET", "/api/session", readSession],
  ["DELETE", "/api/session", deleteSession],
  ["GET", "/api/projects", listProjects],
  ["GET", "/api/status", readStatus],
  ["GET", `${PROJECT}/graph`, readGraph],
  ["GET", `${PROJECT}/bundles`, listBundles],
  ["POST", `${PROJECT}/bundles`, ingestBundle],
  ["PATCH", STAGE, editDefaults],
  ["POST", `${STAGE}/promotions`, promote],
  ["POST", `${STAGE}/rollback`, rollBack],
  ["GET", `${STAGE}/health`, readStageHealth],
  ["GET", `${STAGE}/window-decision`, windowDecision],
  ["GET", `${PROJECT}/promotions`, listPromotions],
  ["GET", PROMOTION, readPromotion],
  ["POST", `${PROMOTION}/(approve|reject|start|retry-window|break-freeze)`, act],
  ["GET", `${PROMOTION}/evidence`, downloadEvidence],
  ["GET", `${PROJECT}/clusters`, listClusters],
  ["POST", `${CLUSTER}/windows`, addWindow],
  ["DELETE", `${CLUSTER}/windows/${SEGMENT}`, deleteWindow],
  ["GET", `${CLUSTER}/window-openings`, listOpenings],
  ["GET", `${PROJECT}/freeze-policy`, readFreezePolicy],
  ["POST", `${PROJECT}/freeze-policy/versions`, scheduleFreezeVersion],
  ["POST", "/api/agent/reports", agentReport],
  ["GET", `/api/approval-links/${SEGMENT}`, approvalLink],
];

const COMPILED = ROUTES.map(([method, pattern, handler]) => ({ method, pattern: new RegExp(`^${pattern}$`), handler }));

export function route(method: string, path: string): { handler: Handler; params: string[] } | null {
  for (const r of COMPILED) {
    const match = r.method === method ? r.pattern.exec(path) : null;
    if (match) return { handler: r.handler, params: match.slice(1).map((p) => decodeURIComponent(p)) };
  }
  return null;
}
