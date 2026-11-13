import type { ServerResponse } from "node:http";
import type { LiveEvent } from "../shared/api.js";

const streams = new Map<string, Set<ServerResponse>>();

export function subscribe(userId: string, res: ServerResponse): void {
  const open = streams.get(userId) ?? new Set<ServerResponse>();
  open.add(res);
  streams.set(userId, open);
  res.on("close", () => {
    open.delete(res);
    if (open.size === 0) streams.delete(userId);
  });
}

function frame(event: LiveEvent): string {
  return `event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function send(userIds: Iterable<string>, event: LiveEvent): void {
  const payload = frame(event);
  for (const userId of userIds) for (const res of streams.get(userId) ?? []) res.write(payload);
}

export function sendToOne(res: ServerResponse, event: LiveEvent): void {
  res.write(frame(event));
}

export function keepAlive(): void {
  setInterval(() => {
    for (const open of streams.values()) for (const res of open) res.write(": keep-alive\n\n");
  }, 15_000).unref();
}
