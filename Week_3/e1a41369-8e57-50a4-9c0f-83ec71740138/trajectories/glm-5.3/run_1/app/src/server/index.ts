import { buildApp } from './server.js';
import { config } from './config.js';
import { pool, q } from './db.js';
import { applySchema } from './schema.js';
import { seed } from './seed.js';
import { runDueCloses } from './close.js';
import { live } from './live.js';
import { toPlayer, allTasksBody, toParty, toQuest, partyIdOf } from './serialize.js';
import type { UserRow } from './db.js';

async function main(): Promise<void> {
  const app = buildApp();
  const server = app.listen(config.port, '0.0.0.0');

  // Apply schema and seed, retrying while the database comes up.
  const ready = await waitForDatabase();
  if (ready) {
    const { ObjectStore } = await import('./objectstore.js');
    const store = new ObjectStore(config.s3);
    try {
      await store.ensureBucket();
    } catch {
      // The store being unreachable is fine at boot; health reports it.
    }
  }

  // The close scheduler: runs every 5 seconds, catching every due close.
  setInterval(async () => {
    try {
      const closes = await runDueCloses(new Date());
      for (const c of closes) {
        const u = await q<UserRow>(`SELECT * FROM users WHERE username=$1`, [c.username]);
        if (u.rows[0]) {
          await emitCloseEvents(u.rows[0]);
        }
        void c;
      }
    } catch {
      // database unavailable; the next tick retries
    }
  }, 5000).unref();

  void server;
  console.log(`deedfall listening on ${config.port}`);
}

async function waitForDatabase(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try {
      await q(`SELECT 1`);
      await applySchema(pool);
      await seed();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

async function emitCloseEvents(user: UserRow): Promise<void> {
  live.toUser(user.id, 'player', await toPlayer(user));
  live.toUser(user.id, 'tasks', await allTasksBody(user.id));
  const partyId = await partyIdOf(user.id);
  if (partyId) {
    const party = await toParty(partyId);
    if (party) live.toParty(partyId, 'party', { party });
    if (party?.questId) {
      const quest = await toQuest(party.questId, user.username);
      if (quest) live.toParty(partyId, 'quest', quest);
    }
    const members = await q<{ id: string }>(
      `SELECT user_id AS id FROM party_members WHERE party_id=$1`,
      [partyId]
    );
    for (const m of members.rows) {
      const mu = (await q<UserRow>(`SELECT * FROM users WHERE id=$1`, [m.id])).rows[0];
      if (mu) live.toUser(mu.id, 'player', await toPlayer(mu));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
