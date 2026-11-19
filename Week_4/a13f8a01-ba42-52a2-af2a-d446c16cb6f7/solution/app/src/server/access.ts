import { ApiError, notFound } from "./errors.js";
import type { User, Visibility } from "../shared/types.js";

export interface PenAccess {
  ownerId: string;
  visibility: Visibility;
}

export function canSee(pen: PenAccess, viewer: User | null): boolean {
  return pen.visibility !== "private" || pen.ownerId === viewer?.id;
}

export function requireSignedIn(viewer: User | null): User {
  if (viewer === null) throw new ApiError("not_signed_in", "Sign in to do this.");
  return viewer;
}

export function requireVisible<T extends PenAccess>(pen: T | null, viewer: User | null): T {
  if (pen === null || !canSee(pen, viewer)) throw notFound();
  return pen;
}

export function requireOwner(pen: PenAccess, viewer: User): void {
  if (pen.ownerId !== viewer.id) throw new ApiError("forbidden", "Only the owner can change this pen.");
}

export function requireVerified(viewer: User): void {
  if (!viewer.verified) {
    throw new ApiError("unverified", `Verify your email to do this. We sent a link to ${viewer.email}.`);
  }
}
