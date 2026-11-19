import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { pool } from "./db.js";
import { Keycloak } from "./keycloak.js";
import { SESSION_COOKIE, createSession, getSession } from "./session.js";
import { errorOut } from "./routes_util.js";
import { randomHex } from "./util.js";

export function authRouter(env: FlanEnv, kc: Keycloak): Router {
  const router = Router();

  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
  };

  router.get("/login", async (req, res) => {
    try {
      const returnTo = typeof req.query.return_to === "string" ? req.query.return_to : "/desk/hollowmint";
      const state = randomHex(16);
      await pool.query("INSERT INTO kc_state (state, return_to) VALUES ($1, $2)", [state, returnTo]);
      const params = new URLSearchParams({
        client_id: env.AUTH_CLIENT_ID,
        redirect_uri: `${env.APP_PUBLIC_URL}/auth/callback`,
        response_type: "code",
        scope: "openid",
        state,
      });
      res.redirect(302, `${kc.realmAuthEndpoint()}?${params.toString()}`);
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.get("/step-up", async (req, res) => {
    try {
      const returnTo = typeof req.query.return_to === "string" ? req.query.return_to : "/desk/hollowmint";
      // A step-up always runs the full Keycloak login (password then one-time code);
      // it also renews the app session, so no prior session is required.
      const state = randomHex(16);
      await pool.query("INSERT INTO kc_state (state, return_to) VALUES ($1, $2)", [state, `step-up:${returnTo}`]);
      const params = new URLSearchParams({
        client_id: env.AUTH_CLIENT_ID,
        redirect_uri: `${env.APP_PUBLIC_URL}/auth/callback`,
        response_type: "code",
        scope: "openid",
        state,
        prompt: "login",
        max_age: "0",
      });
      res.redirect(302, `${kc.realmAuthEndpoint()}?${params.toString()}`);
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.get("/callback", async (req, res) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code || !state) {
        res.status(400).send("Bad request");
        return;
      }
      const stored = await pool.query<{ return_to: string }>("SELECT return_to FROM kc_state WHERE state = $1", [state]);
      const returnTo = stored.rows[0]?.return_to ?? "/desk/hollowmint";
      await pool.query("DELETE FROM kc_state WHERE state = $1", [state]);
      let tokens: { access_token: string } | null = null;
      try {
        tokens = await kc.codeToken(code, `${env.APP_PUBLIC_URL}/auth/callback`);
      } catch {
        tokens = null;
      }
      if (!tokens) {
        res.status(503).send(copyFor("F_SIGNIN_DOWN"));
        return;
      }
      const userinfo = await kc.userinfo(tokens.access_token);
      if (!userinfo) {
        res.status(503).send(copyFor("F_SIGNIN_DOWN"));
        return;
      }
      const role = userinfo.flan_dealer ? "dealer" : userinfo.flan_counterpart ? "counterpart" : "outsider";
      const ns = userinfo.namespace;
      const isStepUp = returnTo.startsWith("step-up:");
      const redirectTo = isStepUp ? returnTo.slice("step-up:".length) : returnTo;
      // A step-up login always runs the one-time-code page for seeded users, so the
      // fresh Keycloak authentication marks the proof on the session.
      const session = await createSession(env, userinfo.sub, userinfo.preferred_username, role, ns, isStepUp, userinfo.sub);
      res.cookie(SESSION_COOKIE, session.sid, { ...cookieOpts, maxAge: env.FLAN_SESSION_TTL_S * 1000 });
      res.redirect(302, redirectTo);
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.post("/logout", async (req, res) => {
    try {
      const sid = cookieValue(req, SESSION_COOKIE);
      if (sid) {
        await pool.query("DELETE FROM sessions WHERE sid = $1", [sid]);
      }
      res.clearCookie(SESSION_COOKIE, cookieOpts);
      res.status(204).end();
    } catch (err) {
      errorOut(res, err);
    }
  });

  return router;
}

function cookieValue(req: { headers: { cookie?: string } }, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
}
