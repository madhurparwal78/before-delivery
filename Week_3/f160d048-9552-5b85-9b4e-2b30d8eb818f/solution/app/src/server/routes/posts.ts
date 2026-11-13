import { config } from "../config";
import { first, rows } from "../db/pool";
import { inUnit, type Unit } from "../db/unit";
import { findContactDetail } from "../domain/contact";
import { postedMonth } from "../domain/anonymity";
import { authorRefusal, type PostSnapshot } from "../domain/postStates";
import { postLabel } from "../domain/postLabel";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, jsonField, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { FIELD_COPY } from "../../shared/errors";
import { CONTACT_FIELDS, interviewNoteShape, parseShape, payReportShape, reviewShape, withoutCompany } from "../../shared/rules";
import { POST_KINDS, type PostKind, type PostState } from "../../shared/reference";
import type { MyPost, PostCreated } from "../../shared/api";

type PostFields = Record<string, string | number>;

const SHAPES = { review: reviewShape, pay_report: payReportShape, interview_note: interviewNoteShape };
const EDIT_SHAPES = {
  review: withoutCompany(reviewShape),
  pay_report: withoutCompany(payReportShape),
  interview_note: withoutCompany(interviewNoteShape),
};

const POST_COLUMNS = ["title", "overall", "work_life", "pay", "management", "pros", "cons", "role_family", "city", "annual_pay", "years_experience", "difficulty", "outcome", "text"];

type PostRow = {
  id: string; kind: PostKind; company_id: string; company_name: string; author_id: string | null; state: PostState;
  title: string | null; role_family: string | null; created_at: Date; reason: string | null;
  overall: number | null; work_life: number | null; pay: number | null; management: number | null; pros: string | null; cons: string | null;
  city: string | null; annual_pay: number | null; years_experience: number | null; difficulty: number | null; outcome: string | null; text: string | null;
  claimed_by: string | null; lapsed_by: string | null; claimed_by_name: string | null; decided_by_name: string | null;
  within_window: boolean;
};

/** The post columns; `windowParam` is the placeholder holding the edit window in minutes. */
const postSql = (windowParam: string): string => `SELECT p.id, p.kind, p.company_id, c.name AS company_name, p.author_id, p.state,
  p.title, p.role_family, p.created_at, p.reason, p.claimed_by, p.lapsed_by,
  p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.city, p.annual_pay, p.years_experience, p.difficulty, p.outcome, p.text,
  (p.created_at + make_interval(mins => ${windowParam}) > app_now()) AS within_window,
  cu.display_name AS claimed_by_name, du.display_name AS decided_by_name
  FROM posts p JOIN companies c ON c.id = p.company_id
  LEFT JOIN users cu ON cu.id = p.claimed_by LEFT JOIN users du ON du.id = p.decided_by`;

const snapshotOf = (post: PostRow): PostSnapshot => ({
  state: post.state,
  claimedBy: post.claimed_by,
  lapsedBy: post.lapsed_by,
  decidedByName: post.decided_by_name,
  claimedByName: post.claimed_by_name,
});

function kindOf(ctx: Ctx): PostKind | undefined {
  const kind = jsonField(ctx, "kind");
  return POST_KINDS.find((candidate) => candidate === kind);
}

function reportContact(kind: PostKind, values: PostFields): void {
  const finding = findContactDetail(CONTACT_FIELDS[kind].map((name) => [name, String(values[name] ?? "")] as const));
  if (finding) throw new ApiError(finding.code, {}, { field: finding.field });
}

async function createdBody(unit: Unit, id: string, kind: PostKind, companyName: string): Promise<PostCreated> {
  const created = await unit.first<{ created_at: Date; title: string | null; role_family: string | null }>(
    "SELECT created_at, title, role_family FROM posts WHERE id = $1",
    [id],
  );
  return {
    id,
    kind,
    state: "pending",
    label: postLabel({ kind, title: created?.title ?? null, role_family: created?.role_family ?? null, company_name: companyName }),
    company_name: companyName,
    posted_month: postedMonth(created?.created_at ?? new Date()),
  };
}

