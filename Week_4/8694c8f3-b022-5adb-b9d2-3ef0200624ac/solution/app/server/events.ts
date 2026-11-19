import type { ServerResponse } from "node:http";
import type { Collab, RelayEvent } from "./collab.ts";
import type { ServiceStatus } from "../shared/types.ts";

type SetEvent = RelayEvent | { kind: "status"; data: ServiceStatus };
type SetListener = (event: SetEvent) => void;

export class EventHub {
  private readonly listeners = new Map<string, Set<SetListener>>();
  private readonly collab: Collab;

  constructor(collab: Collab) {
    this.collab = collab;
    collab.setListener((setId, event) => this.deliver(setId, event));
  }

  listen(setId: string, listener: SetListener): () => void {
    let group = this.listeners.get(setId);
    if (!group) {
      group = new Set();
      this.listeners.set(setId, group);
      this.collab.subscribe(setId);
    }
    group.add(listener);
    return () => {
      group.delete(listener);
      if (group.size === 0) {
        this.listeners.delete(setId);
        this.collab.unsubscribe(setId);
      }
    };
  }

  private deliver(setId: string, event: SetEvent): void {
    for (const listener of this.listeners.get(setId) ?? []) listener(event);
  }

  async publish(setId: string, event: RelayEvent): Promise<void> {
    const relayed = await this.collab.publish(setId, event);
    if (!relayed) this.deliver(setId, event);
  }

  broadcastStatus(status: ServiceStatus): void {
    for (const group of this.listeners.values()) for (const listener of group) listener({ kind: "status", data: status });
  }
}

export function openStream(res: ServerResponse): { send: (event: string, data: unknown, id?: number) => void; close: () => void } {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": stream open\n\n");
  const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  return {
    send(event, data, id) {
      res.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      clearInterval(beat);
    },
  };
}
