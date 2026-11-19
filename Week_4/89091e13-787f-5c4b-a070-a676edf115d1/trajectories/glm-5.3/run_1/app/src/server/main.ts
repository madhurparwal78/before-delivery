// Server entry point. One process holds the simulation, the clock, the mail
// sender and the WebSocket hub.

import { createServer } from "node:http";
import express from "express";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { Db } from "./db.js";
import { SCHEMA_SQL } from "./schema.js";
import { Storage } from "./storage.js";
import { LiveHub, attachWebSocket } from "./live.js";
import { Clock } from "./clock.js";
import { createApiRouter, createApiRouterPart2 } from "./api.js";
import { createApiRouterPart3, createGradingRouter } from "./api3.js";
import { produceBlock } from "./blocks.js";
import { runFraudCheck, takeSample } from "./sampling.js";
import { deliverOutbox } from "./mail.js";
import { seedWorkspace } from "./seed.js";
import { SEED_PASSWORDS } from "./api3.js";
import type { AppConfig } from "./config.js";

const PUBLIC_DIR = join(process.cwd(), "public");

/** Runs every due event for every workspace, in the published order. */
export async function runDueEvents(
  config: AppConfig,
  db: Db,
  clock: Clock,
  hub: LiveHub,
  storage: Storage,
): Promise<void> {
  const now = clock.now();
  const workspaces = await db.many<{ id: string }>(`SELECT id FROM workspaces`);
  for (const workspace of workspaces) {
    const heightRow = await db.one<{ height: number }>(
      `SELECT COALESCE(MAX(height), 0) AS height FROM blocks WHERE workspace_id = $1`,
      [workspace.id],
    );
    let height = heightRow?.height ?? 0;
    // Produce every block whose instant has arrived, gapless.
    while (config.appStartAtMs + (height + 1) * config.blockTimeSeconds * 1000 <= now) {
      height += 1;
      await produceBlock(config, db, hub, storage, workspace.id, height);
    }
    // Auto-sampling: every block produced while the node is on gets one sample
    // every interval, starting one interval after production, up to the cap.
    const nodes = await db.many<{ id: string; number: number; auto_sample: boolean }>(
      `SELECT id, number, auto_sample FROM light_nodes WHERE workspace_id = $1`,
      [workspace.id],
    );
    for (const node of nodes) {
      if (!node.auto_sample) continue;
      const samplingBlocks = await db.many<{ height: number; produced_at: Date; status: string }>(
        `SELECT height, produced_at, status FROM blocks WHERE workspace_id = $1 AND status = 'sampling' ORDER BY height`,
        [workspace.id],
      );
      for (const blockRow of samplingBlocks) {
        const taken = await db.one<{ total: number }>(
          `SELECT COUNT(*) AS total FROM samples WHERE node_id = $1 AND height = $2`,
          [node.id, blockRow.height],
        );
        const count = Number(taken?.total ?? 0);
        const dueCount = Math.floor((now - blockRow.produced_at.getTime()) / config.sampleIntervalMs);
        const wanted = Math.min(dueCount, config.samplesPerBlock);
        for (let i = count; i < wanted; i++) {
          const result = await takeSample(
            config,
            db,
            hub,
            workspace.id,
            node.id,
            blockRow.height,
            new Date(blockRow.produced_at.getTime() + (i + 1) * config.sampleIntervalMs),
          );
          if (!result) break;
          const status = await db.one<{ status: string }>(
            `SELECT status FROM blocks WHERE workspace_id = $1 AND height = $2`,
            [workspace.id, blockRow.height],
          );
          if (status?.status === "rejected") break;
        }
      }
    }
    // Fraud checks on bad-encoding blocks once the delay has passed.
    const badBlocks = await db.many<{ height: number; produced_at: Date; status: string }>(
      `SELECT height, produced_at, status FROM blocks
       WHERE workspace_id = $1 AND producer_behaviour = 'bad-encoding'
         AND NOT EXISTS (SELECT 1 FROM fraud_proofs f WHERE f.workspace_id = blocks.workspace_id AND f.height = blocks.height)`,
      [workspace.id],
    );
    for (const block of badBlocks) {
      const dueAt = block.produced_at.getTime() + config.fraudCheckDelayMs;
      if (dueAt <= now) {
        await runFraudCheck(db, hub, workspace.id, block.height, dueAt);
      }
    }
    // Unbonding releases, inclusive at the end instant.
    const unbondings = await db.many<{
      id: string;
      person_id: string;
      validator_id: string;
      amount_ufern: bigint;
      completes_at: Date;
    }>(
      `SELECT u.id, u.person_id, u.validator_id, u.amount_ufern::bigint AS amount_ufern, u.completes_at
       FROM unbondings u
       JOIN validators v ON v.id = u.validator_id
       WHERE u.workspace_id = $1 AND u.released_at IS NULL AND u.completes_at <= $2`,
      [workspace.id, new Date(now + 1)],
    );
    for (const unbonding of unbondings) {
      await releaseUnbonding(db, workspace.id, unbonding);
    }
    // Proposal period ends and vote reminders.
    const proposals = await db.many<{
      number: number;
      status: string;
      deposit_ufern: bigint;
      min_deposit_ufern: bigint;
      deposit_ends_at: Date | null;
      voting_ends_at: Date | null;
    }>(
      `SELECT number, status, deposit_ufern::bigint AS deposit_ufern, min_deposit_ufern::bigint AS min_deposit_ufern,
              deposit_ends_at, voting_ends_at FROM proposals WHERE workspace_id = $1 AND status IN ('deposit','voting')`,
      [workspace.id],
    );
    for (const proposal of proposals) {
      if (proposal.status === "deposit" && proposal.deposit_ends_at && proposal.deposit_ends_at.getTime() <= now + 1) {
        await endDepositPeriod(db, hub, workspace.id, proposal.number);
      }
      if (proposal.status === "voting" && proposal.voting_ends_at && proposal.voting_ends_at.getTime() <= now + 1) {
        await endVotingPeriod(db, hub, workspace.id, proposal.number);
      }
    }
  }
}

