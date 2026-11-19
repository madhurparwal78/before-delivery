import type { PoolClient } from 'pg';
import { withTransaction } from './db';
import { nowMs } from './clock';
import { hashPassword } from './passwords';
import type { ChannelKind, Role } from '../shared/api';

const SEED_PASSWORD = 'frost-line-2026';

interface SeedWorkspace {
  key: string;
  name: string;
  timeZone: string;
}

interface SeedUser {
  workspace: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
}

interface SeedChannel {
  workspace: string;
  name: string;
  kind: ChannelKind;
  private: boolean;
  members: string[];
}

interface SeedMessage {
  channel: string;
  author: string;
  text: string;
  pinnedBy?: string;
}

const WORKSPACES: SeedWorkspace[] = [
  { key: 'kestrel', name: 'Kestrel Refrigeration Co.', timeZone: 'America/Chicago' },
  { key: 'halvard', name: 'Halvard Mechanical', timeZone: 'America/New_York' },
];

const USERS: SeedUser[] = [
  { workspace: 'kestrel', name: 'Dana Okafor', handle: 'dana', email: 'dana@kestrel.example', role: 'dispatcher' },
  { workspace: 'kestrel', name: 'Rui Takeda', handle: 'rui', email: 'rui@kestrel.example', role: 'field_technician' },
  { workspace: 'kestrel', name: 'Sam Lindqvist', handle: 'sam', email: 'sam@kestrel.example', role: 'field_technician' },
  { workspace: 'kestrel', name: 'Priya Venkat', handle: 'priya', email: 'priya@kestrel.example', role: 'crew_lead' },
  { workspace: 'kestrel', name: 'Marco Bellini', handle: 'marco', email: 'marco@kestrel.example', role: 'crew_lead' },
  { workspace: 'kestrel', name: 'Jo Adeyemi', handle: 'jo', email: 'jo@kestrel.example', role: 'ops_manager' },
  { workspace: 'halvard', name: 'Lee Moreau', handle: 'lee', email: 'lee@halvard.example', role: 'ops_manager' },
  { workspace: 'halvard', name: 'Ari Novak', handle: 'ari', email: 'ari@halvard.example', role: 'field_technician' },
];

const CHANNELS: SeedChannel[] = [
  {
    workspace: 'kestrel',
    name: 'shift-bulletins',
    kind: 'broadcast',
    private: false,
    members: ['dana', 'rui', 'sam', 'priya', 'marco', 'jo'],
  },
  {
    workspace: 'kestrel',
    name: 'crew-main',
    kind: 'crew',
    private: false,
    members: ['dana', 'rui', 'sam', 'priya', 'marco', 'jo'],
  },
  {
    workspace: 'kestrel',
    name: 'install-team',
    kind: 'crew',
    private: false,
    members: ['dana', 'rui', 'priya', 'marco', 'jo'],
  },
  {
    workspace: 'kestrel',
    name: 'weekend-emergency',
    kind: 'crew',
    private: true,
    members: ['dana', 'rui', 'sam', 'priya', 'jo'],
  },
  {
    workspace: 'kestrel',
    name: 'site-store-114',
    kind: 'crew',
    private: false,
    members: ['dana', 'rui', 'priya', 'marco', 'jo'],
  },
  { workspace: 'halvard', name: 'halvard-crew', kind: 'crew', private: false, members: ['lee', 'ari'] },
];

const MESSAGES: SeedMessage[] = [
  {
    channel: 'shift-bulletins',
    author: 'priya',
    text: 'LOCKOUT — Store 114 rooftop RTU-3 is locked and tagged out pending compressor replacement. Do not reset the disconnect.',
    pinnedBy: 'priya',
  },
  {
    channel: 'site-store-114',
    author: 'dana',
    text: 'Store 114 walk-in WIC-2: target superheat 8°F at the evaporator outlet. Send a gauge photo when you set it.',
  },
  {
    channel: 'weekend-emergency',
    author: 'dana',
    text: 'Store 114 after hours: gate code 4471#, alarm panel is left of the dock door.',
  },
  { channel: 'crew-main', author: 'marco', text: 'Van 6 has the spare TXV kit and the 404A jug.' },
  { channel: 'halvard-crew', author: 'lee', text: 'Store 114 walk-in door heater swap booked for Thursday.' },
];

/**
 * Creates the schema's seed records where they are missing. Later serves find
 * the seed already present and leave its instants unchanged.
 */
export async function applySeed(): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rimewire-seed']);
    const existing = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM workspaces');
    if ((existing.rows[0]?.count ?? 0) > 0) return;
    await insertSeed(client, passwordHash);
  });
}

async function insertSeed(client: PoolClient, passwordHash: string): Promise<void> {
  const createdAt = new Date(nowMs());
  const workspaceIds = new Map<string, string>();
  for (const workspace of WORKSPACES) {
    const row = await client.query<{ id: string }>(
      'INSERT INTO workspaces (name, time_zone) VALUES ($1, $2) RETURNING id',
      [workspace.name, workspace.timeZone],
    );
    workspaceIds.set(workspace.key, row.rows[0]!.id);
  }

  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const row = await client.query<{ id: string }>(
      `INSERT INTO users (workspace_id, name, handle, email, role, status, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING id`,
      [workspaceIds.get(user.workspace), user.name, user.handle, user.email, user.role, passwordHash, createdAt],
    );
    userIds.set(user.handle, row.rows[0]!.id);
  }

  const channelIds = new Map<string, string>();
  for (const channel of CHANNELS) {
    const row = await client.query<{ id: string }>(
      'INSERT INTO channels (workspace_id, name, kind, private, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [workspaceIds.get(channel.workspace), channel.name, channel.kind, channel.private, createdAt],
    );
    const channelId = row.rows[0]!.id;
    channelIds.set(channel.name, channelId);
    for (const handle of channel.members) {
      await client.query('INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES ($1, $2, $3)', [
        channelId,
        userIds.get(handle),
        createdAt,
      ]);
    }
  }

  let offsetSeconds = 1;
  for (const message of MESSAGES) {
    const channel = CHANNELS.find((entry) => entry.name === message.channel)!;
    const sentAt = new Date(createdAt.getTime() + offsetSeconds * 1000);
    offsetSeconds += 1;
    const row = await client.query<{ id: string }>(
      `INSERT INTO messages (workspace_id, channel_id, author_id, client_message_id, text, version, sent_at, counted)
       VALUES ($1, $2, $3, NULL, $4, 1, $5, false) RETURNING id`,
      [
        workspaceIds.get(channel.workspace),
        channelIds.get(message.channel),
        userIds.get(message.author),
        message.text,
        sentAt,
      ],
    );
    const messageId = row.rows[0]!.id;
    await client.query(
      'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1, 1, $2, $3, $4)',
      [messageId, message.text, userIds.get(message.author), sentAt],
    );
    for (const handle of channel.members) {
      if (handle === message.author) continue;
      await client.query('INSERT INTO receipts (message_id, user_id, delivered_at) VALUES ($1, $2, NULL)', [
        messageId,
        userIds.get(handle),
      ]);
    }
    if (message.pinnedBy) {
      await client.query('INSERT INTO pins (channel_id, message_id, pinned_by, pinned_at) VALUES ($1, $2, $3, $4)', [
        channelIds.get(message.channel),
        messageId,
        userIds.get(message.pinnedBy),
        createdAt,
      ]);
    }
  }
}
