// API routes. Every route enforces the published error order: 401, 404 (workspace
// or resource invisible), idempotent replay, 403 role, 422 first failing rule,
// 409 state conflict, 503 storage.

import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  TAIL_PADDING_NAMESPACE,
  blobGas,
  feeUfern,
  formatFern,
  hexToBytes,
  namespaceMessages,
  parseFernAmount,
  proveNamespaceRows,
  shareCount,
  verifyRowProof,
  type InclusionProof,
  type AbsenceProof,
} from "../shared/domain.js";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import type { LiveHub } from "./live.js";
import type { Storage } from "./storage.js";
import { accountBalance, heldUfern, personAccount } from "./ledger.js";
import { verifyPassword, hashPassword } from "./seed.js";
import { queueMail } from "./mail.js";
import { buildSnapshotBuffer } from "./blocks.js";
import { checkIdempotency, rememberResponse } from "./idempotency.js";

export interface ApiContext {
  config: AppConfig;
  db: Db;
  hub: LiveHub;
  storage: Storage;
  clock: import("./clock.js").Clock;
}

export interface SessionInfo {
  personId: string;
  name: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    session?: SessionInfo;
    workspaceId?: string | undefined;
    role?: string;
  }
}

export const ERROR_BODIES = {
  unauthorized: { error: "Sign in to continue." },
  notFound: { error: "Not found" },
  sendJson: { error: "Send JSON." },
  tooLarge: { error: "Request body is too large." },
  incorrectCredentials: { error: "Email or password is incorrect." },
};

