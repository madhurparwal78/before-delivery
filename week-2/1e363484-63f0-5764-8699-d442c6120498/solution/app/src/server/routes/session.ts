import { CLEARED_SESSION_COOKIE, SESSION_COOKIE, sessionCookie, signIn, signOut } from "../auth.js";
import { HttpError, validationError, type Route } from "../http.js";
import { requirePerson } from "./common.js";

export const sessionRoutes: Route[] = [
  {
    method: "GET", pattern: /^\/api\/health$/,
    handle: async () => ({ status: 200, json: { status: "ok" } }),
  },
  {
    method: "POST", pattern: /^\/api\/session$/,
    handle: async ({ body }) => {
      const errors: Record<string, string> = {};
      if (typeof body.email !== "string") errors.email = "must be a string";
      if (typeof body.password !== "string") errors.password = "must be a string";
      if (Object.keys(errors).length) throw validationError(errors);
      const session = await signIn(body.email as string, body.password as string);
      if (!session) throw new HttpError(401, { error: "invalid_credentials" });
      return { status: 200, json: { person: session.person }, headers: { "Set-Cookie": sessionCookie(session.token) } };
    },
  },
  {
    method: "DELETE", pattern: /^\/api\/session$/,
    handle: async ({ cookies }) => {
      const token = cookies[SESSION_COOKIE];
      if (token) await signOut(token);
      return { status: 204, headers: { "Set-Cookie": CLEARED_SESSION_COOKIE } };
    },
  },
  {
    method: "GET", pattern: /^\/api\/me$/,
    handle: async (ctx) => ({ status: 200, json: { person: await requirePerson(ctx) } }),
  },
];
