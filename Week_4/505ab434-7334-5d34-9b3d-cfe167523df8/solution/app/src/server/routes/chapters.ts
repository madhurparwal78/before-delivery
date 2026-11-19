// Chapters, rules and the version workflow (brief: Chapters, versions and rules).
import { transaction, read, type AuditDraft, type Tx } from "../db.ts";
import { Denied, refuse, withDenialAudit } from "../denial.ts";
import { ApiError, forbidden, invalidBody, notFound } from "../errors.ts";
import { created, ok, type Ctx, type Reply, type Router } from "../http.ts";
import { liveRules, withdrawalOf } from "../rules.ts";
import {
  OPEN_STATES, assertIdentified, assertPublishable, assertState, canEdit, canSee, loadVersion, markPublished, toView, validateDraft, versionsOf,
  type Statement, type VersionRow, type Withdrawal,
} from "../versions.ts";
import type { AuditAction, Role } from "../../shared/domain.ts";
import type { ChapterPage, ChapterSummary, Principal, RuleView } from "../../shared/api.ts";

interface ChapterRow {
  slug: string;
  title: string;
}

async function chapterRows(tx: Tx): Promise<ChapterRow[]> {
  return tx.q<ChapterRow>("SELECT slug, title FROM chapters ORDER BY position");
}

async function publishedOf(tx: Tx, slug: string): Promise<VersionRow | undefined> {
  return tx.one<VersionRow>(
    `SELECT id, slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn, published_at, review_comment
       FROM chapter_versions WHERE slug = $1 AND state = 'published'`,
    [slug],
  );
}

async function listChapters(): Promise<Reply> {
  return read(async (tx) => {
    const chapters: ChapterSummary[] = [];
    for (const chapter of await chapterRows(tx)) {
      const version = await publishedOf(tx, chapter.slug);
      if (version) chapters.push({ slug: chapter.slug, title: chapter.title, version: version.number, publishedAt: version.published_at!, ruleCount: version.statements.length });
    }
    return ok({ chapters, liveRuleCount: chapters.reduce((sum, c) => sum + c.ruleCount, 0) });
  });
}

async function getChapter(ctx: Ctx): Promise<Reply> {
  return read(async (tx) => {
    const chapter = (await chapterRows(tx)).find((c) => c.slug === ctx.params.slug);
    const version = chapter && (await publishedOf(tx, chapter.slug));
    if (!chapter || !version) throw notFound();
    const names = await tx.q<{ id: string; name: string }>("SELECT id, name FROM assets WHERE id = ANY($1)", [version.asset_ids]);
    const page: ChapterPage = {
      slug: chapter.slug,
      title: chapter.title,
      version: version.number,
      publishedAt: version.published_at!,
      intro: version.intro,
      statements: version.statements,
      assets: version.asset_ids.map((id) => names.find((n) => n.id === id)!.name),
    };
    return ok(page);
  });
}

async function listRules(): Promise<Reply> {
  return read(async (tx) => ok({ rules: (await liveRules(tx)).map((r) => ({ identifier: r.identifier, chapter: r.slug, text: r.text, version: r.version })) }));
}

async function getRule(ctx: Ctx): Promise<Reply> {
  return read(async (tx) => {
    const identifier = ctx.params.identifier;
    const live = (await liveRules(tx)).find((r) => r.identifier === identifier);
    if (live) return ok({ identifier, status: "live", chapter: live.slug, text: live.text } satisfies RuleView);
    const withdrawn = await withdrawalOf(tx, identifier);
    if (!withdrawn) throw notFound();
    return ok({ identifier, status: "withdrawn", ...withdrawn } satisfies RuleView);
  });
}

async function chapterVersions(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  return read(async (tx) => {
    if (!(await chapterRows(tx)).some((c) => c.slug === ctx.params.slug)) throw notFound();
    if (!canEdit(principal)) throw forbidden();
    const versions = (await versionsOf(tx, ctx.params.slug)).map((v) => ({
      id: v.id, number: v.number, state: v.state, revision: v.revision, publishedAt: v.published_at,
    }));
    return ok({ versions });
  });
}

async function getVersion(ctx: Ctx): Promise<Reply> {
  return read(async (tx) => {
    const version = await loadVersion(tx, ctx.params.id);
    if (!version || !canSee(ctx.principal, version)) throw notFound();
    const view = toView(version);
    if (ctx.principal && canEdit(ctx.principal)) {
      view.assetOptions = await tx.q<{ id: string; name: string }>("SELECT id, name FROM assets ORDER BY name");
    }
    return ok(view);
  });
}