export function sendJson(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function sendError(res: Response, status: number, copy: string): void {
  sendJson(res, status, { error: copy });
}

export function sendFieldError(res: Response, field: string, message: string): void {
  sendJson(res, 422, { errors: { [field]: message } });
}

export function createApiRouter(ctx: ApiContext): Router {
  const router = Router();
  const { config, db, clock } = ctx;

  // Content type and body size guards for writes.
  router.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const contentType = req.headers["content-type"] ?? "";
    const lengthHeader = req.headers["content-length"];
    if (lengthHeader !== undefined && Number(lengthHeader) > 1_048_576) {
      sendJson(res, 413, ERROR_BODIES.tooLarge);
      return;
    }
    if (contentType !== "application/json" && contentType !== "application/json; charset=utf-8") {
      sendJson(res, 415, ERROR_BODIES.sendJson);
      return;
    }
    next();
  });

  router.use((req, _res, next) => {
    void (async () => {
      const token = readSessionToken(req.headers.cookie ?? "");
      if (token) {
        const session = await db.one<{ person_id: string; name: string; email: string }>(
          `SELECT s.person_id, p.name, p.email FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`,
          [token],
        );
        if (session) {
          req.session = { personId: session.person_id, name: session.name, email: session.email };
        }
      }
      next();
    })();
  });

  const requireSession = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session) {
      sendJson(res, 401, ERROR_BODIES.unauthorized);
      return;
    }
    next();
  };

  // Session and people.
  router.post("/session", (req, res) => {
    void (async () => {
      const body = req.body as { email?: string; password?: string };
      const person = await db.one<{ id: string; name: string; email: string; password_hash: string }>(
        `SELECT id, name, email, password_hash FROM people WHERE email = $1`,
        [String(body.email ?? "").trim().toLowerCase()],
      );
      if (!person || !verifyPassword(String(body.password ?? ""), person.password_hash)) {
        sendJson(res, 401, ERROR_BODIES.incorrectCredentials);
        return;
      }
      const token = randomBytes(24).toString("hex");
      await db.query(`INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)`, [
        token,
        person.id,
        new Date(),
      ]);
      const workspaces = await db.many<{ id: string; name: string; role: string; joined_at: Date }>(
        `SELECT w.id, w.name, m.role, m.joined_at FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.person_id = $1 ORDER BY m.joined_at`,
        [person.id],
      );
      res.setHeader("Set-Cookie", `fs_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      sendJson(res, 200, {
        user: { id: person.id, name: person.name, email: person.email },
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
      });
    })();
  });

  router.delete("/session", requireSession, (req, res) => {
    void (async () => {
      const token = readSessionToken(req.headers.cookie ?? "");
      if (token) await db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
      res.setHeader("Set-Cookie", "fs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      res.status(204).end();
    })();
  });

  router.get("/me", requireSession, (req, res) => {
    void (async () => {
      const workspaces = await db.many<{ id: string; name: string; role: string }>(
        `SELECT w.id, w.name, m.role, m.joined_at FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.person_id = $1 ORDER BY m.joined_at`,
        [req.session!.personId],
      );
      sendJson(res, 200, {
        user: { id: req.session!.personId, name: req.session!.name, email: req.session!.email },
        workspaces,
      });
    })();
  });

  // Invites.
  router.get("/invites/:token", (req, res) => {
    void (async () => {
      const invite = await db.one<{
        id: string;
        workspace_id: string;
        email: string;
        role: string;
        expires_at: Date;
        used_at: Date | null;
      }>(`SELECT id, workspace_id, email, role, expires_at, used_at FROM invites WHERE token = $1`, [
        req.params.token,
      ]);
      if (!invite || invite.used_at || invite.expires_at.getTime() <= clock.now()) {
        sendError(res, 410, "This invite link has already been used or has expired.");
        return;
      }
      const workspace = await db.one<{ name: string }>(`SELECT name FROM workspaces WHERE id = $1`, [
        invite.workspace_id,
      ]);
      const person = await db.one<{ id: string }>(`SELECT id FROM people WHERE email = $1`, [invite.email]);
      sendJson(res, 200, {
        workspaceName: workspace?.name ?? "",
        email: invite.email,
        role: invite.role,
        existingAccount: person !== null,
      });
    })();
  });

  router.post("/invites/:token/accept", (req, res) => {
    void (async () => {
      const invite = await db.one<{
        id: string;
        workspace_id: string;
        email: string;
        role: string;
        expires_at: Date;
        used_at: Date | null;
      }>(`SELECT id, workspace_id, email, role, expires_at, used_at FROM invites WHERE token = $1`, [
        req.params.token,
      ]);
      if (!invite || invite.used_at || invite.expires_at.getTime() <= clock.now()) {
        sendError(res, 410, "This invite link has already been used or has expired.");
        return;
      }
      const body = req.body as { name?: string; password?: string };
      const person = await db.one<{ id: string; password_hash: string }>(
        `SELECT id, password_hash FROM people WHERE email = $1`,
        [invite.email],
      );
      if (person) {
        if (!verifyPassword(String(body.password ?? ""), person.password_hash)) {
          sendJson(res, 401, ERROR_BODIES.incorrectCredentials);
          return;
        }
      } else {
        if (!String(body.name ?? "").trim()) {
          sendFieldError(res, "name", "Enter your name.");
          return;
        }
        if (String(body.password ?? "").length < 8) {
          sendFieldError(res, "password", "Password must be at least 8 characters.");
          return;
        }
      }
      const token = randomBytes(24).toString("hex");
      await db.transaction(async (tx) => {
        let personId = person?.id;
        if (!personId) {
          personId = randomBytes(12).toString("hex");
          const { hash } = hashPassword(String(body.password));
          await tx.query(`INSERT INTO people (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)`, [
            personId,
            String(body.name ?? "").trim(),
            invite.email,
            hash,
            new Date(),
          ]);
        }
        await tx.query(
          `INSERT INTO memberships (workspace_id, person_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
          [invite.workspace_id, personId, invite.role, new Date()],
        );
        await tx.query(`UPDATE invites SET used_at = $1 WHERE id = $2`, [new Date(), invite.id]);
        await tx.query(`INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)`, [
          token,
          personId,
          new Date(),
        ]);
      });
      res.setHeader("Set-Cookie", `fs_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
      sendJson(res, 200, { workspaceId: invite.workspace_id });
    })();
  });

  // Workspace scoped routes.
  router.use("/w/:workspaceId", requireSession, (req, res, next) => {
    void (async () => {
      const membership = await db.one<{ role: string }>(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND person_id = $2`,
        [req.params.workspaceId!, req.session!.personId],
      );
      if (!membership) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      req.workspaceId = req.params.workspaceId;
      req.role = membership.role;
      next();
    })();
  });

  const requireRole = (allowed: (role: string) => boolean, copy: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!allowed(req.role!)) {
        sendError(res, 403, copy);
        return;
      }
      next();
    };
  };

  const developerCopy = "Viewers can't make changes in this workspace.";
  const ownerProducerCopy = "Only the owner can change producer behaviour.";
  const ownerMembersCopy = "Only the owner can manage members.";

  router.get("/w/:workspaceId", (req, res) => {
    void (async () => {
      const workspace = await db.one<{ id: string; name: string; next_block: string }>(
        `SELECT id, name, next_block FROM workspaces WHERE id = $1`,
        [req.workspaceId!],
      );
      if (!workspace) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const heightRow = await db.one<{ height: number }>(
        `SELECT COALESCE(MAX(height), 0) AS height FROM blocks WHERE workspace_id = $1`,
        [req.workspaceId!],
      );
      sendJson(res, 200, {
        id: workspace.id,
        name: workspace.name,
        role: req.role,
        height: heightRow?.height ?? 0,
        clock: new Date().toISOString(),
        nextBlock: workspace.next_block,
      });
    })();
  });

  router.put("/w/:workspaceId/producer", requireRole((r) => r === "owner", ownerProducerCopy), (req, res) => {
    void (async () => {
      const body = req.body as { nextBlock?: string };
      const choice = String(body.nextBlock ?? "");
      if (!["honest", "withhold", "bad-encoding"].includes(choice)) {
        sendFieldError(res, "nextBlock", "Choose Honest, Withhold shares or Bad encoding.");
        return;
      }
      await db.query(`UPDATE workspaces SET next_block = $1 WHERE id = $2`, [choice, req.workspaceId]);
      sendJson(res, 200, { nextBlock: choice });
    })();
  });

  router.get("/w/:workspaceId/members", (req, res) => {
    void (async () => {
      const members = await db.many<{ id: string; name: string; email: string; role: string }>(
        `SELECT p.id, p.name, p.email, m.role FROM memberships m JOIN people p ON p.id = m.person_id
         WHERE m.workspace_id = $1 ORDER BY m.joined_at`,
        [req.workspaceId!],
      );
      sendJson(res, 200, members);
    })();
  });

  router.post(
    "/w/:workspaceId/invites",
    requireRole((r) => r === "owner", ownerMembersCopy),
    (req, res) => {
      void (async () => {
        const body = req.body as { email?: string; role?: string };
        const email = String(body.email ?? "").trim().toLowerCase();
        const role = String(body.role ?? "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          sendFieldError(res, "email", "Enter a valid email address.");
          return;
        }
        if (!["developer", "viewer"].includes(role)) {
          sendFieldError(res, "role", "Choose Developer or Viewer.");
          return;
        }
        const existingMember = await db.one<{ id: string }>(
          `SELECT m.person_id AS id FROM memberships m JOIN people p ON p.id = m.person_id
           WHERE m.workspace_id = $1 AND p.email = $2`,
          [req.workspaceId!, email],
        );
        if (existingMember) {
          sendError(res, 409, `${email} is already a member of this workspace.`);
          return;
        }
        const inviteId = randomBytes(12).toString("hex");
        const token = randomBytes(24).toString("hex");
        const expiresAt = new Date(clock.now() + config.inviteTtlHours * 3600 * 1000);
        await db.transaction(async (tx) => {
          await tx.query(
            `INSERT INTO invites (id, workspace_id, email, role, token, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [inviteId, req.workspaceId, email, role, token, expiresAt, new Date()],
          );
          const workspace = await tx.one<{ name: string }>(`SELECT name FROM workspaces WHERE id = $1`, [
            req.workspaceId!,
          ]);
          await queueMail(
            tx,
            req.workspaceId!,
            email,
            `Join ${workspace?.name ?? ""} on Fernsquare`,
            `Join ${workspace?.name ?? ""} on Fernsquare\n\nOpen this link to accept your invite:\n${config.publicUrl}/invites/${token}`,
          );
        });
        sendJson(res, 201, { id: inviteId, email, role, expiresAt: expiresAt.toISOString() });
      })();
    },
  );

  router.get("/w/:workspaceId/namespaces", (req, res) => {
    void (async () => {
      const namespaces = await db.many<{ id: string; name: string; hex: string }>(
        `SELECT id, name, hex FROM namespaces WHERE workspace_id = $1 ORDER BY created_at`,
        [req.workspaceId!],
      );
      const out = [];
      for (const namespace of namespaces) {
        const count = await db.one<{ total: number }>(
          `SELECT COUNT(*) AS total FROM blobs b JOIN transactions t ON t.id = b.tx_id
           WHERE b.namespace = $1 AND t.status = 'included'`,
          [namespace.hex],
        );
        out.push({ id: namespace.id, name: namespace.name, hex: namespace.hex, blobCount: Number(count?.total ?? 0) });
      }
      sendJson(res, 200, out);
    })();
  });

  router.post(
    "/w/:workspaceId/namespaces",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const body = req.body as { name?: string; hex?: string };
        const hex = String(body.hex ?? "").trim().toLowerCase();
        const name = String(body.name ?? "").trim();
        const failure = namespaceMessages(hex, name, () => false);
        if (failure && "field" in failure) {
          sendFieldError(res, failure.field, failure.message);
          return;
        }
        const existing = await db.one<{ id: string }>(`SELECT id FROM namespaces WHERE hex = $1`, [hex]);
        if (existing) {
          sendError(res, 409, `Namespace ${hex} is already registered.`);
          return;
        }
        const namespaceId = randomBytes(12).toString("hex");
        try {
          await db.query(
            `INSERT INTO namespaces (id, workspace_id, name, hex, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [namespaceId, req.workspaceId, name, hex, new Date()],
          );
        } catch {
          sendError(res, 409, `Namespace ${hex} is already registered.`);
          return;
        }
        sendJson(res, 201, { id: namespaceId, name, hex });
      })();
    },
  );

  router.get("/w/:workspaceId/fee-estimate", (req, res) => {
    void (async () => {
      const bytes = Number(req.query.bytes ?? 0);
      const shares = shareCount(bytes);
      const gas = blobGas(shares);
      const { feeUfern } = await import("../shared/domain.js");
      const fee = feeUfern(gas, config.minGasPriceUfernPerGas);
      sendJson(res, 200, { size: bytes, shares, gas, feeUfern: fee.toString() });
    })();
  });

  return router;
}

export function createApiRouterPart2(ctx: ApiContext): Router {
  const router = Router();
  const { config, db, hub, storage } = ctx;
  const developerCopy = "Viewers can't make changes in this workspace.";

  const requireSession = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.session) {
      sendJson(res, 401, ERROR_BODIES.unauthorized);
      return;
    }
    next();
  };

  router.use("/w/:workspaceId", requireSession, (req, res, next) => {
    void (async () => {
      const membership = await db.one<{ role: string }>(
        `SELECT role FROM memberships WHERE workspace_id = $1 AND person_id = $2`,
        [req.params.workspaceId!, req.session!.personId],
      );
      if (!membership) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      req.workspaceId = req.params.workspaceId;
      req.role = membership.role;
      next();
    })();
  });

  const requireRole = (allowed: (role: string) => boolean, copy: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!allowed(req.role!)) {
        sendError(res, 403, copy);
        return;
      }
      next();
    };
  };

  // Blobs.
  router.post(
    "/w/:workspaceId/blobs",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const body = req.body as { namespace?: string; dataBase64?: string; fee?: string };
        const namespace = String(body.namespace ?? "").trim().toLowerCase();
        const dataBase64 = String(body.dataBase64 ?? "");
        const feeText = String(body.fee ?? "");
        const data = Buffer.from(dataBase64, "base64");
        const size = data.length;
        const shares = shareCount(size);
        const gas = blobGas(shares);
        const minFee = feeUfern(gas, config.minGasPriceUfernPerGas);
        const maxBytes = 50 + 54 * (config.maxSquareWidth * config.maxSquareWidth - 1);

        if (!namespace) {
          sendFieldError(res, "namespace", "Choose a namespace.");
          return;
        }
        if (size < 1) {
          sendFieldError(res, "data", "A blob must contain at least 1 byte.");
          return;
        }
        if (size > maxBytes) {
          sendFieldError(
            res,
            "data",
            `This blob is ${size.toLocaleString("en-US")} bytes; a block holds at most ${maxBytes.toLocaleString("en-US")} bytes of blob data.`,
          );
          return;
        }
        const namespaceRecord = await db.one<{ hex: string }>(
          `SELECT hex FROM namespaces WHERE workspace_id = $1 AND hex = $2`,
          [req.workspaceId!, namespace],
        );
        if (!namespaceRecord) {
          sendFieldError(res, "namespace", "Choose a namespace.");
          return;
        }
        const fee = parseFernAmount(feeText);
        if (fee === null) {
          sendFieldError(res, "fee", "Fee must be an amount in FERN with at most 6 decimals.");
          return;
        }
        if (fee < minFee) {
          sendFieldError(res, "fee", `Fee too low: this blob needs at least ${formatFern(minFee)} FERN.`);
          return;
        }
        const balance = await accountBalance(db, req.workspaceId!, personAccount(req.session!.personId));
        const held = await heldUfern(db, req.workspaceId!, req.session!.personId);
        const available = balance - held;
        if (fee > available) {
          sendFieldError(
            res,
            "fee",
            `Insufficient balance: available ${formatFern(available)} FERN, this blob needs ${formatFern(fee)} FERN.`,
          );
          return;
        }
        if (!storage.isReachable) {
          sendError(
            res,
            503,
            "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.",
          );
          return;
        }
        const idempotencyKey = req.headers["idempotency-key"] !== undefined ? String(req.headers["idempotency-key"]) : undefined;
        const outcome = await checkIdempotency(db, req.session!.personId, req.workspaceId!, idempotencyKey, req.body);
        if (outcome.kind === "replay") {
          sendJson(res, outcome.replay.status, outcome.replay.body);
          return;
        }
        if (outcome.kind === "conflict") {
          sendJson(res, 409, { error: "This idempotency key was used for a different request." });
          return;
        }
        const blobId = randomBytes(12).toString("hex");
        const txId = randomBytes(12).toString("hex");
        const putResult = await storage.putConfirmed(`blobs/${blobId}`, data);
        if (!putResult.ok) {
          sendError(
            res,
            503,
            "Storage is unavailable, so blobs can't be submitted right now. The explorer still works.",
          );
          return;
        }
        const sequenceRow = await db.one<{ next: number }>(
          `SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM transactions WHERE workspace_id = $1`,
          [req.workspaceId!],
        );
        await db.query(
          `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, fee_ufern, gas, submitted_at, sequence, payload, hold_ufern)
           VALUES ($1, $2, 'blob', $3, 'pending', 'Pending', $4, $5, $6, $7, $8, $9)`,
          [
            txId,
            req.workspaceId,
            req.session!.personId,
            fee.toString(),
            gas,
            new Date(),
            sequenceRow?.next ?? 0,
            JSON.stringify({ dataBase64, namespace }),
            fee.toString(),
          ],
        );
        await db.query(
          `INSERT INTO blobs (id, workspace_id, tx_id, namespace, size_bytes, shares, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [blobId, req.workspaceId, txId, namespace, size, shares, new Date()],
        );
        hub.publish(req.workspaceId!, { kind: "mempool", body: {} });
        const responseBody = {
          id: txId,
          kind: "blob",
          status: "pending",
          feeUfern: fee.toString(),
          gas,
          submittedAt: new Date().toISOString(),
          blobId,
          size,
          shares,
        };
        if (idempotencyKey) {
          await rememberResponse(db, req.session!.personId, req.workspaceId!, idempotencyKey, req.body, 201, responseBody);
        }
        sendJson(res, 201, responseBody);
      })();
    },
  );

  router.get("/w/:workspaceId/blobs", (req, res) => {
    void (async () => {
      const mine = req.query.mine === "true";
      const rows = await db.many<{ id: string }>(
        `SELECT b.id FROM blobs b JOIN transactions t ON t.id = b.tx_id
         WHERE b.workspace_id = $1 ${mine ? "AND t.sender_id = $2" : ""} ORDER BY b.created_at DESC`,
        mine ? [req.workspaceId!, req.session!.personId] : [req.workspaceId!],
      );
      const out = [];
      for (const row of rows) {
        const blob = await blobBody(db, req.workspaceId!, row.id);
        if (blob) out.push(blob);
      }
      sendJson(res, 200, out);
    })();
  });

  router.get("/w/:workspaceId/blobs/:blobId", (req, res) => {
    void (async () => {
      const blob = await blobBody(db, req.workspaceId!, req.params.blobId);
      if (!blob) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      sendJson(res, 200, blob);
    })();
  });

  const blobBody = async (db2: Db, workspaceId: string, blobId: string) => {
    const row = await db2.one<{
      id: string;
      tx_id: string;
      namespace: string;
      size_bytes: number;
      shares: number;
      positions: unknown;
      status: string;
      status_text: string;
      height: number | null;
      fee_ufern: bigint;
      gas: number;
      sender_id: string;
      sender_name: string;
    }>(
      `SELECT b.id, b.tx_id, b.namespace, b.size_bytes, b.shares, b.positions,
              t.status, t.status_text, t.height, t.fee_ufern::bigint AS fee_ufern, t.gas,
              t.sender_id, p.name AS sender_name
       FROM blobs b JOIN transactions t ON t.id = b.tx_id JOIN people p ON p.id = t.sender_id
       WHERE b.workspace_id = $1 AND b.id = $2`,
      [workspaceId, blobId],
    );
    if (!row) return null;
    const namespace = await db2.one<{ name: string }>(
      `SELECT name FROM namespaces WHERE workspace_id = $1 AND hex = $2`,
      [workspaceId, row.namespace],
    );
    return {
      id: row.id,
      txId: row.tx_id,
      namespace: row.namespace,
      namespaceName: namespace?.name ?? "",
      size: row.size_bytes,
      shares: row.shares,
      gas: row.gas,
      feeUfern: row.fee_ufern.toString(),
      status: row.status,
      statusText: row.status_text,
      height: row.height,
      positions: row.positions as [number, number][],
      sender: row.sender_id,
      senderName: row.sender_name,
    };
  };

  router.get("/w/:workspaceId/transactions", (req, res) => {
    void (async () => {
      const mine = req.query.mine === "true";
      const rows = await db.many<{ id: string }>(
        `SELECT t.id FROM transactions t
         WHERE t.workspace_id = $1 ${mine ? "AND t.sender_id = $2" : ""} ORDER BY t.submitted_at DESC, t.sequence DESC`,
        mine ? [req.workspaceId!, req.session!.personId] : [req.workspaceId!],
      );
      const out = [];
      for (const row of rows) {
        const tx = await transactionBody(db, req.workspaceId!, row.id);
        if (tx) out.push(tx);
      }
      sendJson(res, 200, out);
    })();
  });

  router.get("/w/:workspaceId/transactions/:txId", (req, res) => {
    void (async () => {
      const tx = await transactionBody(db, req.workspaceId!, req.params.txId);
      if (!tx) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      sendJson(res, 200, tx);
    })();
  });

  const transactionBody = async (db2: Db, workspaceId: string, txId: string) => {
    const row = await db2.one<{
      id: string;
      kind: string;
      sender_id: string;
      sender_name: string;
      status: string;
      status_text: string;
      height: number | null;
      fee_ufern: bigint;
      gas: number;
      submitted_at: Date;
    }>(
      `SELECT t.id, t.kind, t.sender_id, p.name AS sender_name, t.status, t.status_text, t.height,
              t.fee_ufern::bigint AS fee_ufern, t.gas, t.submitted_at
       FROM transactions t JOIN people p ON p.id = t.sender_id
       WHERE t.workspace_id = $1 AND t.id = $2`,
      [workspaceId, txId],
    );
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      sender: row.sender_id,
      senderName: row.sender_name,
      status: row.status,
      statusText: row.status_text,
      height: row.height,
      feeUfern: row.fee_ufern.toString(),
      gas: row.gas,
      submittedAt: row.submitted_at.toISOString(),
    };
  };

  router.get("/w/:workspaceId/mempool", (req, res) => {
    void (async () => {
      const rows = await db.many<{ id: string }>(
        `SELECT t.id FROM transactions t JOIN blobs b ON b.tx_id = t.id
         WHERE t.workspace_id = $1 AND t.status = 'pending' ORDER BY t.sequence`,
        [req.workspaceId!],
      );
      const blobs = [];
      for (const row of rows) {
        const blob = await blobBody(db, req.workspaceId!, row.id);
        if (blob) blobs.push(blob);
      }
      sendJson(res, 200, { count: rows.length, blobs });
    })();
  });

  // Blocks.
  router.get("/w/:workspaceId/blocks", (req, res) => {
    void (async () => {
      const rows = await db.many<{
        height: number;
        produced_at: Date;
        square_width: number;
        status: string;
        blob_count: number;
        data_root: string;
      }>(
        `SELECT height, produced_at, square_width, status, blob_count, data_root FROM blocks
         WHERE workspace_id = $1 ORDER BY height DESC`,
        [req.workspaceId!],
      );
      sendJson(
        res,
        200,
        rows.map((row) => ({
          height: row.height,
          producedAt: row.produced_at.toISOString(),
          blobs: row.blob_count,
          squareWidth: row.square_width,
          status: row.status,
          dataRoot: row.data_root,
        })),
      );
    })();
  });

  router.get("/w/:workspaceId/blocks/:height", (req, res) => {
    void (async () => {
      const height = Number(req.params.height);
      const block = await blockBody(db, req.workspaceId!, height);
      if (!block) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      sendJson(res, 200, block);
    })();
  });

  router.get("/w/:workspaceId/blocks/:height/shares", (req, res) => {
    void (async () => {
      const height = Number(req.params.height);
      const block = await db.one<{
        square_width: number;
        shares_hex: string[];
        withheld: string[];
      }>(
        `SELECT square_width, shares_hex, withheld FROM blocks WHERE workspace_id = $1 AND height = $2`,
        [req.workspaceId!, height],
      );
      if (!block) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const k = block.square_width;
      const width = 2 * k;
      const withheldSet = new Set(block.withheld);
      const rows = [];
      for (let r = 0; r < width; r++) {
        const row = [];
        for (let c = 0; c < width; c++) {
          const index = r * width + c;
          const isWithheld = withheldSet.has(`${r},${c}`);
          const share = block.shares_hex[index] ?? "";
          row.push({
            row: r,
            col: c,
            quadrant: quadrantOf(r, c, k),
            namespace: share ? share.slice(0, 18) : "",
            kind: isWithheld ? "withheld" : share.slice(0, 18) === TAIL_PADDING_NAMESPACE ? "padding" : r < k && c < k ? "blob" : "parity",
            share: isWithheld ? null : share,
          });
        }
        rows.push(row);
      }
      sendJson(res, 200, { k, rows });
    })();
  });

  router.get("/w/:workspaceId/blocks/:height/proofs", (req, res) => {
    void (async () => {
      const height = Number(req.params.height);
      const namespaceHex = String(req.query.namespace ?? "").trim().toLowerCase();
      const failure = namespaceMessages(namespaceHex, "x", () => false);
      if (failure && "field" in failure) {
        sendFieldError(res, "namespace", failure.message);
        return;
      }
      const block = await db.one<{ square_width: number; shares_hex: string[] }>(
        `SELECT square_width, shares_hex FROM blocks WHERE workspace_id = $1 AND height = $2`,
        [req.workspaceId!, height],
      );
      if (!block) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const shares = block.shares_hex.map((hex) => hexToBytes(hex));
      const proof = proveNamespaceRows(shares, block.square_width, namespaceHex);
      sendJson(res, 200, {
        height,
        namespace: namespaceHex,
        rows: proof.rows.map((row) => ({ ...row, spans: undefined })),
      });
    })();
  });

  router.post("/w/:workspaceId/blocks/:height/proofs/verify", (req, res) => {
    void (async () => {
      const body = req.body as { proof?: InclusionProof | AbsenceProof };
      const proof = body.proof;
      if (!proof) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const verified = verifyRowProof({
        proof,
        spans: proof.nodes.map((n) => n.span),
        width: proofWidth(proof),
      });
      sendJson(res, 200, { verified: verified !== null, root: verified ?? proof.root });
    })();
  });

  router.get("/w/:workspaceId/blocks/:height/fraud-proof", (req, res) => {
    void (async () => {
      const height = Number(req.params.height);
      const proof = await db.one<{ axis: string; index: number; body: unknown; published_at: Date }>(
        `SELECT axis, index, body, published_at FROM fraud_proofs WHERE workspace_id = $1 AND height = $2`,
        [req.workspaceId!, height],
      );
      if (!proof) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const body = proof.body as unknown as Record<string, unknown>;
      sendJson(res, 200, {
        height,
        axis: proof.axis,
        index: proof.index,
        shares: body.shares,
        committedRoot: body.committedRoot,
        recomputedRoot: body.recomputedRoot,
        publishedAt: proof.published_at.toISOString(),
      });
    })();
  });

  router.get("/w/:workspaceId/blocks/:height/snapshot", (req, res) => {
    void (async () => {
      const height = Number(req.params.height);
      const exists = await db.one<{ height: number }>(
        `SELECT height FROM blocks WHERE workspace_id = $1 AND height = $2`,
        [req.workspaceId!, height],
      );
      if (!exists) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      if (!storage.isReachable) {
        sendError(res, 503, "Storage is unavailable, so the snapshot can't be downloaded right now.");
        return;
      }
      const key = `squares/${req.workspaceId}/${height}.bin`;
      const stored = await storage.get(key);
      if (!stored) {
        const built = await buildSnapshotBuffer(db, req.workspaceId!, height);
        await storage.putDeferred(key, built);
        sendSnapshot(res, height, built);
        return;
      }
      sendSnapshot(res, height, stored);
    })();
  });

  const blockBody = async (db2: Db, workspaceId: string, height: number) => {
    const block = await db2.one<{
      height: number;
      produced_at: Date;
      status: string;
      square_width: number;
      data_root: string;
      row_roots: unknown;
      column_roots: unknown;
      rejection: unknown;
      layout: unknown;
      blob_count: number;
    }>(
      `SELECT height, produced_at, status, square_width, data_root, row_roots, column_roots, rejection, layout, blob_count
       FROM blocks WHERE workspace_id = $1 AND height = $2`,
      [workspaceId, height],
    );
    if (!block) return null;
    const blobRows = await db2.many<{ id: string; namespace: string; positions: string }>(
      `SELECT b.id, b.namespace, b.positions FROM blobs b
       JOIN block_blobs bb ON bb.blob_id = b.id
       WHERE bb.workspace_id = $1 AND bb.height = $2`,
      [workspaceId, height],
    );
    const rejection = block.rejection ?? null;
    return {
      height: block.height,
      producedAt: block.produced_at.toISOString(),
      status: block.status,
      squareWidth: block.square_width,
      dataRoot: block.data_root,
      rowRoots: block.row_roots,
      columnRoots: block.column_roots,
      blobs: blobRows.map((row) => ({
        id: row.id,
        namespace: row.namespace,
        positions: row.positions,
      })),
      rejection,
    };
  };

  return router;
}

function sendSnapshot(res: Response, height: number, body: Buffer): void {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="block-${height}-square.bin"`);
  res.status(200).end(body);
}

function quadrantOf(row: number, col: number, k: number): "Q0" | "Q1" | "Q2" | "Q3" {
  const bottom = row >= k;
  const right = col >= k;
  if (!bottom && !right) return "Q0";
  if (!bottom && right) return "Q1";
  if (bottom && !right) return "Q2";
  return "Q3";
}

function proofWidth(proof: InclusionProof | AbsenceProof): number {
  const spanSum = proof.nodes.reduce((acc, node) => acc + node.span, 0);
  if (proof.kind === "inclusion") return spanSum + proof.shares.length;
  return spanSum + 1;
}

function readSessionToken(cookieHeader: string | string[] | undefined): string | null {
  if (!cookieHeader) return null;
  const text = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  for (const part of text.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "fs_session" && rest.length > 0) {
      return rest.join("=");
    }
  }
  return null;
}

export { readSessionToken };
