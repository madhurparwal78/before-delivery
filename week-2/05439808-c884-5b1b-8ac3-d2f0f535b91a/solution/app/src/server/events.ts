// The live channel: server-sent events at /api/events. Each open screen gets the reads behind it
// pushed whenever they change (another tab, another islander, or the server's own timers).
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { meView } from './accounts';
import { clanMessages, clanRequests, clanView, invitationsFor } from './clans';
import { now } from './clock';
import { databaseUp, tx } from './db';
import { DatabaseUnavailable, fail } from './errors';
import { cookieValue, loadSession, type Account } from './http';
import { abandonOverdueRaids, raidList } from './raids';
import { readRewards } from './rewards';
import { SECURITY_HEADERS } from './static';
import { villageIdOf, villageView } from './village';
import { lockIsland } from './island';

const PUSH_MS = 500;
const HEARTBEAT_MS = 15000;

type Topics = Record<string, unknown>;

async function topicsFor(account: Account): Promise<Topics> {
  return tx(async (db) => {
    const at = now();
    await abandonOverdueRaids(db, at);
    const fresh = await loadAccount(db, account.id);
    const topics: Topics = { me: await meView(db, fresh) };
    if (fresh.role === 'operator') return topics;
    const villageId = (await villageIdOf(db, fresh.id)) as number;
    const island = await lockIsland(db, villageId, at);
    const { serverTime: _village, ...village } = await villageView(db, island, at);
    const { serverTime: _rewards, ...rewards } = await readRewards(db, fresh);
    topics.village = village;
    topics.rewards = rewards;
    topics.raids = { attack: await raidList(db, villageId, 'attack'), defence: await raidList(db, villageId, 'defence') };
    const clan = await clanView(db, fresh.id);
    topics.clan = clan === null
      ? { clan: null, invitations: await invitationsFor(db, fresh) }
      : {
          clan,
          messages: await clanMessages(db, clan.id as number, null),
          requests: await clanRequests(db, clan.id as number, fresh.id),
          invitations: [],
        };
    return topics;
  });
}

async function loadAccount(db: Parameters<Parameters<typeof tx>[0]>[0], id: number): Promise<Account> {
  const { rows } = await db.query<{ email: string; display_name: string; time_zone: string; verified: boolean; role: Account['role']; trophies: number; created_at: number }>(
    'SELECT email, display_name, time_zone, verified, role, trophies, created_at FROM accounts WHERE id = $1',
    [id],
  );
  const r = rows[0] as { email: string; display_name: string; time_zone: string; verified: boolean; role: Account['role']; trophies: number; created_at: number };
  return { id, email: r.email, displayName: r.display_name, timeZone: r.time_zone, verified: r.verified, role: r.role, trophies: r.trophies, createdAt: r.created_at };
}

export async function streamEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!databaseUp()) throw new DatabaseUnavailable();
  const token = cookieValue(req.headers.cookie);
  const session = await loadSession(token);
  if (!session?.account) return fail('unauthenticated');
  const accountId = session.account.id;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  const digests = new Map<string, string>();
  let busy = false;
  let outage = false;
  let lastWrite = Date.now();
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    lastWrite = Date.now();
  };
  const push = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const current = await loadSession(token);
      if (current?.account?.id !== accountId) {
        send('session', 'ended');
        stop();
        res.end();
        return;
      }
      const topics = await topicsFor(current.account);
      if (outage) send('status', { database: 'up' });
      outage = false;
      for (const [name, value] of Object.entries(topics)) {
        const json = JSON.stringify(value);
        const digest = createHash('sha1').update(json).digest('hex');
        if (digests.get(name) === digest) continue;
        digests.set(name, digest);
        send(name, value);
      }
      if (Date.now() - lastWrite > HEARTBEAT_MS) {
        res.write(': tide\n\n');
        lastWrite = Date.now();
      }
    } catch {
      if (!outage) send('status', { database: 'down' });
      outage = true;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void push(), PUSH_MS);
  const stop = (): void => clearInterval(timer);
  req.on('close', stop);
  await push();
}
