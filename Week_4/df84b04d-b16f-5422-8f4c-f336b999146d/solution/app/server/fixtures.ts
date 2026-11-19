import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { createAccount, normalizeEmail } from "./accounts.js";

export interface OutlineNode {
  ref?: string;
  text?: string;
  mirrorOf?: string;
  completed?: boolean;
  collapsed?: boolean;
  date?: string;
  children?: OutlineNode[];
}

interface FixtureShare {
  ref?: string;
  bullet: string;
  email: string;
  status: "sent" | "accepted";
}

export interface FixtureUser {
  ref: string;
  email: string;
  name: string;
  password: string;
  confirmed?: boolean;
  hideCompleted?: boolean;
  outline?: OutlineNode[];
  shares?: FixtureShare[];
}

export interface FixtureResult {
  users: Record<string, { id: string }>;
  bullets: Record<string, string>;
  shares: Record<string, { id: string; token: string }>;
}

interface Planned {
  id: string;
  parentId: string | null;
  position: number;
  node: OutlineNode;
}

function plan(nodes: readonly OutlineNode[], parentId: string | null, out: Planned[]): void {
  nodes.forEach((node, position) => {
    const planned = { id: randomUUID(), parentId, position, node };
    out.push(planned);
    plan(node.children ?? [], planned.id, out);
  });
}

async function insertOutline(client: Db, ownerId: string, nodes: readonly OutlineNode[], result: FixtureResult): Promise<Map<string, string>> {
  const planned: Planned[] = [];
  plan(nodes, null, planned);
  const refs = new Map<string, string>();
  for (const entry of planned) if (entry.node.ref !== undefined) refs.set(entry.node.ref, entry.id);
  for (const entry of planned) {
    const { node } = entry;
    const text = node.text === undefined ? "" : node.date === undefined ? node.text : `${node.text} !(${node.date})`;
    await client.query(
      `INSERT INTO bullets (id, owner_id, parent_id, position, text, completed, collapsed, mirror_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.id, ownerId, entry.parentId, entry.position, text, node.completed ?? false, node.collapsed ?? false,
        node.mirrorOf === undefined ? null : refs.get(node.mirrorOf) ?? null],
    );
  }
  for (const [ref, id] of refs) result.bullets[ref] = id;
  return refs;
}

/** Creates accounts, outlines, copies and shares. Throws `email_taken` before writing anything for a known address. */
export async function insertFixtures(client: Db, users: readonly FixtureUser[]): Promise<FixtureResult> {
  const result: FixtureResult = { users: {}, bullets: {}, shares: {} };
  const emails = users.map((user) => normalizeEmail(user.email));
  const taken = await client.query("SELECT 1 FROM accounts WHERE email = ANY($1::text[])", [emails]);
  if ((taken.rowCount ?? 0) > 0 || new Set(emails).size !== emails.length) throw new Error("email_taken");
  const ids = new Map<string, string>();
  for (const user of users) {
    const id = await createAccount(client, {
      email: normalizeEmail(user.email), name: user.name, password: user.password,
      confirmed: user.confirmed ?? true, hideCompleted: user.hideCompleted ?? false,
    });
    ids.set(normalizeEmail(user.email), id);
    result.users[user.ref] = { id };
  }
  for (const user of users) {
    const ownerId = ids.get(normalizeEmail(user.email)) ?? "";
    const refs = await insertOutline(client, ownerId, user.outline ?? [], result);
    for (const share of user.shares ?? []) {
      const bulletId = refs.get(share.bullet);
      const email = normalizeEmail(share.email);
      const accountId = ids.get(email) ?? (await client.query<{ id: string }>("SELECT id FROM accounts WHERE email = $1", [email])).rows[0]?.id;
      if (bulletId === undefined || (share.status === "accepted" && accountId === undefined)) throw new Error("bad_share");
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      await client.query(
        "INSERT INTO shares (id, owner_id, bullet_id, email, token, status, account_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, ownerId, bulletId, email, token, share.status, share.status === "accepted" ? accountId : null],
      );
      if (share.ref !== undefined) result.shares[share.ref] = { id, token };
    }
  }
  return result;
}
