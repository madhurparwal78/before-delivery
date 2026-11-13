import { query } from './db.js';

/** System lines are written with a code and params; each reader renders them in their own language (DP-42). */
export async function postSystemLine(client: { query: Function } | null, channel: string, code: string, params: Record<string, string>): Promise<void> {
  const { appendChatMessage } = await import('./chat.js');
  await appendChatMessage(client as never, channel, { kind: 'system', code, params });
}
