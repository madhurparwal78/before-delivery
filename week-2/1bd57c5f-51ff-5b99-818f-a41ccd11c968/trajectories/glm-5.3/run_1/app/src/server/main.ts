import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { ApiError, Errors, errorBody } from "./errors.js";
import { config } from "./config.js";
import { createDb, applySchema, withTransaction } from "./db/schema.js";
import { seed } from "./db/seed.js";
import { personForToken, SESSION_COOKIE, type Person } from "./context.js";
import { createSessionRouter } from "./routes/session.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createPeopleRouter } from "./routes/people.js";
import { createItemsRouter } from "./routes/items.js";
import { createCostsRouter } from "./routes/costs.js";
import { createSyncRouter } from "./routes/sync.js";
import { createEventsRouter } from "./routes/events.js";
import { startMail, startSummaries } from "./mailer.js";
import { asyncify } from "./routes/shared.js";

const JSON_LIMIT = 1_000_000;
const MULTIPART_LIMIT = 10_500_000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      person?: Person;
      sessionToken?: string | undefined;
      fileBuffer?: Buffer | undefined;
      formFields?: Record<string, string> | undefined;
    }
  }
}

const db = createDb(config.databaseUrl);

async function waitForPostgres(): Promise<void> {
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      await db.query("SELECT 1");
      return;
    } catch {
      if (Date.now() > deadline) {
        console.error("Postgres is unreachable after 60 seconds.");
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function boot(): Promise<void> {
  await waitForPostgres();
  for (let attempt = 0; ; attempt++) {
    try {
      await applySchema(db);
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await withTransaction(db, async (client) => {
    await seed(client);
  });
}

const app = express();
app.disable("x-powered-by");

// Same-origin boundary: state-changing requests with a foreign Origin are refused.
function originCheck(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin !== "" && !sameOrigin(origin)) {
      res.status(403).json(errorBody(Errors.crossOrigin()));
      return;
    }
  }
  next();
}

function sameOrigin(origin: string): boolean {
  const own = new URL(config.publicUrl);
  try {
    const parsed = new URL(origin);
    return parsed.host === own.host;
  } catch {
    return false;
  }
}

function sessionMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
      const cookieHeader = req.headers.cookie ?? "";
    const token = parseCookie(cookieHeader, SESSION_COOKIE);
    req.sessionToken = token;
    if (token !== undefined) {
      const person = await personForToken(db, token);
      if (person !== null) req.person = person;
    }
    next();
  };
}

function parseCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1));
    }
  }
  return undefined;
}

// Body limits: JSON bodies are capped at 1,000,000 bytes, multipart at
// 10,500,000 bytes. Larger bodies answer too_large; the parsers enforce the
// same caps for chunked requests and the error handler maps them.
app.use((req: Request, res: Response, next: NextFunction) => {
  const contentType = String(req.headers["content-type"] ?? "");
  const limit = contentType.includes("multipart/form-data") ? MULTIPART_LIMIT : JSON_LIMIT;
  const declaredLength = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    res.status(413).json(errorBody(Errors.tooLarge()));
    return;
  }
  next();
});

function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.person === undefined) {
    res.status(401).json(errorBody(Errors.unauthenticated()));
    return;
  }
  next();
}

function healthRoute(req: Request, res: Response): void {
  res.json({ status: "ok" });
}

function setupRoutes(): void {
  app.use(originCheck);
  app.use(sessionMiddleware());

  app.get("/api/health", healthRoute);

  const api = express.Router();
  api.use((req: Request, res: Response, next: NextFunction) => {
    // Session creation and health answer without a session cookie.
    if (req.path === "/health" || (req.path === "/session" && req.method === "POST")) {
      next();
      return;
    }
    requireSession(req, res, next);
  });
  api.use(express.json({ limit: `${JSON_LIMIT}b`, type: ["application/json", "text/plain"] }));

  api.use("/", asyncify(createSessionRouter(db)));
  api.use("/", asyncify(createJobsRouter(db)));
  api.use("/", asyncify(createPeopleRouter(db)));
  api.use("/", asyncify(createItemsRouter(db)));
  api.use("/", asyncify(createCostsRouter(db)));
  api.use("/", asyncify(createSyncRouter(db)));
  api.use("/", asyncify(createEventsRouter(db)));

  app.use("/api", api);
}

