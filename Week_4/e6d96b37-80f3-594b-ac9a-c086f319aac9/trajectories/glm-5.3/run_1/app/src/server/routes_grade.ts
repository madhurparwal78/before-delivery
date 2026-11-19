import { Router } from "express";
import type { FlanEnv } from "../shared/env.js";
import { copyFor } from "../shared/feedback.js";
import { namespaceValid } from "../shared/util.js";
import type { SeedVariant, WorkflowKey } from "../shared/seed.js";
import { pool } from "./db.js";
import { Keycloak } from "./keycloak.js";
import { KeycloakAdmin } from "./kcadmin.js";
import { totpCode } from "./kcadmin.js";
import { Register } from "./register.js";
import { Storage } from "./storage.js";
import { Seeder } from "./seed.js";
import { fixturePhoto } from "./fixture_media.js";
import { advance } from "./clock.js";
import { errorOut } from "./routes_util.js";

const WORKFLOW_KEYS: WorkflowKey[] = [
  "intake",
  "attribution",
  "catalog_reconciliation",
  "tray_placement",
  "set_tracking",
  "condition_comparison",
  "duplicate_selection",
  "offer_assembly",
  "counteroffers",
  "dispatch",
  "receipt",
  "disputes",
  "stock_audit",
  "cross_cutting",
];

const VARIANTS: SeedVariant[] = ["base", "conflict", "outage", "offline", "session"];

export function gradeRouter(env: FlanEnv, storage: Storage, register: Register, kc: Keycloak, kcAdmin: KeycloakAdmin): Router {
  const router = Router();

  router.use((req, res, next) => {
    if (!env.FLAN_GRADE_KEY) {
      res.status(404).json({ error: "not_found", message: copyFor("F_HIDDEN") });
      return;
    }
    const header = req.headers["x-flan-grading-key"];
    if (header !== env.FLAN_GRADE_KEY) {
      res.status(404).json({ error: "not_found", message: copyFor("F_HIDDEN") });
      return;
    }
    next();
  });

  router.post("/seed", async (req, res) => {
    try {
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const namespace = typeof raw.namespace === "string" ? raw.namespace : "";
      const workflow = typeof raw.workflow === "string" ? raw.workflow : "";
      const variant = typeof raw.variant === "string" ? raw.variant : "base";
      if (!namespaceValid(namespace)) {
        res.status(422).json({ error: "invalid", message: copyFor("F_INVALID"), fields: { namespace: copyFor("F_INVALID") } });
        return;
      }
      if (!WORKFLOW_KEYS.includes(workflow as WorkflowKey)) {
        res.status(500).json({ error: "seed_failed", message: `unknown workflow ${workflow}` });
        return;
      }
      if (!VARIANTS.includes(variant as SeedVariant)) {
        res.status(500).json({ error: "seed_failed", message: `unknown variant ${variant}` });
        return;
      }
      const seeder = new Seeder(env, storage, register, kc, kcAdmin);
      const outcome = await seeder.seed(namespace, workflow as WorkflowKey, variant as SeedVariant);
      res.status(201).json(outcome);
    } catch (err) {
      res.status(500).json({ error: "seed_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/:ns/clock", async (req, res) => {
    try {
      const ns = req.params.ns;
      if (!namespaceValid(ns)) {
        res.status(422).json({ error: "invalid", message: copyFor("F_INVALID"), fields: { namespace: copyFor("F_INVALID") } });
        return;
      }
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const advanceSeconds = typeof raw.advance_seconds === "number" ? raw.advance_seconds : NaN;
      if (!Number.isInteger(advanceSeconds) || advanceSeconds < 0) {
        res.status(422).json({ error: "invalid", message: copyFor("F_INVALID"), fields: { advance_seconds: copyFor("F_INVALID") } });
        return;
      }
      res.status(200).json({ clock: await advance(ns, advanceSeconds) });
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.get("/:ns/otp", async (req, res) => {
    try {
      const ns = req.params.ns;
      const role = req.query.role === "counterpart" ? "counterpart" : "dealer";
      const secretRow = await pool.query<{ totp_secret: string }>(
        "SELECT totp_secret FROM seeded_identities WHERE ns = $1 AND role = $2",
        [ns, role],
      );
      const secret = secretRow.rows[0]?.totp_secret;
      if (!secret) {
        res.status(500).json({ error: "seed_failed", message: `no totp secret for ${role}` });
        return;
      }
      res.status(200).json({ code: totpCode(secret, env.FLAN_TOTP_PERIOD_S) });
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.post("/:ns/identity", async (req, res) => {
    try {
      const ns = req.params.ns;
      const raw = (req.body ?? {}) as Record<string, unknown>;
      const action = raw.action === "password_change" ? "password_change" : "revoke";
      const user = await kcAdmin.getUserByUsername(`${ns}-counterpart`);
      if (!user) {
        res.status(500).json({ error: "seed_failed", message: "counterpart identity missing" });
        return;
      }
      if (action === "revoke") {
        await kcAdmin.disableUser(user.id);
      } else {
        await kcAdmin.setPassword(user.id, `Flan-${ns}-counterpart-new`);
      }
      await pool.query("DELETE FROM sessions WHERE namespace = $1 AND username = $2", [ns, `${ns}-counterpart`]);
      res.status(200).json({ role: "counterpart", action });
    } catch (err) {
      errorOut(res, err);
    }
  });

  router.get("/:ns/media/:name", (req, res) => {
    const name = req.params.name;
    const photo = name === "reverse" ? fixturePhoto("reverse", "A", "fresh", "none") : fixturePhoto("obverse", "A", "fresh", "none");
    res.setHeader("Content-Type", "image/png");
    res.status(200).send(Buffer.from(photo.bytes));
  });

  return router;
}

export { WORKFLOW_KEYS, VARIANTS };
