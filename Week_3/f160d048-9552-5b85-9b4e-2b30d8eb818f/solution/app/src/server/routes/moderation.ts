import { rows, first } from "../db/pool";
import { inUnit, type Unit } from "../db/unit";
import { postedMonth } from "../domain/anonymity";
import { isModerator } from "../domain/viewer";
import { moderationRefusal, type PostSnapshot } from "../domain/postStates";
import { postLabel } from "../domain/postLabel";
import { ApiError, invalidFields, refuse } from "../http/fail";
import { defineRoute, requireJsonObject, type Ctx, type Handler } from "../http/route";
import { addHistory, lapseExpiredClaims } from "../services/claims";
import { parseDecision } from "../../shared/rules";
import { POST_KIND_NAMES, ROLE_FAMILIES, nameOf, type PostKind, type PostState } from "../../shared/reference";
import { config } from "../config";
import type { HistoryEvent, QueuePost } from "../../shared/api";

type QueueRow = {
  id: string; kind: PostKind; company_id: string; company_slug: string; company_name: string; author_id: string | null;
  state: PostState; created_at: Date; claimed_by: string | null; lapsed_by: string | null;
  claimed_by_name: string | null; decided_by_name: string | null; author_email: string | null;
  title: string | null; overall: number | null; work_life: number | null; pay: number | null; management: number | null;
  pros: string | null; cons: string | null; role_family: string | null; city: string | null; annual_pay: number | null;
  years_experience: number | null; difficulty: number | null; outcome: string | null; text: string | null;
};

const QUEUE_SQL = `SELECT p.id, p.kind, p.company_id, c.slug AS company_slug, c.name AS company_name, p.author_id, p.state, p.created_at,
  p.claimed_by, p.lapsed_by, cu.display_name AS claimed_by_name, du.display_name AS decided_by_name, au.email AS author_email,
  p.title, p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.role_family, p.city, p.annual_pay,
  p.years_experience, p.difficulty, p.outcome, p.text
  FROM posts p JOIN companies c ON c.id = p.company_id
  LEFT JOIN users cu ON cu.id = p.claimed_by LEFT JOIN users du ON du.id = p.decided_by LEFT JOIN users au ON au.id = p.author_id`;

const snapshotOf = (post: QueueRow): PostSnapshot => ({
  state: post.state,
  claimedBy: post.claimed_by,
  lapsedBy: post.lapsed_by,
  decidedByName: post.decided_by_name,
  claimedByName: post.claimed_by_name,
});

function queuePost(row: QueueRow, viewerId: string, history: HistoryEvent[]): QueuePost {
  const post: QueuePost = {
    id: row.id,
    kind: row.kind,
    label: postLabel(row),
    company_name: row.company_name,
    posted_month: postedMonth(row.created_at),
    state: row.state === "claimed" ? "claimed" : "pending",
    claimed_by_name: row.claimed_by_name,
    claimed_by_me: row.claimed_by === viewerId,
    history,
  };
  if (row.kind === "review") {
    Object.assign(post, {
      title: row.title, overall: row.overall, work_life: row.work_life, pay: row.pay, management: row.management,
      pros: row.pros, cons: row.cons,
    });
  } else if (row.kind === "pay_report") {
    Object.assign(post, {
      role_family: row.role_family, role_name: nameOf(ROLE_FAMILIES, row.role_family ?? ""), city: row.city,
      annual_pay: row.annual_pay, years_experience: row.years_experience,
    });
  } else {
    Object.assign(post, {
      role_family: row.role_family, role_name: nameOf(ROLE_FAMILIES, row.role_family ?? ""), difficulty: row.difficulty,
      outcome: row.outcome, text: row.text,
    });
  }
  return post;
}

/** A post this caller may see in moderation: not deleted, and never a moderator's own post. */
async function loadPost(ctx: Ctx): Promise<QueueRow> {
  await lapseExpiredClaims();
  const viewer = ctx.viewer;
  const post = viewer
    ? await first<QueueRow>(`${QUEUE_SQL} WHERE p.id = $1 AND p.deleted_at IS NULL`, [ctx.params["id"]])
    : undefined;
  if (!viewer || !post) throw refuse("not_found");
  const own = post.author_id === viewer.id;
  const hidden = isModerator(viewer) ? own : post.state !== "approved" && !own;
  if (hidden) throw refuse("not_found");
  return post;
}

