import type { Pool } from 'pg';
import type { Config } from './config.js';
import { ApiError, newId, newToken } from './store.js';
import { hashPassword } from './auth.js';
import { extractMentions, extractTags, rewriteDates } from '../domain/text.js';

interface GradingNode {
  ref: string;
  text?: string;
  mirrorOf?: string;
  completed?: boolean;
  collapsed?: boolean;
  date?: string;
  children?: GradingNode[];
}

interface GradingShare {
  ref: string;
  bullet: string;
  email: string;
  status: 'sent' | 'accepted';
}

interface GradingUser {
  ref: string;
  email: string;
  name: string;
  password: string;
  confirmed?: boolean;
  hideCompleted?: boolean;
  outline?: GradingNode[];
  shares?: GradingShare[];
}

interface GradingBody {
  users: GradingUser[];
}

export async function runGradingSetup(
  pool: Pool,
  _config: Config,
  body: GradingBody,
  today: string,
): Promise<Record<string, unknown>> {
  const userMap = new Map<string, { id: string }>();
  const bulletMap = new Map<string, string>();
  const shareMap = new Map<string, { id: string; token: string }>();
  const usersOut: Record<string, { id: string }> = {};
  const bulletsOut: Record<string, string> = {};
  const sharesOut: Record<string, { id: string; token: string }> = {};
  const emailsCreated = new Set<string>();

  for (const user of body.users) {
    if (!user || typeof user !== 'object' || typeof user.email !== 'string' || typeof user.name !== 'string' || typeof user.password !== 'string') {
      throw new ApiError(422, { errors: { users: 'Send name, email and password for every person.' } });
    }
    const email = user.email.trim().toLowerCase();
    const existing = await pool.query('select id from accounts where email = $1', [email]);
    if (existing.rows.length > 0) {
      const used = emailsCreated.has(email);
      if (!used) {
        throw new ApiError(409, { error: 'email_taken', message: 'That email is already registered.' });
      }
      const id = String(existing.rows[0]?.id);
      userMap.set(user.ref, { id });
      usersOut[user.ref] = { id };
      continue;
    }
    const id = newId();
    await pool.query(
      `insert into accounts (id, email, name, password_hash, confirmed, hide_completed, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, email, user.name, hashPassword(user.password), user.confirmed ?? true, user.hideCompleted ?? false, Date.now()],
    );
    await pool.query(`insert into outline_seq (owner_id, seq) values ($1, 0) on conflict do nothing`, [id]);
    emailsCreated.add(email);
    userMap.set(user.ref, { id });
    usersOut[user.ref] = { id };
  }

  for (const user of body.users) {
    const account = userMap.get(user.ref);
    if (!account) continue;
    const refToId = new Map<string, string>();
    for (const node of user.outline ?? []) {
      const id = await insertGradingNode(pool, account.id, null, 0, node, refToId, today);
      if (node.ref) {
        refToId.set(node.ref, id);
        bulletMap.set(node.ref, id);
        bulletsOut[node.ref] = id;
      }
    }
    for (const node of user.outline ?? []) {
      const placed = await placeGradingMirror(pool, account.id, node, refToId, today, bulletsOut);
      if (placed) {
        refToId.set(node.ref, placed);
        bulletMap.set(node.ref, placed);
        bulletsOut[node.ref] = placed;
      }
    }
  }

  for (const user of body.users) {
    const owner = userMap.get(user.ref);
    if (!owner) continue;
    for (const share of user.shares ?? []) {
      const bulletId = bulletMap.get(share.bullet);
      if (!bulletId) {
        throw new ApiError(422, { errors: { shares: 'The share names a bullet that does not exist.' } });
      }
      const id = newId();
      const token = newToken();
      await pool.query(
        `insert into shares (id, bullet_id, owner_id, email, token, status, created_at)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, bulletId, owner.id, share.email.trim().toLowerCase(), token, share.status, Date.now()],
      );
      if (share.status === 'accepted') {
        await pool.query(`update shares set accepted_at = $2 where id = $1`, [id, Date.now()]);
      }
      shareMap.set(share.ref, { id, token });
      sharesOut[share.ref] = { id, token };
    }
  }

  return { users: usersOut, bullets: bulletsOut, shares: sharesOut };
}

async function insertGradingNode(
  pool: Pool,
  ownerId: string,
  parentId: string | null,
  position: number,
  node: GradingNode,
  refToId: Map<string, string>,
  today: string,
): Promise<string> {
  const rawText = node.text ?? '';
  const fullText = node.date ? `${rawText} !(${node.date})` : rawText;
  const { canonicalText, date } = rewriteDates(fullText, today);
  const id = newId();
  await pool.query(
    `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
     values ($1,$2,null,$3,$4,$5,$6,$7,$8,$9,$10,1,null,false,$11)`,
    [
      id, ownerId, parentId, position, canonicalText,
      node.completed ?? false, node.collapsed ?? false, date,
      extractTags(canonicalText), extractMentions(canonicalText), Date.now(),
    ],
  );
  let childPosition = 0;
  for (const child of node.children ?? []) {
    await insertGradingNode(pool, ownerId, id, childPosition, child, refToId, today);
    childPosition += 1;
  }
  return id;
}

async function placeGradingMirror(
  pool: Pool,
  ownerId: string,
  node: GradingNode,
  refToId: Map<string, string>,
  today: string,
  bulletsOut: Record<string, string>,
): Promise<string | null> {
  if (node.mirrorOf) {
    const originalId = refToId.get(node.mirrorOf);
    if (!originalId) {
      throw new ApiError(422, { errors: { outline: 'mirrorOf names a bullet that does not exist.' } });
    }
    const id = newId();
    await pool.query(
      `insert into bullets (id, owner_id, original_id, parent_id, position, text, completed, collapsed, date, tags, mentions, revision, trashed_at, purged, created_at)
       values ($1,$2,$3,null,0,'',false,false,null,'{}','{}',1,null,false,$4)`,
      [id, ownerId, originalId, Date.now()],
    );
    return id;
  }
  for (const child of node.children ?? []) {
    const placed = await placeGradingMirror(pool, ownerId, child, refToId, today, bulletsOut);
    if (placed && child.ref) {
      refToId.set(child.ref, placed);
      bulletsOut[child.ref] = placed;
    }
  }
  return null;
}

export interface GradingBodyOut {
  users: Record<string, { id: string }>;
  bullets: Record<string, string>;
  shares: Record<string, { id: string; token: string }>;
}
