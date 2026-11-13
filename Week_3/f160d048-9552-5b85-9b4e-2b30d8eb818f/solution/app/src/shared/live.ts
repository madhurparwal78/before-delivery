import type { Company, ChannelPost, HistoryEvent } from "./api";
import type { PostState, StageId } from "./reference";

/** Live event payloads as the page receives them; hello carries no id and says how the stream resumed. */
export interface LiveEvents {
  hello: { replay: "reload" | "complete" };
  "queue.changed": { post_id: string; state: PostState | "deleted"; by_name: string | null; by_me: boolean };
  "queue.history": { post_id: string; event: HistoryEvent };
  "post.state": { post_id: string; state: PostState; reason: string | null };
  "member.unlocked": Record<string, never>;
  "company.changed": { slug: string; company: Company | null };
  "application.stage": { application_id: string; job_id: string; stage: StageId };
  "channel.post": { channel_slug: string; post: ChannelPost };
  "alert.matched": { alert_id: string; new_count: number };
}

export const LIVE_TYPES = [
  "hello", "queue.changed", "queue.history", "post.state", "member.unlocked", "company.changed",
  "application.stage", "channel.post", "alert.matched",
] as const satisfies readonly (keyof LiveEvents)[];
