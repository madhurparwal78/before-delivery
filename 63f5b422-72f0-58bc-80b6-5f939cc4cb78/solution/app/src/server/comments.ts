import { ApiError, invalid, notFound } from "../shared/errors.js";
import { locateOnPage } from "../shared/tree.js";
import type { CommentThread, Role, WorkspaceDoc } from "../shared/types.js";
import { memberRole, workspaceOf } from "./access.js";
import type { User } from "./auth.js";
import { config } from "./config.js";
import { all, newId, one, pool } from "./db.js";
import { broadcast } from "./live.js";
import { sendMail } from "./mail.js";
import { loadDoc } from "./workspaces.js";

interface CommentRow {
  id: string;
  workspace_id: string;
  page_id: string;
  node_id: string;
  node_name: string;
  author_id: string;
  author_name: string;
  body: string;
  status: "open" | "resolved";
  created_at: Date;
}

const SELECT_COMMENT = `SELECT c.id, c.workspace_id, c.page_id, c.node_id, c.node_name, c.author_id, u.name AS author_name, c.body, c.status, c.created_at
  FROM comments c JOIN users u ON u.id = c.author_id`;

async function threads(doc: WorkspaceDoc, rows: CommentRow[]): Promise<CommentThread[]> {
  const replies = await all<{ id: string; comment_id: string; author_id: string; author_name: string; body: string; created_at: Date }>(
    pool,
    "SELECT r.id, r.comment_id, r.author_id, u.name AS author_name, r.body, r.created_at FROM replies r JOIN users u ON u.id = r.author_id WHERE r.comment_id = ANY($1) ORDER BY r.created_at",
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({
    id: r.id,
    pageId: r.page_id,
    nodeId: r.node_id,
    nodeName: locateOnPage(doc, r.node_id)?.node.name ?? r.node_name,
    author: { id: r.author_id, name: r.author_name },
    body: r.body,
    createdAt: r.created_at.toISOString(),
    status: r.status,
    replies: replies
      .filter((x) => x.comment_id === r.id)
      .map((x) => ({ id: x.id, author: { id: x.author_id, name: x.author_name }, body: x.body, createdAt: x.created_at.toISOString() })),
  }));
}

async function threadById(id: string): Promise<CommentThread> {
  const row = await one<CommentRow>(pool, `${SELECT_COMMENT} WHERE c.id = $1`, [id]);
  if (!row) throw notFound();
  const [thread] = await threads(await loadDoc(row.workspace_id), [row]);
  return thread;
}

export async function listThreads(user: User, workspaceId: string, pageId: string | null): Promise<CommentThread[]> {
  await memberRole(user, workspaceId);
  const doc = await loadDoc(workspaceId);
  if (!pageId || !doc.pages.some((p) => p.id === pageId)) throw notFound();
  const rows = await all<CommentRow>(pool, `${SELECT_COMMENT} WHERE c.workspace_id = $1 AND c.page_id = $2 ORDER BY c.created_at`, [workspaceId, pageId]);
  return threads(doc, rows);
}

function bodyOf(raw: Record<string, unknown>): string {
  const body = raw.body;
  if (typeof body !== "string" || body.trim().length < 1 || body.length > 2000) throw invalid({ body: "A comment is 1 to 2,000 characters." });
  return body;
}