const audit = (principal: Principal, action: AuditAction, versionId: string): Omit<AuditDraft, "before" | "after" | "outcome"> => ({
  actorId: principal.id,
  actorRole: principal.role,
  action,
  resourceType: "chapter_version",
  resourceId: versionId,
  requestId: null,
});

const announce = (tx: Tx, slug: string): void => {
  tx.live({ type: "chapter.updated", slug }, { all: true });
};

/** Loads a version for an action: 401, 404 when invisible, 403 (audited) when the role may not act. */
async function actOn(ctx: Ctx, role: Role, action: AuditAction): Promise<{ principal: Principal; version: VersionRow }> {
  const principal = ctx.user();
  const version = await read((tx) => loadVersion(tx, ctx.params.id));
  if (!version || !canSee(principal, version)) throw notFound();
  if (principal.role !== role) return refuse(audit(principal, action, version.id));
  return { principal, version };
}

function statementsOf(value: unknown): Statement[] {
  if (!Array.isArray(value)) throw invalidBody();
  return value.map((item: unknown) => {
    const s = item as Partial<Statement> | null;
    if (!s || typeof s.identifier !== "string" || typeof s.text !== "string") throw invalidBody();
    return { identifier: s.identifier, text: s.text };
  });
}

function withdrawalsOf(value: unknown): Withdrawal[] {
  if (!Array.isArray(value)) throw invalidBody();
  return value.map((item: unknown) => {
    const w = item as Partial<Withdrawal> | null;
    if (!w || typeof w.identifier !== "string" || typeof w.replacedBy !== "string") throw invalidBody();
    return { identifier: w.identifier, replacedBy: w.replacedBy };
  });
}

async function startVersion(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  return withDenialAudit(async (tx) => {
    const chapter = (await chapterRows(tx)).find((c) => c.slug === ctx.params.slug);
    if (!chapter) throw notFound();
    if (principal.role !== "author") {
      throw new Denied("forbidden", "You can't do that.", { actorId: principal.id, actorRole: principal.role, action: "chapter.started", resourceType: "chapter", resourceId: chapter.slug, requestId: null });
    }
    await tx.q("SELECT 1 FROM chapters WHERE slug = $1 FOR UPDATE", [chapter.slug]);
    const versions = await versionsOf(tx, chapter.slug);
    const open = versions.find((v) => OPEN_STATES.includes(v.state));
    if (open) throw new ApiError(409, "open_version", `Version ${open.number} is already open.`);
    const latest = versions[versions.length - 1];
    const number = latest.number + 1;
    const id = `ver_${chapter.slug}_${number}`;
    await tx.q(
      `INSERT INTO chapter_versions (id, slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn)
       VALUES ($1,$2,$3,'draft',$4,1,$5,$6,$7,'[]')`,
      [id, chapter.slug, number, principal.id, latest.intro, JSON.stringify(latest.statements), latest.asset_ids],
    );
    announce(tx, chapter.slug);
    return created(toView((await loadVersion(tx, id))!));
  });
}

async function saveVersion(ctx: Ctx): Promise<Reply> {
  const { version } = await actOn(ctx, "author", "chapter.saved");
  return transaction(async (tx) => {
    const current = (await loadVersion(tx, version.id, true))!;
    assertState(current, "draft");
    const body = await ctx.json();
    if (body.revision !== current.revision) throw new ApiError(409, "stale_version", "This draft changed since you opened it. Reload to see the latest.");
    if (typeof body.intro !== "string" || !Array.isArray(body.assetIds) || body.assetIds.some((id) => typeof id !== "string")) throw invalidBody();
    const statements = statementsOf(body.statements);
    const withdrawn = withdrawalsOf(body.withdrawn);
    const assetIds = body.assetIds as string[];
    const known = await tx.q<{ id: string }>("SELECT id FROM assets WHERE id = ANY($1)", [assetIds]);
    if (known.length !== new Set(assetIds).size) throw notFound();
    await validateDraft(tx, current.slug, statements, withdrawn);
    await tx.q(
      "UPDATE chapter_versions SET revision = revision + 1, intro = $2, statements = $3, asset_ids = $4, withdrawn = $5 WHERE id = $1",
      [current.id, body.intro, JSON.stringify(statements), assetIds, JSON.stringify(withdrawn)],
    );
    return ok(toView((await loadVersion(tx, current.id))!));
  });
}

type Transition = { role: Role; action: AuditAction; from: VersionRow["state"]; to: VersionRow["state"] };

