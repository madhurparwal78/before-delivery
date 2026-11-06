import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import { Errors } from "../errors.js";
import { runSync, type SyncOp } from "../sync.js";
import { withJob } from "./shared.js";

const OP_TYPES = ["create_item", "update_item", "item_action", "add_note", "edit_note"] as const;

export function createSyncRouter(db: Db): express.Router {
  const router = express.Router();

  router.post("/jobs/:jobId/sync", async (req: Request, res: Response) => {
    const body = req.body as { ops?: unknown };
    if (!Array.isArray(body.ops) || body.ops.length === 0 || body.ops.length > 200) {
      throw Errors.validation({ ops: "Send 1 to 200 operations." });
    }
    const seqs = new Set<number>();
    for (const raw of body.ops as Record<string, unknown>[]) {
      if (typeof raw.seq !== "number" || !Number.isInteger(raw.seq) || raw.seq < 1 || raw.seq > 2147483647) {
        throw Errors.validation({ ops: "Give every operation a client sequence number." });
      }
      if (seqs.has(raw.seq)) throw Errors.validation({ ops: "Every operation needs its own sequence number." });
      seqs.add(raw.seq);
      if (typeof raw.type !== "string" || !OP_TYPES.includes(raw.type as (typeof OP_TYPES)[number])) {
        throw Errors.validation({ type: "That operation type does not exist." });
      }
    }
    for (const raw of body.ops as Record<string, unknown>[]) {
      if (typeof raw.op_id !== "string" || raw.op_id === "") {
        throw Errors.validation({ op_id: "Give every operation an id." });
      }
    }

    const outcome = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      return runSync(ctx, body.ops as unknown as SyncOp[]);
    });
    res.json({ results: outcome.results, synced: outcome.synced, conflicts: outcome.conflicts });
  });

  return router;
}