/** Mention mail: one mail per mentioned member (never the author) per comment or reply. Returns the addresses that failed. */
async function mentionMail(workspaceId: string, author: User, thread: CommentThread, text: string): Promise<string[]> {
  const mentioned = new Set([...text.matchAll(/@([^\s@,;:!?()<>]+@[^\s@,;:!?()<>]+\.[a-z0-9-]+)/gi)].map((m) => m[1].replace(/\.+$/, "").toLowerCase()));
  if (!mentioned.size) return [];
  const members = await all<{ id: string; email: string }>(pool, "SELECT u.id, u.email FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = ANY($2)", [workspaceId, [...mentioned]]);
  const doc = await loadDoc(workspaceId);
  const page = doc.pages.find((p) => p.id === thread.pageId);
  const link = `${config.publicUrl}/w/${workspaceId}/edit?page=${thread.pageId}`;
  const failed: string[] = [];
  for (const member of members) {
    if (member.id === author.id) continue;
    const quoted = text.split("\n").map((line) => `> ${line}`).join("\n");
    try {
      await sendMail({
        to: member.email,
        subject: `${author.name} mentioned you on ${page?.name ?? ""}`,
        text: `${author.name} mentioned you in a comment on ${thread.nodeName} on the page ${page?.name ?? ""}.\n\n${quoted}\n\nOpen the page in Plinth:\n${link}\n`,
      });
    } catch {
      failed.push(member.email);
    }
  }
  return failed;
}

export async function createThread(user: User, workspaceId: string, raw: Record<string, unknown>): Promise<CommentThread & { mentionFailures?: string[] }> {
  await memberRole(user, workspaceId);
  const doc = await loadDoc(workspaceId);
  const page = doc.pages.find((p) => p.id === raw.pageId);
  const found = typeof raw.nodeId === "string" ? locateOnPage(doc, raw.nodeId) : null;
  if (!page || !found || found.owner.page.id !== page.id) throw notFound();
  const body = bodyOf(raw);
  const id = newId("m");
  await pool.query("INSERT INTO comments (id, workspace_id, page_id, node_id, node_name, author_id, body, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')", [
    id,
    workspaceId,
    page.id,
    found.node.id,
    found.node.name,
    user.id,
    body,
  ]);
  const thread = await threadById(id);
  broadcast(workspaceId, { type: "comment", thread });
  const failed = await mentionMail(workspaceId, user, thread, body);
  return failed.length ? { ...thread, mentionFailures: failed } : thread;
}

async function threadContext(user: User, commentId: string): Promise<{ workspaceId: string; role: Role; thread: CommentThread }> {
  const workspaceId = await workspaceOf("comment", commentId);
  const role = await memberRole(user, workspaceId);
  return { workspaceId, role, thread: await threadById(commentId) };
}

export async function reply(user: User, commentId: string, raw: Record<string, unknown>): Promise<{ id: string; author: { id: string; name: string }; body: string; createdAt: string; mentionFailures?: string[] }> {
  const { workspaceId, thread } = await threadContext(user, commentId);
  const body = bodyOf(raw);
  const id = newId("m");
  const row = await one<{ created_at: Date }>(pool, "INSERT INTO replies (id, comment_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING created_at", [id, commentId, user.id, body]);
  broadcast(workspaceId, { type: "comment", thread: await threadById(commentId) });
  const failed = await mentionMail(workspaceId, user, thread, body);
  const out = { id, author: { id: user.id, name: user.name }, body, createdAt: (row?.created_at ?? new Date()).toISOString() };
  return failed.length ? { ...out, mentionFailures: failed } : out;
}

/** Resolve and reopen: owners and editors any thread, a viewer only threads they started. */
export async function setStatus(user: User, commentId: string, status: "open" | "resolved"): Promise<CommentThread> {
  const { workspaceId, role, thread } = await threadContext(user, commentId);
  if (role === "viewer" && thread.author.id !== user.id) throw new ApiError(403, "forbidden_role", "Viewers can resolve only threads they started.");
  const changed = await one(pool, "UPDATE comments SET status = $2 WHERE id = $1 AND status <> $2 RETURNING id", [commentId, status]);
  if (!changed && status === "resolved") throw new ApiError(409, "already_resolved", "This thread is already resolved.");
  if (!changed) throw new ApiError(409, "not_resolved", "This thread is not resolved.");
  const updated = await threadById(commentId);
  broadcast(workspaceId, { type: "comment", thread: updated });
  return updated;
}