/** What the author may change, as the edit form needs it. */
function editableFields(post: PostRow): Record<string, string | number> {
  const present = (entries: [string, string | number | null][]): Record<string, string | number> =>
    Object.fromEntries(entries.filter((entry): entry is [string, string | number] => entry[1] !== null));
  if (post.kind === "review") {
    return present([["overall", post.overall], ["work_life", post.work_life], ["pay", post.pay], ["management", post.management], ["title", post.title], ["pros", post.pros], ["cons", post.cons]]);
  }
  if (post.kind === "pay_report") {
    return present([["role_family", post.role_family], ["city", post.city], ["annual_pay", post.annual_pay], ["years_experience", post.years_experience]]);
  }
  return present([["role_family", post.role_family], ["difficulty", post.difficulty], ["outcome", post.outcome], ["text", post.text]]);
}

async function reviewsInWindow(db: Pick<Unit, "first">, authorId: string, companyId: string): Promise<number> {
  const row = await db.first<{ n: number }>(
    `SELECT count(*)::int AS n FROM posts
      WHERE author_id = $1 AND company_id = $2 AND kind = 'review' AND created_at > app_now() - interval '365 days'`,
    [authorId, companyId],
  );
  return row?.n ?? 0;
}

const create = defineRoute({
  method: "POST",
  path: "/api/posts",
  auth: "session",
  roles: ["member"],
  body: "json",
  async load(ctx) {
    const companyId = jsonField(ctx, "company_id");
    if (typeof companyId !== "string" || companyId.trim() === "") return undefined;
    const company = await first<{ id: string; name: string }>("SELECT id, name FROM companies WHERE id = $1", [companyId]);
    if (!company) throw refuse("not_found");
    return company;
  },
  async conflicts(ctx, company) {
    if (kindOf(ctx) !== "review" || !company || !ctx.viewer) return;
    if ((await reviewsInWindow({ first }, ctx.viewer.id, company.id)) >= config.limits.reviewsPerCompanyPerYear) throw refuse("duplicate_review");
  },
  input(ctx) {
    const kind = kindOf(ctx);
    if (!kind) throw invalidFields({ kind: FIELD_COPY.kind });
    const parsed = parseShape(SHAPES[kind], requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    reportContact(kind, parsed.value);
    return { kind, values: parsed.value as PostFields };
  },
  async run(ctx, company, input) {
    const viewer = ctx.viewer;
    if (!viewer || !company) throw refuse("unauthenticated");
    const body = await inUnit(async (unit) => {
      if (input.kind === "review") {
        await unit.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`review:${viewer.id}:${company.id}`]);
        if ((await reviewsInWindow(unit, viewer.id, company.id)) >= config.limits.reviewsPerCompanyPerYear) throw refuse("duplicate_review");
      }
      const values = input.values;
      const columns = POST_COLUMNS.filter((name) => values[name] !== undefined);
      const created = await unit.first<{ id: string }>(
        `INSERT INTO posts (kind, company_id, author_id, state, created_at, ${columns.join(", ")})
         VALUES ($1, $2, $3, 'pending', app_now(), ${columns.map((_, index) => `$${index + 4}`).join(", ")})
         RETURNING id`,
        [input.kind, company.id, viewer.id, ...columns.map((name) => values[name])],
      );
      if (!created) throw refuse("not_found");
      unit.emit({
        type: "queue.changed",
        audience: ["moderators"],
        exclude: viewer.id,
        data: { post_id: created.id, state: "pending", by_name: null, by_user: null },
      });
      return createdBody(unit, created.id, input.kind, company.name);
    });
    return { status: 201, body };
  },
});

const mine = defineRoute({
  method: "GET",
  path: "/api/me/posts",
  auth: "session",
  roles: ["member"],
  async run(ctx) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const found = await rows<PostRow>(
      `${postSql("$2")}
        WHERE p.author_id = $1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC, p.id`,
      [viewer.id, config.limits.editWindowMinutes],
    );
    const posts: MyPost[] = found.map((post) => ({
      id: post.id,
      kind: post.kind,
      label: postLabel({ kind: post.kind, title: post.title, role_family: post.role_family, company_name: post.company_name }),
      company_name: post.company_name,
      state: post.state,
      reason: post.state === "rejected" ? post.reason : null,
      posted_month: postedMonth(post.created_at),
      editable: authorRefusal("edit", snapshotOf(post), post.within_window) === undefined,
      fields: editableFields(post),
    }));
    return { status: 200, body: { posts } };
  },
});

