import type { AccessReason, Role } from "./access.js";
import type { Layout } from "./layout.js";

export interface Author {
  userId: string;
  displayName: string;
}

export type LiveMessage =
  | { type: "hello"; revision: number; text: string; layout: Layout; access: Role; presenceTimeoutSeconds: number }
  | { type: "revision"; revision: number; text: string; by: Author }
  | { type: "layout"; layout: Layout; by: Author }
  | { type: "presence"; people: Author[]; linkViewers: number }
  | { type: "access"; access: "editor" | "viewer" | "none"; reason: AccessReason };

export const ACCESS_CLOSE_CODE = 4404;
