// Drop stories (brief: Business rules → Stories). The allowlist is decided here and nowhere else.
import { Parser } from "htmlparser2";
import { staleStart, tooLong } from "../shared/copy";
import { marketTime } from "../shared/format";
import { instantText } from "../shared/time";
import { type Member, requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, tx } from "./db";
import { staffDrop } from "./drops";
import { ApiError, type Json, reply, route, validationFailed } from "./http";

const KEPT = new Set(["p", "h2", "h3", "strong", "em", "ul", "ol", "li", "br", "a"]);
const DROPPED = new Set(["script", "style", "iframe"]);
const VOID = new Set(["br"]);
const SCHEMES = /^(https?:|mailto:)/i;

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string): string => escapeText(text).replace(/"/g, "&quot;");

/** Keeps only the published elements and http, https and mailto links; every other attribute goes. */
function allowlist(html: string): string {
  let out = "";
  let skipping = 0;
  const open: Array<string | null> = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (skipping || DROPPED.has(name)) {
          if (DROPPED.has(name)) skipping += 1;
          open.push(null);
          return;
        }
        if (!KEPT.has(name)) {
          open.push(null);
          return;
        }
        if (name === "a") {
          const href = (attrs.href ?? "").trim();
          if (!SCHEMES.test(href)) {
            open.push(null);
            return;
          }
          out += `<a href="${escapeAttr(href)}">`;
        } else out += `<${name}>`;
        open.push(VOID.has(name) ? null : name);
      },
      ontext(text) {
        if (!skipping) out += escapeText(text);
      },
      onclosetag(name) {
        const kept = open.pop();
        if (DROPPED.has(name) && skipping) skipping -= 1;
        if (kept) out += `</${kept}>`;
      },
    },
    { decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true },
  );
  parser.write(html);
  parser.end();
  return out;
}

interface StoryRow {
  html: string;
  version: number;
  saved_by: string | null;
  saved_at: Date | null;
  published_html: string | null;
  published_at: Date | null;
}

function storyJson(s: StoryRow): Json {
  return {
    html: s.html,
    version: s.version,
    savedBy: s.saved_by,
    savedAt: s.saved_at ? instantText(s.saved_at.getTime()) : null,
    publishedHtml: s.published_html,
    publishedAt: s.published_at ? instantText(s.published_at.getTime()) : null,
  };
}

async function storyOf(db: Db, dropId: string, lock = false): Promise<StoryRow> {
  const found = await one<StoryRow>(db, `SELECT html, version, saved_by, saved_at, published_html, published_at FROM stories WHERE drop_id = $1${lock ? " FOR UPDATE" : ""}`, [dropId]);
  return found ?? { html: "", version: 1, saved_by: null, saved_at: null, published_html: null, published_at: null };
}

/** 412 naming who saved the newer version, with the saved story. */
function stale(s: StoryRow, me: Member): ApiError {
  const at = s.saved_at ? s.saved_at.getTime() : Date.now();
  const by = s.saved_by ?? me.name;
  return new ApiError(412, "stale_version", staleStart(by, marketTime(at)), { savedBy: by, savedAt: instantText(at), current: storyJson(s) });
}

route("GET", "/api/drops/{dropId}/story", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  return reply(200, storyJson(await storyOf(pool, drop.id)));
});

route("PUT", "/api/drops/{dropId}/story", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "press_lead");
  const body = ctx.json();
  return tx(async (db) => {
    await db.query("INSERT INTO stories (drop_id, html, version) VALUES ($1, '', 1) ON CONFLICT DO NOTHING", [drop.id]);
    const current = await storyOf(db, drop.id, true);
    if (body.version !== current.version) throw stale(current, me);
    const html = typeof body.html === "string" ? body.html : "";
    if (html.length > 100_000) throw validationFailed({ html: tooLong(100_000) });
    await db.query("UPDATE stories SET html = $2, version = version + 1, saved_by = $3, saved_at = $4 WHERE drop_id = $1", [drop.id, allowlist(html), me.name, nowSeconds()]);
    return reply(200, storyJson(await storyOf(db, drop.id)));
  });
});

route("POST", "/api/drops/{dropId}/story/publish", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "press_lead");
  const body = ctx.json();
  return tx(async (db) => {
    const current = await storyOf(db, drop.id, true);
    if (body.version !== current.version) throw stale(current, me);
    await db.query("UPDATE stories SET published_html = html, published_at = $2 WHERE drop_id = $1", [drop.id, nowSeconds()]);
    return reply(200, storyJson(await storyOf(db, drop.id)));
  });
});
