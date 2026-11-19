import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserRow } from "./domain.js";
import type { App } from "./server.js";

interface Client {
  res: ServerResponse;
  penIds: Set<string>;
  userId: string | null;
}

export class EventBus {
  private clients = new Set<Client>();
  private counters = new Map<string, { likes: number; forks: number }>();
  private heads = new Map<string, number>();
  private ids = 0;

  addClient(res: ServerResponse, penIds: Set<string>, userId: string | null): void {
    const client: Client = { res, penIds, userId };
    this.clients.add(client);
    this.ids++;
    res.on("close", () => {
      this.clients.delete(client);
    });
  }

  private send(client: Client, event: string, data: unknown): void {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  countsChanged(penId: string): void {
    for (const client of this.clients) {
      if (client.penIds.has(penId)) {
        const c = this.counters.get(penId) ?? { likes: 0, forks: 0 };
        this.send(client, "counts", { pen_id: penId, likes: c.likes, forks: c.forks });
      }
    }
  }

  headChanged(penId: string, head: number): void {
    this.heads.set(penId, head);
    for (const client of this.clients) {
      if (client.penIds.has(penId)) {
        this.send(client, "head", { pen_id: penId, head });
      }
    }
  }

  penRemoved(penId: string): void {
    for (const client of this.clients) {
      if (client.penIds.has(penId)) {
        this.send(client, "removed", { pen_id: penId });
      }
    }
  }

  accountVerified(userId: string): void {
    for (const client of this.clients) {
      if (client.userId === userId) {
        this.send(client, "account", { verified: true });
      }
    }
  }

  // Events carry only ids; counts are re-fetched by the pages, so the bus
  // itself needs no database access to stay honest.
  setCounts(penId: string, likes: number, forks: number): void {
    this.counters.set(penId, { likes, forks });
    for (const client of this.clients) {
      if (client.penIds.has(penId)) {
        this.send(client, "counts", { pen_id: penId, likes, forks });
      }
    }
  }
}

export async function handleEvents(app: App, req: IncomingMessage, res: ServerResponse, url: URL, user: UserRow | null): Promise<void> {
  const ids = (url.searchParams.get("pens") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9]{10}$/.test(s));
  // Only pens the caller can see are watched.
  const visible = await app.db
    .withClient(async (client) => {
      const out = new Set<string>();
      for (const id of ids) {
        const row = (await client.query<{ visibility: string; owner_id: string }>("SELECT visibility, owner_id FROM pens WHERE id = $1", [id])).rows[0];
        if (!row) continue;
        if (row.visibility === "public" || row.visibility === "unlisted" || (user && row.owner_id === user.id)) out.add(id);
      }
      return out;
    })
    .catch(() => new Set<string>());
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(":ok\n\n");
  app.events.addClient(res, visible, user?.id ?? null);
  const keepAlive = setInterval(() => {
    res.write(":keep\n\n");
  }, 15000);
  res.on("close", () => clearInterval(keepAlive));
}
