import { createReadStream, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { authenticate } from "./auth.js";
import { config } from "./config.js";
import { migrate, nowSeconds, only, pool } from "./db.js";
import { makeApi, ApiError, errorReply, ok, refused, SEARCH_CAP, send, type ApiRoute, type Desk } from "./http.js";
import { accessRoutes } from "./api-access.js";
import { enquiryRoutes } from "./api-enquiries.js";
import { operatorRoutes, askByToken, bidEnded } from "./api-operators.js";
import { hireRoutes, quotePageByToken } from "./api-hires.js";
import { runRoutes, sheetByToken } from "./api-runs.js";
import { moneyRoutes } from "./api-money.js";
import { seatRoutes } from "./api-seats.js";
import { documentRoutes } from "./api-documents.js";
import { aftercareRoutes } from "./api-aftercare.js";
import { requireHire } from "./domain.js";
import { applySeed } from "./seed.js";
import { startWorkers } from "./workers.js";
import { fleetPage, homePage, notFoundPage, occasionPage, OCCASIONS, quotePage, signPage, termsPage } from "./pages/public.js";
import * as desk from "./pages/desk.js";
import { withPageIds } from "./pages/layout.js";
import { bidEndedPage, bidPrivatePage, endedPrivatePage, quotePrivatePage, runSheetPage } from "./pages/private.js";
import { readerLength } from "../shared/rules.js";
import { copyFor, languageOf, sheetCopy, type Language } from "../shared/strings.js";
import type { CustomerRow, HireRow } from "./records.js";

const routes: ApiRoute[] = [...accessRoutes, ...enquiryRoutes, ...operatorRoutes, ...hireRoutes, ...runRoutes, ...moneyRoutes, ...seatRoutes, ...documentRoutes, ...aftercareRoutes, ...publicSearchRoutes()];
const api = makeApi(routes, authenticate);

function publicSearchRoutes(): ApiRoute[] {
  return [{
    method: "GET", path: "/api/public/search", access: "public",
    run: async ({ query }) => {
      const q = (query.get("q") ?? "").trim();
      if (!q) throw refused("Enter something to search for.", "q");
      if (readerLength(q) > SEARCH_CAP) throw refused("Search text can be up to 200 characters.", "q");
      const needle = q.toLowerCase();
      const results = publicIndex().filter((page) => page.words.toLowerCase().includes(needle)).map(({ title, path, excerpt }) => ({ title, path, excerpt }));
      return ok({ results });
    },
  }];
}
const publicIndex = (): { title: string; path: string; excerpt: string; words: string }[] => [
  { title: "Coaches and minibuses with a driver", path: "/", excerpt: "One desk, one person, every detail checked.", words: "Coaches and minibuses with a driver arranged for you from Coventry partner operators papers checked drivers hours private page quote school weddings company festivals" },
  ...Object.entries(OCCASIONS).map(([key, o]) => ({ title: o.heading, path: `/occasions/${key}`, excerpt: o.panel, words: [o.heading, o.panel, o.arrange, o.tell, o.pay, o.early, o.who, o.change, "What we arrange", "What to tell us", "How payment works", "Questions"].join(" ") })),
  { title: "Our fleet", path: "/fleet", excerpt: "Seven sizes from 8 to 70 seats.", words: "Our fleet minibus coach lift seats bag units 8 12 16 31 49 56 70" },
  { title: "Terms", path: "/terms", excerpt: "Quotes, paying, waiting, cancelling and lost property.", words: "Terms quote paying deposit balance waiting comfort stops cancelling notice lost property complaints" },
];

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL("../", import.meta.url));
const TYPES: Record<string, string> = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const serveFile = (res: ServerResponse, root: string, relative: string, extra: Record<string, string> = {}): boolean => {
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const type = TYPES[extname(safe)];
  if (!type) return false;
  const path = join(root, safe);
  if (!path.startsWith(root)) return false;
  try {
    if (!statSync(path).isFile()) return false;
  } catch {
    return false;
  }
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...extra });
  createReadStream(path).pipe(res);
  return true;
};
const htmlReply = (res: ServerResponse, status: number, page: string): void => send(res, { status, raw: page, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const missing = (res: ServerResponse): void => htmlReply(res, 404, notFoundPage());

type DeskScreen = (d: Desk, url: URL) => Promise<string | null>;
const hireScreen = (build: (d: Desk, hire: HireRow, url: URL) => Promise<string>): ((d: Desk, url: URL, id: string) => Promise<string | null>) => async (d, url, id) => {
  try {
    return await build(d, await requireHire(pool, d.id, id), url);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
};
const deskScreens: Record<string, DeskScreen> = {
  "/enquiries": (d, url) => desk.enquiriesScreen(d, url.searchParams),
  "/operators": (d) => desk.operatorsScreen(d),
  "/payments": (d) => desk.paymentsScreen(d),
  "/diary": (d, url) => desk.diaryScreen(d, url.searchParams),
  "/documents": (d) => desk.documentsScreen(d),
  "/rates": (d) => desk.ratesScreen(d),
  "/customers": (d, url) => desk.customersScreen(d, url.searchParams),
  "/aftercare/complaints": (d) => desk.complaintsScreen(d),
  "/aftercare/lost-property": (d) => desk.lostScreen(d),
};
const deskHireScreens: [RegExp, ReturnType<typeof hireScreen>][] = [
  [/^\/enquiries\/([^/]+)$/, hireScreen((d, hire) => desk.enquiryScreen(d, hire))],
  [/^\/enquiries\/([^/]+)\/trip$/, hireScreen((d, hire) => desk.tripScreen(d, hire))],
  [/^\/enquiries\/([^/]+)\/bids$/, hireScreen((d, hire, url) => desk.bidsScreen(d, hire, url.searchParams))],
  [/^\/hires\/([^/]+)\/quote$/, hireScreen((d, hire) => desk.quoteScreen(d, hire))],
  [/^\/hires\/([^/]+)\/hours$/, hireScreen((d, hire, url) => desk.hoursScreen(d, hire, url.searchParams))],
  [/^\/hires\/([^/]+)\/seats$/, hireScreen((d, hire) => desk.seatsScreen(d, hire))],
  [/^\/hires\/([^/]+)\/changes$/, hireScreen((d, hire) => desk.changesScreen(d, hire))],
];
/** The return address the sign-in page will follow: a same-origin relative path only. */
const safeReturn = (value: string | null): string | null => (value && /^\/(?![/\\])/.test(value) && !value.includes("\\") ? value : null);

const page = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  if (req.method !== "GET" && req.method !== "HEAD") return missing(res);
  if (path === "/") return htmlReply(res, 200, homePage());
  const occasion = /^\/occasions\/(school|weddings|company|festivals)$/.exec(path);
  if (occasion) return htmlReply(res, 200, occasionPage(occasion[1]));
  if (path === "/fleet") return htmlReply(res, 200, fleetPage());
  if (path === "/terms") return htmlReply(res, 200, termsPage());
  if (path === "/quote") {
    const chosen = url.searchParams.get("occasion");
    res.writeHead(303, { Location: `/quote/route${chosen ? `?occasion=${encodeURIComponent(chosen)}` : ""}` });
    return void res.end();
  }
  const step = /^\/quote\/(route|when|details|thanks)$/.exec(path);
  if (step) return htmlReply(res, 200, quotePage(step[1]));
  if (path === "/sign-in") return htmlReply(res, 200, signPage("in", safeReturn(url.searchParams.get("return"))));
  if (path === "/sign-up") return htmlReply(res, 200, signPage("up", null));

  const quoteToken = /^\/q\/([^/]+)$/.exec(path);
  if (quoteToken) {
    const asked = languageOf(url.searchParams.get("lang"));
    const found = await quotePageByToken(pool, quoteToken[1]);
    if (found.hire) {
      const customer = await only<CustomerRow>(pool, "SELECT * FROM customers WHERE id=$1", [found.hire.customer_id]);
      return htmlReply(res, 200, await quotePrivatePage(found.hire, asked ?? (customer.language as Language)));
    }
    if (found.endedLanguage) {
      const language = asked ?? languageOf(found.endedLanguage) ?? "en";
      return htmlReply(res, 410, endedPrivatePage(language, copyFor(language).pageEnded));
    }
    return missing(res);
  }
  const bidToken = /^\/b\/([^/]+)$/.exec(path);
  if (bidToken) {
    const found = await askByToken(pool, bidToken[1]);
    if (!found) return missing(res);
    if (bidEnded(found.ask, found.hire, nowSeconds())) return htmlReply(res, 410, bidEndedPage());
    return htmlReply(res, 200, await bidPrivatePage(found.ask, found.hire));
  }
  const sheetToken = /^\/r\/([^/]+)$/.exec(path);
  if (sheetToken) {
    const found = await sheetByToken(pool, sheetToken[1]);
    if (!found) return missing(res);
    const language = url.searchParams.get("lang") === "pl" ? "pl" : "en";
    if (found.ended) return htmlReply(res, 410, endedPrivatePage(language, sheetCopy(language).pageEnded));
    return htmlReply(res, 200, await runSheetPage(found.run, language));
  }

  const screen = deskScreens[path];
  const hireMatch = deskHireScreens.map(([pattern, build]) => ({ found: pattern.exec(path), build })).find((m) => m.found);
  if (!screen && !hireMatch) return missing(res);
  const session = await authenticate(req);
  if (!session.desk) {
    res.writeHead(303, { Location: `/sign-in?return=${encodeURIComponent(path + url.search)}` });
    return void res.end();
  }
  const rendered = screen ? await screen(session.desk, url) : await hireMatch!.build(session.desk, url, decodeURIComponent(hireMatch!.found![1]));
  if (rendered === null) return missing(res);
  return htmlReply(res, 200, rendered);
};

const server = createServer((req, res) => {
  if (!URL.canParse(req.url ?? "/", "http://app.invalid")) return missing(res);
  const url = new URL(req.url ?? "/", "http://app.invalid");
  const fail = (error: unknown): void => {
    console.error(error);
    if (res.headersSent) res.end();
    else send(res, errorReply(new ApiError(500, "internal", "Something went wrong. Try again.")));
  };
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return void api(req, res, url).catch(fail);
  if (url.pathname.startsWith("/assets/js/client/") || url.pathname.startsWith("/assets/js/shared/")) {
    const extra: Record<string, string> = url.pathname.endsWith("/sw.js") ? { "Service-Worker-Allowed": "/r/" } : {};
    if (serveFile(res, CLIENT_DIR, url.pathname.slice("/assets/js/".length), extra)) return;
    return missing(res);
  }
  if (url.pathname.startsWith("/assets/")) {
    if (serveFile(res, PUBLIC_DIR, url.pathname.slice("/assets/".length))) return;
    return missing(res);
  }
  withPageIds(() => page(req, res, url)).catch((error) => {
    if (error instanceof ApiError && error.status === 422) return missing(res);
    fail(error);
  });
});

const boot = async (): Promise<void> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await migrate();
      await applySeed();
      break;
    } catch (error) {
      if (attempt > 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  startWorkers();
  server.listen(config.port, "0.0.0.0");
};
boot().catch((error) => {
  console.error(error);
  process.exit(1);
});
