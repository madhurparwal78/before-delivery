/* Seed data, applied on serve only when `fieldnotes` doesn't exist. Every
   seeded person, community and post is invented. */
import argon2 from 'argon2';
import type { Db } from './db.js';
import type { AppConfig } from '../config.js';
import { hotRank } from './domain.js';
import { renderMarkdown } from './markdown.js';

const SEED_PASSWORD = 'moothall-seed-2026';

export async function seed(db: Db, cfg: AppConfig): Promise<void> {
  const hash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });
  const accountIds: Record<string, number> = {};

  const accounts: { username: string; role: 'user' | 'admin'; totp: boolean }[] = [
    { username: 'wren_hollis', role: 'user', totp: false },
    { username: 'odalys_finch', role: 'user', totp: false },
    { username: 'teodor_vane', role: 'user', totp: false },
    { username: 'larkspur_admin', role: 'admin', totp: true },
  ];
  for (const a of accounts) {
    const inserted = await db.query(
      `INSERT INTO accounts (username, username_lc, email, email_lc, password_hash, email_verified, totp_secret, totp_enabled, role, created_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8, now() - make_interval(days => 400))
       ON CONFLICT (username_lc) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [a.username, a.username.toLowerCase(), `${a.username}@example.test`, `${a.username}@example.test`, hash, a.totp ? 'JBSWY3DPEHPK3PXP' : null, a.totp, a.role]
    );
    accountIds[a.username] = Number((inserted.rows[0] as { id: string }).id);
  }

  const communities: { name: string; title: string; type: 'public' | 'restricted'; owner: string; mods: string[]; members: string[]; memberCount: number; rules: { title: string; description: string }[]; approved?: string[] }[] = [
    {
      name: 'fieldnotes', title: 'Field Notes', type: 'public', owner: 'wren_hollis',
      mods: ['wren_hollis', 'odalys_finch'], members: ['wren_hollis', 'odalys_finch', 'teodor_vane'], memberCount: 3,
      rules: [
        { title: 'Say where and when', description: 'Include the place and date of your observation.' },
        { title: 'No collecting from protected sites', description: 'Never take samples from protected land or water.' },
        { title: "Credit other people's photos", description: 'Name the photographer when a picture is not yours.' },
      ],
    },
    {
      name: 'brasswork', title: 'Brass Band Players', type: 'public', owner: 'teodor_vane',
      mods: ['teodor_vane'], members: ['teodor_vane', 'wren_hollis'], memberCount: 2,
      rules: [{ title: 'Stay on brass', description: 'Posts must be about brass instruments and playing.' }],
    },
    {
      name: 'quietbuilds', title: 'Quiet Builds', type: 'restricted', owner: 'odalys_finch',
      mods: ['odalys_finch'], members: ['odalys_finch', 'wren_hollis'], memberCount: 2,
      rules: [{ title: 'Show your process', description: 'Share how you made it, not only the result.' }],
      approved: ['wren_hollis'],
    },
  ];

  for (const c of communities) {
    const inserted = await db.query(
      `INSERT INTO communities (name, name_lc, title, description, type, member_count, show_mod_names)
       VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id`,
      [c.name, c.name.toLowerCase(), c.title, `A place for ${c.title.toLowerCase()}.`, c.type, c.memberCount]
    );
    const communityId = Number((inserted.rows[0] as { id: string }).id);
    for (let i = 0; i < c.rules.length; i++) {
      const r = c.rules[i] as { title: string; description: string };
      await db.query(`INSERT INTO rules (community_id, position, title, description) VALUES ($1,$2,$3,$4)`, [communityId, i, r.title, r.description]);
    }
    for (const username of c.mods) {
      await db.query(`INSERT INTO moderators (community_id, account_id, is_owner) VALUES ($1,$2,$3)`, [communityId, accountIds[username], username === c.owner]);
    }
    for (const username of c.members) {
      await db.query(`INSERT INTO memberships (community_id, account_id) VALUES ($1,$2)`, [communityId, accountIds[username] as number]);
    }
    for (const username of c.approved ?? []) {
      await db.query(`INSERT INTO approved_posters (community_id, account_id) VALUES ($1,$2)`, [communityId, accountIds[username] as number]);
    }
  }

  const posts: { community: string; author: string; title: string; body: string; score: number; ageHours: number }[] = [
    { community: 'fieldnotes', author: 'wren_hollis', title: 'Grey heron at the weir, 6:40 this morning', body: 'Standing on the concrete lip below the sluice, absolutely unbothered by the flow. Long stalk, slow neck. Worth the early start.', score: 14, ageHours: 3 },
    { community: 'fieldnotes', author: 'odalys_finch', title: 'Which hand lens do you actually carry?', body: 'Mine is a 10x triplet that lives on a bootlace. What do you carry daily, and does the extra magnification ever get used in the field?', score: 6, ageHours: 9 },
    { community: 'fieldnotes', author: 'teodor_vane', title: 'Lichen survey on the north wall', body: 'Counted eleven species on the churchyard wall facing the mill. The wall is old mortar and sooty brick — a proper archive of the air here.', score: 2, ageHours: 26 },
    { community: 'brasswork', author: 'teodor_vane', title: 'Mouthpiece rim width for long rehearsals', body: 'Switched to a wider rim for a parade-heavy month and my lip stopped giving out by the second hour. What rim widths do others use for long days?', score: 9, ageHours: 5 },
    { community: 'brasswork', author: 'wren_hollis', title: 'Valve oil that survives a cold bandstand', body: 'Three hours on an open bandstand and the rotors still moved. This oil is thin enough to spread and thick enough to stay.', score: 0, ageHours: 40 },
    { community: 'quietbuilds', author: 'wren_hollis', title: 'Dovetail jig from scrap ply', body: 'Cut a simple dovetail jig from offcuts, four careful passes per pin. Slow work, quiet, and it takes a lovely joint.', score: 4, ageHours: 12 },
  ];
  const postIds: Record<string, number> = {};
  for (const p of posts) {
    const created = new Date(Date.now() - p.ageHours * 3_600_000);
    const inserted = await db.query(
      `INSERT INTO posts (community_id, author_id, title, body_md, body_html, score, hot_rank, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        (await communityIdOf(db, p.community)) as number,
        accountIds[p.author] as number,
        p.title,
        p.body,
        renderMarkdown(p.body),
        p.score,
        hotRank(p.score, created),
        created,
      ]
    );
    const id = Number((inserted.rows[0] as { id: string }).id);
    postIds[p.title] = id;
  }
  void cfg;

  // The heron post has a four-level reply chain.
  const heronId = postIds['Grey heron at the weir, 6:40 this morning'] as number;
  const chain: { author: string; body: string }[] = [
    { author: 'odalys_finch', body: 'Six-forty is the hour. The light comes low over the water and everything comes to the weir to feed.' },
    { author: 'teodor_vane', body: 'There is a heron on the mill sluice most mornings. It has a scarred left wing and owns that stretch of water.' },
    { author: 'wren_hollis', body: 'That is the one. It barely moved while the sluice ran — completely at home in the rush.' },
    { author: 'odalys_finch', body: 'Thanks for the notes, I will come down tomorrow and see for myself before work.' },
  ];
  let parentId: number | null = null;
  let path = '';
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i] as { author: string; body: string };
    const inserted = await db.query(
      `INSERT INTO comments (post_id, parent_id, author_id, path, depth, body_md, body_html) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [heronId, parentId, accountIds[c.author] as number, path, i + 1, c.body, renderMarkdown(c.body)]
    );
    const id = Number((inserted.rows[0] as { id: string }).id);
    // The path includes the comment itself; every ancestor's descendant count
    // moves in the same step.
    path = path === '' ? String(id) : `${path}.${id}`;
    const ancestorIds = path.split('.').map(Number).slice(0, -1);
    for (const anc of ancestorIds) {
      await db.query(`UPDATE comments SET descendant_count = descendant_count + 1 WHERE id = $1`, [anc]);
    }
    parentId = id;
  }
  await db.query(`UPDATE posts SET comment_count = 4 WHERE id = $1`, [heronId]);
}

async function communityIdOf(db: Db, name: string): Promise<number> {
  const rows = await db.query(`SELECT id FROM communities WHERE name_lc = $1`, [name.toLowerCase()]);
  return Number((rows.rows[0] as { id: string }).id);
}