async function transition(ctx: Ctx, step: Transition, extra?: (tx: Tx, version: VersionRow) => Promise<Record<string, unknown>>): Promise<Reply> {
  const { principal, version } = await actOn(ctx, step.role, step.action);
  return transaction(async (tx) => {
    const current = (await loadVersion(tx, version.id, true))!;
    assertState(current, step.from);
    const after = (await extra?.(tx, current)) ?? {};
    await tx.q("UPDATE chapter_versions SET state = $2, review_comment = $3 WHERE id = $1", [
      current.id, step.to, typeof after.comment === "string" ? after.comment : null,
    ]);
    tx.audit({ ...audit(principal, step.action, current.id), before: { state: step.from }, after: { ...after, state: step.to } });
    announce(tx, current.slug);
    return ok(toView((await loadVersion(tx, current.id))!));
  });
}

const submitVersion = (ctx: Ctx): Promise<Reply> =>
  transition(ctx, { role: "author", action: "chapter.submitted", from: "draft", to: "in_review" }, async (_tx, version) => {
    assertIdentified(version);
    return {};
  });

const approveVersion = (ctx: Ctx): Promise<Reply> =>
  transition(ctx, { role: "brand_reviewer", action: "chapter.approved", from: "in_review", to: "approved" });

async function requestChanges(ctx: Ctx): Promise<Reply> {
  return transition(ctx, { role: "brand_reviewer", action: "chapter.changes_requested", from: "in_review", to: "draft" }, async () => {
    const body = await ctx.json(true);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (comment === "") throw new ApiError(422, "comment_required", "Say what needs to change.");
    return { comment };
  });
}

async function publishVersion(ctx: Ctx): Promise<Reply> {
  const { principal, version } = await actOn(ctx, "owner", "chapter.published");
  return transaction(async (tx) => {
    const current = (await loadVersion(tx, version.id, true))!;
    assertState(current, "approved");
    await assertPublishable(tx, current);
    await markPublished(tx, current.id, current.slug);
    tx.audit({ ...audit(principal, "chapter.published", current.id), before: { state: "approved" }, after: { state: "published", version: current.number } });
    announce(tx, current.slug);
    return ok(toView((await loadVersion(tx, current.id))!));
  });
}

async function republish(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const slug = ctx.params.slug;
  if (!(await read(chapterRows)).some((c) => c.slug === slug)) throw notFound();
  if (principal.role !== "owner") {
    return refuse({ actorId: principal.id, actorRole: principal.role, action: "chapter.published", resourceType: "chapter", resourceId: slug, requestId: null });
  }
  const payload = await ctx.json();
  return transaction(async (tx) => {
    await tx.q("SELECT 1 FROM chapters WHERE slug = $1 FOR UPDATE", [slug]);
    const versions = await versionsOf(tx, slug);
    const source = versions.find((v) => v.number === payload.version);
    if (!source) throw notFound();
    assertState(source, ["published", "superseded"]);
    await assertPublishable(tx, source);
    const number = versions[versions.length - 1].number + 1;
    const id = `ver_${slug}_${number}`;
    await tx.q(
      `INSERT INTO chapter_versions (id, slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn)
       VALUES ($1,$2,$3,'draft',$4,1,$5,$6,$7,$8)`,
      [id, slug, number, principal.id, source.intro, JSON.stringify(source.statements), source.asset_ids, JSON.stringify(source.withdrawn)],
    );
    await markPublished(tx, id, slug);
    tx.audit({ ...audit(principal, "chapter.published", id), before: null, after: { republishedFrom: source.number, state: "published", version: number } });
    announce(tx, slug);
    return created(toView((await loadVersion(tx, id))!));
  });
}

export function registerChapters(router: Router): void {
  router.get("/api/chapters", listChapters);
  router.get("/api/chapters/:slug", getChapter);
  router.get("/api/rules", listRules);
  router.get("/api/rules/:identifier", getRule);
  router.get("/api/chapters/:slug/versions", chapterVersions);
  router.post("/api/chapters/:slug/versions", startVersion);
  router.post("/api/chapters/:slug/republish", republish);
  router.get("/api/versions/:id", getVersion);
  router.put("/api/versions/:id", saveVersion);
  router.post("/api/versions/:id/submit", submitVersion);
  router.post("/api/versions/:id/approve", approveVersion);
  router.post("/api/versions/:id/request-changes", requestChanges);
  router.post("/api/versions/:id/publish", publishVersion);
}
