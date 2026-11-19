import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { randomToken } from "../auth.ts";
import { clockNow } from "../clock.ts";
import { config } from "../config.ts";
import { bytesForShares } from "../square.ts";
import { maybeOne, pool, run, transaction } from "../db.ts";
import { conflict, invalid, notFound, unavailable } from "../errors.ts";
import { estimateBlob } from "../fee.ts";
import { isUuid } from "../ids.ts";
import { availableOf } from "../ledger.ts";
import { broadcast } from "../live.ts";
import { deliverDueMail, enqueueMail } from "../outbox.ts";
import { putObject } from "../storage.ts";
import { blobsOf, transactionsOf } from "../views.ts";
import { latestHeight, membersOf } from "../workspace.ts";
import { insertBlob } from "../transactions.ts";
import { createTransaction, read, requireOwner, requireWriter, write } from "./context.ts";
import { checkNamespaceHex } from "../../shared/namespace.ts";
import { OWNER_MEMBERS_COPY, OWNER_PRODUCER_COPY, STORAGE_DOWN_SUBMIT } from "../../shared/copy.ts";
import { formatFern, groupThousands, parseFernExact } from "../../shared/units.ts";
import { NEXT_BLOCK_OPTIONS, type NamespaceInfo, type NextBlock } from "../../shared/api.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const workspaceRoutes = new Hono();

workspaceRoutes.get(
  "/w/:id",
  read(async (c, scope) => {
    const next = await maybeOne<{ nextBlock: NextBlock }>(pool, 'SELECT next_block AS "nextBlock" FROM workspaces WHERE id = $1', [scope.workspaceId]);
    return c.json({
      id: scope.workspaceId,
      name: scope.workspaceName,
      role: scope.role,
      height: await latestHeight(pool, scope.workspaceId),
      clock: clockNow().toISOString(),
      nextBlock: next?.nextBlock,
    });
  }),
);

workspaceRoutes.put(
  "/w/:id/producer",
  write(async (c, scope, body) => {
    requireOwner(scope, OWNER_PRODUCER_COPY);
    const choice = NEXT_BLOCK_OPTIONS.find((option) => option.value === body.nextBlock)?.value;
    if (!choice) throw invalid("nextBlock", "Choose Honest, Withhold shares or Bad encoding.");
    await run(pool, "UPDATE workspaces SET next_block = $2 WHERE id = $1", [scope.workspaceId, choice]);
    broadcast(scope.workspaceId, { type: "changed" });
    return c.json({ nextBlock: choice });
  }),
);

workspaceRoutes.get("/w/:id/members", read(async (c, scope) => c.json(await membersOf(pool, scope.workspaceId))));

workspaceRoutes.post(
  "/w/:id/invites",
  write(async (c, scope, body) => {
    requireOwner(scope, OWNER_MEMBERS_COPY);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email)) throw invalid("email", "Enter a valid email address.");
    if (body.role !== "developer" && body.role !== "viewer") throw invalid("role", "Choose Developer or Viewer.");
    const member = await maybeOne(
      pool,
      "SELECT 1 FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND u.email = $2",
      [scope.workspaceId, email],
    );
    if (member) throw conflict(`${email} is already a member of this workspace.`);
    const token = randomToken();
    const expiresAt = new Date(clockNow().getTime() + config.inviteTtlMs);
    const invite = await transaction(async (db, after) => {
      const created = await maybeOne<{ id: string }>(
        db,
        "INSERT INTO invites (token, workspace_id, email, role, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [token, scope.workspaceId, email, body.role, expiresAt],
      );
      await enqueueMail(
        db,
        email,
        `Join ${scope.workspaceName} on Fernsquare`,
        `${scope.user.name} invited you to ${scope.workspaceName} on Fernsquare as ${body.role}.\n\nAccept the invite: ${config.publicUrl}/invites/${token}`,
      );
      after(() => void deliverDueMail());
      return created;
    });
    return c.json({ id: invite?.id, email, role: body.role, expiresAt: expiresAt.toISOString() }, 201);
  }),
);

const NAMESPACE_COUNTS = `SELECT n.id, n.name, n.hex,
  (SELECT count(*) FROM blobs b JOIN transactions t ON t.id = b.tx_id
   WHERE b.workspace_id = n.workspace_id AND b.namespace = n.hex AND t.status = 'included')::int AS "blobCount"
  FROM namespaces n WHERE n.workspace_id = $1 ORDER BY n.seq`;

workspaceRoutes.get(
  "/w/:id/namespaces",
  read(async (c, scope) => c.json((await pool.query<NamespaceInfo>(NAMESPACE_COUNTS, [scope.workspaceId])).rows)),
);

