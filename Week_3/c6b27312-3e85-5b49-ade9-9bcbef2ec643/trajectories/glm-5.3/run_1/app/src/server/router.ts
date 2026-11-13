import { Router, type Request, type Response } from "express";
import { Buffer } from "node:buffer";
import { AppCtx } from "./ctx.js";
import { Api } from "./api.js";
import { ERR as E, httpError, wrap, readBodyBytes } from "./http.js";
import { newId, foldEmail } from "./auth.js";
import { parseStored, buildManifest, buildTape, preflightReport } from "./domain.js";
import { evaluate } from "./evaluate.js";
import { canonicalJson, digestOf } from "../shared/canonical.js";
import { formatFixed } from "../shared/numbers.js";
import { CATEGORIES, PROCESSES, type Values } from "../shared/records.js";
import { STORAGE_OUTAGE_COPY } from "./http.js";
import { createRevision } from "./revisions.js";
import { eventStream, dropStreams } from "./events.js";
import { gradingSetup } from "./grading.js";
import { compareRevisions } from "./compare.js";
import { graphemeLength, sendMail } from "./text.js";
import { checkRawGrammar } from "./grammar.js";

import { tapeSteps } from "./tine.js";
import { thumbnailSvg } from "./thumbnail.js";
import { archiveZip, archiveTar } from "./archive.js";

interface WriteAnswer {
  status: number;
  body: unknown;
  location?: string;
  etag?: string;
}

