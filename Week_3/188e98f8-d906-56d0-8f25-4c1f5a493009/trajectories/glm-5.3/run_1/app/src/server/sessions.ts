import { createHash, randomBytes } from "node:crypto";
import type { Role } from "../domain/types";

export const SESSION_COOKIE = "desk_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

/** The one sign-in landing by role. */
export function deskPathFor(role: Role): "/quizmaster" | "/marker" | "/captain" {
  switch (role) {
    case "quizmaster":
      return "/quizmaster";
    case "marker":
      return "/marker";
    case "captain":
      return "/captain";
  }
}

export function newSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
