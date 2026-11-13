import type { App } from "../app.js";
import { errors } from "../http/errors.js";
import { row } from "../db.js";
import { newId } from "../db.js";
import { projectUser, userByEmail, createSession, sessionCookie, clearedSessionCookie, destroySession, type UserRow } from "../http/session.js";
import { hashPassword, formatStoredHash, verifyPassword, parseStoredHash } from "../domain/passwords.js";
import { rows } from "../db.js";

export function registerAccountRoutes(app: App): void {
  app.post("/api/studios", "public", async (ctx) => {
    const body = ctx.body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const studioName = typeof body.studioName === "string" ? body.studioName.trim() : "";
    const contactName = typeof body.contactName === "string" ? body.contactName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (studioName.length < 2 || studioName.length > 80) {
      fields.studioName = "Studio names are 2 to 80 characters.";
    }
    if (contactName.length < 2 || contactName.length > 80) {
      fields.contactName = "Contact names are 2 to 80 characters.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.email = "Enter a valid email address.";
    }
    if (password.length < 10) {
      fields.password = "Passwords are at least 10 characters.";
    }
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    const existingEmail = await userByEmail(app.db, email);
    if (existingEmail) {
      throw errors.emailTaken();
    }
    const existingName = await row<{ id: string }>(app.db, "SELECT id FROM studios WHERE lower(name) = lower($1)", [studioName]);
    if (existingName) {
      throw errors.studioNameTaken();
    }
    const studioId = newId("stu");
    const userId = newId("usr");
    await app.db.transaction(async (client) => {
      await client.query("INSERT INTO studios (id, name, contact_name, email) VALUES ($1, $2, $3, $4)", [studioId, studioName, contactName, email]);
      await client.query(
        "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'studio', $2, $3, $4, $5)",
        [userId, contactName, email, formatStoredHash(hashPassword(password)), studioId],
      );
    });
    const user = (await row<Pick<UserRow, "id" | "role" | "name" | "email" | "studio_id">>(app.db, "SELECT id, role, name, email, studio_id FROM users WHERE id = $1", [userId]))!;
    const token = await createSession(app.db, userId);
    ctx.res.setHeader("Set-Cookie", sessionCookie(token));
    return { status: 201, body: { user: projectUser(user, studioName) } };
  });

  app.post("/api/session", "public", async (ctx) => {
    const body = ctx.body as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = await userByEmail(app.db, email);
    if (!user || !verifyPassword(password, parseStoredHash(user.password_hash))) {
      throw errors.invalidCredentials();
    }
    const token = await createSession(app.db, user.id);
    const studio = user.studio_id ? await row<{ name: string }>(app.db, "SELECT name FROM studios WHERE id = $1", [user.studio_id]) : null;
    ctx.res.setHeader("Set-Cookie", sessionCookie(token));
    return { status: 200, body: { user: projectUser(user, studio?.name ?? null) } };
  });

  app.get("/api/session", "signedIn", async (ctx) => {
    const user = (await row<Pick<UserRow, "id" | "role" | "name" | "email" | "studio_id">>(app.db, "SELECT id, role, name, email, studio_id FROM users WHERE id = $1", [ctx.auth!.userId]))!;
    const studio = user.studio_id ? await row<{ name: string }>(app.db, "SELECT name FROM studios WHERE id = $1", [user.studio_id]) : null;
    return { body: { user: projectUser(user, studio?.name ?? null) } };
  });

  app.delete("/api/session", "signedIn", async (ctx) => {
    const token = app.sessionToken(ctx.req);
    if (token) {
      await destroySession(app.db, token);
    }
    ctx.res.setHeader("Set-Cookie", clearedSessionCookie());
    return { status: 204, body: null };
  });

  app.get("/api/studios", "directorOrJuror", async () => {
    const studios = await rows<{ id: string; name: string }>(app.db, "SELECT id, name FROM studios ORDER BY name ASC");
    return { body: { studios } };
  });

  app.post("/api/jurors", "director", async (ctx) => {
    const body = ctx.body as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const studioId = typeof body.studioId === "string" && body.studioId.length > 0 ? body.studioId : null;
    if (name.length < 2 || name.length > 80) {
      fields.name = "Juror names are 2 to 80 characters.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.email = "Enter a valid email address.";
    }
    if (password.length < 10) {
      fields.password = "Passwords are at least 10 characters.";
    }
    let studio: { id: string; name: string } | null = null;
    if (studioId !== null) {
      studio = await row<{ id: string; name: string }>(app.db, "SELECT id, name FROM studios WHERE id = $1", [studioId]);
      if (!studio) {
        fields.studioId = "Choose an existing studio.";
      }
    }
    if (Object.keys(fields).length > 0) {
      throw errors.validation(fields);
    }
    const existing = await userByEmail(app.db, email);
    if (existing) {
      throw errors.emailTaken();
    }
    const id = newId("usr");
    await app.db.query(
      "INSERT INTO users (id, role, name, email, password_hash, studio_id) VALUES ($1, 'juror', $2, $3, $4, $5)",
      [id, name, email, formatStoredHash(hashPassword(password)), studioId],
    );
    await app.audit(ctx.auth!.userId, "juror.create", "juror", id, name);
    return { status: 201, body: { juror: { id, name, email, studioId } } };
  });

  app.get("/api/jurors", "director", async () => {
    const jurors = await rows<{ id: string; name: string; email: string; studio_id: string | null }>(app.db, "SELECT id, name, email, studio_id FROM users WHERE role = 'juror' ORDER BY name ASC");
    return { body: { jurors: jurors.map((j) => ({ id: j.id, name: j.name, email: j.email, studioId: j.studio_id })) } };
  });
}
