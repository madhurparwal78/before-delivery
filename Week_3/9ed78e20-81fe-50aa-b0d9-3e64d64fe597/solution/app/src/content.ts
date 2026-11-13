import type { PoolClient } from "pg";
import {
  pool,
  all,
  one,
  transaction,
  advisory,
  id,
  now,
  saveContent,
  saveRecord,
  saveRow,
  audit,
  enqueueMail,
  staffName,
  type DB,
} from "./db.js";
import {
  fail,
  notFound,
  forbidden,
  validation,
  requireVersion,
  checkVersion,
  acceptOnly,
  illegal,
  str,
  object,
  ApiError,
} from "./errors.js";
import { requireRole, requireNonAuthor, staffRoles } from "./auth.js";
import {
  contentMove,
  emptyReleaseRecord,
  validateClaims,
  readTime,
  londonInstant,
  validSlug,
  validScore,
  comparators,
  subjects,
  validDate,
  grantActive,
  withinLength,
  codePoints,
  signedStatus,
} from "./domain.js";
import { indexContent, unindex } from "./search.js";
import { config } from "./config.js";
import type {
  Staff,
  Content,
  ReleaseRecord,
  BenchmarkRow,
  Grant,
} from "./types.js";
export interface ApiResult {
  status: number;
  data: unknown;
  version?: number;
  headers?: Record<string, string>;
}
export interface ApiContext {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  version?: string;
  staff: Staff;
}
const ok = (data: unknown, status = 200, version?: number): ApiResult => ({
  status,
  data,
  version,
});
const editableKeys = {
  news: ["slug", "title", "summary", "body", "subject", "tags"],
  model: ["slug", "title", "summary", "body", "claims", "linked_news_slug"],
} as const;
const verbKeys: Record<string, readonly string[]> = {
  submit: [],
  approve: [],
  release: [],
  withdraw: [],
  return: ["reason"],
  schedule: ["release_at_local"],
  comments: ["body"],
  "release-record/signoffs": ["kind", "note"],
  "release-record/validate-claims": [],
  "release-record/clear": [],
};
const versioned = [
  "",
  "submit",
  "approve",
  "return",
  "schedule",
  "release",
  "withdraw",
];
const nonAuthor = [
  "approve",
  "return",
  "schedule",
  "release",
  "release-record/signoffs",
  "release-record/clear",
];
function contentFields(
  input: Record<string, unknown>,
  current?: Content,
): Content {
  const kind = current?.kind || input.kind;
  // A key present in the request replaces the stored value, even as null.
  const sent = (key: string): boolean => Object.hasOwn(input, key);
  const text = (key: "slug" | "title" | "summary" | "body"): string =>
    str(sent(key) ? input[key] : current?.[key]).trim();
  const listOf = (key: "tags" | "claims"): unknown[] | undefined =>
    !sent(key) ? undefined : Array.isArray(input[key]) ? input[key] : [null];
  return {
    id: current?.id || id(),
    kind: kind === "model" ? "model" : "news",
    slug: text("slug"),
    title: text("title"),
    summary: text("summary"),
    body: text("body"),
    subject:
      kind === "news"
        ? str(sent("subject") ? input.subject : current?.subject)
        : null,
    tags:
      kind === "news"
        ? (listOf("tags") ?? current?.tags ?? []).map((t) =>
            typeof t === "string" ? t.trim() : "",
          )
        : null,
    claims:
      kind === "model"
        ? (listOf("claims") ?? current?.claims ?? []).map((v: unknown) => {
            const x = object(v);
            return {
              id: str(x.id),
              text: str(x.text).trim(),
              benchmark: str(x.benchmark).trim(),
              eval_date: str(x.eval_date),
              comparator: str(x.comparator),
              stated_delta: str(x.stated_delta),
            };
          })
        : null,
    linked_news_slug:
      kind === "model"
        ? str(
            sent("linked_news_slug")
              ? input.linked_news_slug
              : current?.linked_news_slug,
          ).trim() || null
        : null,
    status: current?.status || "draft",
    version: current?.version || 1,
    author: current?.author || "",
    comments: current?.comments || [],
    release_at: current?.release_at || null,
    release_at_local: current?.release_at_local || null,
    published_at: current?.published_at || null,
    read_time_minutes: current?.read_time_minutes || null,
  };
}
async function validateContent(
  db: DB,
  c: Content,
  kind: unknown,
): Promise<void> {
  const fields: Record<string, string> = {};
  if (kind !== "model" && kind !== "news")
    fields.kind = "Choose model or news.";
  if (!validSlug(c.slug))
    fields.slug =
      "Use lowercase letters, numbers and single hyphens, up to 80 characters.";
  else if (
    (
      await db.query("SELECT 1 FROM content WHERE slug=$1 AND id<>$2", [
        c.slug,
        c.id,
      ])
    ).rowCount
  )
    fields.slug = "That slug is already in use.";
  if (!c.title) fields.title = "Enter a title.";
  if (c.kind === "news" && !Object.hasOwn(subjects, c.subject || ""))
    fields.subject = "Choose research, safety, policy or company.";
  if (c.kind === "news" && (c.tags || []).some((t) => !validSlug(t)))
    fields.tags = "Use lowercase tags of letters, numbers and single hyphens.";
  if (c.kind === "news" && /\[claim:/.test(c.body))
    fields.body = "Claim markers belong on model routes.";
  if (
    c.kind === "model" &&
    (c.claims || []).some(
      (x) =>
        !/^c\d+$/.test(x.id) ||
        !x.text ||
        !x.benchmark ||
        !validDate(x.eval_date) ||
        !comparators[x.comparator] ||
        !/^[-+]?\d+(?:\.\d{1,2})?$/.test(x.stated_delta),
    )
  )
    fields.claims =
      "Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.";
  if (
    c.linked_news_slug &&
    !(
      await db.query("SELECT 1 FROM content WHERE kind='news' AND slug=$1", [
        c.linked_news_slug,
      ])
    ).rowCount
  )
    fields.linked_news_slug = "No news post has that slug.";
  if (Object.keys(fields).length) validation(fields);
}
async function contentBySlug(
  db: DB,
  kind: "model" | "news",
  slug: string,
  lock = false,
): Promise<Content | undefined> {
  return (
    await db.query<{ data: Content }>(
      `SELECT data FROM content WHERE kind=$1 AND slug=$2${lock ? " FOR UPDATE" : ""}`,
      [kind, slug],
    )
  ).rows[0]?.data;
}
const scheduledModelFor = async (
  db: DB,
  post: Content,
): Promise<Content | undefined> =>
  (
    await db.query<{ data: Content }>(
      "SELECT data FROM content WHERE kind='model' AND status='scheduled' AND data->>'linked_news_slug'=$1",
      [post.slug],
    )
  ).rows[0]?.data;
// Publishes an item (and a model route's scheduled announcement) on every public surface.
export async function publishContent(
  db: PoolClient,
  c: Content,
  actor: string,
  instant: string,
): Promise<void> {
  const expected = c.version;
  c.status = contentMove(c.status, "release");
  c.published_at = instant;
  c.read_time_minutes = readTime(c);
  c.version++;
  await saveContent(db, c, expected);
  await db.query(
    "INSERT INTO publication_history(content_id,published_at) VALUES($1,$2)",
    [c.id, instant],
  );
  await indexContent(db, c);
  const schedule = (
    await db.query<{ scheduled_by: string }>(
      "DELETE FROM embargo_schedules WHERE content_id=$1 RETURNING scheduled_by",
      [c.id],
    )
  ).rows[0];
  await audit(db, actor, "content.release", "content", c.id, {
    scheduled_by: schedule.scheduled_by,
  });
  if (c.kind === "model" && c.linked_news_slug) {
    const post = (await contentBySlug(db, "news", c.linked_news_slug, true))!;
    await publishContent(db, post, actor, instant);
  }
}
// The embargo schedule names the approver who set it, for the release's audit entry.
async function embargo(db: DB, c: Content, approver: string): Promise<void> {
  await db.query(
    "INSERT INTO embargo_schedules(content_id,release_at,scheduled_by) VALUES($1,$2,$3)",
    [c.id, c.release_at, approver],
  );
}
async function withdrawContent(
  db: PoolClient,
  c: Content,
  actor: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const expected = c.version;
  const wasPublished = c.status === "published";
  c.status = contentMove(c.status, "withdraw");
  c.version++;
  await saveContent(db, c, expected);
  if (wasPublished) {
    await db.query(
      "UPDATE publication_history SET withdrawn_at=now() WHERE content_id=$1",
      [c.id],
    );
    await unindex(db, c.kind, c.slug);
  } else
    await db.query("DELETE FROM embargo_schedules WHERE content_id=$1", [c.id]);
  await audit(db, actor, "content.withdraw", "content", c.id, detail);
}
const hasApprover = async (db: DB, email: string): Promise<boolean> =>
  (await staffRoles(db, email)).some((r) => r.role === "approver");
async function lapsed(db: DB, record: ReleaseRecord): Promise<boolean> {
  for (const kind of ["safety", "legal"] as const) {
    const signer = record[kind]?.by;
    if (signer && !(await hasApprover(db, signer))) return true;
  }
  return false;
}
// Voids sign-offs on uncleared records whose signer no longer holds an active approver grant.
export async function voidLapsedSignoffs(
  db: PoolClient,
  actor: string,
  signer?: string,
): Promise<void> {
  const records = await db.query<{ id: string; data: ReleaseRecord }>(
    "SELECT r.id,r.data FROM release_records r JOIN content c ON c.id=r.id WHERE r.data->>'status'<>'cleared' AND (r.data->'safety'<>'null'::jsonb OR r.data->'legal'<>'null'::jsonb) ORDER BY r.id FOR UPDATE OF c,r",
  );
  for (const { id: key, data: record } of records.rows) {
    let changed = false;
    for (const kind of ["safety", "legal"] as const) {
      const by = record[kind]?.by;
      if (!by || (signer && by !== signer) || (await hasApprover(db, by)))
        continue;
      record[kind] = null;
      changed = true;
      await audit(db, actor, "release_record.void", "content", key, {
        reason: "signoff_lapsed",
        kind,
        signer: by,
      });
    }
    if (!changed) continue;
    record.claims_validated_at = null;
    record.last_validation = null;
    record.status = signedStatus(record);
    await saveRecord(db, key, record);
  }
}
async function rowsApi(ctx: ApiContext): Promise<ApiResult> {
  const { method, body, staff } = ctx;
  if (method === "PATCH" || method === "DELETE")
    fail(405, "rows_immutable", "Recorded rows cannot be changed.");
  requireRole(staff, "editor", "approver");
  if (method === "GET")
    return ok({ rows: await all<BenchmarkRow>(pool, "benchmark_rows") });
  return transaction(async (db) => {
    await advisory(db, "benchmark-rows");
    const subject = str(body.subject),
      benchmark = str(body.benchmark).trim(),
      eval_date = str(body.eval_date),
      score = str(body.score).trim();
    const model = await contentBySlug(db, "model", subject);
    const fields: Record<string, string> = {};
    if (!model && !comparators[subject])
      fields.subject = "Choose a model route or a recorded comparator.";
    if (!validScore(score))
      fields.score = "Enter a score from 0 to 100 with at most two decimals.";
    if (!withinLength(benchmark, 120)) fields.benchmark = "Enter a benchmark.";
    if (!validDate(eval_date)) fields.eval_date = "Enter an evaluation date.";
    if (Object.keys(fields).length) validation(fields);
    if (
      (
        await db.query(
          "SELECT 1 FROM benchmark_rows WHERE subject=$1 AND benchmark=$2 AND eval_date=$3",
          [subject, benchmark, eval_date],
        )
      ).rowCount
    )
      fail(
        409,
        "row_exists",
        "A row for this model, benchmark and date is already recorded.",
      );
    const row: BenchmarkRow = {
      id: id(),
      subject,
      benchmark,
      eval_date,
      score,
      source_note: str(body.source_note).trim(),
      subject_name: model?.title || comparators[subject].name,
      organisation: model
        ? "Aldermoor Labs"
        : comparators[subject].organisation,
    };
    await saveRow(db, row);
    await audit(db, staff.email, "row.create", "row", row.id, {
      subject,
      benchmark,
      eval_date,
      score,
    });
    return ok({ row }, 201);
  });
}
async function createContent(ctx: ApiContext): Promise<ApiResult> {
  const { body, staff } = ctx;
  requireRole(staff, "editor");
  const kind = body.kind;
  acceptOnly(body, [
    "kind",
    ...(kind === "model"
      ? editableKeys.model
      : kind === "news"
        ? editableKeys.news
        : [...new Set([...editableKeys.news, ...editableKeys.model])]),
  ]);
  return transaction(async (db) => {
    await advisory(db, "content-slugs");
    const c = contentFields(body);
    c.author = staff.email;
    await validateContent(db, c, kind);
    await saveContent(db, c);
    if (c.kind === "model") await saveRecord(db, c.id, emptyReleaseRecord());
    await audit(db, staff.email, "content.create", "content", c.id, {
      kind: c.kind,
      slug: c.slug,
    });
    return ok({ content: c }, 201, c.version);
  });
}
async function recordAction(
  db: PoolClient,
  c: Content,
  record: ReleaseRecord,
  verb: string,
  body: Record<string, unknown>,
  staff: Staff,
): Promise<ApiResult> {
  if (verb === "signoffs") {
    if (!["in_review", "approved"].includes(c.status))
      fail(
        409,
        "not_in_review",
        "Sign-offs are recorded while a route is in review or approved.",
      );
    const kind = body.kind as "safety" | "legal";
    const other = kind === "safety" ? "legal" : "safety";
    if (record[kind])
      fail(409, "already_signed", "This sign-off is already recorded.");
    if (record[other]?.by === staff.email)
      fail(
        409,
        "distinct_approver_required",
        "Safety and legal sign-off must come from different approvers.",
      );
    record[kind] = {
      by: staff.email,
      at: now(),
      note: str(body.note).trim(),
    };
    record.status = signedStatus(record);
    await saveRecord(db, c.id, record);
    await audit(db, staff.email, `signoff.${kind}`, "content", c.id, {
      kind,
    });
    return ok({ record }, 201);
  }
  if (verb === "validate-claims") {
    if (!record.safety || !record.legal)
      fail(
        409,
        "signoffs_incomplete",
        "Record both sign-offs before validating claims.",
      );
    if (record.status === "cleared") illegal("cleared", "claims_validated");
    if (await lapsed(db, record))
      fail(
        409,
        "signoff_lapsed",
        "A sign-off holder no longer holds the approver role. Record that sign-off again.",
      );
    const result = validateClaims(
      c,
      await all<BenchmarkRow>(db, "benchmark_rows"),
    );
    const invalid = Object.keys(result.fields).length > 0;
    record.last_validation = result.results;
    record.status = invalid ? "signed" : "claims_validated";
    record.claims_validated_at = invalid ? null : now();
    await saveRecord(db, c.id, record);
    await audit(db, staff.email, "claims.validate", "content", c.id, {
      ok: !invalid,
      results: result.results,
    });
    if (invalid)
      return ok(
        new ApiError(
          422,
          "claims_invalid",
          "Some claims do not match the recorded rows.",
          result.fields,
        ).toJSON(),
        422,
      );
    return ok({ record });
  }
  if (record.status !== "claims_validated")
    fail(
      409,
      "claims_not_validated",
      "Validate the claims before clearing this record.",
    );
  if (await lapsed(db, record))
    fail(
      409,
      "signoff_lapsed",
      "A sign-off holder no longer holds the approver role. Record that sign-off again.",
    );
  record.status = "cleared";
  record.cleared_by = staff.email;
  record.cleared_at = now();
  await saveRecord(db, c.id, record);
  await audit(db, staff.email, "release_record.clear", "content", c.id);
  return ok({ record });
}
export async function contentApi(ctx: ApiContext): Promise<ApiResult | null> {
  const { method, path, body, version, staff, query } = ctx;
  if (/^\/api\/console\/benchmark-rows(\/[^/]+)?$/.test(path))
    return rowsApi(ctx);
  if (path === "/api/console/content") {
    if (method === "POST") return createContent(ctx);
    requireRole(staff, "editor", "approver");
    const status = query.get("status");
    return ok({
      items: (await all<Content>(pool, "content")).filter(
        (c) => !status || c.status === status,
      ),
    });
  }
  const match = path.match(/^\/api\/console\/content\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  const [, cid, verb = ""] = match;
  return transaction(async (db) => {
    const c = await one<Content>(db, "content", cid, method !== "GET");
    if (!c) notFound();
    const record = await one<ReleaseRecord>(db, "release_records", cid);
    if (verb.startsWith("release-record") && !record) notFound();
    if (method === "GET") {
      requireRole(staff, "editor", "approver");
      return verb === "release-record"
        ? ok({ record })
        : ok({ content: c }, 200, c.version);
    }
    let linkedPost: Content | undefined;
    if (
      c.kind === "model" &&
      c.linked_news_slug &&
      ["schedule", "release"].includes(verb)
    )
      linkedPost = await contentBySlug(db, "news", c.linked_news_slug, true);
    if (nonAuthor.includes(verb)) {
      requireNonAuthor(c.author, staff.email);
      if (linkedPost) requireNonAuthor(linkedPost.author, staff.email);
      requireRole(staff, "approver");
    } else if (verb === "" || verb === "submit") {
      requireRole(staff, "editor");
      if (c.author !== staff.email) forbidden();
    } else if (verb === "withdraw") requireRole(staff, "approver");
    else requireRole(staff, "editor", "approver");
    const expected = versioned.includes(verb)
      ? requireVersion(version)
      : c.version;
    acceptOnly(body, verb === "" ? editableKeys[c.kind] : verbKeys[verb] || []);
    let updated: Content | undefined;
    let localInstant: string | undefined;
    if (verb === "") {
      if (!Object.keys(body).length) validation({});
      await advisory(db, "content-slugs");
      updated = contentFields(body, c);
      await validateContent(db, updated, c.kind);
    }
    if (verb === "return" && !withinLength(str(body.reason), 2000))
      validation({ reason: "Say what needs to change." });
    if (verb === "comments" && !withinLength(str(body.body), 4000))
      validation({ body: "Enter a comment of at most 4,000 characters." });
    if (verb === "schedule")
      localInstant = londonInstant(str(body.release_at_local));
    if (verb === "release-record/signoffs") {
      const fields: Record<string, string> = {};
      if (!["safety", "legal"].includes(str(body.kind)))
        fields.kind = "Choose safety or legal.";
      if (codePoints(str(body.note)) > 2000)
        fields.note = "Enter a note of at most 2,000 characters.";
      if (Object.keys(fields).length) validation(fields);
    }
    checkVersion(expected, c.version);
    if (verb.startsWith("release-record/"))
      return recordAction(
        db,
        c,
        record!,
        verb.slice("release-record/".length),
        body,
        staff,
      );
    if (verb === "comments") {
      if (!["draft", "in_review", "returned", "approved"].includes(c.status))
        fail(
          409,
          "comments_closed",
          "Comments are closed once an item is scheduled.",
        );
      const comment = {
        id: id(),
        author: staff.email,
        body: str(body.body).trim(),
        created_at: now(),
      };
      c.comments.push(comment);
      await saveContent(db, c, c.version);
      await audit(db, staff.email, "content.comment", "content", cid, {
        comment: comment.id,
      });
      return ok({ comment }, 201);
    }
    if (verb === "") {
      if (!["draft", "returned"].includes(c.status))
        fail(
          409,
          "not_editable",
          "Only drafts and returned items can be edited.",
        );
      Object.assign(c, updated);
      c.version++;
      await saveContent(db, c, expected);
      await audit(db, staff.email, "content.update", "content", cid, {
        fields: Object.keys(body).sort(),
      });
      if (
        record &&
        (record.status !== "open" || record.last_validation !== null)
      ) {
        await saveRecord(db, cid, emptyReleaseRecord());
        await audit(db, staff.email, "release_record.void", "content", cid, {
          reason: "route_edited",
        });
      }
      return ok({ content: c }, 200, c.version);
    }
    if (
      c.kind === "news" &&
      ["schedule", "release", "withdraw"].includes(verb) &&
      (await scheduledModelFor(db, c))
    )
      fail(409, "linked_to_model", "This post releases with its model route.");
    const to = contentMove(c.status, verb);
    if (verb === "release") {
      await publishContent(db, c, staff.email, now());
      return ok({ content: c }, 200, c.version);
    }
    if (verb === "withdraw") {
      const post =
        c.kind === "model" && c.linked_news_slug
          ? await contentBySlug(db, "news", c.linked_news_slug, true)
          : undefined;
      await withdrawContent(db, c, staff.email);
      if (post && ["published", "scheduled"].includes(post.status))
        await withdrawContent(db, post, staff.email, { linked_model: cid });
      return ok({ content: c }, 200, c.version);
    }
    if (verb === "schedule") {
      if (c.kind === "model" && record?.status !== "cleared")
        fail(
          409,
          "release_record_not_cleared",
          "This model route's release record is not cleared.",
        );
      if (c.linked_news_slug) {
        if (!linkedPost || linkedPost.status !== "approved")
          fail(
            409,
            "linked_post_not_ready",
            "The linked announcement must be approved before scheduling.",
          );
        const postExpected = linkedPost.version;
        linkedPost.status = contentMove(linkedPost.status, "schedule");
        linkedPost.release_at = localInstant!;
        linkedPost.release_at_local = str(body.release_at_local);
        linkedPost.version++;
        await saveContent(db, linkedPost, postExpected);
        await embargo(db, linkedPost, staff.email);
        await audit(
          db,
          staff.email,
          "content.schedule",
          "content",
          linkedPost.id,
          { release_at: localInstant, linked_model: cid },
        );
      }
      c.release_at = localInstant!;
      c.release_at_local = str(body.release_at_local);
      await embargo(db, c, staff.email);
    }
    c.status = to;
    c.version++;
    if (verb === "return")
      c.comments.push({
        id: id(),
        author: staff.email,
        body: str(body.reason).trim(),
        created_at: now(),
      });
    await saveContent(db, c, expected);
    await audit(
      db,
      staff.email,
      `content.${verb}`,
      "content",
      cid,
      verb === "schedule"
        ? { release_at: localInstant }
        : verb === "return"
          ? { reason: str(body.reason).trim() }
          : {},
    );
    if (verb === "submit" && c.kind === "model") {
      const approvers = new Set(
        (await all<Grant>(db, "grants"))
          .filter(
            (g) =>
              g.role === "approver" &&
              g.staff_email !== c.author &&
              grantActive(g),
          )
          .map((g) => g.staff_email),
      );
      for (const email of approvers)
        await enqueueMail(
          db,
          { name: await staffName(db, email), email },
          `Release record awaiting sign-off: ${c.title}`,
          `${c.title}\n${config.publicBaseUrl}/console/content/${c.id}`,
        );
    }
    return ok(
      verb === "schedule"
        ? { content: c, zone: "Europe/London" }
        : { content: c },
      200,
      c.version,
    );
  });
}