export function apiRouter(ctx: AppCtx): Router {
  const r = Router();
  const api = new Api(ctx);
  const C = ctx.config;

  // ---------- helpers ----------

  const readJson = async (req: Request, limit = 65536): Promise<{ body: unknown; raw: Buffer }> => api.readJson(req, limit);

  async function part(slug: string): Promise<Record<string, unknown> | null> {
    const rows = await ctx.db.query(
      `select p.*, u.display_name as owner_name from parts p join users u on u.id = p.owner_id where p.slug = $1`, [slug]);
    return rows.rows[0] ?? null;
  }

  async function isReviewer(slug: string, userId: string): Promise<boolean> {
    const rows = await ctx.db.query(
      `select 1 from room_reviewers rr join rooms ro on ro.id = rr.room_id where ro.part_slug = $1 and rr.user_id = $2 limit 1`,
      [slug, userId]);
    return rows.rows.length > 0;
  }

  async function canReadPart(partRow: Record<string, unknown>, userId: string | null): Promise<boolean> {
    if (partRow.visibility === "public") return true;
    if (!userId) return false;
    if (partRow.owner_id === userId) return true;
    return isReviewer(partRow.slug as string, userId);
  }

  async function headId(slug: string): Promise<string | null> {
    const rows = await ctx.db.query(`select id from revisions where part_slug = $1 order by label desc limit 1`, [slug]);
    return rows.rows[0]?.id ?? null;
  }

  async function revisionRow(id: string): Promise<Record<string, unknown> | null> {
    const rows = await ctx.db.query(`select * from revisions where id = $1`, [id]);
    return rows.rows[0] ?? null;
  }

  function revisionJson(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      label: `r${row.label}`,
      partSlug: row.part_slug,
      parentRevisionId: row.parent_id,
      authorId: row.author_id,
      createdAt: (row.created_at as Date).toISOString(),
      values: row.values,
      sourceRef: row.source_key,
      evaluationId: row.evaluation_id,
      geometryDigest: row.geometry_digest,
      message: row.message,
      restoredFrom: row.restored_from,
      forkedFrom: row.forked_from,
    };
  }

  /** Read the part source from PostgreSQL. */
  async function partSource(sourceKey: string): Promise<string> {
    const rows = await ctx.db.query(`select bytes from sources where key = $1`, [sourceKey]);
    if (rows.rows[0]) return Buffer.from(rows.rows[0].bytes).toString("utf8");
    return (await ctx.s3.getObject(sourceKey)).toString("utf8");
  }

  // ---------- auth ----------

  r.get("/health", wrap(async (req, res) => api.health(req, res)));
  r.get("/config", (req, res) => api.config(req, res));
  r.post("/auth/signup", wrap(async (req, res) => api.signup(req, res)));
  r.post("/auth/signin", wrap(async (req, res) => api.signin(req, res)));
  r.post("/auth/signout", wrap(async (req, res) => api.signout(req, res)));
  r.get("/me", wrap(async (req, res) => api.me(req, res)));

  // ---------- gallery ----------

  r.get("/parts", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const sort = typeof req.query.sort === "string" ? req.query.sort : "featured";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
    if (!["featured", "liked", "newest", "name"].includes(sort)) throw E.invalid({ sort: "Start again from the first page." });
    const counts: Array<{ slug: string; name: string; count: number }> = [];
    for (const c of CATEGORIES) {
      const rows = await ctx.db.query(
        `select count(*)::int as n from parts where category = $1 and visibility = 'public' and slug <> 'hero-cable-clip'`, [c.slug]);
      counts.push({ slug: c.slug, name: c.name, count: rows.rows[0]!.n });
    }
    const total = counts.reduce((s, c) => s + c.count, 0);
    if (category && !CATEGORIES.some((c) => c.slug === category)) {
      throw E.invalid({ category: "Start again from the first page." });
    }
    let offset = 0;
    if (cursor) {
      if (!/^[0-9a-z]+$/.test(cursor)) throw E.invalid({ cursor: "Start again from the first page." });
      offset = parseInt(cursor, 36);
      if (!Number.isSafeInteger(offset)) throw E.invalid({ cursor: "Start again from the first page." });
    }
    const order = sort === "liked"
      ? `(select count(*) from likes l where l.part_slug = p.slug) desc, p.title asc, p.slug asc`
      : sort === "newest"
        ? "p.created_at desc, p.slug asc"
        : sort === "name"
          ? "p.title asc, p.slug asc"
          : "p.seed_position asc nulls last, p.created_at asc, p.slug asc";
    const params: unknown[] = [];
    let where = `p.visibility = 'public' and p.slug <> 'hero-cable-clip'`;
    if (category) { params.push(category); where += ` and p.category = $${params.length}`; }
    params.push(12, offset);
    const rows = await ctx.db.query(
      `select p.slug, p.title, p.category, u.display_name as owner_name, p.created_at,
        (select count(*)::int from likes l where l.part_slug = p.slug) as likes,
        ${rc.user ? `exists(select 1 from likes l where l.part_slug = p.slug and l.user_id = '${rc.user.id}')` : "false"} as liked,
        h.id as head_id, h.label as head_label, h.geometry_digest as head_digest, e.volume as head_volume, e.bbox as head_bbox
       from parts p
       join users u on u.id = p.owner_id
       join lateral (select * from revisions rr where rr.part_slug = p.slug order by label desc limit 1) h on true
       join lateral (select * from evaluations e where e.id = h.evaluation_id limit 1) e on true
       where ${where}
       order by ${order}
       limit $${params.length - 1} offset $${params.length}`,
      params
    );
    const parts = rows.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      category: row.category,
      author: { id: row.owner_name, displayName: row.owner_name },
      likes: row.likes,
      liked: row.liked,
      createdAt: row.created_at.toISOString(),
      head: { id: row.head_id, label: `r${row.head_label}`, geometryDigest: row.head_digest, volume: Number(row.head_volume), bbox: row.head_bbox },
    }));
    const nextCursor = rows.rows.length === 12 ? (offset + 12).toString(36) : null;
    res.json({ parts, nextCursor, categories: [{ slug: "", name: "All parts", count: total }, ...counts], total });
  }));

  // ---------- a part ----------

  r.get("/parts/:slug", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const revisionParam = typeof req.query.revision === "string" ? req.query.revision : undefined;
    let rev: Record<string, unknown> | null = null;
    const head = (await headId(p.slug as string))!;
    if (revisionParam) {
      rev = await revisionRow(revisionParam);
      if (!rev || rev.part_slug !== p.slug) throw E.notFound();
    } else {
      rev = await revisionRow(head);
    }
    if (!rev) throw E.notFound();
    const source = await partSource(rev.source_key as string);
    const parsed = parseStored(source);
    const manifest = buildManifest(parsed, rev.values as Values);
    let preflightLeft: number | null = null;
    if (!rc.user) {
      const key = ctx.prefix(`preflight:${rc.visitorId}`);
      const used = await ctx.redis.get(key);
      preflightLeft = Math.max(0, C.preflightSignedOutLimit - (used ? Number(used) : 0));
    }
    const etag = head;
    res.set("ETag", `"${etag}"`);
    res.json({
      slug: p.slug,
      title: p.title,
      category: p.category,
      visibility: p.visibility,
      owner: { id: p.owner_id, displayName: p.owner_name },
      likes: (await ctx.db.query(`select count(*)::int as n from likes where part_slug = $1`, [p.slug])).rows[0]!.n,
      liked: rc.user ? (await ctx.db.query(
        `select 1 from likes where part_slug = $1 and user_id = $2`, [p.slug, rc.user.id])).rows.length > 0 : false,
      headRevisionId: head,
      revision: revisionJson(rev),
      source,
      manifest,
      preflightLeft,
    });
  }));

  r.post("/parts", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const b = body as Record<string, unknown>;
    const title = typeof b.title === "string" ? b.title.normalize("NFC") : "";
    const category = typeof b.category === "string" ? b.category : "";
    const visibility = b.visibility === "private" ? "private" : "public";
    const source = typeof b.source === "string" ? b.source : "";
    const errors: Record<string, string> = {};
    const tl = graphemeLength(title);
    if (tl < 1 || tl > 80) errors.title = "Use 1 to 80 characters.";
    if (!CATEGORIES.some((c) => c.slug === category)) errors.category = "Choose a category.";
    if (Object.keys(errors).length > 0) throw E.invalid(errors);
    // Source validation with the published line reasons.
    const parsed0 = await import("./tine.js").then((m) => m.parseSource(source));
    if ("error" in parsed0) throw E.invalid({ source: `Line ${parsed0.error.line}: ${parsed0.error.reason}` });
    const tapeN = (await import("./tine.js")).tapeOpCount(parsed0.parsed);
    if (tapeN > 64) throw E.invalid({ source: `Line 1: The build tape has more than 64 operations.` });
    if (!ctx.storageUp) throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    const slug = `${slugify(title)}-${randomHex(6)}`;
    const sourceKey = `sources/${digestOf(source)}.tine`;
    await ctx.putObject(sourceKey, Buffer.from(source, "utf8"), "text/plain");
    await ctx.db.query(`insert into sources (key, bytes) values ($1,$2) on conflict (key) do nothing`, [sourceKey, source]);
    await ctx.db.query(
      `insert into parts (slug, title, category, visibility, owner_id) values ($1,$2,$3,$4,$5)`,
      [slug, title, category, visibility, rc.user.id]
    );
    const result = await createRevision(ctx, {
      partSlug: slug, parentRevisionId: null, authorId: rc.user.id, values: {}, source, message: "First version",
    });
    const rev = await revisionRow(result.id);
    return { status: 201, body: { slug, revision: revisionJson(rev!) }, location: `/api/parts/${slug}` };
  })));

  r.get("/parts/:slug/revisions", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const rows = await ctx.db.query(`select * from revisions where part_slug = $1 order by label desc`, [p.slug]);
    const head = rows.rows[0]?.id ?? "";
    res.set("ETag", `"${head}"`);
    res.json({ revisions: rows.rows.map(revisionJson) });
  }));

  // ---------- conditional write helpers ----------

  /** Evaluate If-Match per the revision history validator. */
  function ifMatchOk(header: string | undefined, head: string): boolean | "required" | false {
    if (header === undefined) return "required";
    if (header.trim() === "*") return true;
    for (const tag of header.split(",")) {
      const t = tag.trim();
      if (t === `"${head}"`) return true;
    }
    return false;
  }

  // ---------- save a revision ----------

  r.post("/parts/:slug/revisions", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    if (p.owner_id !== rc.user.id) throw E.forbidden();
    const head = await headId(p.slug as string);
    const match = ifMatchOk(req.headers["if-match"], head ?? "");
    if (match === "required") throw E.preconditionRequired();
    if (!match) {
      const headRow = head ? await revisionRow(head) : null;
      throw E.headMoved(head ?? "", headRow ? `r${headRow.label}` : "", headRow ? revisionJson(headRow) : null);
    }
    // H1: the number grammar is checked on the request text before parsing values.
    const b = body as Record<string, unknown>;
    const values = b.values && typeof b.values === "object" ? b.values as Values : {};
    const message = typeof b.message === "string" ? b.message : "";
    if (graphemeLength(message) > 200) throw E.invalid({ message: "Use at most 200 characters." });
    const source = await partSource((head ? await revisionRow(head) : null)!.source_key as string);
    // Validate the values against the manifest.
    const parsed = parseStored(source);
    const err = validateValues(parsed, values);
    if (err) throw err;
    if (!ctx.storageUp) throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    const result = await createRevision(ctx, {
      partSlug: p.slug as string, parentRevisionId: head, authorId: rc.user.id, values, source, message,
    });
    const rev = await revisionRow(result.id);
    return { status: 201, body: revisionJson(rev!), location: `/api/parts/${p.slug}?revision=${result.id}`, etag: `"${result.id}"` };
  })));

  /** Validate values against the parsed source, per the API's values order. */
  function validateValues(parsed: import("./tine.js").ParsedSource, values: Values): ReturnType<typeof httpError> | null {
    const byName = new Map(parsed.params.map((p) => [p.name, p]));
    for (const [name, value] of Object.entries(values)) {
      const p = byName.get(name);
      if (!p) {
        const errors: Record<string, string> = {};
        errors[name] = "Unknown parameter.";
        return E.invalid(errors);
      }
      if (p.kind === "boolean" && typeof value !== "boolean") {
        return E.invalid({ [name]: "Enter true or false." });
      }
      if (p.kind === "enum" && (typeof value !== "string" || !p.options?.includes(value))) {
        return E.invalid({ [name]: `Choose one of ${p.options?.join(", ")}.` });
      }
      if ((p.kind === "length" || p.kind === "angle" || p.kind === "count") && typeof value !== "number") {
        return E.invalid({ [name]: `Enter a whole number.` });
      }
      if (p.kind === "count" && !Number.isInteger(value as number)) {
        return E.invalid({ [name]: "Enter a whole number." });
      }
      if ((p.kind === "length" || p.kind === "angle") && typeof value === "number") {
        if (p.min !== undefined && value < p.min) return E.invalid({ [name]: `${labelOf(p.name)} must be between ${p.min} and ${p.max} ${p.kind === "angle" ? "\u00b0" : "mm"}.` });
        if (p.max !== undefined && value > p.max) return E.invalid({ [name]: `${labelOf(p.name)} must be between ${p.min} and ${p.max} ${p.kind === "angle" ? "\u00b0" : "mm"}.` });
      }
    }
    return null;
  }

  function labelOf(name: string): string {
    const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  // ---------- copies, restore, fork, tape, solids, archives ----------

  r.post("/parts/:slug/copies", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const b = body as Record<string, unknown>;
    const values = b.values && typeof b.values === "object" ? b.values as Values : {};
    const message = typeof b.message === "string" ? b.message : "";
    if (graphemeLength(message) > 200) throw E.invalid({ message: "Use at most 200 characters." });
    const headRow = await headId(p.slug as string);
    if (!headRow) throw E.notFound();
    const head = await revisionRow(headRow);
    if (!head) throw E.notFound();
    const source = await partSource(head.source_key as string);
    const parsed = parseStored(source);
    const err = validateValues(parsed, values);
    if (err) throw err;
    if (!ctx.storageUp) throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    const copySlug = `${p.slug}-copy-${randomHex(6)}`.slice(0, 60);
    // The copy's defaults are the original's defaults.
    await ctx.db.query(`insert into sources (key, bytes) values ($1,$2) on conflict (key) do nothing`, [head.source_key, source]);
    await ctx.db.query(
      `insert into parts (slug, title, category, visibility, owner_id) values ($1,$2,$3,'private',$4)`,
      [copySlug, `${p.title} (my configuration)`, p.category, rc.user.id]
    );
    const result = await createRevision(ctx, {
      partSlug: copySlug, parentRevisionId: null, authorId: rc.user.id, values, source, message,
    });
    const rev = await revisionRow(result.id);
    return { status: 201, body: { slug: copySlug, revision: revisionJson(rev!) }, location: `/api/parts/${copySlug}` };
  })));

  r.post("/parts/:slug/revisions/:id/restore", wrap(async (req, res) => withIdempotency(req, res, async (_body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    if (p.owner_id !== rc.user.id) throw E.forbidden();
    const head = await headId(p.slug as string);
    const match = ifMatchOk(req.headers["if-match"], head ?? "");
    if (match === "required") throw E.preconditionRequired();
    const target = await revisionRow(req.params.id!);
    if (!target || target.part_slug !== p.slug) throw E.notFound();
    if (target.id === head) {
      throw httpError(409, "already_head", `r${target.label} is already the latest revision.`);
    }
    if (!match) {
      const headRow = head ? await revisionRow(head) : null;
      throw E.headMoved(head ?? "", headRow ? `r${headRow.label}` : "", headRow ? revisionJson(headRow) : null);
    }
    if (!ctx.storageUp) throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    // Reuse the stored solid after reading its metadata back.
    const solidKey = `solids/${target.geometry_digest}.json`;
    if (!(await ctx.s3.headObject(solidKey))) {
      throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    }
    const source = await partSource(target.source_key as string);
    const result = await createRevision(ctx, {
      partSlug: p.slug as string, parentRevisionId: head, authorId: rc.user.id,
      values: target.values as Values, source, message: `Restored r${target.label}`,
      restoredFrom: target.id as string, evaluationId: target.evaluation_id as string | null,
    });
    const rev = await revisionRow(result.id);
    return { status: 201, body: revisionJson(rev!), location: `/api/parts/${p.slug}?revision=${result.id}`, etag: `"${result.id}"` };
  })));

  r.post("/revisions/:id/fork", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const target = await revisionRow(req.params.id!);
    if (!target) throw E.notFound();
    const p = await part(target.part_slug as string);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    if (p.owner_id !== rc.user.id) throw E.forbidden();
    const head = await headId(p.slug as string);
    const match = ifMatchOk(req.headers["if-match"], head ?? "");
    if (match === "required") throw E.preconditionRequired();
    if (!match) {
      const headRow = head ? await revisionRow(head) : null;
      throw E.headMoved(head ?? "", headRow ? `r${headRow.label}` : "", headRow ? revisionJson(headRow) : null);
    }
    const b = body as Record<string, unknown>;
    const operation = b.operation;
    if (typeof operation !== "number" || !Number.isInteger(operation)) {
      throw E.invalid({ operation: "Fork from the body operation or later." });
    }
    const fullSource = await partSource(target.source_key as string);
    const parsed = parseStored(fullSource);
    const steps = tapeSteps(fullSource, parsed);
    if (operation < 1 || operation >= steps.length || steps[operation]!.kind === "params" && steps.findIndex((st) => st.kind === "body") > operation) {
      throw E.invalid({ operation: "Fork from the body operation or later." });
    }
    const cut = truncateSource(fullSource, steps, operation);
    if (!ctx.storageUp) throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.save);
    const result = await createRevision(ctx, {
      partSlug: p.slug as string, parentRevisionId: head, authorId: rc.user.id,
      values: target.values as Values, source: cut, message: `Forked at operation ${operation}`,
      forkedFrom: { revisionId: target.id as string, operation },
    });
    const rev = await revisionRow(result.id);
    return { status: 201, body: revisionJson(rev!), location: `/api/parts/${p.slug}?revision=${result.id}`, etag: `"${result.id}"` };
  })));

  /** Truncate the source after an operation's line, closing any open repeat block. */
  function truncateSource(source: string, steps: { line: number | null }[], operation: number): string {
    const lines = source.split("\n");
    const line = steps[operation]!.line!;
    const head = lines.slice(0, line);
    let open = 0;
    for (const l of head) {
      const t = l.trim();
      if (t.endsWith("{")) open++;
      else if (t === "}") open--;
    }
    if (open > 0) head.push(...Array.from({ length: open }, () => "}"));
    return head.join("\n");
  }

  r.get("/revisions/:id/tape", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const rev = await revisionRow(req.params.id!);
    if (!rev) throw E.notFound();
    const p = await part(rev.part_slug as string);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const rows = await ctx.db.query(`select n, operations from tapes where revision_id = $1`, [rev.id]);
    const source = await partSource(rev.source_key as string);
    let operations: unknown[];
    let n: number;
    if (rows.rows[0]) {
      operations = rows.rows[0].operations;
      n = rows.rows[0].n;
    } else {
      const parsed = parseStored(source);
      const tape = buildTape(source, parsed, rev.values as Values);
      operations = tape.operations.map(({ solid: _s, ...rest }) => rest);
      n = tape.operations.length - 1;
    }
    // Pins: the newest stored complete report matching this digest.
    const report = await ctx.db.query(
      `select * from reports where part_slug = $1 and status = 'complete' and geometry_digest = $2
       order by created_at desc limit 1`, [rev.part_slug, rev.geometry_digest]);
    res.json({ revisionId: rev.id, partSlug: rev.part_slug, n, operations, preflight: report.rows[0] ?? null });
  }));

  r.get("/solids/:digest", wrap(async (req, res) => {
    try {
      const bytes = await ctx.s3.getObject(`solids/${req.params.digest}.json`);
      res.type("application/json").send(bytes);
    } catch (e) {
      if (e instanceof Error && e.message === "S3 object not found") throw E.notFound();
      throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.download);
    }
  }));

  r.get("/solids/:digest/thumbnail.svg", wrap(async (req, res) => {
    try {
      const bytes = await ctx.s3.getObject(`thumbnails/${req.params.digest}.svg`);
      res.type("image/svg+xml").send(bytes);
    } catch (e) {
      if (e instanceof Error && e.message === "S3 object not found") throw E.notFound();
      throw httpError(503, "storage_unavailable", STORAGE_OUTAGE_COPY.download);
    }
  }));

  r.get("/revisions/:id/archive.zip", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const rev = await revisionRow(req.params.id!);
    if (!rev) throw E.notFound();
    const p = await part(rev.part_slug as string);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const zip = await archiveZip(ctx, rev, p);
    res.type("application/zip")
      .set("Content-Disposition", `attachment; filename="${p.slug}-r${rev.label}.zip"`)
      .send(zip);
  }));

  r.get("/revisions/:id/archive.tar", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const rev = await revisionRow(req.params.id!);
    if (!rev) throw E.notFound();
    const p = await part(rev.part_slug as string);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const tar = await archiveTar(ctx, rev, p);
    res.type("application/x-tar")
      .set("Content-Disposition", `attachment; filename="${p.slug}-r${rev.label}.tar"`)
      .send(tar);
  }));

  // ---------- evaluations ----------

  r.post("/evaluations", wrap(async (req, res) => {
    const { body } = await readJson(req);
    const b = body as Record<string, unknown>;
    const partSlug = typeof b.partSlug === "string" ? b.partSlug : "";
    const viewerId = typeof b.viewerId === "string" ? b.viewerId : "";
    const seq = typeof b.seq === "number" ? b.seq : 1;
    const values = b.values && typeof b.values === "object" ? b.values as Values : {};
    const p = await part(partSlug);
    if (!p || p.visibility !== "public" && !rcUserCanRead(req, p)) throw E.notFound();
    const headRowE = await headId(partSlug);
    if (!headRowE) throw E.notFound();
    const head = await revisionRow(headRowE);
    if (!head) throw E.notFound();
    const source = await partSource(head.source_key as string);
    const parsed = parseStored(source);
    const err = validateValues(parsed, values);
    if (err) throw err;
    // Cancel any earlier in-flight evaluation from this viewer.
    await cancelInFlight(viewerId);
    const evalId = newId("eval");
    const delayKey = ctx.prefix(`grading:delay:${partSlug}`);
    const delayMs = await ctx.redis.get(delayKey).then((v) => (v ? Number(v) : 0)).catch(() => 0);
    await ctx.db.query(
      `insert into evaluations (id, part_slug, viewer_id, seq, status) values ($1,$2,$3,$4,'running')`,
      [evalId, partSlug, viewerId, seq]
    );
    const inFlightKey = ctx.prefix(`eval:${viewerId}`);
    await ctx.redis.set(inFlightKey, JSON.stringify({ evaluationId: evalId, seq }), "EX", 60).catch(() => {});
    // The client left when the response closes before its answer is written.
    let clientGone = false;
    res.on("close", () => { clientGone = !res.writableEnded; });
    const isCancelled = (): boolean => clientGone || evalCancelled.get(evalId) === true;
    // Evaluate after the delay; stop if cancelled or the client leaves.
    if (delayMs > 0) {
      const startAt = Date.now() + delayMs;
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (isCancelled() || Date.now() >= startAt) { clearInterval(timer); resolve(); }
        }, Math.min(50, Math.max(1, delayMs / 20)));
      });
    }
    const result = evaluate(parsed, values, C.evalTimeoutMs, isCancelled);
    if (isCancelled()) {
      await ctx.db.query(`update evaluations set status = 'cancelled', finished_at = now() where id = $1`, [evalId]);
      return;
    }
    if ("fail" in result) {
      await ctx.db.query(
        `update evaluations set status = 'failed', diagnostics = $2, finished_at = now() where id = $1`,
        [evalId, JSON.stringify(result.fail.diagnostics)]
      );
      res.json(evaluationJson({
        id: evalId, partSlug, viewerId, seq, status: "failed",
        geometryDigest: null, volume: 0, bbox: [0, 0, 0], faces: 0, solid: null,
        diagnostics: result.fail.diagnostics, startedAt: new Date(), finishedAt: new Date(),
      }));
      return;
    }
    const ok = result.ok;
    // Store the solid by digest if new.
    try {
      if (!(await ctx.s3.headObject(`solids/${ok.digest}.json`))) {
        await ctx.putObject(`solids/${ok.digest}.json`, Buffer.from(canonicalJson(ok.solid), "utf8"), "application/json");
      }
      if (!(await ctx.s3.headObject(`thumbnails/${ok.digest}.svg`))) {
        await ctx.putObject(`thumbnails/${ok.digest}.svg`, Buffer.from(thumbnailSvg(ok.solid), "utf8"), "image/svg+xml");
      }
    } catch { /* evaluation itself needs no stored object */ }
    await ctx.db.query(
      `update evaluations set status = 'succeeded', geometry_digest = $2, volume = $3, bbox = $4, faces = $5, solid = $6, finished_at = now() where id = $1`,
      [evalId, ok.digest, ok.volume, JSON.stringify(ok.bbox), ok.faces, JSON.stringify(ok.solid)]
    );
    res.json(evaluationJson({
      id: evalId, partSlug, viewerId, seq, status: "succeeded",
      geometryDigest: ok.digest, volume: ok.volume, bbox: ok.bbox, faces: ok.faces,
      solid: ok.solid, diagnostics: [], startedAt: new Date(), finishedAt: new Date(),
    }));
  }));

  const evalCancelled = new Map<string, boolean>();

  async function cancelInFlight(viewerId: string): Promise<void> {
    const key = ctx.prefix(`eval:${viewerId}`);
    const raw = await ctx.redis.get(key).catch(() => null);
    if (!raw) return;
    try {
      const { evaluationId, seq } = JSON.parse(raw) as { evaluationId: string; seq: number };
      evalCancelled.set(evaluationId, true);
      await ctx.redis.publish(ctx.prefix("eval-cancel"), evaluationId);
      await ctx.redis.del(key);
      await ctx.db.query(
        `update evaluations set status = 'cancelled', finished_at = now()
         where id = $1 and status = 'running'`, [evaluationId]);
      void seq;
    } catch { /* stale entry */ }
  }

  function evaluationJson(e: Record<string, unknown>): Record<string, unknown> {
    return {
      id: e.id, partSlug: e.partSlug, viewerId: e.viewerId, seq: e.seq, status: e.status,
      engineVersion: "tine-1.4.0", geometryDigest: e.geometryDigest, volume: e.volume,
      bbox: e.bbox, faces: e.faces, solid: e.solid, diagnostics: e.diagnostics,
      startedAt: (e.startedAt as Date).toISOString(), finishedAt: (e.finishedAt as Date).toISOString(),
    };
  }

  function rcUserCanRead(req: Request, p: Record<string, unknown>): Promise<boolean> {
    const cookie = req.headers.cookie ?? "";
    const sid = /(?:^|;\s*)tw_session=([^;]+)/.exec(cookie)?.[1];
    return (async () => {
      if (!sid) return p.visibility === "public";
      const rows = await ctx.db.query(
        `select u.id from sessions s join users u on u.id = s.user_id where s.id = $1`, [sid]);
      const userId = rows.rows[0]?.id as string | undefined;
      return canReadPart(p, userId ?? null);
    })();
  }

  r.post("/evaluations/cancel", wrap(async (req, res) => {
    const { body } = await readJson(req);
    const b = body as Record<string, unknown>;
    const viewerId = typeof b.viewerId === "string" ? b.viewerId : "";
    await cancelInFlight(viewerId);
    res.status(204).end();
  }));

  r.get("/evaluations/:id", wrap(async (req, res) => {
    const rows = await ctx.db.query(`select * from evaluations where id = $1`, [req.params.id!]);
    const row = rows.rows[0];
    if (!row) throw E.notFound();
    res.json({
      id: row.id, partSlug: row.part_slug, viewerId: row.viewer_id, seq: row.seq, status: row.status,
      engineVersion: "tine-1.4.0", geometryDigest: row.geometry_digest,
      volume: row.volume === null ? null : Number(row.volume), bbox: row.bbox, faces: row.faces,
      solid: row.solid, diagnostics: row.diagnostics ?? [],
      startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null,
    });
  }));

  // ---------- pre-flight ----------

  r.post("/preflight", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const { body } = await readJson(req);
    const b = body as Record<string, unknown>;
    const partSlug = typeof b.partSlug === "string" ? b.partSlug : "";
    const process = typeof b.process === "string" ? b.process : "";
    const values = b.values && typeof b.values === "object" ? b.values as Values : {};
    if (!PROCESSES.some((p) => p.id === process)) {
      throw E.invalid({ process: "Choose a process." });
    }
    const p = await part(partSlug);
    if (!p) throw E.notFound();
    if (!(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const headRowP = await headId(partSlug);
    if (!headRowP) throw E.notFound();
    const head = await revisionRow(headRowP);
    if (!head) throw E.notFound();
    const source = await partSource(head.source_key as string);
    const parsed = parseStored(source);
    const err = validateValues(parsed, values);
    if (err) throw err;
    // Signed-out allowance: claimed atomically before computing.
    let claimKey: string | null = null;
    if (!rc.user) {
      claimKey = ctx.prefix(`preflight:${rc.visitorId}`);
      const claimed = await claimPreflight(claimKey);
      if (!claimed) {
        const ttl = await ctx.redis.ttl(claimKey).catch(() => 86400);
        const retry = Math.max(1, Math.min(86400, ttl > 0 ? ttl : 86400));
        res.set("Retry-After", String(retry));
        throw E.preflightLimit(retry);
      }
    }
    const ev = evaluate(parsed, values, C.evalTimeoutMs);
    if ("fail" in ev) {
      if (claimKey) await releasePreflight(claimKey);
      throw httpError(422, "evaluation_failed", ev.fail.diagnostics[0]?.message ?? "Evaluation failed.", { diagnostics: ev.fail.diagnostics });
    }
    const report = preflightReport(parsed, process, {
      digest: ev.ok.digest, volume: ev.ok.volume, bbox: ev.ok.bbox, solid: ev.ok.solid, ops: ev.ok.ops,
    });
    const id = newId("rep");
    await ctx.db.query(
      `insert into reports (id, part_slug, process, values, geometry_digest, status, message, findings, cost_bands, confidence, visitor_session)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, partSlug, process, JSON.stringify(values), ev.ok.digest, report.status, report.message,
        JSON.stringify(report.findings), JSON.stringify(report.costBands), report.confidence, rc.visitorId]
    );
    res.status(201).json({
      id, partSlug, process, values, geometryDigest: ev.ok.digest, status: report.status,
      message: report.message, findings: report.findings, costBands: report.costBands,
      confidence: report.confidence, createdAt: new Date().toISOString(),
    });
  }));

  /** Claim one report atomically; false when the allowance is used up. */
  async function claimPreflight(key: string): Promise<boolean> {
    const limit = C.preflightSignedOutLimit;
    try {
      const n = await ctx.redis.incr(key);
      if (n === 1) await ctx.redis.expire(key, 86400);
      if (n > limit) { await ctx.redis.decr(key); return false; }
      return true;
    } catch {
      return true; // Valkey down: pre-flight still runs.
    }
  }

  async function releasePreflight(key: string): Promise<void> {
    await ctx.redis.decr(key).catch(() => {});
  }

  // ---------- compare ----------

  r.get("/compare", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    const baseId = typeof req.query.base === "string" ? req.query.base : "";
    const headIdParam = typeof req.query.head === "string" ? req.query.head : "";
    const base = await revisionRow(baseId);
    const headRev = await revisionRow(headIdParam);
    if (!base || !headRev || base.part_slug !== headRev.part_slug) {
      throw httpError(404, "not_found", "Not found.");
    }
    const p = await part(base.part_slug as string);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    const result = await compareRevisions(ctx, base, headRev, p);
    res.json(result);
  }));

  // ---------- likes ----------

  r.put("/parts/:slug/like", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    await ctx.db.query(`insert into likes (part_slug, user_id) values ($1,$2) on conflict do nothing`, [p.slug, rc.user.id]);
    const n = (await ctx.db.query(`select count(*)::int as n from likes where part_slug = $1`, [p.slug])).rows[0]!.n;
    await ctx.outbox(ctx.db, "like", p.slug as string, null, { type: "like", partSlug: p.slug, likes: n });
    res.json({ liked: true, likes: n });
  }));

  r.delete("/parts/:slug/like", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    await ctx.db.query(`delete from likes where part_slug = $1 and user_id = $2`, [p.slug, rc.user.id]);
    const n = (await ctx.db.query(`select count(*)::int as n from likes where part_slug = $1`, [p.slug])).rows[0]!.n;
    await ctx.outbox(ctx.db, "like", p.slug as string, null, { type: "like", partSlug: p.slug, likes: n });
    res.json({ liked: false, likes: n });
  }));

  // ---------- dashboard ----------

  r.get("/dashboard", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const partsRows = await ctx.db.query(
      `select p.slug, p.title, p.visibility,
        (select count(*)::int from likes l where l.part_slug = p.slug) as likes,
        (select count(*)::int from revisions rr where rr.part_slug = p.slug) as revision_count,
        h.id as head_id, h.label as head_label
       from parts p
       join lateral (select * from revisions rr where rr.part_slug = p.slug order by label desc limit 1) h on true
       where p.owner_id = $1 order by p.created_at desc, p.slug asc`, [rc.user.id]);
    const roomRows = await ctx.db.query(
      `select ro.id, ro.title, ro.part_slug, ro.state, ro.required_approvals,
        (select count(*)::int from approvals a where a.room_id = ro.id and a.geometry_digest =
          (select geometry_digest from revisions where part_slug = ro.part_slug order by label desc limit 1)) as approvals
       from rooms ro where ro.created_by = $1
       or exists (select 1 from room_reviewers rr where rr.room_id = ro.id and rr.user_id = $1)
       order by ro.created_at desc, ro.id asc`, [rc.user.id]);
    const likedRows = await ctx.db.query(
      `select p.slug, p.title, u.display_name as author from likes l
       join parts p on p.slug = l.part_slug join users u on u.id = p.owner_id
       where l.user_id = $1 order by l.created_at desc, p.slug asc`, [rc.user.id]);
    res.json({
      parts: partsRows.rows.map((row) => ({
        slug: row.slug, title: row.title, visibility: row.visibility, likes: row.likes,
        head: { id: row.head_id, label: `r${row.head_label}` }, revisionCount: row.revision_count,
      })),
      rooms: roomRows.rows.map((row) => ({
        id: row.id, title: row.title, partSlug: row.part_slug, state: row.state,
        approvals: row.approvals, requiredApprovals: row.required_approvals,
      })),
      liked: likedRows.rows.map((row) => ({ slug: row.slug, title: row.title, author: row.author })),
    });
  }));

  // ---------- events ----------

  r.get("/events", (req, res) => { void eventStream(ctx, req, res); });
  r.post("/grading/drop-streams", wrap(async (_req, res) => {
    await dropStreams();
    res.status(204).end();
  }));

  // ---------- grading ----------

  r.post("/grading/setup", wrap(async (req, res) => {
    const { body } = await readJson(req, 1_000_000);
    await gradingSetup(ctx, body as Record<string, unknown>, req, res);
  }));

  r.post("/grading/evaluator-delay", wrap(async (req, res) => {
    const { body } = await readJson(req);
    const b = body as Record<string, unknown>;
    const partSlug = typeof b.partSlug === "string" ? b.partSlug : "";
    const ms = b.ms;
    if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > 600000 || !partSlug) {
      throw E.invalid({ ms: "Choose a delay from 0 to 600 000 ms." });
    }
    const key = ctx.prefix(`grading:delay:${partSlug}`);
    if (ms === 0) await ctx.redis.del(key);
    else await ctx.redis.set(key, String(ms));
    res.status(204).end();
  }));

  r.get("/grading/evaluations", wrap(async (req, res) => {
    const viewerId = typeof req.query.viewerId === "string" ? req.query.viewerId : "";
    const started = (await ctx.db.query(`select count(*)::int as n from evaluations where viewer_id = $1`, [viewerId])).rows[0]!.n;
    const completed = (await ctx.db.query(
      `select count(*)::int as n from evaluations where viewer_id = $1 and status in ('succeeded','failed')`, [viewerId])).rows[0]!.n;
    const cancelled = (await ctx.db.query(
      `select count(*)::int as n from evaluations where viewer_id = $1 and status = 'cancelled'`, [viewerId])).rows[0]!.n;
    res.json({ started, completed, cancelled });
  }));

  /**
   * House rule H8: claim a key atomically, replay a completed answer, hold a
   * key in progress, release it on any other outcome. The run function
   * returns its answer as {status, body, location, etag}, or throws.
   */
  async function withIdempotency(
    req: Request,
    res: Response,
    run: (body: unknown) => Promise<WriteAnswer | void>
  ): Promise<void> {
    const keyHeader = req.headers["idempotency-key"];
    const key = typeof keyHeader === "string" ? keyHeader : undefined;
    const raw = await readBodyBytes(req, 65536);
    let parsed: unknown = {};
    if (raw.length > 0) {
      checkRawGrammar(raw);
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        throw E.invalid({});
      }
    }
    const answer = async (result: WriteAnswer | void): Promise<void> => {
      if (!result) return;
      if (result.location) res.set("Location", result.location);
      if (result.etag) res.set("ETag", result.etag);
      res.status(result.status).json(result.body);
    };
    if (key === undefined) {
      await answer(await run(parsed));
      return;
    }
    const rc = await api.reqCtx(req, res);
    const caller = rc.user?.id ?? rc.visitorId;
    const fullScope = `${caller}:${req.method}:${req.baseUrl}${req.route?.path ?? ""}`;
    const fingerprint = canonicalJson(parsed);
    if (key.length < 1 || key.length > 255 || !/^[\x20-\x7E]+$/.test(key)) {
      throw E.invalidIdempotencyKey();
    }
    const existing = await ctx.db.query(
      `select fingerprint, state, response_status, response_location, response_etag, response_body
       from idempotency where caller_id = $1 and method_path = $2 and key = $3`,
      [caller, fullScope, key]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      if (row.fingerprint !== fingerprint) throw E.keyReused();
      if (row.state === "completed") {
        if (row.response_location) res.set("Location", row.response_location);
        if (row.response_etag) res.set("ETag", row.response_etag);
        res.status(row.response_status).send(row.response_body);
        return;
      }
      throw E.idempotencyInProgress();
    }
    const claimed = await ctx.db.query(
      `insert into idempotency (caller_id, method_path, key, fingerprint, state)
       values ($1,$2,$3,$4,'in_progress')
       on conflict (caller_id, method_path, key) do nothing`,
      [caller, fullScope, key, fingerprint]
    );
    if (claimed.rowCount === 0) {
      const row = (await ctx.db.query(
        `select fingerprint, state from idempotency where caller_id = $1 and method_path = $2 and key = $3`,
        [caller, fullScope, key]
      )).rows[0]!;
      if (row.fingerprint !== fingerprint) throw E.keyReused();
      throw E.idempotencyInProgress();
    }
    try {
      const result = await run(parsed);
      if (result && result.status >= 200 && result.status < 300) {
        await ctx.db.query(
          `update idempotency set state = 'completed', response_status = $4, response_location = $5,
             response_etag = $6, response_body = $7
           where caller_id = $1 and method_path = $2 and key = $3`,
          [caller, fullScope, key, result.status, result.location ?? null, result.etag ?? null,
            Buffer.from(JSON.stringify(result.body), "utf8")]
        );
      } else {
        await releaseKey(caller, fullScope, key);
      }
      await answer(result);
    } catch (err) {
      await releaseKey(caller, fullScope, key);
      throw err;
    }
  }

  function releaseKey(caller: string, scope: string, key: string): Promise<void> {
    return ctx.db.query(
      `delete from idempotency where caller_id = $1 and method_path = $2 and key = $3 and state = 'in_progress'`,
      [caller, scope, key]
    ).then(() => undefined);
  }

  // ---------- rooms ----------

  async function roomRow(id: string): Promise<Record<string, unknown> | null> {
    const rows = await ctx.db.query(`select * from rooms where id = $1`, [id]);
    return rows.rows[0] ?? null;
  }

  async function roomCanRead(room: Record<string, unknown>, userId: string | null): Promise<boolean> {
    if (!userId) return false;
    if (room.created_by === userId) return true;
    const rows = await ctx.db.query(`select 1 from room_reviewers where room_id = $1 and user_id = $2`, [room.id, userId]);
    return rows.rows.length > 0;
  }

  /** The room JSON, with counted approvals (digest equals the head's digest). */
  async function roomJson(room: Record<string, unknown>): Promise<Record<string, unknown>> {
    const slug = room.part_slug as string;
    const headRow = await ctx.db.query(`select id, geometry_digest from revisions where part_slug = $1 order by label desc limit 1`, [slug]);
    const headDigest = headRow.rows[0]?.geometry_digest as string | undefined;
    const approvals = await ctx.db.query(
      `select a.reviewer_id, a.revision_id, a.geometry_digest, a.at, u.display_name from approvals a
       join users u on u.id = a.reviewer_id
       where a.room_id = $1 order by a.at asc, a.reviewer_id asc`, [room.id]
    );
    const counted = approvals.rows.filter((a) => a.geometry_digest === headDigest);
    const reviewers = await ctx.db.query(
      `select rr.email, rr.user_id, u.display_name from room_reviewers rr
       left join users u on u.id = rr.user_id where rr.room_id = $1`, [room.id]
    );
    const reviewerList = reviewers.rows
      .map((rr) => ({
        email: rr.email,
        userId: rr.user_id,
        ...(rr.display_name !== null ? { displayName: rr.display_name } : {}),
      }))
      .sort((a, b) => {
        const fa = a.email.toUpperCase().toLowerCase();
        const fb = b.email.toUpperCase().toLowerCase();
        if (fa !== fb) return fa < fb ? -1 : 1;
        return (a.userId ?? "").localeCompare(b.userId ?? "");
      });
    return {
      id: room.id,
      partSlug: slug,
      baseRevisionId: null,
      headRevisionId: headRow.rows[0]?.id ?? null,
      title: room.title,
      state: room.state,
      requiredApprovals: room.required_approvals,
      approvals: counted.map((a) => ({ reviewerId: a.reviewer_id, revisionId: a.revision_id, geometryDigest: a.geometry_digest, at: a.at })),
      reviewers: reviewerList,
      createdBy: room.created_by,
    };
  }

  /** Recompute the room state from its counted approvals. */
  async function refreshRoomState(roomId: string): Promise<void> {
    const room = await roomRow(roomId);
    if (!room || room.state === "closed") return;
    const json = await roomJson(room);
    const count = (json.approvals as unknown[]).length;
    const state = count >= (room.required_approvals as number) ? "approved" : "open";
    if (state !== room.state) {
      await ctx.db.query(`update rooms set state = $1 where id = $2`, [state, roomId]);
    }
  }

  r.post("/parts/:slug/rooms", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const p = await part(req.params.slug!);
    if (!p || !(await canReadPart(p, rc.user?.id ?? null))) throw E.notFound();
    if (p.owner_id !== rc.user.id) throw E.forbidden();
    const b = body as Record<string, unknown>;
    const title = typeof b.title === "string" ? b.title.normalize("NFC") : "";
    const reviewers = Array.isArray(b.reviewers) ? b.reviewers.filter((x): x is string => typeof x === "string") : [];
    const errors: Record<string, string> = {};
    const tl = graphemeLength(title);
    if (tl < 1 || tl > 80) errors.title = "Use 1 to 80 characters.";
    const folded = reviewers.map(foldEmail);
    if (folded.length < C.requiredApprovals) errors.reviewers = `Invite at least ${C.requiredApprovals} reviewers.`;
    if (folded.some((f) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f))) errors.reviewers = "Enter valid email addresses.";
    if (Object.keys(errors).length > 0) throw E.invalid(errors);
    const id = newId("room");
    const head = await headId(p.slug as string);
    // One invitation mail per reviewer; no mail, no room.
    try {
      const headRev = head ? await revisionRow(head) : null;
      const volumeRow = headRev ? await ctx.db.query(`select volume from evaluations where id = $1`, [headRev.evaluation_id]) : null;
      const volume = volumeRow?.rows[0]?.volume ? Number(volumeRow.rows[0].volume) : 0;
      for (const email of reviewers) {
        await sendMail(ctx, foldEmail(email), `Review ${p.title} on Tinework`,
          [
            `Room: ${title}`,
            `Revision: r${headRev?.label ?? 1}`,
            `Head volume: ${formatFixed(volume, 2)}\u202Fmm\u00b3`,
            `${C.publicUrl}/rooms/${id}`,
          ].join("\n"));
      }
    } catch {
      throw httpError(503, "mail_unavailable", "We could not send the invitations right now. Try again in a minute.");
    }
    const client = await ctx.db.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into rooms (id, part_slug, title, state, required_approvals, created_by) values ($1,$2,$3,'open',$4,$5)`,
        [id, p.slug, title, C.requiredApprovals, rc.user.id]
      );
      for (const email of folded) {
        const userRow = await client.query(`select id, display_name from users where email = $1 and verified`, [email]);
        await client.query(
          `insert into room_reviewers (room_id, email, user_id) values ($1,$2,$3) on conflict do nothing`,
          [id, email, userRow.rows[0]?.id ?? null]
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    const room = await roomRow(id);
    return { status: 201, body: await roomJson(room!), location: `/api/rooms/${id}` };
  })));

  r.get("/rooms/:id", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.notFound();
    const room = await roomRow(req.params.id!);
    if (!room || !(await roomCanRead(room, rc.user.id))) throw E.notFound();
    const comments = await ctx.db.query(
      `select c.*, u.display_name from comments c join users u on u.id = c.author_id
       where c.room_id = $1 order by c.created_at asc, c.id asc`, [room.id]
    );
    res.json({ room: await roomJson(room), comments: comments.rows.map(commentJson) });
  }));

  function commentJson(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      roomId: row.room_id,
      author: { id: row.author_id, displayName: row.display_name },
      body: row.body,
      anchor: row.anchor,
      pose: row.pose,
      revisionId: row.revision_id,
      createdAt: (row.created_at as Date).toISOString(),
    };
  }

  r.post("/rooms/:id/comments", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const room = await roomRow(req.params.id!);
    if (!room || !(await roomCanRead(room, rc.user.id))) throw E.notFound();
    if (room.state === "closed") throw httpError(409, "room_closed", "This review room is closed.");
    const b = body as Record<string, unknown>;
    const text = typeof b.body === "string" ? b.body.normalize("NFC") : "";
    const len = graphemeLength(text);
    if (len < 1) throw E.invalid({ body: "Write a comment first." });
    if (len > C.commentMaxChars) {
      throw httpError(422, "comment_too_long", `Comments can be at most ${C.commentMaxChars} characters.`, {
        errors: { body: `Comments can be at most ${C.commentMaxChars} characters.` },
      });
    }
    const anchor = b.anchor && typeof b.anchor === "object" && (b.anchor as Record<string, unknown>).kind === "point"
      ? b.anchor : { kind: "none" };
    const pose = b.pose && typeof b.pose === "object" ? b.pose : {};
    const head = await headId(room.part_slug as string);
    const id = newId("comment");
    const client = await ctx.db.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into comments (id, room_id, author_id, body, anchor, pose, revision_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, room.id, rc.user.id, text, JSON.stringify(anchor), JSON.stringify(pose), head]
      );
      await ctx.outbox(client, "comment", room.part_slug as string, room.id as string, {
        type: "comment",
        comment: { id, roomId: room.id, author: { id: rc.user.id, displayName: rc.user.displayName }, body: text, anchor, pose, revisionId: head },
      });
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return { status: 201, body: { id, roomId: room.id, author: { id: rc.user.id, displayName: rc.user.displayName }, body: text, anchor, pose, revisionId: head, createdAt: new Date().toISOString() } };
  })));

  r.post("/rooms/:id/approvals", wrap(async (req, res) => withIdempotency(req, res, async (body) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const room = await roomRow(req.params.id!);
    if (!room || !(await roomCanRead(room, rc.user.id))) throw E.notFound();
    if (room.created_by === rc.user.id) {
      throw httpError(422, "own_revision", "Owners cannot approve their own revision.");
    }
    if (room.state === "closed") throw httpError(409, "room_closed", "This review room is closed.");
    const b = body as Record<string, unknown>;
    const revisionId = typeof b.revisionId === "string" ? b.revisionId : "";
    const head = await headId(room.part_slug as string);
    if (revisionId !== head) {
      const headRow = head ? await revisionRow(head) : null;
      throw httpError(409, "stale_revision", `r${headRow?.label ?? "?"} is no longer the head; review r${headRow?.label ?? "?"} before approving.`);
    }
    const headRow = await revisionRow(head!);
    const digest = headRow!.geometry_digest as string;
    // Duplicate approvals: exactly one 201; the others 200 with nothing added.
    const existing = await ctx.db.query(
      `select 1 from approvals where room_id = $1 and reviewer_id = $2 and geometry_digest = $3`,
      [room.id, rc.user.id, digest]
    );
    if (existing.rows.length > 0) {
      return { status: 200, body: await roomJson(room) };
    }
    // Among several simultaneous identical approvals, exactly one inserts.
    const inserted = await ctx.db.query(
      `insert into approvals (room_id, reviewer_id, revision_id, geometry_digest) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [room.id, rc.user.id, head, digest]
    );
    if (inserted.rowCount === 0) {
      return { status: 200, body: await roomJson(room) };
    }
    await refreshRoomState(room.id as string);
    const fresh = await roomRow(room.id as string);
    await ctx.outbox(ctx.db, "approvals", room.part_slug as string, room.id as string, {
      type: "approvals", room: await roomJson(fresh!), reason: "approved", label: `r${headRow!.label}`, displayName: rc.user.displayName,
    });
    return { status: 201, body: await roomJson(fresh!) };
  })));

  r.post("/rooms/:id/close", wrap(async (req, res) => {
    const rc = await api.reqCtx(req, res);
    if (!rc.user) throw E.unauthenticated();
    const room = await roomRow(req.params.id!);
    if (!room || !(await roomCanRead(room, rc.user.id))) throw E.notFound();
    if (room.created_by !== rc.user.id) throw E.forbidden();
    if (room.state === "closed") throw httpError(409, "room_closed", "This review room is closed.");
    await ctx.db.query(`update rooms set state = 'closed' where id = $1`, [room.id]);
    const fresh = await roomRow(room.id as string);
    await ctx.outbox(ctx.db, "approvals", room.part_slug as string, room.id as string, {
      type: "approvals", room: await roomJson(fresh!), reason: "closed", label: null, displayName: null,
    });
    res.status(200).json(await roomJson(fresh!));
  }));

  return r;
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "part";
}

function randomHex(n: number): string {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * 16)];
  return out;
}