async function releaseUnbonding(
  db: Db,
  workspaceId: string,
  unbonding: {
    id: string;
    person_id: string;
    validator_id: string;
    amount_ufern: bigint;
    completes_at: Date;
  },
): Promise<void> {
  const { ledgerPair, personAccount, postPair } = await import("./ledger.js");
  const { queueMail } = await import("./mail.js");
  const validator = await db.one<{ name: string }>(`SELECT name FROM validators WHERE id = $1`, [
    unbonding.validator_id,
  ]);
  await db.transaction(async (tx) => {
    const released = await tx.one<{ id: string }>(
      `SELECT id FROM unbondings WHERE id = $1 AND released_at IS NULL`,
      [unbonding.id],
    );
    if (!released) return;
    await tx.query(`UPDATE unbondings SET released_at = $1 WHERE id = $2`, [
      unbonding.completes_at,
      unbonding.id,
    ]);
    const pair = ledgerPair({
      workspaceId,
      credit: { account: personAccount(unbonding.person_id), amount: unbonding.amount_ufern },
      debit: { account: "unbonding", amount: unbonding.amount_ufern },
      kind: "unbonding-released",
      label: `Unbonding released from ${validator?.name ?? ""}`,
      at: unbonding.completes_at,
    });
    await postPair(tx, pair);
    const person = await tx.one<{ email: string }>(`SELECT email FROM people WHERE id = $1`, [
      unbonding.person_id,
    ]);
    if (person) {
      const { formatFern } = await import("../shared/domain.js");
      await queueMail(
        tx,
        workspaceId,
        person.email,
        `Unbonding complete: ${formatFern(unbonding.amount_ufern)} FERN from ${validator?.name ?? ""}`,
        `Unbonding complete: ${formatFern(unbonding.amount_ufern)} FERN from ${validator?.name ?? ""}\n\nYour unbonding in your Fernsquare workspace has completed and the tokens are back in your balance.`,
      );
    }
  });
}

async function endDepositPeriod(
  db: Db,
  hub: LiveHub,
  workspaceId: string,
  number: number,
): Promise<void> {
  const proposal = await db.one<{ deposit_ufern: bigint; min_deposit_ufern: bigint }>(
    `SELECT deposit_ufern::bigint AS deposit_ufern, min_deposit_ufern::bigint AS min_deposit_ufern FROM proposals WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  if (!proposal) return;
  if (proposal.deposit_ufern < proposal.min_deposit_ufern) {
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE proposals SET status = 'failed-deposit', status_text = 'Failed — deposit not met' WHERE workspace_id = $1 AND number = $2`,
        [workspaceId, number],
      );
      const deposits = await tx.many<{ person_id: string; amount_ufern: bigint }>(
        `SELECT person_id, amount_ufern::bigint AS amount_ufern FROM deposits WHERE workspace_id = $1 AND number = $2 AND refunded = false`,
        [workspaceId, number],
      );
      const { ledgerPair, personAccount, depositsAccount, postPair } = await import("./ledger.js");
      for (const deposit of deposits) {
        const pair = ledgerPair({
          workspaceId,
          credit: { account: personAccount(deposit.person_id), amount: deposit.amount_ufern },
          debit: { account: depositsAccount(number), amount: deposit.amount_ufern },
          kind: "deposit-refund",
          label: "Deposit refund",
          at: new Date(),
        });
        await postPair(tx, pair);
      }
      await tx.query(`UPDATE deposits SET refunded = true WHERE workspace_id = $1 AND number = $2`, [
        workspaceId,
        number,
      ]);
    });
    hub.publish(workspaceId, { kind: "proposal-status", body: { number, status: "failed-deposit" } });
  }
}

