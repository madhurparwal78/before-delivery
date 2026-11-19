// API part 3: light nodes, staking, governance, ledger and grading routes.

import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  blobGas,
  confidenceDecimal,
  feeUfern,
  formatFern,
  isBlockAvailable,
  percentFromFraction,
  parseFernAmount,
} from "../shared/domain.js";
import type { ApiContext } from "./api.js";
import { ERROR_BODIES, sendError, sendFieldError, sendJson, readSessionToken } from "./api.js";
import { accountBalance, heldUfern, personAccount } from "./ledger.js";
import { listSamples, takeSample } from "./sampling.js";
import { resetAll, seedWorkspace } from "./seed.js";
import type { Db } from "./db.js";
import type { Clock } from "./clock.js";
import { checkIdempotency, rememberResponse } from "./idempotency.js";

export const SEED_PASSWORDS = {
  amara: "amara-fernhill-2026",
  felix: "felix-fernhill-2026",
  priya: "priya-fernhill-2026",
  jonas: "jonas-quarry-2026",
};

export function createApiRouterPart3(ctx: ApiContext): Router {
  const router = Router();
  const { config, db, hub, clock } = ctx;
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
        [req.params.workspaceId, req.session!.personId],
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

  const stakingFee = feeUfern(80_000, config.minGasPriceUfernPerGas);

  // Light nodes.
  router.get("/w/:workspaceId/light-nodes", (req, res) => {
    void (async () => {
      const nodes = await db.many<{ id: string; name: string; number: number; auto_sample: boolean }>(
        `SELECT id, name, number, auto_sample FROM light_nodes WHERE workspace_id = $1 ORDER BY number`,
        [req.workspaceId!],
      );
      sendJson(res, 200, nodes.map((node) => ({ id: node.id, name: node.name, number: node.number, autoSample: node.auto_sample })));
    })();
  });

  router.patch(
    "/w/:workspaceId/light-nodes/:nodeId",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const body = req.body as { autoSample?: boolean };
        const node = await db.one<{ id: string; name: string; number: number; auto_sample: boolean }>(
          `SELECT id, name, number, auto_sample FROM light_nodes WHERE workspace_id = $1 AND id = $2`,
          [req.workspaceId!, req.params.nodeId],
        );
        if (!node) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        if (typeof body.autoSample !== "boolean") {
          sendFieldError(res, "autoSample", "Choose a boolean.");
          return;
        }
        await db.query(`UPDATE light_nodes SET auto_sample = $1 WHERE id = $2`, [body.autoSample, node.id]);
        sendJson(res, 200, {
          id: node.id,
          name: node.name,
          number: node.number,
          autoSample: body.autoSample,
        });
      })();
    },
  );

  router.get("/w/:workspaceId/light-nodes/:nodeId/samples", (req, res) => {
    void (async () => {
      const node = await db.one<{ id: string; name: string; number: number }>(
        `SELECT id, name, number FROM light_nodes WHERE workspace_id = $1 AND id = $2`,
        [req.workspaceId!, req.params.nodeId],
      );
      if (!node) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const heightParam = req.query.height;
      const latest = await db.one<{ height: number; square_width: number }>(
        `SELECT height, square_width FROM blocks WHERE workspace_id = $1 ORDER BY height DESC LIMIT 1`,
        [req.workspaceId!],
      );
      if (!latest) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const height = heightParam !== undefined ? Number(heightParam) : latest.height;
      const block = await db.one<{ square_width: number; status: string }>(
        `SELECT square_width, status FROM blocks WHERE workspace_id = $1 AND height = $2`,
        [req.workspaceId!, height],
      );
      if (!block) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      const samples = await listSamples(db, node.id, height);
      const allServed = samples.every((sample) => sample.served);
      const confidence = confidenceDecimal(samples.length, block.square_width);
      const verdict = block.status === "rejected" ? "unavailable" : isBlockAvailable(samples.length, block.square_width, allServed) ? "available" : "sampling";
      sendJson(res, 200, {
        height,
        k: block.square_width,
        samples: samples.map((sample) => ({
          index: sample.index,
          row: sample.row,
          col: sample.col,
          served: sample.served,
          confidence: confidenceDecimal(sample.index + 1, block.square_width),
        })),
        confidence,
        verdict,
      });
    })();
  });

  router.post(
    "/w/:workspaceId/light-nodes/:nodeId/samples",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const body = req.body as { height?: number };
        const node = await db.one<{ id: string; name: string; number: number }>(
          `SELECT id, name, number FROM light_nodes WHERE workspace_id = $1 AND id = $2`,
          [req.workspaceId!, req.params.nodeId],
        );
        if (!node) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        const height = Number(body.height ?? NaN);
        const block = await db.one<{ square_width: number; status: string }>(
          `SELECT square_width, status FROM blocks WHERE workspace_id = $1 AND height = $2`,
          [req.workspaceId!, height],
        );
        if (!block) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        const existing = await listSamples(db, node.id, height);
        if (existing.length >= config.samplesPerBlock) {
          sendError(res, 409, `Light node ${node.name} has already taken ${config.samplesPerBlock} samples of block ${height}.`);
          return;
        }
        const sample = await takeSample(config, db, hub, req.workspaceId!, node.id, height, new Date());
        if (!sample) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        const samples = await listSamples(db, node.id, height);
        const allServed = samples.every((s) => s.served);
        sendJson(res, 201, {
          index: sample.index,
          row: sample.row,
          col: sample.col,
          served: sample.served,
          confidence: confidenceDecimal(samples.length, block.square_width),
          height,
          verdict: block.status === "rejected" ? "unavailable" : isBlockAvailable(samples.length, block.square_width, allServed) ? "available" : "sampling",
        });
      })();
    },
  );

  // Staking.
  router.get("/w/:workspaceId/validators", (req, res) => {
    void (async () => {
      const validators = await db.many<{
        id: string;
        name: string;
        self_stake_ufern: bigint;
        commission: string;
        stake_ufern: bigint;
      }>(
        `SELECT v.id, v.name, v.self_stake_ufern::bigint AS self_stake_ufern, v.commission::text AS commission,
                (v.self_stake_ufern + COALESCE((SELECT SUM(d.amount_ufern) FROM delegations d WHERE d.validator_id = v.id), 0))::bigint AS stake_ufern
         FROM validators v WHERE v.workspace_id = $1 ORDER BY v.name`,
        [req.workspaceId!],
      );
      const totalBonded = validators.reduce((acc, v) => acc + v.stake_ufern, 0n);
      sendJson(
        res,
        200,
        validators.map((v) => ({
          id: v.id,
          name: v.name,
          selfStakeUfern: v.self_stake_ufern.toString(),
          stakeUfern: v.stake_ufern.toString(),
          commission: v.commission,
          shareOfBonded: percentFromFraction(v.stake_ufern, totalBonded),
        })),
      );
    })();
  });

  router.get("/w/:workspaceId/staking/fee", (_req, res) => {
    sendJson(res, 200, { gas: 80_000, feeUfern: stakingFee.toString() });
  });

  router.get("/w/:workspaceId/staking/me", (req, res) => {
    void (async () => {
      const balance = await accountBalance(db, req.workspaceId!, personAccount(req.session!.personId));
      const held = await heldUfern(db, req.workspaceId!, req.session!.personId);
      const delegations = await db.many<{
        validator_id: string;
        name: string;
        amount_ufern: bigint;
        pending_rewards_ufern: bigint;
      }>(
        `SELECT d.validator_id, v.name, d.amount_ufern::bigint AS amount_ufern, d.pending_rewards_ufern::bigint AS pending_rewards_ufern
         FROM delegations d JOIN validators v ON v.id = d.validator_id
         WHERE d.workspace_id = $1 AND d.person_id = $2`,
        [req.workspaceId!, req.session!.personId],
      );
      const unbondings = await db.many<{
        id: string;
        validator_id: string;
        name: string;
        amount_ufern: bigint;
        completes_at: Date;
        released_at: Date | null;
      }>(
        `SELECT u.id, u.validator_id, v.name, u.amount_ufern::bigint AS amount_ufern, u.completes_at, u.released_at
         FROM unbondings u JOIN validators v ON v.id = u.validator_id
         WHERE u.workspace_id = $1 AND u.person_id = $2 ORDER BY u.completes_at`,
        [req.workspaceId!, req.session!.personId],
      );
      const redelegations = await db.many<{
        id: string;
        from_validator_id: string;
        from_name: string;
        to_validator_id: string;
        to_name: string;
        amount_ufern: bigint;
        arrived_at: Date;
        movable_at: Date;
      }>(
        `SELECT r.id, r.from_validator_id, fv.name AS from_name, r.to_validator_id, tv.name AS to_name,
                r.amount_ufern::bigint AS amount_ufern, r.arrived_at, r.movable_at
         FROM redelegations r
         JOIN validators fv ON fv.id = r.from_validator_id
         JOIN validators tv ON tv.id = r.to_validator_id
         WHERE r.workspace_id = $1 AND r.person_id = $2`,
        [req.workspaceId!, req.session!.personId],
      );
      const now = clock.now();
      sendJson(res, 200, {
        balanceUfern: balance.toString(),
        availableUfern: (balance - held).toString(),
        heldUfern: held.toString(),
        delegations: delegations.map((d) => ({
          validator: d.validator_id,
          validatorName: d.name,
          amountUfern: d.amount_ufern.toString(),
          pendingRewardsUfern: d.pending_rewards_ufern.toString(),
        })),
        unbondings: unbondings.map((u) => ({
          id: u.id,
          validator: u.validator_id,
          validatorName: u.name,
          amountUfern: u.amount_ufern.toString(),
          completesAt: u.completes_at.toISOString(),
          status: u.released_at !== null || u.completes_at.getTime() <= now ? "released" : "unbonding",
        })),
        redelegations: redelegations.map((r) => ({
          from: r.from_validator_id,
          fromName: r.from_name,
          to: r.to_validator_id,
          toName: r.to_name,
          amountUfern: r.amount_ufern.toString(),
          arrivedAt: r.arrived_at.toISOString(),
          movableAt: r.movable_at.toISOString(),
        })),
      });
    })();
  });

  const stakingWrite = (kind: "delegate" | "undelegate" | "redelegate" | "claim") => {
    return (req: Request, res: Response): void => {
      void (async () => {
        const body = req.body as {
          validator?: string;
          from?: string;
          to?: string;
          amount?: string;
        };
        const personId = req.session!.personId;
        const workspaceId = req.workspaceId!;
        const validatorId = kind === "redelegate" ? String(body.from ?? "") : String(body.validator ?? "");
        const toValidatorId = kind === "redelegate" ? String(body.to ?? "") : "";
        const amountText = String(body.amount ?? "");
        const amount = kind === "claim" ? 0n : parseFernAmount(amountText);

        const validator = validatorId
          ? await db.one<{ id: string; name: string }>(`SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`, [workspaceId, validatorId])
          : null;
        const toValidator = kind === "redelegate"
          ? await db.one<{ id: string; name: string }>(`SELECT id, name FROM validators WHERE workspace_id = $1 AND id = $2`, [workspaceId, toValidatorId])
          : null;
        if (kind !== "claim" && (!validator || (kind === "redelegate" && !toValidator))) {
          sendFieldError(res, kind === "redelegate" ? "from" : "validator", "Choose a validator.");
          return;
        }
        if (kind === "redelegate" && validatorId === toValidatorId) {
          sendFieldError(res, "to", "Choose a different validator.");
          return;
        }
        if (kind !== "claim" && amount === null) {
          sendFieldError(res, "amount", "Amount must be an amount in FERN with at most 6 decimals.");
          return;
        }
        if (kind !== "claim" && amount === 0n) {
          sendFieldError(res, "amount", "Amount must be more than 0.");
          return;
        }
        const balance = await accountBalance(db, workspaceId, personAccount(personId));
        const held = await heldUfern(db, workspaceId, personId);
        const available = balance - held;
        const fee = stakingFee;
        if (kind === "delegate" && amount! > available - fee) {
          sendFieldError(res, "amount", `You can delegate at most ${formatFern(available - fee)} FERN.`);
          return;
        }
        if (kind === "undelegate" || kind === "redelegate") {
          const delegation = await db.one<{ amount_ufern: bigint }>(
            `SELECT amount_ufern::bigint AS amount_ufern FROM delegations WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3`,
            [workspaceId, personId, validatorId],
          );
          const movable = delegation?.amount_ufern ?? 0n;
          if (amount! > movable) {
            const verb = kind === "undelegate" ? "undelegate" : "redelegate";
            sendFieldError(res, "amount", `You can ${verb} at most ${formatFern(movable)} FERN.`);
            return;
          }
          if (kind === "redelegate") {
            const locked = await db.many<{ movable_at: Date; from_name: string; arrived_at: Date }>(
              `SELECT r.movable_at, fv.name AS from_name, r.arrived_at FROM redelegations r JOIN validators fv ON fv.id = r.from_validator_id
               WHERE r.workspace_id = $1 AND r.person_id = $2 AND r.to_validator_id = $3`,
              [workspaceId, personId, validatorId],
            );
            for (const lock of locked) {
              if (lock.movable_at.getTime() > clock.now()) {
                sendFieldError(
                  res,
                  "amount",
                  `This stake arrived from ${lock.from_name} at ${lock.arrived_at.toISOString()} and can move again at ${lock.movable_at.toISOString()}.`,
                );
                return;
              }
            }
          }
        }
        if (kind === "undelegate") {
          const inProgress = await db.one<{ total: number }>(
            `SELECT COUNT(*) AS total FROM unbondings WHERE workspace_id = $1 AND person_id = $2 AND validator_id = $3 AND released_at IS NULL`,
            [workspaceId, personId, validatorId],
          );
          if (Number(inProgress?.total ?? 0) >= config.maxUnbondings) {
            sendFieldError(res, "amount", `You already have ${config.maxUnbondings} unbondings in progress from ${validator!.name}.`);
            return;
          }
        }
        if (kind === "redelegate") {
          const inProgress = await db.one<{ total: number }>(
            `SELECT COUNT(*) AS total FROM redelegations WHERE workspace_id = $1 AND person_id = $2 AND movable_at > $3`,
            [workspaceId, personId, new Date(clock.now())],
          );
          if (Number(inProgress?.total ?? 0) >= config.maxRedelegations) {
            sendFieldError(res, "amount", `You already have ${config.maxRedelegations} redelegations in progress.`);
            return;
          }
        }
        if (kind === "claim") {
          const total = await db.one<{ total: bigint | null }>(
            `SELECT COALESCE(SUM(pending_rewards_ufern), 0) AS total FROM delegations WHERE workspace_id = $1 AND person_id = $2`,
            [workspaceId, personId],
          );
          if ((total?.total ?? 0n) === 0n) {
            sendError(res, 409, "There are no rewards to claim.");
            return;
          }
        } else if (fee > available) {
          sendFieldError(res, "amount", `Insufficient balance: available ${formatFern(available)} FERN, this transaction needs ${formatFern(fee)} FERN.`);
          return;
        }

        const idempotencyKey = req.headers["idempotency-key"] !== undefined ? String(req.headers["idempotency-key"]) : undefined;
        const outcome = await checkIdempotency(db, req.session!.personId, workspaceId, idempotencyKey, req.body);
        if (outcome.kind === "replay") {
          sendJson(res, outcome.replay.status, outcome.replay.body);
          return;
        }
        if (outcome.kind === "conflict") {
          sendJson(res, 409, { error: "This idempotency key was used for a different request." });
          return;
        }
        const txId = randomBytes(12).toString("hex");
        const sequenceRow = await db.one<{ next: number }>(
          `SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM transactions WHERE workspace_id = $1`,
          [workspaceId],
        );
        const payload: Record<string, unknown> =
          kind === "redelegate"
            ? { fromValidatorId: validatorId, toValidatorId, amountUfern: amount!.toString() }
            : kind === "claim"
              ? {}
              : { validatorId, amountUfern: amount!.toString() };
        await db.query(
          `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, fee_ufern, gas, submitted_at, sequence, payload, hold_ufern)
           VALUES ($1, $2, $3, $4, 'pending', 'Pending', $5, 80000, $6, $7, $8, $9)`,
          [
            txId,
            workspaceId,
            kind,
            personId,
            fee.toString(),
            new Date(),
            sequenceRow?.next ?? 0,
            JSON.stringify(payload),
            kind === "delegate" ? amount!.toString() : "0",
          ],
        );
        hub.publish(workspaceId, { kind: "transaction", body: { id: txId, kind } });
        const responseBody = {
          id: txId,
          kind,
          status: "pending",
          feeUfern: fee.toString(),
          gas: 80_000,
          submittedAt: new Date().toISOString(),
        };
        if (idempotencyKey) {
          await rememberResponse(db, req.session!.personId, workspaceId, idempotencyKey, req.body, 201, responseBody);
        }
        sendJson(res, 201, responseBody);
      })();
    };
  };

  router.post("/w/:workspaceId/staking/delegate", requireRole((r) => r !== "viewer", developerCopy), stakingWrite("delegate"));
  router.post("/w/:workspaceId/staking/undelegate", requireRole((r) => r !== "viewer", developerCopy), stakingWrite("undelegate"));
  router.post("/w/:workspaceId/staking/redelegate", requireRole((r) => r !== "viewer", developerCopy), stakingWrite("redelegate"));
  router.post("/w/:workspaceId/staking/claim", requireRole((r) => r !== "viewer", developerCopy), stakingWrite("claim"));

  // Governance.
  router.get("/w/:workspaceId/proposals", (req, res) => {
    void (async () => {
      const proposals = await db.many<{ number: number }>(
        `SELECT number FROM proposals WHERE workspace_id = $1 ORDER BY number`,
        [req.workspaceId!],
      );
      const out = [];
      for (const proposal of proposals) {
        out.push(await proposalBody(db, req.workspaceId!, proposal.number, req.session!.personId));
      }
      sendJson(res, 200, out);
    })();
  });

  router.get("/w/:workspaceId/proposals/:number", (req, res) => {
    void (async () => {
      const body = await proposalBody(db, req.workspaceId!, Number(req.params.number), req.session!.personId);
      if (!body) {
        sendJson(res, 404, ERROR_BODIES.notFound);
        return;
      }
      sendJson(res, 200, body);
    })();
  });

  router.post("/w/:workspaceId/proposals", requireRole((r) => r !== "viewer", developerCopy), (req, res) => {
    void (async () => {
      const body = req.body as { title?: string; description?: string; initialDeposit?: string };
      const title = String(body.title ?? "").trim();
      const description = String(body.description ?? "");
      const deposit = parseFernAmount(String(body.initialDeposit ?? "0"));
      if (!title) {
        sendFieldError(res, "title", "Give the proposal a title.");
        return;
      }
      if (title.length > 120) {
        sendFieldError(res, "title", "Keep the title to 120 characters or fewer.");
        return;
      }
      if (description.length > 2000) {
        sendFieldError(res, "description", "Keep the description to 2,000 characters or fewer.");
        return;
      }
      if (deposit === null) {
        sendFieldError(res, "amount", "Amount must be an amount in FERN with at most 6 decimals.");
        return;
      }
      const balance = await accountBalance(db, req.workspaceId!, personAccount(req.session!.personId));
      const held = await heldUfern(db, req.workspaceId!, req.session!.personId);
      const available = balance - held;
      if (deposit + stakingFee > available) {
        sendFieldError(res, "amount", `Insufficient balance: available ${formatFern(available)} FERN, this transaction needs ${formatFern(deposit + stakingFee)} FERN.`);
        return;
      }
      const txId = randomBytes(12).toString("hex");
      const sequenceRow = await db.one<{ next: number }>(
        `SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM transactions WHERE workspace_id = $1`,
        [req.workspaceId!],
      );
      await db.query(
        `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, fee_ufern, gas, submitted_at, sequence, payload, hold_ufern)
         VALUES ($1, $2, 'proposal', $3, 'pending', 'Pending', $4, 80000, $5, $6, $7, $8)`,
        [
          txId,
          req.workspaceId,
          req.session!.personId,
          stakingFee.toString(),
          new Date(),
          sequenceRow?.next ?? 0,
          JSON.stringify({ title, description, amountUfern: deposit.toString() }),
          deposit.toString(),
        ],
      );
      sendJson(res, 201, {
        id: txId,
        kind: "proposal",
        status: "pending",
        feeUfern: stakingFee.toString(),
        gas: 80_000,
        submittedAt: new Date().toISOString(),
      });
    })();
  });

  router.post(
    "/w/:workspaceId/proposals/:number/deposits",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const number = Number(req.params.number);
        const body = req.body as { amount?: string };
        const amount = parseFernAmount(String(body.amount ?? ""));
        const proposal = await db.one<{ status: string; deposit_ends_at: Date | null }>(
          `SELECT status, deposit_ends_at FROM proposals WHERE workspace_id = $1 AND number = $2`,
          [req.workspaceId!, number],
        );
        if (!proposal) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        if (amount === null) {
          sendFieldError(res, "amount", "Amount must be an amount in FERN with at most 6 decimals.");
          return;
        }
        if (amount === 0n) {
          sendFieldError(res, "amount", "Amount must be more than 0.");
          return;
        }
        if (proposal.status !== "deposit" || !proposal.deposit_ends_at || proposal.deposit_ends_at.getTime() <= clock.now()) {
          sendError(res, 409, `The deposit period for proposal ${number} has ended.`);
          return;
        }
        const balance = await accountBalance(db, req.workspaceId!, personAccount(req.session!.personId));
        const held = await heldUfern(db, req.workspaceId!, req.session!.personId);
        const available = balance - held;
        if (amount + stakingFee > available) {
          sendFieldError(res, "amount", `Insufficient balance: available ${formatFern(available)} FERN, this transaction needs ${formatFern(amount + stakingFee)} FERN.`);
          return;
        }
        const txId = randomBytes(12).toString("hex");
        const sequenceRow = await db.one<{ next: number }>(
          `SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM transactions WHERE workspace_id = $1`,
          [req.workspaceId!],
        );
        await db.query(
          `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, fee_ufern, gas, submitted_at, sequence, payload, hold_ufern)
           VALUES ($1, $2, 'deposit', $3, 'pending', 'Pending', $4, 80000, $5, $6, $7, $8)`,
          [
            txId,
            req.workspaceId,
            req.session!.personId,
            stakingFee.toString(),
            new Date(),
            sequenceRow?.next ?? 0,
            JSON.stringify({ number, amountUfern: amount.toString() }),
            amount.toString(),
          ],
        );
        sendJson(res, 201, {
          id: txId,
          kind: "deposit",
          status: "pending",
          feeUfern: stakingFee.toString(),
          gas: 80_000,
          submittedAt: new Date().toISOString(),
        });
      })();
    },
  );

  router.post(
    "/w/:workspaceId/proposals/:number/votes",
    requireRole((r) => r !== "viewer", developerCopy),
    (req, res) => {
      void (async () => {
        const number = Number(req.params.number);
        const body = req.body as { option?: string };
        const option = String(body.option ?? "");
        const proposal = await db.one<{ status: string; voting_ends_at: Date | null }>(
          `SELECT status, voting_ends_at FROM proposals WHERE workspace_id = $1 AND number = $2`,
          [req.workspaceId!, number],
        );
        if (!proposal) {
          sendJson(res, 404, ERROR_BODIES.notFound);
          return;
        }
        if (!["yes", "no", "no_with_veto", "abstain"].includes(option)) {
          sendFieldError(res, "option", "Choose an option.");
          return;
        }
        if (proposal.status === "deposit" || !proposal.voting_ends_at) {
          sendError(res, 409, `Proposal ${number} is not open for voting yet.`);
          return;
        }
        if (proposal.status !== "voting" || proposal.voting_ends_at.getTime() <= clock.now()) {
          sendError(res, 409, `The voting period for proposal ${number} has ended.`);
          return;
        }
        const balance = await accountBalance(db, req.workspaceId!, personAccount(req.session!.personId));
        const held = await heldUfern(db, req.workspaceId!, req.session!.personId);
        if (stakingFee > balance - held) {
          sendFieldError(res, "amount", `Insufficient balance: available ${formatFern(balance - held)} FERN, this transaction needs ${formatFern(stakingFee)} FERN.`);
          return;
        }
        const txId = randomBytes(12).toString("hex");
        const sequenceRow = await db.one<{ next: number }>(
          `SELECT COALESCE(MAX(sequence) + 1, 0) AS next FROM transactions WHERE workspace_id = $1`,
          [req.workspaceId!],
        );
        await db.query(
          `INSERT INTO transactions (id, workspace_id, kind, sender_id, status, status_text, fee_ufern, gas, submitted_at, sequence, payload, hold_ufern)
           VALUES ($1, $2, 'vote', $3, 'pending', 'Pending', $4, 80000, $5, $6, $7, 0)`,
          [
            txId,
            req.workspaceId,
            req.session!.personId,
            stakingFee.toString(),
            new Date(),
            sequenceRow?.next ?? 0,
            JSON.stringify({ number, option }),
          ],
        );
        sendJson(res, 201, {
          id: txId,
          kind: "vote",
          status: "pending",
          feeUfern: stakingFee.toString(),
          gas: 80_000,
          submittedAt: new Date().toISOString(),
        });
      })();
    },
  );

  // Ledger.
  router.get("/w/:workspaceId/ledger", (req, res) => {
    void (async () => {
      const account = req.query.account as string | undefined;
      const rows = await db.many<{
        id: string;
        pair_id: string;
        account: string;
        counter_account: string;
        kind: string;
        label: string;
        amount_ufern: bigint;
        height: number | null;
        at: Date;
      }>(
        `SELECT id, pair_id, account, counter_account, kind, label, amount_ufern::bigint AS amount_ufern, height, at
         FROM ledger_entries WHERE workspace_id = $1 ${account ? "AND account = $2" : ""} ORDER BY at DESC, id DESC`,
        account ? [req.workspaceId!, account] : [req.workspaceId!],
      );
      let balance = 0n;
      if (account) {
        const row = await db.one<{ total: bigint | null }>(
          `SELECT COALESCE(SUM(amount_ufern), 0) AS total FROM ledger_entries WHERE workspace_id = $1 AND account = $2`,
          [req.workspaceId!, account],
        );
        balance = row?.total ?? 0n;
      }
      sendJson(res, 200, {
        account: account ?? null,
        balanceUfern: balance.toString(),
        entries: rows.map((row) => ({
          id: row.id,
          pairId: row.pair_id,
          account: row.account,
          counterAccount: row.counter_account,
          kind: row.kind,
          label: row.label,
          amountUfern: row.amount_ufern.toString(),
          height: row.height,
          at: row.at.toISOString(),
        })),
      });
    })();
  });

  return router;
}

