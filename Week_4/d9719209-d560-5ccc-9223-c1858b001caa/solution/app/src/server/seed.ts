import type pg from 'pg';
import { one } from './db.js';
import { secondsAgo, now } from './clock.js';
import { hashPassword, insertUser } from './accounts.js';
import { insertComment, insertCommunity, insertPost } from './writes.js';

const SEED_PASSWORD = 'moothall-seed-2026';
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const SEED_ACCOUNT_AGE_DAYS = 400;
const HOUR_SECONDS = 3600;

const COMMUNITIES = [
  {
    name: 'fieldnotes', title: 'Field Notes', description: 'Notes from walks, hides and window sills: what you saw, where and when.',
    type: 'public' as const, owner: 'wren_hollis', moderators: ['wren_hollis', 'odalys_finch'], members: ['wren_hollis', 'odalys_finch', 'teodor_vane'],
    rules: ['Say where and when', 'No collecting from protected sites', 'Credit other people\'s photos'],
  },
  {
    name: 'brasswork', title: 'Brass Band Players', description: 'Rehearsal tips, kit and repertoire for brass players of every level.',
    type: 'public' as const, owner: 'teodor_vane', moderators: ['teodor_vane'], members: ['teodor_vane', 'wren_hollis'],
    rules: ['Stay on brass'],
  },
  {
    name: 'quietbuilds', title: 'Quiet Builds', description: 'Slow woodworking and small builds, shown step by step.',
    type: 'restricted' as const, owner: 'odalys_finch', moderators: ['odalys_finch'], members: ['odalys_finch', 'wren_hollis'],
    rules: ['Show your process'],
  },
];

const POSTS = [
  { community: 'fieldnotes', title: 'Grey heron at the weir, 6:40 this morning', author: 'wren_hollis', score: 14, hours: 3,
    body: 'Standing in the shallows below the weir for twenty minutes before it struck. *Light was low*, so the photo is soft, but the **posture** is unmistakable.' },
  { community: 'fieldnotes', title: 'Which hand lens do you actually carry?', author: 'odalys_finch', score: 6, hours: 9,
    body: 'I keep buying 10x lenses and leaving them on the desk. What lives in your pocket on a real walk?' },
  { community: 'fieldnotes', title: 'Lichen survey on the north wall', author: 'teodor_vane', score: 2, hours: 26,
    body: 'Three crusts and one leafy species so far. Counting again after the next dry week.' },
  { community: 'brasswork', title: 'Mouthpiece rim width for long rehearsals', author: 'teodor_vane', score: 9, hours: 5,
    body: 'Wider rims spread the pressure but cost me some flexibility. Curious what other cornet players settled on.' },
  { community: 'brasswork', title: 'Valve oil that survives a cold bandstand', author: 'wren_hollis', score: 0, hours: 40,
    body: 'Outdoor concert in November and the valves were treacle by the second piece.' },
  { community: 'quietbuilds', title: 'Dovetail jig from scrap ply', author: 'wren_hollis', score: 4, hours: 12,
    body: 'Two offcuts, four clamps and an afternoon. The jig cuts clean tails in pine.' },
];

const HERON_THREAD = [
  { author: 'odalys_finch', body: 'Lovely light on the water. Was it the same bird as last week?' },
  { author: 'teodor_vane', body: 'It has a notch in the left wing feathers, so I think so.' },
  { author: 'wren_hollis', body: 'Same notch, same fishing spot. I will note the time next visit.' },
  { author: 'odalys_finch', body: 'Please do. A dawn tally would make a good thread of its own.' },
];

/** Applies the starting data once: it runs only while the community `fieldnotes` does not exist. */
export async function seedIfEmpty(client: pg.PoolClient): Promise<void> {
  if (await one(client, "SELECT 1 FROM communities WHERE name_key = 'fieldnotes'")) return;
  await client.query('BEGIN');
  try {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    const ids = new Map<string, string>();
    const accounts = [
      { username: 'wren_hollis', role: 'user' as const, totpSecret: null },
      { username: 'odalys_finch', role: 'user' as const, totpSecret: null },
      { username: 'teodor_vane', role: 'user' as const, totpSecret: null },
      { username: 'larkspur_admin', role: 'admin' as const, totpSecret: ADMIN_TOTP_SECRET },
    ];
    for (const account of accounts) {
      ids.set(account.username, await insertUser(client, {
        username: account.username, email: `${account.username}@example.test`, passwordHash, emailVerified: true,
        role: account.role, totpSecret: account.totpSecret, createdAt: secondsAgo(SEED_ACCOUNT_AGE_DAYS * 86_400),
      }));
    }
    const id = (username: string): string => ids.get(username) as string;
    const communityIds = new Map<string, string>();
    for (const community of COMMUNITIES) {
      const made = await insertCommunity(client, {
        name: community.name, title: community.title, description: community.description, type: community.type,
        ownerId: id(community.owner), rules: community.rules.map((title) => ({ title, description: '' })),
        moderatorIds: community.moderators.map(id), memberIds: community.members.map(id), memberCount: community.members.length,
      });
      communityIds.set(community.name, made.id);
    }
    await client.query('INSERT INTO approved_posters (community_id, user_id) VALUES ($1, $2)', [communityIds.get('quietbuilds'), id('wren_hollis')]);
    const started = now();
    for (const post of POSTS) {
      const postId = await insertPost(client, {
        communityId: communityIds.get(post.community) as string, authorId: id(post.author), title: post.title, bodyMd: post.body,
        spoiler: false, score: post.score, createdAt: new Date(started.getTime() - post.hours * HOUR_SECONDS * 1000), images: [],
      });
      if (post.title.startsWith('Grey heron')) {
        let parentId: string | null = null;
        for (const reply of HERON_THREAD) {
          parentId = await insertComment(client, { postId, parentId, authorId: id(reply.author), bodyMd: reply.body, createdAt: now() });
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