async function loadOwn(ctx: Ctx): Promise<PostRow> {
  const viewer = ctx.viewer;
  const post = viewer
    ? await first<PostRow>(
        `${postSql("$3")}
          WHERE p.id = $1 AND p.author_id = $2 AND p.deleted_at IS NULL`,
        [ctx.params["id"], viewer.id, config.limits.editWindowMinutes],
      )
    : undefined;
  if (!post) throw refuse("not_found");
  return post;
}

async function announceChange(unit: Unit, post: PostRow, wasApproved: boolean, state: string, authorId: string): Promise<void> {
  unit.emit({
    type: "queue.changed",
    audience: ["moderators"],
    exclude: authorId,
    data: { post_id: post.id, state, by_name: null, by_user: null },
  });
  if (wasApproved) {
    unit.emit({ type: "company.changed", audience: ["all"], data: { slug: await slugOf(unit, post.company_id) } });
    await unit.syncSearch("companies", post.company_id);
  }
}

async function slugOf(unit: Unit, companyId: string): Promise<string> {
  const company = await unit.first<{ slug: string }>("SELECT slug FROM companies WHERE id = $1", [companyId]);
  return company ? company.slug : "";
}

const edit = defineRoute({
  method: "PATCH",
  path: "/api/posts/:id",
  auth: "session",
  roles: ["member"],
  body: "json",
  load: loadOwn,
  async conflicts(_ctx, post) {
    const refusal = authorRefusal("edit", snapshotOf(post), post.within_window);
    if (refusal) throw new ApiError(refusal.code, refusal.params);
  },
  input(ctx, post) {
    const parsed = parseShape(EDIT_SHAPES[post.kind], requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    reportContact(post.kind, parsed.value as PostFields);
    return parsed.value as PostFields;
  },
  async run(ctx, post, values) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const body = await inUnit(async (unit) => {
      await unit.query("SELECT 1 FROM posts WHERE id = $1 FOR UPDATE", [post.id]);
      const locked = await unit.first<PostRow>(`${postSql("$2")} WHERE p.id = $1 AND p.deleted_at IS NULL`, [post.id, config.limits.editWindowMinutes]);
      if (!locked) throw refuse("not_found");
      const refusal = authorRefusal("edit", snapshotOf(locked), locked.within_window);
      if (refusal) throw new ApiError(refusal.code, refusal.params);
      const columns = POST_COLUMNS.filter((name) => values[name] !== undefined);
      await unit.query(
        `UPDATE posts SET state = 'pending', reason = NULL, decided_by = NULL, decided_at = NULL,
                ${columns.map((name, index) => `${name} = $${index + 2}`).join(", ")}
          WHERE id = $1`,
        [post.id, ...columns.map((name) => values[name])],
      );
      await announceChange(unit, post, locked.state === "approved", "pending", viewer.id);
      unit.emit({ type: "post.state", audience: [`user:${viewer.id}`], data: { post_id: post.id, state: "pending", reason: null } });
      return createdBody(unit, post.id, post.kind, post.company_name);
    });
    return { status: 200, body };
  },
});

const remove = defineRoute({
  method: "DELETE",
  path: "/api/posts/:id",
  auth: "session",
  roles: ["member"],
  load: loadOwn,
  async conflicts(_ctx, post) {
    const refusal = authorRefusal("delete", snapshotOf(post), post.within_window);
    if (refusal) throw new ApiError(refusal.code, refusal.params);
  },
  async run(ctx, post) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    await inUnit(async (unit) => {
      await unit.query("SELECT 1 FROM posts WHERE id = $1 FOR UPDATE", [post.id]);
      const locked = await unit.first<PostRow>(`${postSql("$2")} WHERE p.id = $1 AND p.deleted_at IS NULL`, [post.id, config.limits.editWindowMinutes]);
      if (!locked) throw refuse("not_found");
      const refusal = authorRefusal("delete", snapshotOf(locked), locked.within_window);
      if (refusal) throw new ApiError(refusal.code, refusal.params);
      await unit.query("UPDATE posts SET deleted_at = app_now() WHERE id = $1", [post.id]);
      await announceChange(unit, post, locked.state === "approved", "deleted", viewer.id);
    });
    return { status: 204 };
  },
});

export const postRoutes: Handler[] = [create, mine, edit, remove];
