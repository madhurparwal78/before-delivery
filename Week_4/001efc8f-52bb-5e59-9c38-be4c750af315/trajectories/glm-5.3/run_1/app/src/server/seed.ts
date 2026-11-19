import type { AppClock } from './app-clock';
import type { Db } from './db';
import { hashPassword, uuid } from './passwords';

interface SeedPerson {
  name: string;
  handle: string;
  email: string;
  role: string;
}

interface SeedChannel {
  name: string;
  kind: 'broadcast' | 'crew';
  private: boolean;
  members: string[];
}

const SEED_PASSWORD = 'frost-line-2026';

const KESTREL: SeedPerson[] = [
  { name: 'Dana Okafor', handle: 'dana', email: 'dana@kestrel.example', role: 'dispatcher' },
  { name: 'Rui Takeda', handle: 'rui', email: 'rui@kestrel.example', role: 'field_technician' },
  { name: 'Sam Lindqvist', handle: 'sam', email: 'sam@kestrel.example', role: 'field_technician' },
  { name: 'Priya Venkat', handle: 'priya', email: 'priya@kestrel.example', role: 'crew_lead' },
  { name: 'Marco Bellini', handle: 'marco', email: 'marco@kestrel.example', role: 'crew_lead' },
  { name: 'Jo Adeyemi', handle: 'jo', email: 'jo@kestrel.example', role: 'ops_manager' },
];

const HALVARD: SeedPerson[] = [
  { name: 'Lee Moreau', handle: 'lee', email: 'lee@halvard.example', role: 'ops_manager' },
  { name: 'Ari Novak', handle: 'ari', email: 'ari@halvard.example', role: 'field_technician' },
];

const CHANNELS: (SeedChannel & { workspace: 'kestrel' | 'halvard' })[] = [
  { workspace: 'kestrel', name: 'shift-bulletins', kind: 'broadcast', private: false, members: ['dana', 'rui', 'sam', 'priya', 'marco', 'jo'] },
  { workspace: 'kestrel', name: 'crew-main', kind: 'crew', private: false, members: ['dana', 'rui', 'sam', 'priya', 'marco', 'jo'] },
  { workspace: 'kestrel', name: 'install-team', kind: 'crew', private: false, members: ['dana', 'rui', 'priya', 'marco', 'jo'] },
  { workspace: 'kestrel', name: 'weekend-emergency', kind: 'crew', private: true, members: ['dana', 'rui', 'sam', 'priya', 'jo'] },
  { workspace: 'kestrel', name: 'site-store-114', kind: 'crew', private: false, members: ['dana', 'rui', 'priya', 'marco', 'jo'] },
  { workspace: 'halvard', name: 'halvard-crew', kind: 'crew', private: false, members: ['lee', 'ari'] },
];

const MESSAGES: { channel: string; author: string; text: string; pinnedBy?: string }[] = [
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
  {
    channel: 'crew-main',
    author: 'marco',
    text: 'Van 6 has the spare TXV kit and the 404A jug.',
  },
  {
    channel: 'halvard-crew',
    author: 'lee',
    text: 'Store 114 walk-in door heater swap booked for Thursday.',
  },
];

/** Creates the schema and seed data where missing, without duplicating anything. */
export async function migrateAndSeed(db: Db, clock: AppClock, schemaSql: string): Promise<void> {
  await db.pool.query(schemaSql);

  const existing = await db.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM workspaces');
  if (Number(existing.rows[0].count) > 0) return;

  const now = clock.now();
  const passwordHash = await hashPassword(SEED_PASSWORD);

  await db.tx(async (client) => {
    const kestrelId = uuid();
    const halvardId = uuid();
    await client.query('INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)', [
      kestrelId,
      'Kestrel Refrigeration Co.',
      'America/Chicago',
    ]);
    await client.query('INSERT INTO workspaces (id, name, time_zone) VALUES ($1, $2, $3)', [
      halvardId,
      'Halvard Mechanical',
      'America/New_York',
    ]);

    const ids = new Map<string, string>();
    for (const person of [...KESTREL, ...HALVARD]) {
      const id = uuid();
      ids.set(person.handle, id);
      await client.query(
        'INSERT INTO users (id, workspace_id, name, handle, email, role, status, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, person.email.endsWith('@halvard.example') ? halvardId : kestrelId, person.name, person.handle, person.email, person.role, 'active', passwordHash, now],
      );
    }

    const channelIds = new Map<string, string>();
    for (const channel of CHANNELS) {
      const id = uuid();
      channelIds.set(channel.name, id);
      const workspaceId = channel.workspace === 'kestrel' ? kestrelId : halvardId;
      await client.query('INSERT INTO channels (id, workspace_id, name, kind, private) VALUES ($1,$2,$3,$4,$5)', [
        id,
        workspaceId,
        channel.name,
        channel.kind,
        channel.private,
      ]);
      for (const handle of channel.members) {
        await client.query('INSERT INTO memberships (channel_id, user_id, joined_at) VALUES ($1,$2,$3)', [
          id,
          ids.get(handle) as string,
          now,
        ]);
      }
    }

    let sentAt = new Date(now.getTime() + 1000);
    for (const message of MESSAGES) {
      const id = uuid();
      const channelId = channelIds.get(message.channel) as string;
      await client.query(
        'INSERT INTO messages (id, channel_id, workspace_id, client_message_id, author_id, text, version, sent_at, deleted) VALUES ($1,$2,$3,$4,$5,$6,1,$7,false)',
        [id, channelId, channelId === channelIds.get('halvard-crew') ? halvardId : kestrelId, uuid(), ids.get(message.author) as string, message.text, sentAt],
      );
      await client.query(
        'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1,1,$2,$3,$4)',
        [id, message.text, ids.get(message.author) as string, sentAt],
      );
      if (message.pinnedBy) {
        await client.query('INSERT INTO pins (channel_id, message_id, pinned_by, pinned_at) VALUES ($1,$2,$3,$4)', [
          channelId,
          id,
          ids.get(message.pinnedBy) as string,
          now,
        ]);
      }
      sentAt = new Date(sentAt.getTime() + 1000);
    }
  });
}