async function endVotingPeriod(
  db: Db,
  hub: LiveHub,
  workspaceId: string,
  number: number,
): Promise<void> {
  const { computeTally } = await import("./tally.js");
  const outcome = await computeTally(db, workspaceId, number);
  if (!outcome) return;
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE proposals SET status = $3, status_text = $4 WHERE workspace_id = $1 AND number = $2`, [
      workspaceId,
      number,
      outcome.status,
      outcome.statusText,
    ]);
    const burned = outcome.status === "rejected-quorum" || outcome.status === "rejected-veto";
    if (burned) {
      const deposits = await tx.many<{ person_id: string; amount_ufern: bigint }>(
        `SELECT person_id, amount_ufern::bigint AS amount_ufern FROM deposits WHERE workspace_id = $1 AND number = $2 AND refunded = false`,
        [workspaceId, number],
      );
      const { ledgerPair, depositsAccount, postPair } = await import("./ledger.js");
      for (const deposit of deposits) {
        const pair = ledgerPair({
          workspaceId,
          credit: { account: "burn", amount: deposit.amount_ufern },
          debit: { account: depositsAccount(number), amount: deposit.amount_ufern },
          kind: "deposit-burned",
          label: "Deposit burned",
          at: new Date(),
        });
        await postPair(tx, pair);
      }
      await tx.query(`UPDATE deposits SET refunded = true WHERE workspace_id = $1 AND number = $2`, [
        workspaceId,
        number,
      ]);
    } else {
      const deposits = await tx.many<{ person_id: string; amount_ufern: bigint }>(
        `SELECT person_id, amount_ufern::bigint AS amount_ufern FROM deposits WHERE workspace_id = $1 AND number = $2 AND refunded = false`,
        [workspaceId, number],
      );
      const { ledgerPair, personAccount, depositsAccount, postPair } = await import("./ledger.js");
      for (const deposit of deposits) {
        const pair = ledgerPair({
          workspaceId,
          credit: { account: personAccount(deposit.person_id), amount: deposit.amount_ufern },
          debit: { account: depositsAccount(number), amount: deposit.amount_ufern },
          kind: "deposit-refund",
          label: "Deposit refund",
          at: new Date(),
        });
        await postPair(tx, pair);
      }
      await tx.query(`UPDATE deposits SET refunded = true WHERE workspace_id = $1 AND number = $2`, [
        workspaceId,
        number,
      ]);
    }
  });
  hub.publish(workspaceId, { kind: "proposal-status", body: { number, status: outcome.status } });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Db(config.databaseUrl);
  await db.query(SCHEMA_SQL);

  const storage = new Storage(config.storage);
  void storage.check();

  const hub = new LiveHub(db);

  const offsetRow = await db.one<{ value: string }>(`SELECT value FROM meta WHERE key = 'clock_offset'`);
  const clock = new Clock(config, db, offsetRow ? BigInt(offsetRow.value) : 0n);

  const ctx = { config, db, hub, storage, clock };

  const app = express();
  app.use(
    express.json({
      limit: "1048576kb",
      verify: (req, _res, buf) => {
        void req;
        void buf;
      },
    }),
  );
  app.use("/api", createApiRouter(ctx));
  app.use("/api", createApiRouterPart2(ctx));
  app.use("/api", createApiRouterPart3(ctx));
  app.use("/api/grading", createGradingRouter(ctx));

  app.get("/api/health", (_req, res) => {
    res.json({ status: storage.isReachable ? "ok" : "unavailable" });
  });

  app.get("/api/bootstrap", (_req, res) => {
    res.json({ squareRowRevealMs: config.squareRowRevealMs, timeZone: config.appTimeZone });
  });

  app.use(express.static(PUBLIC_DIR, { index: "index.html", fallthrough: true }));

  // Workspace and app routes serve the single-page shell.
  const shell = existsSync(join(PUBLIC_DIR, "index.html"))
    ? readFileSync(join(PUBLIC_DIR, "index.html"), "utf8")
    : "<!doctype html><title>Fernsquare</title>";
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) {
      next();
      return;
    }
    res.type("html").send(shell);
  });

  const server = createServer(app);
  attachWebSocket(server, db, hub);

  // Empty database at first boot: seed automatically so the sandbox is usable.
  const peopleRow = await db.one<{ total: number }>(`SELECT COUNT(*) AS total FROM people`);
  if (!peopleRow || Number(peopleRow.total) === 0) {
    await seedWorkspace(config, db, storage, SEED_PASSWORDS);
  }

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`Fernsquare listening on port ${config.port}`);
  });

  // Periodic work: due events, storage recheck, deferred writes and mail delivery.
  let lastStorageCheck = 0;
  const timer = setInterval(() => {
    void (async () => {
      if (config.clockMode === "realtime") {
        await runDueEvents(config, db, clock, hub, storage);
      }
      const now = Date.now();
      if (now - lastStorageCheck >= 5000) {
        lastStorageCheck = now;
        await storage.check();
      }
      await storage.flushPending();
      await deliverOutbox(config, db);
    })();
  }, 1000);
  void timer;
}

main().catch((error) => {
  console.error("server failed to start", error);
  process.exit(1);
});
