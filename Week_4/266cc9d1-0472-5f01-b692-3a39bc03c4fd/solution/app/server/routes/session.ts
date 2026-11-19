// Sign-in, sign-out, health and service status.
import { endSession, SESSION_COOKIE, sessionToken, staffByAccessCode, staffJson, startSession } from "../auth.js";
import { fail } from "../http/errors.js";
import { json, noInput, publicRoute, staffRoute, type Route } from "../http/pipeline.js";
import { monitor } from "../monitor.js";

const noLoad = async (): Promise<null> => null;

export const sessionRoutes: Route[] = [
  publicRoute({
    method: "GET",
    path: "/api/health",
    load: noLoad,
    validate: noInput,
    perform: async () => json(200, { status: "ok" }),
  }),

  publicRoute({
    method: "GET",
    path: "/api/status",
    load: noLoad,
    validate: noInput,
    perform: async () => {
      const now = await monitor.current();
      return json(200, { storage: now.storage, mail: now.mail, checked_at: now.checkedAt.toISOString() });
    },
  }),

  publicRoute({
    method: "POST",
    path: "/api/session",
    load: noLoad,
    validate: (ctx) => {
      const code = ctx.json.access_code;
      if (typeof code !== "string" || code.trim() === "") throw fail.validation({ access_code: "Enter your access code." });
      return code.trim();
    },
    perform: async (ctx, _loaded, accessCode) => {
      const staff = await staffByAccessCode(ctx.db, accessCode);
      if (staff === null) throw fail.invalidAccessCode();
      const token = await startSession(ctx.db, staff);
      return json(200, { staff: staffJson(staff) }, {
        "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      });
    },
  }),

  staffRoute({
    method: "GET",
    path: "/api/session",
    load: noLoad,
    validate: noInput,
    perform: async (ctx) => json(200, { staff: staffJson(ctx.staff) }),
  }),

  publicRoute({
    method: "DELETE",
    path: "/api/session",
    load: noLoad,
    validate: noInput,
    perform: async (ctx) => {
      const token = sessionToken(ctx.req);
      if (token !== null) await endSession(ctx.db, token);
      return { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
    },
  }),
];
