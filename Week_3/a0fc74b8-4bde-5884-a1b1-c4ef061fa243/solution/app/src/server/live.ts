import pg from "pg";
import { config } from "./config.js";
import { LIVE_CHANNEL } from "./db.js";
import type { LiveEvent } from "../shared/types.js";

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dispatch(event: LiveEvent): void {
  for (const listener of listeners) listener(event);
}

function parseEvent(payload: string): LiveEvent | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || !("type" in value)) return null;
    const record = value as Record<string, unknown>;
    if (record["type"] === "document" && typeof record["documentId"] === "string" && typeof record["teamId"] === "string") {
      return { type: "document", documentId: record["documentId"], teamId: record["teamId"] };
    }
    if (record["type"] === "role" && typeof record["userId"] === "string") return { type: "role", userId: record["userId"] };
    if (record["type"] === "templates" && typeof record["teamId"] === "string") return { type: "templates", teamId: record["teamId"] };
    return null;
  } catch {
    return null;
  }
}

export async function startListening(): Promise<void> {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on("notification", (message) => {
      const event = parseEvent(message.payload ?? "");
      if (event) dispatch(event);
    });
    client.on("error", () => {
      client.end().catch(() => undefined);
      setTimeout(() => void connect().catch(() => undefined), 1000);
    });
    await client.connect();
    await client.query(`LISTEN ${LIVE_CHANNEL}`);
  };
  await connect();
}
