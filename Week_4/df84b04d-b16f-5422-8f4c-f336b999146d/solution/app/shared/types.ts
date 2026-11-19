export interface Bullet {
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  mirrorOf: string | null;
  placeholder: boolean;
  revision: number;
  childCount: number;
}

export interface OutlineView {
  root: Bullet | null;
  ancestors: Bullet[];
  seq: number;
  bullets: Bullet[];
}

export interface Person {
  id: string;
  email: string;
  name: string;
}

export interface MeResponse {
  user: Person & { hideCompleted: boolean };
  shared: { bulletId: string; text: string; owner: { name: string } }[];
}

export type ShareStatus = "sent" | "not_sent" | "pending_send" | "accepted" | "lapsed" | "revoked";

export interface ShareRow {
  id: string;
  email: string;
  status: ShareStatus;
  createdAt: string;
}

export interface ChangeMessage {
  type: "change";
  seq: number;
  bullets: Bullet[];
  removed: string[];
}

export type LiveMessage =
  | ChangeMessage
  | { type: "heartbeat"; fanout: "ok" | "paused"; heartbeatSeconds?: number; pauseAfterSeconds?: number }
  | { type: "reload" }
  | { type: "revoked" };

export type Step = "new bullet" | "text edit" | "delete" | "move" | "indent" | "outdent" | "completion" | "mirror";

export interface SearchResult {
  query: string;
  count: number;
  matches: string[];
  context: string[];
}

export interface Suggestion {
  value: string;
  count: number;
}
