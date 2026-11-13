import { query } from './db.js';
import config from './config.js';
import { hashPassword, verifyPassword } from './auth.js';
import { charactersForAccount } from './characters.js';

/**
 * Seed data (DP-01, DP-35, DP-38): eight verified accounts, all friends, one hero each.
 * Inserted only where missing, on every start.
 */
const seeded = [
  { email: 'aiko@linewright.test', password: 'paper-lantern-01', display: 'Aiko_Sketch', locale: 'ja', hero: 'Aiko' },
  { email: 'mateo@linewright.test', password: 'paper-lantern-02', display: 'MateoTrazo', locale: 'es', hero: 'Mateo' },
  { email: 'robin@linewright.test', password: 'paper-lantern-03', display: 'RobinInk', locale: 'en', hero: 'Robin' },
  { email: 'sol@linewright.test', password: 'paper-lantern-04', display: 'SolDoodle', locale: 'en', hero: 'Sol' },
  { email: 'kenji@linewright.test', password: 'paper-lantern-05', display: 'KenjiLines', locale: 'ja', hero: 'Kenji' },
  { email: 'noa@linewright.test', password: 'paper-lantern-06', display: 'NoaPencil', locale: 'en', hero: 'Noa' },
  { email: 'lucia@linewright.test', password: 'paper-lantern-07', display: 'LuciaGrafito', locale: 'es', hero: 'Lucia' },
  { email: 'haru@linewright.test', password: 'paper-lantern-08', display: 'HaruSumi', locale: 'ja', hero: 'Haru' },
];

const defaultParts = { head: 'round', torso: 'stick', arms: 'thin', legs: 'thin' };
const defaultProportions = {
  head_size: 1, neck_length: 1, spine_length: 1, upper_arm_length: 1,
  forearm_length: 1, thigh_length: 1, shin_length: 1,
};
const defaultAccessories = { head: 'none', back: 'none', left_hand: 'none' };

export async function seed(): Promise<void> {
  const ids: string[] = [];
  for (const person of seeded) {
    const existing = await query<{ id: string; password_hash: string }>(
      'select id, password_hash from accounts where lower(email) = lower($1)',
      [person.email],
    );
    let accountId = existing.rows[0]?.id;
    if (!accountId) {
      accountId = crypto.randomUUID();
      await query(
        `insert into accounts (id, email, password_hash, display_name, locale, email_verified, verification_email)
         values ($1, $2, $3, $4, $5, true, 'sent')`,
        [accountId, person.email, hashPassword(person.password), person.display, person.locale],
      );
    }
    ids.push(accountId);
    const heroExisting = await query('select 1 from characters where account_id = $1', [accountId]);
    if (heroExisting.rows.length === 0) {
      await query(
        `insert into characters (id, account_id, slot, revision, name, parts, proportions, pose, material, accessories, equipped)
         values ($1, $2, 1, 1, $3, $4, $5, $6, 'graphite', $7, true)`,
        [
          crypto.randomUUID(), accountId, person.hero,
          JSON.stringify(defaultParts), JSON.stringify(defaultProportions),
          JSON.stringify({ right_arm_raise: 0 }), JSON.stringify(defaultAccessories),
        ],
      );
    }
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      await query(
        'insert into friendships (account_id, friend_id) values ($1, $2), ($2, $1) on conflict do nothing',
        [a, b],
      );
    }
  }
  const lobbyChannel = await query('select 1 from chat_channels where channel = $1', ['lobby']);
  if (lobbyChannel.rows.length === 0) {
    await query("insert into chat_channels (channel, last_seq) values ('lobby', 0)");
  }
}
