import type { IncomingMessage } from "node:http";
import { Db, newId } from "./db.js";
import { Router, type Handler, type RoleGuard } from "./http/router.js";
import { readConfig, type Config } from "./config.js";
import { KillBillClient } from "./providers/killbill.js";
import { Storage } from "./providers/storage.js";
import { Mailer } from "./providers/smtp.js";
import { sessionTokenFromCookie, authForSession } from "./http/session.js";
import type { Auth } from "./http/router.js";

export interface HandlerResult {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Buffer;
  contentType?: string;
}

export class App {
  readonly config: Config;
  readonly db: Db;
  readonly storage: Storage;
  readonly killbill: KillBillClient;
  readonly mailer: Mailer;
  readonly router = new Router();

  constructor(config: Config) {
    this.config = config;
    this.db = new Db(config.databaseUrl);
    this.storage = new Storage(config.s3);
    this.killbill = new KillBillClient(config.killbill);
    this.mailer = new Mailer(config.smtp);
  }

  static fromEnv(): App {
    return new App(readConfig());
  }

  add(method: string, pattern: string, roles: RoleGuard, handler: Handler): void {
    this.router.add(method, pattern, roles, handler);
  }

  get(pattern: string, roles: RoleGuard, handler: Handler): void {
    this.add("GET", pattern, roles, handler);
  }

  post(pattern: string, roles: RoleGuard, handler: Handler): void {
    this.add("POST", pattern, roles, handler);
  }

  put(pattern: string, roles: RoleGuard, handler: Handler): void {
    this.add("PUT", pattern, roles, handler);
  }

  patch(pattern: string, roles: RoleGuard, handler: Handler): void {
    this.add("PATCH", pattern, roles, handler);
  }

  delete(pattern: string, roles: RoleGuard, handler: Handler): void {
    this.add("DELETE", pattern, roles, handler);
  }

  sessionToken(req: IncomingMessage): string | null {
    return sessionTokenFromCookie(req.headers.cookie);
  }

  async auth(req: IncomingMessage): Promise<Auth | null> {
    const token = this.sessionToken(req);
    if (!token) {
      return null;
    }
    return authForSession(this.db, token);
  }

  async audit(directorId: string, action: string, targetType: string, targetId: string, detail = ""): Promise<void> {
    await this.db.query(
      "INSERT INTO audit_events (id, director_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5, $6)",
      [newId("aud"), directorId, action, targetType, targetId, detail],
    );
  }

  async categoryEmbargoPassed(categoryId: string): Promise<boolean> {
    const category = await this.db.one<{ embargo_at: Date | null; published_at: Date | null }>(
      "SELECT embargo_at, published_at FROM categories WHERE id = $1",
      [categoryId],
    );
    if (!category?.published_at || !category.embargo_at) {
      return false;
    }
    return new Date(category.embargo_at).getTime() <= Date.now();
  }
}
