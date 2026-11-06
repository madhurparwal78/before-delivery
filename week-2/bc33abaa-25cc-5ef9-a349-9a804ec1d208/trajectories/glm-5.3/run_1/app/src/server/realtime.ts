import type { ServerResponse } from "http";
import type { OpOut } from "./routes/scenes";

interface Client {
  sceneId: string;
  res: ServerResponse;
}

class Hub {
  private clients = new Set<Client>();

  subscribe(sceneId: string, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":ok\n\n");
    const client: Client = { sceneId, res };
    this.clients.add(client);
    res.on("close", () => this.clients.delete(client));
  }

  publish(sceneId: string, event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      if (client.sceneId === sceneId) client.res.write(payload);
    }
  }
}

export const hub = new Hub();

export function sceneKey(sceneId: string): string {
  return sceneId;
}

export function publishOps(sceneId: string, data: { batchId: string; ops: OpOut[] }): void {
  hub.publish(sceneId, "op", data);
}

export function publishLock(sceneId: string, data: { nodeId: string; holder: unknown }): void {
  hub.publish(sceneId, "lock", data);
}

export function publishPresence(sceneId: string, data: { authors: { author: unknown; selection: string | null }[] }): void {
  hub.publish(sceneId, "presence", data);
}

export function publishComment(sceneId: string, data: unknown): void {
  hub.publish(sceneId, "comment", data);
}

export function publishVersion(sceneId: string, data: unknown): void {
  hub.publish(sceneId, "version", data);
}
