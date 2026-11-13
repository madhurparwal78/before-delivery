import { Buffer } from "node:buffer";
import { Request, Response } from "express";
import { AppCtx } from "./ctx.js";
import { ERR as E, httpError, readBodyBytes } from "./http.js";
import { newId, newToken, hashPassword, verifyPassword, foldEmail, EMAIL_RE } from "./auth.js";
import { publicConfig } from "./config.js";
import { safeNext, graphemeLength, sendMail } from "./text.js";
import { checkRawGrammar } from "./grammar.js";


/** Per-request context resolved once: the session user and the visitor id. */
export interface ReqCtx {
  user: { id: string; email: string; displayName: string } | null;
  visitorId: string;
}

export class Api {
  constructor(readonly ctx: AppCtx) {}

  async reqCtx(req: Request, res: Response): Promise<ReqCtx> {
    const cookie = req.headers.cookie ?? "";
    const sid = /(?:^|;\s*)tw_session=([^;]+)/.exec(cookie)?.[1];
    let user: ReqCtx["user"] = null;
    if (sid) {
      const rows = await this.ctx.db.query(
        `select u.id, u.email, u.display_name from sessions s join users u on u.id = s.user_id where s.id = $1`,
        [sid]
      );
      const row = rows.rows[0];
      if (row) user = { id: row.id, email: row.email, displayName: row.display_name };
    }
    const vid = /(?:^|;\s*)tw_visitor=([^;]+)/.exec(cookie)?.[1];
    const visitorId = vid ?? newId("visitor");
    if (!vid) this.appendCookie(res, "tw_visitor", visitorId, 86_400);
    return { user, visitorId };
  }

  appendCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
    const prev = res.getHeader("set-cookie");
    const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
    res.setHeader("set-cookie", Array.isArray(prev) ? [...prev, cookie] : prev ? [String(prev), cookie] : cookie);
  }

  async readJson(req: Request, limit = 65536): Promise<{ body: unknown; raw: Buffer }> {
    const raw = await readBodyBytes(req, limit);
    if (raw.length === 0) return { body: {}, raw };
    // House rule H1: the number grammar is checked on the request text before the body is parsed.
    checkRawGrammar(raw);
    try {
      return { body: JSON.parse(raw.toString("utf8")), raw };
    } catch {
      throw E.invalid({});
    }
  }

  config(_req: Request, res: Response): void {
    res.json(publicConfig(this.ctx.config));
  }

  async health(_req: Request, res: Response): Promise<void> {
    if (!this.ctx.dbUp) { res.status(503).json({ status: "unavailable", database: "down" }); return; }
    const up = await this.ctx.checkStorage();
    if (!up) res.json({ status: "unavailable", storage: "down" });
    else res.json({ status: "ok" });
  }

  async signup(req: Request, res: Response): Promise<void> {
    const { body } = await this.readJson(req);
    const b = body as Record<string, unknown>;
    const email = typeof b.email === "string" ? b.email : "";
    const password = typeof b.password === "string" ? b.password : "";
    const displayName = typeof b.displayName === "string" ? b.displayName : "";
    const next = typeof b.next === "string" ? b.next : "/";
    const errors: Record<string, string> = {};
    if (!EMAIL_RE.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
    if (password.length < 10) errors.password = "Use at least 10 characters.";
    const dn = graphemeLength(displayName);
    if (dn < 1 || dn > 40) errors.displayName = "Use 1 to 40 characters.";
    if (Object.keys(errors).length > 0) throw E.invalid(errors);
    const folded = foldEmail(email);
    const exists = await this.ctx.db.query(`select 1 from users where email = $1`, [folded]);
    if (exists.rows.length > 0) throw httpError(409, "email_taken", "An account with this email already exists.");
    const id = newId("user");
    const token = newToken();
    const client = await this.ctx.db.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into users (id, email, password_hash, display_name, verified) values ($1,$2,$3,$4,false)`,
        [id, folded, hashPassword(password), displayName.normalize("NFC")]
      );
      await client.query(`insert into verify_tokens (token, user_id, next) values ($1,$2,$3)`, [token, id, next]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    try {
      await sendMail(this.ctx, email, "Confirm your Tinework account",
        `${this.ctx.config.publicUrl}/auth/verify?token=${encodeURIComponent(token)}&next=${encodeURIComponent(safeNext(next))}`);
    } catch {
      await this.ctx.db.query(`delete from users where id = $1`, [id]);
      throw httpError(503, "mail_unavailable", "We could not send the email right now. Try again in a minute.");
    }
    res.status(201).json({ status: "verification_sent" });
  }

  async verify(req: Request, res: Response): Promise<void> {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const next = typeof req.query.next === "string" ? req.query.next : "/";
    const rows = await this.ctx.db.query(`select * from verify_tokens where token = $1`, [token]);
    const row = rows.rows[0];
    const ttl = this.ctx.config.verifyTokenTtlSeconds * 1000;
    const expired = !row || row.used || Date.now() - new Date(row.created_at).getTime() >= ttl;
    if (expired) {
      res.redirect(303, "/signin?expired=1");
      return;
    }
    const sid = newToken();
    const client = await this.ctx.db.connect();
    try {
      await client.query("begin");
      await client.query(`update verify_tokens set used = true where token = $1`, [token]);
      await client.query(`update users set verified = true where id = $1`, [row.user_id]);
      await client.query(`insert into sessions (id, user_id) values ($1,$2)`, [sid, row.user_id]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    this.appendCookie(res, "tw_session", sid, 60 * 60 * 24 * 30);
    res.redirect(303, safeNext(next));
  }

  async signin(req: Request, res: Response): Promise<void> {
    const { body } = await this.readJson(req);
    const b = body as Record<string, unknown>;
    const email = typeof b.email === "string" ? b.email : "";
    const password = typeof b.password === "string" ? b.password : "";
    const next = typeof b.next === "string" ? b.next : undefined;
    const rows = await this.ctx.db.query(`select * from users where email = $1`, [foldEmail(email)]);
    const user = rows.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw httpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    if (!user.verified) throw httpError(403, "unverified", "Confirm your email first; we sent you a link.");
    const sid = newToken();
    await this.ctx.db.query(`insert into sessions (id, user_id) values ($1,$2)`, [sid, user.id]);
    this.appendCookie(res, "tw_session", sid, 60 * 60 * 24 * 30);
    res.json({ id: user.id, email: user.email, displayName: user.display_name, landing: next ? safeNext(next) : "/dashboard" });
  }

  async signout(req: Request, res: Response): Promise<void> {
    const cookie = req.headers.cookie ?? "";
    const sid = /(?:^|;\s*)tw_session=([^;]+)/.exec(cookie)?.[1];
    if (sid) await this.ctx.db.query(`delete from sessions where id = $1`, [sid]);
    this.appendCookie(res, "tw_session", "", 0);
    res.status(204).end();
  }

  async me(req: Request, res: Response): Promise<void> {
    const rc = await this.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    res.json({ id: rc.user.id, email: rc.user.email, displayName: rc.user.displayName });
  }
}
