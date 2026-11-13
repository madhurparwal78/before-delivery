import type { UserPublic } from "../../shared/domain.js";
import { hueFor } from "../../shared/domain.js";

type PublicRow = { id: number; handle: string };

/** Every user that leaves the server does so as { id, handle, hue }. */
export function toUserPublic(row: PublicRow): UserPublic {
  return { id: row.id, handle: row.handle, hue: hueFor(row.id) };
}

export function userStub(id: number, handle: string): UserPublic {
  return { id, handle, hue: hueFor(id) };
}
