import { Router } from "express";
import { LIMITS } from "../config.js";
import {
  SESSION_COOKIE,
  createSession,
  currentStaff,
  deleteSession,
  sessionId,
  staffByAccessCode,
  staffPayload,
} from "../auth.js";
import { FIELD_MESSAGES, invalidAccessCode, validationFailed } from "../errors.js";
import { defineRoute } from "../http.js";
import { statusSnapshot } from "../services/health.js";
import { SIGN_IN_FAILED } from "../../shared/copy.js";

export const sessionRouter = Router();

sessionRouter.post(
  "/session",
  defineRoute({
    auth: "none",
    bodyLimit: LIMITS.jsonBodyBytes,
    mutating: true,
    async handle({ body, res }) {
      const record = (typeof body === "object" && body !== null ? body : {}) as Record<
        string,
        unknown
      >;
      const accessCode = record.access_code;
      if (typeof accessCode !== "string" || accessCode.trim() === "") {
        throw validationFailed({ access_code: FIELD_MESSAGES.accessCode });
      }
      const staff = await staffByAccessCode(accessCode.trim());
      if (!staff) throw invalidAccessCode(SIGN_IN_FAILED);
      const session = await createSession(staff.id);
      res.cookie(SESSION_COOKIE, session, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      return { status: 200, body: { staff: staffPayload(staff) } };
    },
  }),
);

sessionRouter.get(
  "/session",
  defineRoute({
    auth: "staff",
    async handle({ auth }) {
      return { status: 200, body: { staff: staffPayload(auth.staff) } };
    },
  }),
);

sessionRouter.delete(
  "/session",
  defineRoute({
    auth: "none",
    mutating: true,
    async handle({ req, res }) {
      const session = sessionId(req);
      if (session) await deleteSession(session);
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      return { status: 204 };
    },
  }),
);

sessionRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

sessionRouter.get("/status", (_req, res) => {
  res.status(200).json(statusSnapshot());
});
