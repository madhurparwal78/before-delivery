import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, type Config } from "./config.js";
import { Database, type EnquiryRecord } from "./database.js";
import { MailService } from "./mail-service.js";
import { BriefService } from "./brief-service.js";
import { parseContent } from "./content-shape.js";
import { checkEnquiry, isValidSubmissionId } from "./enquiry-checks.js";
import { homePageHtml } from "./pages/home.js";
import { caseStudyHtml, privacyHtml, notFoundHtml, briefUnavailableHtml } from "./pages/case-study.js";
import { isCategoryId, isProjectTypeId, type CategoryId, type Project } from "../domain/model.js";
import { randomBytes } from "node:crypto";

const BODY_LIMIT = 262_144;

interface ApiError {
  error: string;
  message?: string;
  fields?: Record<string, string>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, status: number, body: ApiError): void {
  sendJson(res, status, body);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface AppServices {
  config: Config;
  database: Database;
  mail: MailService;
  brief: BriefService;
}

export class App {
  private services: AppServices | null = null;

  async start(): Promise<void> {
    const config = readConfig();
    const database = new Database(config.databaseUrl);
    await database.connect((attempt) => {
      console.log(`Waiting for Postgres (attempt ${attempt})...`);
    });
    await database.setup();
    const mail = new MailService(config);
    const brief = new BriefService(config.gotenbergUrl);
    this.services = { config, database, mail, brief };
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        console.error("Unhandled request error", error);
        if (!res.headersSent) {
          sendHtml(res, 500, "<!DOCTYPE html><html lang=\"en\"><head><title>Error | Sollis Studio</title></head><body><h1>Server error</h1></body></html>");
        } else {
          res.end();
        }
      });
    });
    server.listen(config.port, "0.0.0.0", () => {
      console.log(`Sollis Studio Folio listening on port ${config.port}`);
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (path.startsWith("/api/")) {
      await this.handleApi(req, res, path, method);
      return;
    }

    if (path === "/briefs" || path.startsWith("/briefs/")) {
      await this.handleBrief(res, path);
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      sendHtml(res, 405, notFoundHtml("page"));
      return;
    }

    await this.handlePage(res, path, url);
  }

  private async handlePage(res: ServerResponse, path: string, url: URL): Promise<void> {
    if (path === "/" || path === "/index.html") {
      const content = await this.services!.database.loadContent();
      const query = this.parseHomeQuery(url);
      sendHtml(res, 200, homePageHtml(content, query));
      return;
    }
    if (path === "/privacy") {
      sendHtml(res, 200, privacyHtml());
      return;
    }
    if (path.startsWith("/work/")) {
      const slug = path.slice("/work/".length).replace(/\/+$/, "");
      const content = await this.services!.database.loadContent();
      const project = content.projects.find((p) => p.slug === slug);
      if (!project) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(notFoundHtml("project"));
        return;
      }
      const category = this.parseCategory(url);
      const sequence = this.buildSequence(content.projects, project, category);
      sendHtml(res, 200, caseStudyHtml(project, sequence));
      return;
    }
    if (path.startsWith("/css/") || path.startsWith("/js/") || path.startsWith("/fonts/")) {
      this.serveStatic(res, path);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(notFoundHtml("page"));
  }

  private parseHomeQuery(url: URL): { category: CategoryId | null; service: string | null; type: string | null } {
    const categoryValue = url.searchParams.get("category");
    const serviceValue = url.searchParams.get("service");
    const typeValue = url.searchParams.get("type");
    const services = ["brand-identity", "website-design", "digital-product-design"];
    return {
      category: categoryValue && isCategoryId(categoryValue) ? categoryValue : null,
      service: serviceValue && services.includes(serviceValue) ? serviceValue : null,
      type: typeValue && isProjectTypeId(typeValue) ? typeValue : null,
    };
  }

  private parseCategory(url: URL): CategoryId | null {
    const value = url.searchParams.get("category");
    return value && isCategoryId(value) ? value : null;
  }

  private buildSequence(projects: Project[], project: Project, category: CategoryId | null): { prev: Project | null; next: Project | null; category: CategoryId | null } {
    const list = category ? projects.filter((p) => p.category === category) : projects;
    const index = list.findIndex((p) => p.slug === project.slug);
    return {
      prev: index > 0 ? list[index - 1] : null,
      next: index >= 0 && index < list.length - 1 ? list[index + 1] : null,
      category,
    };
  }

  private serveStatic(res: ServerResponse, path: string): void {
    const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../public");
    const relative = normalize(path).replace(/^(\.\.[/\\])+/g, "");
    const filePath = join(publicDir, relative);
    if (!filePath.startsWith(publicDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(notFoundHtml("page"));
      return;
    }
    const data = readFileSync(filePath);
    const type = MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.byteLength, "Cache-Control": "public, max-age=3600" });
    res.end(data);
  }

  private async handleBrief(res: ServerResponse, path: string): Promise<void> {
    const match = /^\/briefs\/([0-9a-f]{32})\.pdf$/.exec(path);
    if (!match) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(notFoundHtml("page"));
      return;
    }
    const token = match[1];
    const enquiry = await this.services!.database.findEnquiryByToken(token);
    if (!enquiry) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(notFoundHtml("page"));
      return;
    }
    try {
      const pdf = await this.services!.brief.render(enquiry);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${enquiry.reference}-brief.pdf"`,
        "Content-Length": pdf.byteLength,
      });
      res.end(pdf);
    } catch {
      sendHtml(res, 503, briefUnavailableHtml(enquiry.reference));
    }
  }

  private async readBody(req: IncomingMessage): Promise<{ ok: boolean; body?: unknown; tooLarge?: boolean; badJson?: boolean }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).byteLength;
      if (size > BODY_LIMIT) {
        return { ok: false, tooLarge: true };
      }
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (raw.length === 0) {
      return { ok: false, badJson: true };
    }
    try {
      return { ok: true, body: JSON.parse(raw) };
    } catch {
      return { ok: false, badJson: true };
    }
  }

  private async handleApi(req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<void> {
    const { config, database, mail } = this.services!;

    if (path === "/api/health") {
      if (method !== "GET") {
        sendError(res, 405, { error: "method_not_allowed", message: "Method not allowed." });
        return;
      }
      const [dbOk, mailOk] = await Promise.all([
        database
          .query("SELECT 1")
          .then(() => true)
          .catch(() => false),
        mail.available(),
      ]);
      const gotenbergOk = await this.checkGotenberg();
      const status = dbOk && mailOk && gotenbergOk ? "ok" : "unavailable";
      sendJson(res, 200, { status });
      return;
    }

    if (path === "/api/enquiries") {
      if (method !== "POST") {
        sendError(res, 405, { error: "method_not_allowed", message: "Method not allowed." });
        return;
      }
      const body = await this.readBody(req);
      if (body.tooLarge) {
        sendError(res, 413, { error: "too_large", message: "The request body is too large." });
        return;
      }
      if (body.badJson || !body.ok || typeof body.body !== "object" || body.body === null) {
        sendError(res, 400, { error: "bad_request", message: "The request body must be JSON." });
        return;
      }
      const payload = body.body as Record<string, unknown>;
      const submissionId = payload["submission_id"];
      if (isValidSubmissionId(submissionId)) {
        const existing = await database.findEnquiryBySubmission(submissionId);
        if (existing) {
          sendJson(res, 200, {
            reference: existing.reference,
            brief_url: `/briefs/${existing.briefToken}.pdf`,
            mail: existing.mail,
          });
          return;
        }
      }
      const check = checkEnquiry({
        submission_id: submissionId,
        name: payload["name"],
        email: payload["email"],
        project_type: payload["project_type"],
        budget: payload["budget"],
        description: payload["description"],
      });
      if (Object.keys(check.errors).length > 0 || !isValidSubmissionId(submissionId)) {
        const fields: Record<string, string> = {};
        if (!isValidSubmissionId(submissionId)) {
          fields.submission_id = "Reload the page and try again.";
        }
        for (const [key, value] of Object.entries(check.errors)) {
          fields[key] = value as string;
        }
        sendError(res, 422, { error: "invalid", fields });
        return;
      }
      let stored: EnquiryRecord | null;
      try {
        stored = await this.storeEnquiryWithRetry(submissionId, check);
      } catch {
        sendError(res, 503, { error: "unavailable", message: "The enquiry could not be saved." });
        return;
      }
      if (stored === null) {
        const replayed = await database.findEnquiryBySubmission(submissionId);
        if (replayed) {
          sendJson(res, 200, { reference: replayed.reference, brief_url: `/briefs/${replayed.briefToken}.pdf`, mail: replayed.mail });
          return;
        }
        sendError(res, 503, { error: "unavailable", message: "The enquiry could not be saved." });
        return;
      }
      const outcome = await mail.send({
        reference: stored.reference,
        name: stored.name,
        email: stored.email,
        projectType: stored.project_type,
        budget: stored.budget,
        description: stored.description,
      });
      if (outcome.mail === "sent") {
        await database.query("UPDATE enquiries SET mail = 'sent' WHERE reference = $1", [stored.reference]);
      }
      const answered = { ...stored, mail: outcome.mail };
      sendJson(res, 201, { reference: answered.reference, brief_url: `/briefs/${answered.briefToken}.pdf`, mail: answered.mail });
      return;
    }

    if (path.startsWith("/api/grading/")) {
      const gradingKey = req.headers["x-grading-key"];
      if (!config.gradingKey || gradingKey !== config.gradingKey) {
        sendError(res, 404, { error: "not_found", message: "Not found." });
        return;
      }
      if (path === "/api/grading/content") {
        if (method === "PUT") {
          const body = await this.readBody(req);
          if (body.tooLarge) {
            sendError(res, 413, { error: "too_large", message: "The request body is too large." });
            return;
          }
          if (body.badJson || !body.ok) {
            sendError(res, 400, { error: "bad_request", message: "The request body must be JSON." });
            return;
          }
          const content = parseContent(body.body);
          if (!content) {
            sendError(res, 422, { error: "invalid", message: "The content does not match the published shape." });
            return;
          }
          const edition = await database.replaceContent(content);
          sendJson(res, 200, { edition });
          return;
        }
        if (method === "DELETE") {
          const edition = await database.restoreContent();
          sendJson(res, 200, { edition });
          return;
        }
        sendError(res, 405, { error: "method_not_allowed", message: "Method not allowed." });
        return;
      }
      if (path === "/api/grading/enquiries") {
        if (method !== "GET") {
          sendError(res, 405, { error: "method_not_allowed", message: "Method not allowed." });
          return;
        }
        const enquiries = await database.listEnquiries();
        sendJson(res, 200, { enquiries });
        return;
      }
      sendError(res, 404, { error: "not_found", message: "Not found." });
      return;
    }

    sendError(res, 404, { error: "not_found", message: "Not found." });
  }

  private async checkGotenberg(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(`${this.services!.config.gotenbergUrl}/health`, { signal: controller.signal });
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  private async storeEnquiryWithRetry(submissionId: string, check: ReturnType<typeof checkEnquiry>, attempts = 4): Promise<EnquiryRecord | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const stored = await this.storeEnquiry(submissionId, check);
        return stored;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (attempt < attempts - 1 && message.includes("duplicate key value")) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("storeEnquiry retry loop exited without result");
  }

  private async storeEnquiry(submissionId: string, check: ReturnType<typeof checkEnquiry>): Promise<EnquiryRecord | null> {
    const { database } = this.services!;
    return database.transaction(async (client) => {
      const existing = await client.query("SELECT reference, brief_token, mail FROM enquiries WHERE submission_id = $1", [submissionId]);
      if (existing.rows.length > 0) {
        return null;
      }
      const referenceResult = await client.query<{ reference: number }>(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 5) AS integer)), 0) + 1 AS reference FROM enquiries"
      );
      const reference = `SOL-${String(referenceResult.rows[0].reference).padStart(4, "0")}`;
      const briefToken = randomBytes(16).toString("hex");
      await client.query(
        `INSERT INTO enquiries (reference, submission_id, brief_token, name, email, project_type, budget, description, mail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'not_sent')`,
        [reference, submissionId, briefToken, check.name, check.email, check.project_type, check.budget, check.description]
      );
      return {
        reference,
        submissionId,
        briefToken,
        name: check.name,
        email: check.email,
        project_type: check.project_type,
        budget: check.budget,
        description: check.description,
        mail: "not_sent" as const,
      };
    });
  }
}

const app = new App();
void app.start();
