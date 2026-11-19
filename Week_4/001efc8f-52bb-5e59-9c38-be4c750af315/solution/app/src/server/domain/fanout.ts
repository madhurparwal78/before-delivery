import type pg from "pg";
import type { LoggedEvent } from "../events.js";
import { channelForMembers } from "./channels.js";
import { loadMessages } from "./messages.js";

// Event payloads built inside the writing transaction, so they show the committed state.

export async function messageEvents(client: pg.PoolClient, name: "message.created" | "message.updated", workspaceId: string, channelId: string, ids: string[]): Promise<LoggedEvent[]> {
  const loaded = await loadMessages(client, ids);
  return ids
    .map((id) => loaded.get(id))
    .filter((message) => message !== undefined && !message.deleted)
    .map((message) => ({ workspaceId, channelId, userId: null, name, payload: { message } }));
}

export async function channelUpdates(client: pg.PoolClient, workspaceId: string, channelId: string, exceptUserId: string | null): Promise<LoggedEvent[]> {
  const views = await channelForMembers(client, channelId, exceptUserId);
  return views.map((view) => ({ workspaceId, channelId, userId: view.user_id, name: "channel.updated", payload: { channel: view.channel } }));
}
