import { Router } from "express";
import { randomBytes } from "node:crypto";
import { query } from "../db";
import { errors, requireAuth, assertNotReadOnly } from "../http";
import { audit } from "../audit";
import { callerAuthor, getSceneRow, activeLocks, tryClaim, releaseLock, holderOf } from "./scenes";
import { hub, publishLock, publishPresence, publishComment } from "../realtime";
import { pocketbase } from "../services";

export const realtimeRouter = Router();
realtimeRouter.use(requireAuth);

realtimeRouter.get("/:sceneId/events", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    await getSceneRow(req.params.sceneId, ws);
    const sceneId = req.params.sceneId;
    hub.subscribe(sceneId, res);
  } catch (e) {
    next(e);
  }
});

realtimeRouter.post("/:sceneId/presence", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const body = req.body ?? {};
    const selection = body.selection === null || body.selection === undefined ? null : typeof body.selection === "string" ? body.selection : null;
    const author = callerAuthor(caller);
    await pocketbase().heartbeat(scene.workspace_id, scene.id, author.kind === "agent" ? "agent" : "member", author.id, author.name, selection);
    publishPresence(scene.id, { authors: [{ author, selection }] });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

realtimeRouter.get("/:sceneId/locks", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const locks = await activeLocks(scene.id);
    const out = [...locks.entries()].map(([nodeId, holder]) => ({
      nodeId,
      holder,
      expiresAt: new Date(Date.now() + 30_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }));
    res.json({ locks: out });
  } catch (e) {
    next(e);
  }
});

realtimeRouter.post("/:sceneId/locks", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const canEdit = (caller.kind === "agent" && caller.token.scope === "edit") ||
      (caller.kind === "member" && ["owner", "editor"].includes(caller.member.role));
    if (!canEdit) throw errors.forbidden();
    await assertNotReadOnly(ws);
    const nodeId = req.body?.nodeId;
    if (typeof nodeId !== "string") throw errors.validation({ nodeId: "Node is required" });
    const author = callerAuthor(caller);
    const existing = await holderOf(scene.id, nodeId);
    if (existing && !(existing.id === author.id && existing.kind === author.kind)) {
      throw errors.conflict("locked", { nodeId, holder: existing });
    }
    const won = await tryClaim(scene.id, nodeId, author);
    if (!won) {
      const holder = await holderOf(scene.id, nodeId) ?? author;
      throw errors.conflict("locked", { nodeId, holder });
    }
    publishLock(scene.id, { nodeId, holder: author });
    res.json({
      lock: {
        nodeId,
        holder: author,
        expiresAt: new Date(Date.now() + 30_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
    });
  } catch (e) {
    next(e);
  }
});

