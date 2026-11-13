import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { hashPassword } from '../domain/passwords.js';
import { clocktowerDraft, starterRooms } from '../../shared/starter.js';
import { insertStarterRoom } from '../repo/rooms.js';
import { one, query, rowOne, tx } from './db.js';

interface SeedMember {
  email: string;
  password: string;
  displayName: string;
  role: 'owner' | 'co_designer';
}

const lanternLane: { workspace: string; members: SeedMember[] } = {
  workspace: 'Lantern Lane Escapes',
  members: [
    {
      email: 'mara@lanternlane.test',
      password: 'keyway-owner-1',
      displayName: 'Mara Quint',
      role: 'owner',
    },
    {
      email: 'tobi@lanternlane.test',
      password: 'keyway-codesign-1',
      displayName: 'Tobi Ferreira',
      role: 'co_designer',
    },
  ],
};

const brassKey: { workspace: string; members: SeedMember[] } = {
  workspace: 'Brass Key Rooms',
  members: [
    {
      email: 'ines@brasskey.test',
      password: 'keyway-other-1',
      displayName: 'Ines Albright',
      role: 'owner',
    },
  ],
};

async function seedWorkspace(
  client: PoolClient,
  name: string,
  members: SeedMember[],
  rooms: typeof starterRooms,
): Promise<void> {
  const existing = await rowOne<{ id: string }>(
    client,
    `select id from users where email_lower = $1`,
    [members[0].email.toLowerCase()],
  );
  if (existing) return;
  const workspaceId = randomUUID();
  await client.query(`insert into workspaces (id, name) values ($1, $2)`, [workspaceId, name]);
  for (const member of members) {
    await client.query(
      `insert into users (id, workspace_id, email, email_lower, password_hash, display_name, role)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        workspaceId,
        member.email,
        member.email.toLowerCase(),
        await hashPassword(member.password),
        member.displayName,
        member.role,
      ],
    );
  }
  for (const room of rooms) {
    await insertStarterRoom(client, workspaceId, room);
  }
}

export async function applySeed(): Promise<void> {
  await query('select pg_advisory_lock(728342)');
  try {
    await tx(async (client) => {
      await seedWorkspace(client, lanternLane.workspace, lanternLane.members, starterRooms);
      await seedWorkspace(client, brassKey.workspace, brassKey.members, [clocktowerDraft]);
    });
  } finally {
    await query('select pg_advisory_unlock(728342)');
  }
}

/** The cookie-signing secret is generated on first start and kept in Postgres. */
export async function sessionSecret(): Promise<string> {
  const made = randomUUID() + randomUUID();
  await query(
    `insert into app_secrets (name, value) values ('cookie_secret', $1)
       on conflict (name) do nothing`,
    [made],
  );
  const stored = await one<{ value: string }>(
    `select value from app_secrets where name = 'cookie_secret'`,
  );
  return stored ? stored.value : made;
}