function setupMultipart(): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST" && req.method !== "PUT") {
      next();
      return;
    }
    const contentType = String(req.headers["content-type"] ?? "");
    if (!contentType.includes("multipart/form-data")) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const boundaryMatch = /boundary=(.+)$/.exec(contentType);
      const boundary = boundaryMatch !== null ? boundaryMatch[1].trim() : "";
      const parts = splitMultipart(raw, boundary);
      const fields: Record<string, string> = {};
      let fileBuffer: Buffer | undefined;
      for (const part of parts) {
        if (part.filename !== undefined && part.filename !== "") {
          fileBuffer = part.data;
        } else if (part.name !== undefined && part.filename === undefined) {
          fields[part.name] = part.data.toString("utf8");
        }
      }
      req.formFields = fields;
      if (fileBuffer !== undefined) req.fileBuffer = fileBuffer;
      next();
    });
  });
}

type MultipartPart = { name?: string | undefined; filename?: string | undefined; data: Buffer };

function splitMultipart(raw: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  if (boundary === "") return parts;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = raw.indexOf(delimiter);
  while (start !== -1) {
    const contentStart = start + delimiter.length;
    const next = raw.indexOf(delimiter, contentStart);
    if (next === -1) break;
    let section = raw.subarray(contentStart, next);
    // Trim the leading CRLF and the trailing CRLF before the delimiter.
    if (section[0] === 0x0d && section[1] === 0x0a) section = section.subarray(2);
    if (section[section.length - 2] === 0x0d && section[section.length - 1] === 0x0a) section = section.subarray(0, section.length - 2);
    const headerEnd = section.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = section.subarray(0, headerEnd).toString("utf8");
      const data = section.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const fileMatch = /filename="([^"]*)"/.exec(headerText);
      parts.push({
        name: nameMatch !== null ? nameMatch[1] : undefined,
        filename: fileMatch !== null ? fileMatch[1] : undefined,
        data,
      });
    }
    start = next;
  }
  return parts;
}

function setupStatic(): void {
  const publicDir = path.join(import.meta.dirname, "..", "public");
  const indexHtml = path.join(publicDir, "index.html");
  app.use(express.static(publicDir, { index: false, fallthrough: true }));
  app.get("*", (req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json(errorBody(Errors.notFound()));
      return;
    }
    // Only route-like paths answer the app shell; anything that looks like a
    // file outside the build output (run.json, sources, lockfiles) answers 404.
    if (/\.[^/]+$/.test(req.path)) {
      res.status(404).json(errorBody(Errors.notFound()));
      return;
    }
    if (existsSync(indexHtml)) {
      res.type("html").send(readFileSync(indexHtml, "utf8"));
      return;
    }
    res.status(404).send("Not found");
  });
}

function setupErrors(): void {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(errorBody(err));
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(422).json(errorBody(Errors.validation({ body: "That request could not be read." })));
      return;
    }
    if ((err as { status?: number; type?: string }).status === 413 || (err as { type?: string }).type === "entity.too.large") {
      res.status(413).json(errorBody(Errors.tooLarge()));
      return;
    }
    console.error(err);
    res.status(500).json({ error: "internal", message: "Something went wrong." });
  });
}

async function main(): Promise<void> {
  await boot();
  setupMultipart();
  setupRoutes();
  setupErrors();
  setupStatic();
  startMail(db);
  startSummaries(db);
  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Snaglight listening on ${config.port}`);
  });
}

void main();