realtimeRouter.delete("/:sceneId/locks/:nodeId", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const author = callerAuthor(caller);
    const released = await pocketbase().releaseLock(scene.id, req.params.nodeId!, author.id);
    if (!released) throw errors.conflict("not_lock_holder");
    publishLock(scene.id, { nodeId: req.params.nodeId, holder: null });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

realtimeRouter.post("/:sceneId/locks/:nodeId/takeover", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const canEdit = (caller.kind === "agent" && caller.token.scope === "edit") ||
      (caller.kind === "member" && ["owner", "editor"].includes(caller.member.role));
    if (!canEdit) throw errors.forbidden();
    await assertNotReadOnly(ws);
    const nodeId = req.params.nodeId;
    const author = callerAuthor(caller);
    const previous = await holderOf(scene.id, nodeId);
    if (previous) {
      await releaseLock(scene.id, nodeId, previous.id);
    }
    const won = await tryClaim(scene.id, nodeId, author);
    if (!won) {
      const holder = await holderOf(scene.id, nodeId) ?? author;
      throw errors.conflict("locked", { nodeId, holder });
    }
    publishLock(scene.id, { nodeId, holder: author });
    res.json({
      lock: {
        nodeId,
        holder: author,
        expiresAt: new Date(Date.now() + 30_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      },
      previousHolder: previous,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const commentsRouter = Router();
commentsRouter.use(requireAuth);

commentsRouter.get("/:sceneId/comments", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    const rows = await query(
      "SELECT c.id, c.node_id, c.body, c.author_id, c.author_kind, c.author_name, c.mentions, c.resolved, c.created_at FROM comments c WHERE c.scene_id = $1 ORDER BY c.created_at",
      [scene.id],
    );
    res.json({
      comments: rows.rows.map((r) => {
        const row = r as { id: string; node_id: string; body: string; author_id: string; author_kind: string; author_name: string; mentions: { id: string; name: string }[]; resolved: boolean; created_at: Date };
        return {
          id: row.id,
          nodeId: row.node_id,
          body: row.body,
          author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
          mentions: row.mentions ?? [],
          resolved: row.resolved,
          createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

commentsRouter.post("/:sceneId/comments", async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    const scene = await getSceneRow(req.params.sceneId, ws);
    if (caller.kind === "agent") throw errors.forbidden();
    await assertNotReadOnly(ws);
    const body = req.body ?? {};
    const text = typeof body.body === "string" ? body.body : "";
    const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m: unknown) => typeof m === "string") : [];
    const fieldErrors: Record<string, string> = {};
    if (text.length < 1 || text.length > 2000) fieldErrors.body = "Body must be 1-2000 characters";
    if (!nodeId) fieldErrors.nodeId = "Node is required";
    if (Object.keys(fieldErrors).length > 0) throw errors.validation(fieldErrors);
    // validate mentions and nodeId belong to this workspace
    const graph = await (await import("./scenes")).graphAt(scene.id, await (await import("./scenes")).latestSeq(scene.id));
    if (!graph.graph.nodes.some((n) => n.id === nodeId)) throw errors.validation({ nodeId: "Node does not exist" });
    const memberRows = await query(
      "SELECT id, name FROM members WHERE workspace_id = $1 AND removed_at IS NULL",
      [ws],
    );
    const members = memberRows.rows as { id: string; name: string }[];
    const mentionInfos: { id: string; name: string }[] = [];
    for (const m of mentions) {
      const found = members.find((x) => x.id === m);
      if (!found) throw errors.notFound();
      mentionInfos.push({ id: found.id, name: found.name });
    }
    const id = `cmt_${randomBytes(9).toString("hex")}`;
    const author = callerAuthor(caller);
    await query(
      "INSERT INTO comments (id, scene_id, node_id, body, author_id, author_kind, author_name, mentions, resolved) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)",
      [id, scene.id, nodeId, text, author.id, author.kind, author.name, JSON.stringify(mentionInfos)],
    );
    await pocketbase().syncComment(ws, scene.id, { id, nodeId, body: text, authorId: author.id, authorName: author.name, mentions: mentionInfos.map((m) => m.id), resolved: false });
    audit(caller, "comment.posted", { type: "comment", id });
    const comment = {
      id,
      nodeId,
      body: text,
      author,
      mentions: mentionInfos,
      resolved: false,
      createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    publishComment(scene.id, comment);
    res.status(201).json(comment);
  } catch (e) {
    next(e);
  }
});

export const commentPatchRouter = Router();

commentPatchRouter.patch("/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const caller = req.caller!;
    const ws = caller.kind === "agent" ? caller.token.workspace_id : caller.member.workspace_id;
    if (caller.kind === "agent") throw errors.forbidden();
    const rows = await query(
      `SELECT c.id, c.scene_id, c.node_id, c.body, c.author_id, c.author_kind, c.author_name, c.mentions, c.resolved, c.created_at, s.workspace_id
       FROM comments c JOIN scenes s ON s.id = c.scene_id WHERE c.id = $1`,
      [req.params.commentId],
    );
    const row = rows.rows[0] as (Omit<CommentRow, "workspace_id"> & { workspace_id: string }) | undefined;
    if (!row || row.workspace_id !== ws) throw errors.notFound();
    await assertNotReadOnly(ws);
    const resolved = req.body?.resolved;
    if (typeof resolved !== "boolean") throw errors.validation({ resolved: "Must be a boolean" });
    await query("UPDATE comments SET resolved = $1 WHERE id = $2", [resolved, row.id]);
    audit(caller, resolved ? "comment.resolved" : "comment.reopened", { type: "comment", id: row.id });
    const author = callerAuthor(caller);
    const comment = {
      id: row.id,
      nodeId: row.node_id,
      body: row.body,
      author: { kind: row.author_kind, id: row.author_id, name: row.author_name },
      mentions: row.mentions ?? [],
      resolved,
      createdAt: row.created_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    publishComment(row.scene_id, comment);
    await pocketbase().syncComment(ws, row.scene_id, { id: row.id, nodeId: row.node_id, body: row.body, authorId: row.author_id, authorName: row.author_name, mentions: (row.mentions ?? []).map((m: { id: string }) => m.id), resolved });
    res.json(comment);
  } catch (e) {
    next(e);
  }
});

interface CommentRow {
  id: string;
  scene_id: string;
  node_id: string;
  body: string;
  author_id: string;
  author_kind: string;
  author_name: string;
  mentions: { id: string; name: string }[];
  resolved: boolean;
  created_at: Date;
}

export const mentionRouter = Router();
mentionRouter.use(requireAuth);

mentionRouter.get("/:sceneId/mentionable", async (req, res, next) => {
  try {
    const caller = req.caller!;
    if (caller.kind === "agent") throw errors.forbidden();
    const ws = caller.member.workspace_id;
    await getSceneRow(req.params.sceneId, ws);
    const q = String(req.query.q ?? "").toLowerCase();
    const rows = await query(
      "SELECT id, name, role FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY name LIMIT 20",
      [ws],
    );
    const members = (rows.rows as { id: string; name: string; role: string }[])
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((m) => ({ id: m.id, name: m.name, role: m.role }));
    res.json({ members });
  } catch (e) {
    next(e);
  }
});
