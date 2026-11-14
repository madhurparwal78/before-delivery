import { timingSafeEqual } from "node:crypto";
import { COLOURS, emptyLayout, isColour, isGridPosition, syncLayout, type Layout } from "../shared/layout.js";
import { createSession, findOrCreateUser, validDisplayName, validEmail, type User } from "./auth.js";
import { config } from "./config.js";
import { transaction } from "./db.js";
import { FIELD, fail, type Fields } from "./errors.js";
import { isWholeNumber } from "./guard.js";
import { json, parseJson, type Router } from "./http.js";
import { insertProject, loadProject, parseText } from "./project-store.js";
import { insertShare } from "./shares.js";
import { insertVersion, validVersionName } from "./versions.js";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function keyMatches(given: string | undefined): boolean {
  if (!config.gradingKey || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(config.gradingKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads a layout object, or returns null when its shape is wrong. */
function readLayout(value: unknown): Layout | null {
  if (value === undefined) return emptyLayout();
  if (!isObject(value)) return null;
  const layout = emptyLayout();
  const entities = value.entities ?? {};
  const groups = value.groups ?? {};
  if (!isObject(entities) || !isObject(groups)) return null;
  for (const [name, raw] of Object.entries(entities)) {
    if (!isObject(raw) || !isGridPosition(raw.x) || !isGridPosition(raw.y)) return null;
    const color = raw.color ?? COLOURS[0];
    if (!isColour(color)) return null;
    layout.entities[name] = { x: raw.x, y: raw.y, color };
  }
  for (const [name, raw] of Object.entries(groups)) {
    if (!isObject(raw) || !isColour(raw.color)) return null;
    layout.groups[name] = { color: raw.color };
  }
  return layout;
}

function syncedLayout(text: string, layout: Layout): Layout {
  const parse = parseText(text);
  return parse.errors.length ? layout : syncLayout(layout, parse.model);
}

export function registerGradingRoutes(router: Router): void {
  router.add("POST", "/api/grading/setup", async (ctx) => {
    if (!keyMatches(ctx.req.headers["x-grading-key"] as string | undefined)) throw fail.notFound();
    const body = parseJson(ctx.body);
    const fields: Fields = {};
    const users = list(body.users);
    const userRefs = new Set<string>();
    users.forEach((u, i) => {
      if (!isObject(u) || typeof u.ref !== "string" || !u.ref) fields[`users.${i}.ref`] = "Give each user a ref.";
      else userRefs.add(u.ref);
      if (!isObject(u) || !validEmail(u.email)) fields[`users.${i}.email`] = FIELD.email;
      if (!isObject(u) || !validDisplayName(u.displayName)) fields[`users.${i}.displayName`] = FIELD.displayName;
    });
    const projects = list(body.projects);
    projects.forEach((p, i) => {
      const at = `projects.${i}`;
      if (!isObject(p)) {
        fields[at] = "Send each project as an object.";
        return;
      }
      if (typeof p.ref !== "string" || !p.ref) fields[`${at}.ref`] = "Give each project a ref.";
      if (typeof p.owner !== "string" || !userRefs.has(p.owner)) fields[`${at}.owner`] = "Name a listed user ref.";
      if (typeof p.name !== "string" || p.name.trim().length < 1 || p.name.trim().length > 80) fields[`${at}.name`] = FIELD.projectName;
      if (p.text !== undefined && typeof p.text !== "string") fields[`${at}.text`] = FIELD.text;
      if (readLayout(p.layout) === null) fields[`${at}.layout`] = FIELD.layout;
      list(p.versions).forEach((v, j) => {
        if (!isObject(v) || !validVersionName(v.name)) fields[`${at}.versions.${j}.name`] = FIELD.versionName;
        else {
          if (v.text !== undefined && typeof v.text !== "string") fields[`${at}.versions.${j}.text`] = FIELD.text;
          if (v.layout !== undefined && readLayout(v.layout) === null) fields[`${at}.versions.${j}.layout`] = FIELD.layout;
        }
      });
      list(p.members).forEach((m, j) => {
        if (!isObject(m) || typeof m.user !== "string" || !userRefs.has(m.user) || m.user === p.owner)
          fields[`${at}.members.${j}.user`] = "Name a listed user ref.";
        if (!isObject(m) || (m.role !== "editor" && m.role !== "viewer")) fields[`${at}.members.${j}.role`] = FIELD.role;
      });
      list(p.shares).forEach((s, j) => {
        if (!isObject(s) || typeof s.ref !== "string" || !s.ref) fields[`${at}.shares.${j}.ref`] = "Give each share a ref.";
        if (!isObject(s) || (s.access !== "view" && s.access !== "edit")) fields[`${at}.shares.${j}.access`] = FIELD.access;
        if (
          isObject(s) &&
          s.expiresInSeconds !== undefined &&
          (!isWholeNumber(s.expiresInSeconds) || s.expiresInSeconds < 1 || s.expiresInSeconds > 31536000)
        ) {
          fields[`${at}.shares.${j}.expiresInSeconds`] = FIELD.expiresInSeconds;
        }
      });
    });
    if (Object.keys(fields).length) throw fail.invalid(fields);

    const result = await transaction(async (db) => {
      const userOut: Record<string, { id: string; session: string }> = {};
      const byRef = new Map<string, User>();
      for (const raw of users as Json[]) {
        const user = await findOrCreateUser(db, raw.email as string, raw.displayName as string);
        byRef.set(raw.ref as string, user);
        userOut[raw.ref as string] = { id: user.id, session: await createSession(db, user.id) };
      }
      const projectOut: Record<string, { id: string; revision: number; versions: number[] }> = {};
      const shareOut: Record<string, { id: string; token: string; url: string }> = {};
      for (const raw of projects as Json[]) {
        const owner = byRef.get(raw.owner as string)!;
        const text = (raw.text as string | undefined) ?? "";
        const id = await insertProject(db, owner, (raw.name as string).trim(), text, readLayout(raw.layout)!);
        const project = (await loadProject(db, id))!;
        const numbers: number[] = [];
        for (const v of list(raw.versions) as Json[]) {
          const versionText = (v.text as string | undefined) ?? project.text;
          const versionLayout = v.layout === undefined ? project.layout : syncedLayout(versionText, readLayout(v.layout)!);
          numbers.push((await insertVersion(db, project, (v.name as string).trim(), versionText, versionLayout, owner, null)).number);
        }
        for (const m of list(raw.members) as Json[]) {
          await db.query(
            `INSERT INTO members (project_id, user_id, role, joined_via, joined_at) VALUES ($1, $2, $3, NULL, $4)
             ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, removed_at = NULL`,
            [id, byRef.get(m.user as string)!.id, m.role, new Date()],
          );
        }
        for (const s of list(raw.shares) as Json[]) {
          const share = await insertShare(
            db,
            id,
            s.access as "view" | "edit",
            null,
            (s.expiresInSeconds as number | undefined) ?? config.shareTtlSeconds,
          );
          shareOut[s.ref as string] = { id: share.id, token: share.token, url: `/s/${share.token}` };
        }
        projectOut[raw.ref as string] = { id, revision: 1, versions: numbers };
      }
      return { users: userOut, projects: projectOut, shares: shareOut };
    });
    return json(201, result);
  });
}
