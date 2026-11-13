import * as accounts from "./accounts.js";
import { listAudit } from "./audit.js";
import * as ballots from "./ballots.js";
import * as entries from "./entries.js";
import type { ApiRequest, ApiResult } from "./http.js";
import * as programs from "./programs.js";
import * as publishing from "./publishing.js";
import * as rounds from "./rounds.js";
import * as screening from "./screening.js";

// Every endpoint in the brief's API tables, and nothing else.

type Handler = (req: ApiRequest) => Promise<ApiResult>;

const TABLE: [string, string, Handler][] = [
  ["POST", "/api/studios", accounts.createStudio],
  ["GET", "/api/studios", accounts.listStudios],
  ["POST", "/api/session", accounts.createSession],
  ["GET", "/api/session", accounts.getSession],
  ["DELETE", "/api/session", accounts.deleteSession],
  ["POST", "/api/jurors", accounts.createJuror],
  ["GET", "/api/jurors", accounts.listJurors],
  ["GET", "/api/programs", programs.listPrograms],
  ["POST", "/api/programs", programs.createProgram],
  ["PATCH", "/api/programs/:id", programs.updateProgram],
  ["POST", "/api/programs/:id/categories", programs.addCategory],
  ["GET", "/api/programs/:id/summary", programs.programSummary],
  ["POST", "/api/entries", entries.createEntry],
  ["GET", "/api/entries", entries.listEntries],
  ["GET", "/api/entries/:id", entries.getEntry],
  ["PATCH", "/api/entries/:id", entries.updateEntry],
  ["DELETE", "/api/entries/:id", entries.deleteEntry],
  ["POST", "/api/entries/:id/assets", entries.uploadAsset],
  ["DELETE", "/api/entries/:id/assets/:assetId", entries.removeAsset],
  ["POST", "/api/entries/:id/submit", entries.submitEntry],
  ["POST", "/api/entries/:id/withdraw", entries.withdrawEntry],
  ["GET", "/api/entries/:id/receipt", entries.getReceipt],
  ["GET", "/api/invoices/:invoiceId", entries.getInvoice],
  ["GET", "/api/assets/:assetId", entries.getAsset],
  ["GET", "/api/categories/:id/entries", screening.listCategoryEntries],
  ["POST", "/api/entries/:id/screen", screening.screenEntry],
  ["POST", "/api/entries/:id/reinstate", screening.reinstateEntry],
  ["GET", "/api/rounds/:id", rounds.getRound],
  ["POST", "/api/rounds/:id/jurors", rounds.addJuror],
  ["POST", "/api/rounds/:id/open", rounds.openRound],
  ["POST", "/api/rounds/:id/close", rounds.closeRound],
  ["POST", "/api/rounds/:id/confirm", rounds.confirmRound],
  ["GET", "/api/rounds/:id/standings", rounds.getStandings],
  ["POST", "/api/categories/:id/publish", publishing.publishCategory],
  ["GET", "/api/audit", listAudit],
  ["GET", "/api/juror/rounds", ballots.jurorRounds],
  ["GET", "/api/rounds/:id/ballot", ballots.getBallot],
  ["PUT", "/api/rounds/:id/scores/:entryId", ballots.saveScores],
  ["POST", "/api/rounds/:id/ballot/submit", ballots.submitBallot],
  ["POST", "/api/rounds/:id/entries/:entryId/recuse", ballots.recuse],
  ["POST", "/api/conflicts", ballots.declareConflict],
  ["GET", "/api/conflicts", ballots.listConflicts],
  ["GET", "/api/public/gallery", publishing.gallery],
  ["GET", "/api/public/leaderboard", publishing.leaderboard],
];

const ROUTES = TABLE.map(([method, pattern, handler]) => {
  const names: string[] = [];
  const source = pattern.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, regex: new RegExp(`^${source}$`), names, handler };
});

export const UPLOAD_ROUTE = /^\/api\/entries\/[^/]+\/assets$/;

export function match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    const found = route.method === method ? route.regex.exec(path) : null;
    if (found) {
      return { handler: route.handler, params: Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(found[i + 1] ?? "")])) };
    }
  }
  return null;
}