function refusal(move: "claim" | "renew" | "decide", post: QueueRow, viewerId: string): void {
  const refused = moderationRefusal(move, snapshotOf(post), viewerId);
  if (refused) throw new ApiError(refused.code, refused.params);
}

async function lockPost(unit: Unit, id: string): Promise<QueueRow> {
  await unit.query("SELECT 1 FROM posts WHERE id = $1 FOR UPDATE", [id]);
  const post = await unit.first<QueueRow>(`${QUEUE_SQL} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
  if (!post) throw refuse("not_found");
  return post;
}

function announceState(unit: Unit, post: QueueRow, state: string, byName: string | null, byUser: string | null, reason: string | null): void {
  unit.emit({
    type: "queue.changed",
    audience: ["moderators"],
    exclude: post.author_id ?? undefined,
    data: { post_id: post.id, state, by_name: byName, by_user: byUser },
  });
  if (post.author_id) {
    unit.emit({ type: "post.state", audience: [`user:${post.author_id}`], data: { post_id: post.id, state, reason } });
  }
}

const MODERATORS = ["moderator", "founder"] as const;

const queue = defineRoute({
  method: "GET",
  path: "/api/moderation/queue",
  auth: "session",
  roles: MODERATORS,
  async load() {
    await lapseExpiredClaims();
  },
  async run(ctx) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const found = await rows<QueueRow>(
      `${QUEUE_SQL} WHERE p.deleted_at IS NULL AND p.state IN ('pending', 'claimed') AND p.author_id IS DISTINCT FROM $1
        ORDER BY p.created_at, p.id`,
      [viewer.id],
    );
    const events = await rows<{ post_id: string; type: HistoryEvent["type"]; by_name: string | null; reason: string | null; at: Date }>(
      "SELECT post_id, type, by_name, reason, at FROM post_history WHERE post_id = ANY($1) ORDER BY id",
      [found.map((row) => row.id)],
    );
    const historyOf = (postId: string): HistoryEvent[] =>
      events.filter((event) => event.post_id === postId).map((event) => ({ type: event.type, by_name: event.by_name, reason: event.reason, at: event.at.toISOString() }));
    return { status: 200, body: { posts: found.map((row) => queuePost(row, viewer.id, historyOf(row.id))) } };
  },
});

const claim = defineRoute({
  method: "POST",
  path: "/api/moderation/:id/claim",
  auth: "session",
  roles: MODERATORS,
  load: loadPost,
  async conflicts(ctx, post) {
    if (ctx.viewer) refusal("claim", post, ctx.viewer.id);
  },
  async run(ctx, post) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const claimedByName = await inUnit(async (unit) => {
      const locked = await lockPost(unit, post.id);
      refusal("claim", locked, viewer.id);
      if (locked.state === "pending") {
        await unit.query(
          "UPDATE posts SET state = 'claimed', claimed_by = $2, claimed_at = app_now(), lapsed_by = NULL WHERE id = $1",
          [post.id, viewer.id],
        );
        await addHistory(unit, post.id, "claimed", { id: viewer.id, name: viewer.displayName }, null, post.author_id);
        announceState(unit, post, "claimed", viewer.displayName, viewer.id, null);
        await unit.audit("claimed", post.id, viewer.id, {});
      }
      return viewer.displayName;
    });
    return { status: 200, body: { id: post.id, state: "claimed", claimed_by_name: claimedByName } };
  },
});

const renew = defineRoute({
  method: "POST",
  path: "/api/moderation/:id/renew",
  auth: "session",
  roles: MODERATORS,
  load: loadPost,
  async conflicts(ctx, post) {
    if (ctx.viewer) refusal("renew", post, ctx.viewer.id);
  },
  async run(ctx, post) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const leaseEnds = await inUnit(async (unit) => {
      const locked = await lockPost(unit, post.id);
      refusal("renew", locked, viewer.id);
      const renewed = await unit.first<{ lease_ends_at: Date }>(
        `UPDATE posts SET claimed_at = app_now() WHERE id = $1
         RETURNING claimed_at + make_interval(secs => $2) AS lease_ends_at`,
        [post.id, config.limits.claimLapseSeconds],
      );
      await addHistory(unit, post.id, "renewed", { id: viewer.id, name: viewer.displayName }, null, post.author_id);
      await unit.audit("renewed", post.id, viewer.id, {});
      return renewed?.lease_ends_at ?? new Date();
    });
    return { status: 200, body: { id: post.id, state: "claimed", lease_ends_at: leaseEnds.toISOString() } };
  },
});

const history = defineRoute({
  method: "GET",
  path: "/api/moderation/:id/history",
  auth: "session",
  roles: MODERATORS,
  load: loadPost,
  async run(_ctx, post) {
    const events = await rows<{ type: HistoryEvent["type"]; by_name: string | null; reason: string | null; at: Date }>(
      "SELECT type, by_name, reason, at FROM post_history WHERE post_id = $1 ORDER BY id",
      [post.id],
    );
    return { status: 200, body: { events: events.map((event) => ({ ...event, at: event.at.toISOString() })) } };
  },
});

const decision = defineRoute({
  method: "POST",
  path: "/api/moderation/:id/decision",
  auth: "session",
  roles: MODERATORS,
  body: "json",
  load: loadPost,
  async conflicts(ctx, post) {
    if (ctx.viewer) refusal("decide", post, ctx.viewer.id);
  },
  input(ctx) {
    const parsed = parseDecision(requireJsonObject(ctx));
    if (!parsed.ok) throw invalidFields(parsed.fields);
    return parsed.value;
  },
  async run(ctx, post, input) {
    const viewer = ctx.viewer;
    if (!viewer) throw refuse("unauthenticated");
    const approved = input.decision === "approve";
    const reason = input.decision === "reject" ? (input.reason === "Other" ? (input.details ?? "") : input.reason) : null;
    await inUnit(async (unit) => {
      const locked = await lockPost(unit, post.id);
      refusal("decide", locked, viewer.id);
      const state = approved ? "approved" : "rejected";
      await unit.query("UPDATE posts SET state = $2, decided_by = $3, decided_at = app_now(), reason = $4 WHERE id = $1", [
        post.id, state, viewer.id, reason,
      ]);
      await addHistory(unit, post.id, state, { id: viewer.id, name: viewer.displayName }, reason, post.author_id);
      announceState(unit, post, state, viewer.displayName, viewer.id, reason);
      await unit.audit(state, post.id, viewer.id, { reason });
      if (approved) await publish(unit, post);
      if (post.author_id && post.author_email) {
        const kind = POST_KIND_NAMES[post.kind];
        await unit.mail(
          post.author_email,
          `Your post on Candour Bench was ${state}`,
          `Your ${kind} for ${post.company_name} was ${state}.\n${reason === null ? "" : `Reason: ${reason}.\n`}`,
        );
      }
    });
    return { status: 200, body: { id: post.id, state: approved ? "approved" : "rejected", decided_by_name: viewer.displayName } };
  },
});

/** An approval changes the company's public figures and unlocks the author. */
async function publish(unit: Unit, post: QueueRow): Promise<void> {
  unit.emit({ type: "company.changed", audience: ["all"], data: { slug: post.company_slug } });
  await unit.syncSearch("companies", post.company_id);
  if (post.author_id) {
    const unlocked = await unit.first<{ id: string }>(
      "UPDATE users SET unlocked = true WHERE id = $1 AND NOT unlocked RETURNING id",
      [post.author_id],
    );
    if (unlocked) unit.emit({ type: "member.unlocked", audience: [`user:${post.author_id}`], data: {} });
  }
}

export const moderationRoutes: Handler[] = [queue, claim, renew, history, decision];