/** Live tally of a proposal: votes by bonded stake, quorum, veto and pass rules. */
async function proposalBody(db: Db, workspaceId: string, number: number, personId: string) {
  const proposal = await db.one<{
    number: number;
    title: string;
    description: string;
    status: string;
    status_text: string;
    deposit_ufern: bigint;
    min_deposit_ufern: bigint;
    deposit_ends_at: Date | null;
    voting_ends_at: Date | null;
  }>(
    `SELECT number, title, description, status, status_text, deposit_ufern::bigint AS deposit_ufern,
            min_deposit_ufern::bigint AS min_deposit_ufern, deposit_ends_at, voting_ends_at
     FROM proposals WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  if (!proposal) return null;
  const votes = await db.many<{ person_id: string; option: string }>(
    `SELECT person_id, option FROM votes WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  const validators = await db.many<{ id: string; name: string; self_stake_ufern: bigint; stake_ufern: bigint }>(
    `SELECT v.id, v.name, v.self_stake_ufern::bigint AS self_stake_ufern,
            (v.self_stake_ufern + COALESCE((SELECT SUM(d.amount_ufern) FROM delegations d WHERE d.validator_id = v.id), 0))::bigint AS stake_ufern
     FROM validators v WHERE v.workspace_id = $1`,
    [workspaceId],
  );
  const validatorByOperator = new Map(validators.map((v) => [`validator-op-${v.id}`, v]));
  const delegations = await db.many<{ person_id: string; validator_id: string; amount_ufern: bigint }>(
    `SELECT person_id, validator_id, amount_ufern::bigint AS amount_ufern FROM delegations WHERE workspace_id = $1`,
    [workspaceId],
  );
  const bondedByPerson = new Map<string, bigint>();
  for (const validator of validators) {
    bondedByPerson.set(validator.id, validator.stake_ufern);
  }
  for (const delegation of delegations) {
    bondedByPerson.set(delegation.person_id, (bondedByPerson.get(delegation.person_id) ?? 0n) + delegation.amount_ufern);
  }
  const totalBonded = validators.reduce((acc, v) => acc + v.stake_ufern, 0n);
  const voteTotals: Record<string, bigint> = { yes: 0n, no: 0n, no_with_veto: 0n, abstain: 0n };
  for (const vote of votes) {
    const validator = validatorByOperator.get(vote.person_id);
    const power = validator ? validator.self_stake_ufern : bondedByPerson.get(vote.person_id) ?? 0n;
    voteTotals[vote.option] = (voteTotals[vote.option] ?? 0n) + power;
  }
  const votesTotal = voteTotals.yes + voteTotals.no + voteTotals.no_with_veto + voteTotals.abstain;
  const turnout = percentFromFraction(votesTotal, totalBonded);
  const vetoShare = percentFromFraction(voteTotals.no_with_veto, votesTotal);
  const yesShare = percentFromFraction(voteTotals.yes, votesTotal);
  const quorumReached = votesTotal * 1000n > totalBonded * 334n;
  const vetoed = votesTotal > 0n && voteTotals.no_with_veto * 1000n > votesTotal * 334n;
  const yesPassed = votesTotal - voteTotals.abstain > 0n && voteTotals.yes * 2n > votesTotal - voteTotals.abstain;
  let result: string;
  if (proposal.status === "deposit") {
    result = "Deposit period";
  } else if (proposal.status === "voting") {
    if (!quorumReached) result = "Rejected — quorum not reached";
    else if (vetoed) result = "Rejected with veto";
    else if (yesPassed) result = "Passed";
    else result = "Rejected";
  } else {
    result = proposal.status_text;
  }
  const myVoteRow = await db.one<{ option: string }>(
    `SELECT option FROM votes WHERE workspace_id = $1 AND number = $2 AND person_id = $3`,
    [workspaceId, number, personId],
  );
  return {
    number: proposal.number,
    title: proposal.title,
    description: proposal.description,
    status: proposal.status,
    statusText: proposal.status_text,
    depositUfern: proposal.deposit_ufern.toString(),
    minDepositUfern: proposal.min_deposit_ufern.toString(),
    depositEndsAt: proposal.deposit_ends_at?.toISOString() ?? null,
    votingEndsAt: proposal.voting_ends_at?.toISOString() ?? null,
    tally: {
      votesUfern: votesTotal.toString(),
      totalBondedUfern: totalBonded.toString(),
      turnout,
      yesUfern: voteTotals.yes!.toString(),
      noUfern: voteTotals.no!.toString(),
      noWithVetoUfern: voteTotals.no_with_veto!.toString(),
      abstainUfern: voteTotals.abstain!.toString(),
      vetoShare,
      yesShare,
      result,
    },
    myVote: myVoteRow?.option ?? null,
  };
}

/** The grading router: reset, seed and clock, all key-guarded. */
export function createGradingRouter(ctx: ApiContext & { clock: Clock }): Router {
  const router = Router();
  const { config, db, storage, clock } = ctx;

  router.use((req, res, next) => {
    if (req.headers["x-grading-key"] !== config.gradingKey) {
      sendJson(res, 404, ERROR_BODIES.notFound);
      return;
    }
    next();
  });

  router.post("/reset", (_req, res) => {
    void (async () => {
      await resetAll(db, storage);
      await clock.setOffset(0n);
      sendJson(res, 200, { clock: new Date(config.appStartAtMs).toISOString() });
    })();
  });

  router.post("/seed", (_req, res) => {
    void (async () => {
      await resetAll(db, storage);
      const result = await seedWorkspace(config, db, storage, SEED_PASSWORDS);
      await clock.setOffset(BigInt(5 * config.blockTimeSeconds) * 1000n);
      sendJson(res, 200, result);
    })();
  });

  router.post("/clock", (req, res) => {
    void (async () => {
      const body = req.body as { advanceMs?: unknown };
      const raw = body.advanceMs;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 86_400_000) {
        sendFieldError(res, "advanceMs", "Give a whole number of milliseconds from 0 to 86400000.");
        return;
      }
      const before = clock.currentOffset();
      await clock.setOffset(before + BigInt(raw));
      const { runDueEvents } = await import("./main.js");
      await runDueEvents(config, db, clock, ctx.hub, storage);
      const heights = await workspaceHeights(db);
      sendJson(res, 200, {
        clock: new Date(config.appStartAtMs + clock.now() - config.appStartAtMs).toISOString(),
        heights,
      });
    })();
  });

  return router;
}

export async function workspaceHeights(db: Db): Promise<Record<string, number>> {
  const workspaces = await db.many<{ id: string }>(`SELECT id FROM workspaces`);
  const heights: Record<string, number> = {};
  for (const workspace of workspaces) {
    const row = await db.one<{ height: number }>(
      `SELECT COALESCE(MAX(height), 0) AS height FROM blocks WHERE workspace_id = $1`,
      [workspace.id],
    );
    heights[workspace.id] = row?.height ?? 0;
  }
  return heights;
}

export { readSessionToken, blobGas };
