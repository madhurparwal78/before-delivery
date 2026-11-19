import type { IncomingMessage } from "node:http";
import { db, write } from "./db.js";
import { now } from "./clock.js";
import { ApiError, fingerprint, invalid, type Reply } from "./http.js";

const KEPT_MS = 24 * 3_600_000;
const POLL_MS = 150;
const PENDING_WAIT_MS = 30_000;

interface Row {
  fingerprint: string;
  status: number;
  body: string;
}

function replay(row: Row): Reply {
  return { status: row.status, body: row.body === "" ? undefined : JSON.parse(row.body) };
}

/**
 * A request carrying `Idempotency-Key` is remembered for 24 hours per person and endpoint:
 * the same key and body replays the stored answer; the same key with another body is a conflict.
 */
export async function withIdempotency(
  req: IncomingMessage,
  personId: string,
  raw: Buffer,
  run: () => Promise<Reply>,
): Promise<Reply> {
  const key = req.headers["idempotency-key"];
  if (key === undefined) return run();
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,100}$/.test(key)) {
    throw invalid({ "Idempotency-Key": "Use 1 to 100 visible characters." });
  }
  const endpoint = `${req.method ?? "POST"} ${(req.url ?? "").split("?")[0]}`;
  const print = fingerprint(req.method ?? "POST", endpoint, raw);
  const deadline = Date.now() + PENDING_WAIT_MS;
  for (;;) {
    const claimed = await write(async (tx) => {
      await tx.query("DELETE FROM idempotency WHERE created_at < $1", [new Date(now().getTime() - KEPT_MS)]);
      const row = await tx.one<Row>("SELECT fingerprint, status, body FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [
        personId,
        endpoint,
        key,
      ]);
      if (!row) {
        await tx.query("INSERT INTO idempotency (person_id, endpoint, key, fingerprint, status, body, created_at) VALUES ($1,$2,$3,$4,0,'',$5)", [
          personId,
          endpoint,
          key,
          print,
          now(),
        ]);
        return "new" as const;
      }
      if (row.fingerprint !== print) throw new ApiError(409, "idempotency_conflict", "That key was already used for a different request.");
      return row.status === 0 ? ("pending" as const) : row;
    });
    if (claimed === "new") break;
    if (claimed !== "pending") return replay(claimed);
    if (Date.now() > deadline) throw new ApiError(409, "idempotency_conflict", "That request is still being processed.");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const forget = (): Promise<unknown> =>
    write((tx) => tx.query("DELETE FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [personId, endpoint, key]));
  let reply: Reply;
  try {
    reply = await run();
  } catch (error) {
    await forget();
    throw error;
  }
  if (reply.status >= 300) {
    await forget();
    return reply;
  }
  await db.query("UPDATE idempotency SET status = $4, body = $5 WHERE person_id = $1 AND endpoint = $2 AND key = $3", [
    personId,
    endpoint,
    key,
    reply.status,
    reply.body === undefined ? "" : JSON.stringify(reply.body),
  ]);
  return reply;
}
