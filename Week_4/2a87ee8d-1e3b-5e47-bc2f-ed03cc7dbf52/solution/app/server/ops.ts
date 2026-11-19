// Operation replay (step 6 of the error order): one stored response per actor and clientOpId.
import crypto from "node:crypto";
import { savepoint, tx, type Db } from "./db.js";
import { ApiError, FIELD, invalid } from "./errors.js";
import { errorReply, type Reply, type Req } from "./http.js";

const OP_ID = /^[A-Za-z0-9_-]{8,64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function clientOpId(req: Req): string {
  const body = req.json;
  const id = body && typeof body === "object" ? (body as Record<string, unknown>).clientOpId : undefined;
  if (typeof id !== "string" || !OP_ID.test(id)) invalid({ clientOpId: FIELD.clientOpId });
  return id;
}

/**
 * Runs a ✱ request once. Copies that arrive while the first is in flight wait on the unique key and then
 * receive its stored response; a different body under the same id answers op_conflict. 2xx and 4xx are
 * stored; a 5xx rolls everything back so a retry runs again.
 */
export async function once(req: Req, actor: string, work: (t: Db) => Promise<Reply>): Promise<Reply> {
  const id = clientOpId(req);
  const fingerprint = crypto.createHash("sha256").update(`${req.method} ${req.path} ${canonical(req.json)}`).digest("hex");
  return tx(async (t) => {
    const claimed = await t.one("INSERT INTO ops (actor, client_op_id, fingerprint) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1 AS ok", [
      actor,
      id,
      fingerprint,
    ]);
    if (!claimed) {
      const stored = await t.one<{ fingerprint: string; status: number; body: string | null }>(
        "SELECT fingerprint, status, body FROM ops WHERE actor = $1 AND client_op_id = $2",
        [actor, id],
      );
      if (!stored || stored.fingerprint !== fingerprint) throw new ApiError("op_conflict");
      return { status: stored.status, ...(stored.body === null ? {} : { json: stored.body }) };
    }
    let out: Reply;
    try {
      out = await savepoint(t, () => work(t));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      out = errorReply(error);
    }
    await t.run("UPDATE ops SET status = $3, body = $4 WHERE actor = $1 AND client_op_id = $2", [actor, id, out.status, out.json ?? null]);
    return out;
  });
}
