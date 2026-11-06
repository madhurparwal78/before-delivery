import type { Env } from "./env";

export interface PresenceEntry {
  authorKind: "member" | "agent";
  authorId: string;
  authorName: string;
  selection: string | null;
  seenAt: string;
}

export interface LockRecord {
  node: string;
  holderKind: "member" | "agent";
  holderId: string;
  holderName: string;
  expiresAt: string;
}

interface PbItem extends Record<string, unknown> {
  id: string;
}

export class PocketBase {
  constructor(private env: Env) {}

  private async auth(): Promise<string> {
    const res = await fetch(new URL("/api/admins/auth-with-password", this.env.pocketbaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: this.env.pocketbaseAdminEmail, password: this.env.pocketbaseAdminPassword }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`PocketBase auth failed: ${res.status}`);
    const data = (await res.json()) as { token: string };
    return data.token;
  }

  private async list(path: string, token: string, filter?: string): Promise<PbItem[]> {
    const url = new URL(path, this.env.pocketbaseUrl);
    if (filter) url.searchParams.set("filter", filter);
    url.searchParams.set("perPage", "200");
    const res = await fetch(url, { headers: { Authorization: token }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`PocketBase list failed: ${res.status}`);
    const data = (await res.json()) as { items: PbItem[] };
    return data.items;
  }

  private async create(path: string, token: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(new URL(path, this.env.pocketbaseUrl), {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`PocketBase create failed: ${res.status}`);
  }

  private async patch(path: string, token: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(new URL(path, this.env.pocketbaseUrl), {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`PocketBase patch failed: ${res.status}`);
  }

  private async del(path: string, token: string): Promise<void> {
    const res = await fetch(new URL(path, this.env.pocketbaseUrl), {
      method: "DELETE",
      headers: { Authorization: token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) throw new Error(`PocketBase delete failed: ${res.status}`);
  }

  async ping(): Promise<boolean> {
    try {
      const token = await this.auth();
      await this.list("/api/collections/presence/records", token);
      return true;
    } catch {
      return false;
    }
  }

  async ensureCollections(): Promise<void> {
    const token = await this.auth();
    const collections = [
      {
        name: "presence",
        fields: [
          { name: "workspace", type: "text" },
          { name: "scene", type: "text" },
          { name: "authorKind", type: "text" },
          { name: "authorId", type: "text" },
          { name: "authorName", type: "text" },
          { name: "selection", type: "text" },
          { name: "cursor", type: "json" },
          { name: "seenAt", type: "date" },
        ],
        indexes: ["CREATE UNIQUE INDEX `idx_presence_scene_author` ON `presence` (`scene`, `authorId`)"],
      },
      {
        name: "object_locks",
        fields: [
          { name: "workspace", type: "text" },
          { name: "scene", type: "text" },
          { name: "node", type: "text" },
          { name: "holderKind", type: "text" },
          { name: "holderId", type: "text" },
          { name: "holderName", type: "text" },
          { name: "expiresAt", type: "date" },
        ],
        indexes: ["CREATE UNIQUE INDEX `idx_locks_scene_node` ON `object_locks` (`scene`, `node`)"],
      },
      {
        name: "comments",
        fields: [
          { name: "workspace", type: "text" },
          { name: "scene", type: "text" },
          { name: "commentId", type: "text" },
          { name: "node", type: "text" },
          { name: "body", type: "text" },
          { name: "authorId", type: "text" },
          { name: "authorName", type: "text" },
          { name: "mentions", type: "json" },
          { name: "resolved", type: "bool" },
        ],
        indexes: ["CREATE UNIQUE INDEX `idx_comments_commentId` ON `comments` (`commentId`)"],
      },
    ];
    for (const col of collections) {
      const check = await fetch(new URL(`/api/collections/${col.name}/records`, this.env.pocketbaseUrl), {
        headers: { Authorization: token },
      });
      if (check.ok) continue;
      const schema = col.fields.map((f) => {
        const base: Record<string, unknown> = { name: f.name, type: f.type, required: !["selection", "cursor", "mentions", "resolved"].includes(f.name) };
        if (f.type === "json") base.options = { maxSize: 2_000_000 };
        return base;
      });
      await this.create("/api/collections", token, { name: col.name, type: "base", schema, indexes: col.indexes, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null });
    }
  }

  async presence(sceneId: string, workspaceId: string): Promise<PresenceEntry[]> {
    const token = await this.auth();
    const items = await this.list("/api/collections/presence/records", token, `scene = "${sceneId}" && workspace = "${workspaceId}"`);
    return items.map((i) => ({
      authorKind: (i.authorKind as "member" | "agent") ?? "member",
      authorId: i.authorId as string,
      authorName: i.authorName as string,
      selection: (i.selection as string | null) || null,
      seenAt: i.seenAt as string,
    }));
  }

  async heartbeat(workspaceId: string, sceneId: string, authorKind: "member" | "agent", authorId: string, authorName: string, selection: string | null): Promise<void> {
    const token = await this.auth();
    const existing = await this.list("/api/collections/presence/records", token, `scene = "${sceneId}" && authorId = "${authorId}"`);
    const body: Record<string, unknown> = {
      workspace: workspaceId,
      scene: sceneId,
      authorKind,
      authorId,
      authorName,
      selection,
      cursor: null,
      seenAt: new Date().toISOString(),
    };
    if (existing.length > 0) {
      await this.patch(`/api/collections/presence/records/${existing[0]!.id}`, token, body);
    } else {
      await this.create("/api/collections/presence/records", token, body);
    }
  }

  async clearPresence(workspaceId: string, authorId: string): Promise<void> {
    const token = await this.auth();
    const items = await this.list("/api/collections/presence/records", token, `workspace = "${workspaceId}" && authorId = "${authorId}"`);
    for (const item of items) {
      await this.del(`/api/collections/presence/records/${item.id}`, token);
    }
  }

  async locks(sceneId: string, workspaceId: string): Promise<LockRecord[]> {
    const token = await this.auth();
    const items = await this.list("/api/collections/object_locks/records", token, `scene = "${sceneId}" && workspace = "${workspaceId}"`);
    return items.map((i) => ({
      node: i.node as string,
      holderKind: (i.holderKind as "member" | "agent") ?? "member",
      holderId: i.holderId as string,
      holderName: i.holderName as string,
      expiresAt: i.expiresAt as string,
    }));
  }

  async findLock(sceneId: string, nodeId: string): Promise<LockRecord | null> {
    const token = await this.auth();
    const items = await this.list("/api/collections/object_locks/records", token, `scene = "${sceneId}" && node = "${nodeId}"`);
    if (items.length === 0) return null;
    const i = items[0]!;
    return {
      node: i.node as string,
      holderKind: (i.holderKind as "member" | "agent") ?? "member",
      holderId: i.holderId as string,
      holderName: i.holderName as string,
      expiresAt: i.expiresAt as string,
    };
  }

  async takeLock(workspaceId: string, sceneId: string, nodeId: string, holderKind: "member" | "agent", holderId: string, holderName: string): Promise<boolean> {
    const token = await this.auth();
    try {
      await this.create("/api/collections/object_locks/records", token, {
        workspace: workspaceId,
        scene: sceneId,
        node: nodeId,
        holderKind,
        holderId,
        holderName,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseLock(sceneId: string, nodeId: string, holderId: string): Promise<boolean> {
    const token = await this.auth();
    const items = await this.list("/api/collections/object_locks/records", token, `scene = "${sceneId}" && node = "${nodeId}"`);
    const item = items.find((i) => i.holderId === holderId);
    if (!item) return false;
    await this.del(`/api/collections/object_locks/records/${item.id}`, token);
    return true;
  }

  async releaseAllLocks(holderId: string, workspaceId: string): Promise<void> {
    const token = await this.auth();
    const items = await this.list("/api/collections/object_locks/records", token, `workspace = "${workspaceId}" && holderId = "${holderId}"`);
    for (const item of items) {
      await this.del(`/api/collections/object_locks/records/${item.id}`, token);
    }
  }

  async syncComment(workspaceId: string, sceneId: string, comment: { id: string; nodeId: string; body: string; authorId: string; authorName: string; mentions: string[]; resolved: boolean }): Promise<void> {
    const token = await this.auth();
    const items = await this.list("/api/collections/comments/records", token, `commentId = "${comment.id}"`);
    const body: Record<string, unknown> = {
      workspace: workspaceId,
      scene: sceneId,
      commentId: comment.id,
      node: comment.nodeId,
      body: comment.body,
      authorId: comment.authorId,
      authorName: comment.authorName,
      mentions: comment.mentions,
      resolved: comment.resolved,
    };
    if (items.length > 0) {
      await this.patch(`/api/collections/comments/records/${items[0]!.id}`, token, body);
    } else {
      await this.create("/api/collections/comments/records", token, body);
    }
  }

  async pruneExpiredLocks(): Promise<void> {
    const token = await this.auth();
    const items = await this.list("/api/collections/object_locks/records", token, `expiresAt < "${new Date().toISOString()}"`);
    for (const item of items) {
      await this.del(`/api/collections/object_locks/records/${item.id}`, token);
    }
  }
}
