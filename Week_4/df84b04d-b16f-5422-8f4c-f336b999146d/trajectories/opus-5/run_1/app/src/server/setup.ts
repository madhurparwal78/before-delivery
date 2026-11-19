import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hashPassword, userByEmail } from './accounts.js';
import { pool } from './db.js';
import { conflict, invalid } from './errors.js';
import { insertRow, readTextFields, type SavedRow } from './rows.js';

/** One node of a built outline: either text of its own, or a copy of another node. */
export interface OutlineNode {
  ref?: string;
  text?: string;
  mirrorOf?: string;
  completed?: boolean;
  collapsed?: boolean;
  date?: string;
  children?: OutlineNode[];
}

export interface ShareSpec {
  ref?: string;
  bullet: string;
  email: string;
  status: 'sent' | 'accepted';
}

export interface UserSpec {
  ref?: string;
  email: string;
  name: string;
  password: string;
  confirmed?: boolean;
  hideCompleted?: boolean;
  outline?: OutlineNode[];
  shares?: ShareSpec[];
}

export interface SetupResult {
  users: Record<string, { id: string }>;
  bullets: Record<string, string>;
  shares: Record<string, { id: string; token: string }>;
}

interface PendingCopy {
  node: OutlineNode;
  parentId: string | null;
  position: number;
}

/** Builds nested bullets, then the copies that point at them. */
export async function buildOutline(
  client: PoolClient,
  ownerId: string,
  nodes: readonly OutlineNode[],
  refs: Map<string, string>
): Promise<void> {
  const copies: PendingCopy[] = [];

  const place = async (
    list: readonly OutlineNode[],
    parentId: string | null
  ): Promise<void> => {
    for (const [index, node] of list.entries()) {
      if (node.mirrorOf !== undefined) {
        copies.push({ node, parentId, position: index });
        continue;
      }
      const base = node.text ?? '';
      const text = node.date === undefined ? base : `${base} !(${node.date})`;
      const fields = readTextFields(text);
      const row: SavedRow = {
        id: randomUUID(),
        ownerId,
        parentId,
        position: index,
        text: fields.text,
        completed: node.completed === true,
        collapsed: node.collapsed === true,
        date: fields.date,
        tags: fields.tags,
        mentions: fields.mentions,
        mirrorOf: null,
        revision: 1,
        revisionAuthor: ownerId
      };
      await client.query(
        `insert into bullets (id, owner_id, parent_id, position, text, completed, collapsed, date,
                              tags, mentions, mirror_of, revision, revision_author)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          row.id,
          row.ownerId,
          row.parentId,
          row.position,
          row.text,
          row.completed,
          row.collapsed,
          row.date,
          row.tags,
          row.mentions,
          row.mirrorOf,
          row.revision,
          row.revisionAuthor
        ]
      );
      if (node.ref !== undefined) refs.set(node.ref, row.id);
      if (node.children !== undefined) await place(node.children, row.id);
    }
  };

  await place(nodes, null);

  for (const copy of copies) {
    const originalId = refs.get(copy.node.mirrorOf!);
    if (originalId === undefined) {
      throw invalid({ outline: 'A copy names a bullet that is not in this outline.' });
    }
    const row: SavedRow = {
      id: randomUUID(),
      ownerId,
      parentId: copy.parentId,
      position: copy.position,
      text: '',
      completed: false,
      collapsed: copy.node.collapsed === true,
      date: null,
      tags: [],
      mentions: [],
      mirrorOf: originalId,
      revision: 1,
      revisionAuthor: ownerId
    };
    await insertRow(client, row);
    if (copy.node.ref !== undefined) refs.set(copy.node.ref, row.id);
  }
}

function checkUsers(users: unknown): UserSpec[] {
  if (!Array.isArray(users) || users.length === 0) {
    throw invalid({ users: 'Send at least one person.' });
  }
  for (const user of users as UserSpec[]) {
    if (typeof user.email !== 'string' || typeof user.name !== 'string') {
      throw invalid({ users: 'Each person needs an email and a name.' });
    }
    if (typeof user.password !== 'string' || user.password.length < 10) {
      throw invalid({ users: 'Each person needs a password of at least 10 characters.' });
    }
  }
  return users as UserSpec[];
}

/** Creates people, outlines, copies and shares for grading. */
export async function runSetup(body: { users?: unknown }): Promise<SetupResult> {
  const specs = checkUsers(body.users);
  const result: SetupResult = { users: {}, bullets: {}, shares: {} };
  const client = await pool.connect();
  try {
    await client.query('begin');
    const refs = new Map<string, string>();
    const createdEmails = new Map<string, string>();
    for (const spec of specs) {
      const email = spec.email.trim().toLowerCase();
      if ((await userByEmail(email)) !== null) throw conflict('email_taken');
      const id = randomUUID();
      await client.query(
        `insert into users (id, email, name, password_hash, confirmed, hide_completed)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          email,
          spec.name,
          await hashPassword(spec.password),
          spec.confirmed !== false,
          spec.hideCompleted === true
        ]
      );
      createdEmails.set(email, id);
      if (spec.ref !== undefined) result.users[spec.ref] = { id };
      if (spec.outline !== undefined) await buildOutline(client, id, spec.outline, refs);
    }
    for (const spec of specs) {
      const ownerId = createdEmails.get(spec.email.trim().toLowerCase())!;
      for (const share of spec.shares ?? []) {
        const bulletId = refs.get(share.bullet);
        if (bulletId === undefined) throw invalid({ shares: 'A share names an unknown bullet.' });
        const email = share.email.trim().toLowerCase();
        if (share.status === 'accepted' && !createdEmails.has(email)) {
          if ((await userByEmail(email)) === null) {
            throw invalid({ shares: 'An accepted share needs a person with that email.' });
          }
        }
        const id = randomUUID();
        const token = randomBytes(24).toString('hex');
        await client.query(
          `insert into shares (id, bullet_id, owner_id, email, token, status, sent_at)
           values ($1,$2,$3,$4,$5,$6, now())`,
          [id, bulletId, ownerId, email, token, share.status]
        );
        if (share.ref !== undefined) result.shares[share.ref] = { id, token };
      }
    }
    for (const [ref, id] of refs) result.bullets[ref] = id;
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