workspaceRoutes.post(
  "/w/:id/namespaces",
  write(async (c, scope, body) => {
    requireWriter(scope);
    const checked = checkNamespaceHex(typeof body.hex === "string" ? body.hex : "");
    if ("error" in checked) throw invalid("hex", checked.error);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") throw invalid("name", "Give the namespace a name.");
    const created = await maybeOne<{ id: string }>(
      pool,
      "INSERT INTO namespaces (workspace_id, name, hex) VALUES ($1, $2, $3) ON CONFLICT (hex) DO NOTHING RETURNING id",
      [scope.workspaceId, name, checked.hex],
    );
    if (!created) throw conflict(`Namespace ${checked.hex} is already registered.`);
    broadcast(scope.workspaceId, { type: "changed" });
    return c.json({ id: created.id, name, hex: checked.hex }, 201);
  }),
);

workspaceRoutes.get(
  "/w/:id/fee-estimate",
  read(async (c) => {
    const bytes = Number(c.req.query("bytes"));
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw invalid("bytes", "Give a whole number of bytes.");
    return c.json(estimateBlob(bytes));
  }),
);

workspaceRoutes.post(
  "/w/:id/blobs",
  write((c, scope, body) =>
    createTransaction(c, scope, body, async (db) => {
      requireWriter(scope);
      const hex = typeof body.namespace === "string" ? body.namespace.toLowerCase() : "";
      const registered = await maybeOne(db, "SELECT 1 FROM namespaces WHERE workspace_id = $1 AND hex = $2", [scope.workspaceId, hex]);
      if (!registered) throw invalid("namespace", "Choose a namespace.");
      const data = typeof body.dataBase64 === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(body.dataBase64) ? Buffer.from(body.dataBase64, "base64") : Buffer.alloc(0);
      if (data.length === 0) throw invalid("data", "A blob must contain at least 1 byte.");
      const maxBlobBytes = bytesForShares(config.maxSquareWidth ** 2);
      if (data.length > maxBlobBytes) {
        throw invalid("data", `This blob is ${groupThousands(data.length)} bytes; a block holds at most ${groupThousands(maxBlobBytes)} bytes of blob data.`);
      }
      const exactFee = parseFernExact(body.fee);
      if (exactFee === null) throw invalid("fee", "Fee must be an amount in FERN with at most 6 decimals.");
      const estimate = estimateBlob(data.length);
      if (exactFee < BigInt(estimate.feeUfern)) throw invalid("fee", `Fee too low: this blob needs at least ${formatFern(estimate.feeUfern)} FERN.`);
      const available = await availableOf(db, scope.workspaceId, scope.user.id);
      if (exactFee > BigInt(available)) {
        throw invalid("fee", `Insufficient balance: available ${formatFern(available)} FERN, this blob needs ${formatFern(exactFee)} FERN.`);
      }
      const fee = Number(exactFee);
      const blobId = randomUUID();
      if (!(await putObject(`blobs/${blobId}`, data))) throw unavailable(STORAGE_DOWN_SUBMIT);
      return insertBlob(db, scope.workspaceId, scope.user.id, { id: blobId, namespace: hex, data, feeUfern: fee, stored: true });
    }),
  ),
);

workspaceRoutes.get(
  "/w/:id/blobs",
  read(async (c, scope) => c.json(await blobsOf(pool, scope.workspaceId, { mineOf: c.req.query("mine") === "true" ? scope.user.id : undefined }))),
);

workspaceRoutes.get(
  "/w/:id/blobs/:blobId",
  read(async (c, scope) => {
    const id = c.req.param("blobId");
    const [blob] = isUuid(id) ? await blobsOf(pool, scope.workspaceId, { id }) : [];
    if (!blob) throw notFound();
    return c.json(blob);
  }),
);

workspaceRoutes.get(
  "/w/:id/transactions",
  read(async (c, scope) => c.json(await transactionsOf(pool, scope.workspaceId, { mineOf: c.req.query("mine") === "true" ? scope.user.id : undefined }))),
);

workspaceRoutes.get(
  "/w/:id/transactions/:txId",
  read(async (c, scope) => {
    const id = c.req.param("txId");
    const [tx] = isUuid(id) ? await transactionsOf(pool, scope.workspaceId, { id }) : [];
    if (!tx) throw notFound();
    return c.json(tx);
  }),
);

workspaceRoutes.get(
  "/w/:id/mempool",
  read(async (c, scope) => {
    const blobs = await blobsOf(pool, scope.workspaceId, { pending: true });
    return c.json({ count: blobs.length, blobs });
  }),
);
