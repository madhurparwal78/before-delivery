import type { Role } from "./roles.js";

export type UserRow = {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "deactivated";
};

export type UserJson = Omit<UserRow, "email"> & { email?: string };

// The email projection: only operations managers and the person themself see an email key.
export function projectUser(viewer: { id: string; role: Role }, user: UserRow): UserJson {
  const { email, ...rest } = user;
  return viewer.role === "ops_manager" || viewer.id === user.id ? { ...rest, email } : rest;
}
