import type { Response } from "express";
import { verifyPassword } from "../seed.ts";
import { createSession, deleteSession, findUserByEmail } from "../store.ts";
import { ApiError } from "../errors.ts";
import type { AppServices, TypedRequest } from "../context.ts";
import { bodyOf, requireSession, setSessionCookie, clearSessionCookie } from "../context.ts";

export async function signIn(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  const body = bodyOf(req);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await findUserByEmail(services.pool, email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new ApiError(401, "invalid_credentials", "That email and password don't match a Bloom Desk account.");
  }
  const token = await createSession(services.pool, user.id);
  setSessionCookie(res, token);
  res.status(200).json({ user: { id: user.id, name: user.name, role: user.role } });
}

export async function signOut(services: AppServices, req: TypedRequest, res: Response): Promise<void> {
  requireSession(req);
  const cookieHeader = req.headers.cookie ?? "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("bloom_session="))
    ?.slice("bloom_session=".length);
  if (token) {
    await deleteSession(services.pool, token);
  }
  clearSessionCookie(res);
  res.status(204).end();
}

export async function me(req: TypedRequest, res: Response): Promise<void> {
  const actor = requireSession(req);
  res.status(200).json({ user: { id: actor.id, name: actor.name, role: actor.role } });
}
