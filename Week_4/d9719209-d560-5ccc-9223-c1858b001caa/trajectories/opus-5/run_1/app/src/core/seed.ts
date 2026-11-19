import { db, one, transaction, type Queryable } from './db.js';
import { hashPassword } from './crypto.js';
import { hotRankSql } from './schema.js';
import { renderMarkdown } from '../domain/markdown.js';

const SEED_PASSWORD = 'moothall-seed-2026';
const ADMIN_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

interface SeedAccount {
  username: string;
  role: 'user' | 'admin';
  totp: boolean;
}

const ACCOUNTS: SeedAccount[] = [
  { username: 'wren_hollis', role: 'user', totp: false },
  { username: 'odalys_finch', role: 'user', totp: false },
  { username: 'teodor_vane', role: 'user', totp: false },
  { username: 'larkspur_admin', role: 'admin', totp: true },
];

interface SeedCommunity {
  name: string;
  title: string;
  type: 'public' | 'restricted';
  owner: string;
  moderators: string[];
  members: string[];
  approved: string[];
  memberCount: number;
  rules: string[];
}

const COMMUNITIES: SeedCommunity[] = [
  {
    name: 'fieldnotes',
    title: 'Field Notes',
    type: 'public',
    owner: 'wren_hollis',
    moderators: ['wren_hollis', 'odalys_finch'],
    members: ['wren_hollis', 'odalys_finch', 'teodor_vane'],
    approved: [],
    memberCount: 3,
    rules: ['Say where and when', 'No collecting from protected sites', "Credit other people's photos"],
  },
  {
    name: 'brasswork',
    title: 'Brass Band Players',
    type: 'public',
    owner: 'teodor_vane',
    moderators: ['teodor_vane'],
    members: ['teodor_vane', 'wren_hollis'],
    approved: [],
    memberCount: 2,
    rules: ['Stay on brass'],
  },
  {
    name: 'quietbuilds',
    title: 'Quiet Builds',
    type: 'restricted',
    owner: 'odalys_finch',
    moderators: ['odalys_finch'],
    members: ['odalys_finch', 'wren_hollis'],
    approved: ['wren_hollis'],
    memberCount: 2,
    rules: ['Show your process'],
  },
];

interface SeedPost {
  community: string;
  title: string;
  author: string;
  score: number;
  ageHours: number;
}

const POSTS: SeedPost[] = [
  {
    community: 'fieldnotes',
    title: 'Grey heron at the weir, 6:40 this morning',
    author: 'wren_hollis',
    score: 14,
    ageHours: 3,
  },
  {
    community: 'fieldnotes',
    title: 'Which hand lens do you actually carry?',
    author: 'odalys_finch',
    score: 6,
    ageHours: 9,
  },
  { community: 'fieldnotes', title: 'Lichen survey on the north wall', author: 'teodor_vane', score: 2, ageHours: 26 },
  {
    community: 'brasswork',
    title: 'Mouthpiece rim width for long rehearsals',
    author: 'teodor_vane',
    score: 9,
    ageHours: 5,
  },
  {
    community: 'brasswork',
    title: 'Valve oil that survives a cold bandstand',
    author: 'wren_hollis',
    score: 0,
    ageHours: 40,
  },
  { community: 'quietbuilds', title: 'Dovetail jig from scrap ply', author: 'wren_hollis', score: 4, ageHours: 12 },
];

const BODIES: Record<string, string> = {
  'Grey heron at the weir, 6:40 this morning':
    'Stood on the sill for twenty minutes before it moved. Water was high after Tuesday rain.\n\nNotes: weir pool, east bank, overcast.',
  'Which hand lens do you actually carry?':
    'I keep meaning to buy a 20x but the 10x lives in my coat pocket and that is the one I use.',
  'Lichen survey on the north wall':
    'Twelve squares, two hours. Full tally below.\n\n- *Xanthoria parietina* in every square\n- One patch I cannot place',
  'Mouthpiece rim width for long rehearsals':
    'Three hours on Sunday and my top lip gave up. Thinking about a wider rim.',
  'Valve oil that survives a cold bandstand':
    'Anything that stays thin at four degrees? The synthetic I use goes gummy.',
  'Dovetail jig from scrap ply':
    'Two offcuts and a hinge. Photos of the process to follow once the glue is off.',
};

const REPLY_CHAIN = [
  { author: 'odalys_finch', body: 'Lovely. Did it fish while you watched, or just stand?' },
  { author: 'teodor_vane', body: 'They stand for ages. I have waited out a heron and lost.' },
  { author: 'wren_hollis', body: 'It took one stab at something and missed, then went back to standing.' },
  { author: 'odalys_finch', body: 'That is the whole hobby, really.' },
];

async function seedAccounts(tx: Queryable, passwordHash: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const row = await one<{ id: string }>(
      tx,
      `insert into members (username, username_ci, email, email_ci, password_hash, email_verified, role,
         totp_secret, totp_enabled, created_at)
       values ($1, $2, $3, $4, $5, true, $6, $7, $8, now() - make_interval(days => 400)) returning id`,
      [
        account.username,
        account.username,
        `${account.username}@example.test`,
        `${account.username}@example.test`,
        passwordHash,
        account.role,
        account.totp ? ADMIN_TOTP_SECRET : null,
        account.totp,
      ],
    );
    ids.set(account.username, String(row?.id));
  }
  return ids;
}

/** The seed runs on serve only while the community `fieldnotes` does not exist. */
export async function applySeed(): Promise<void> {
  const existing = await one(db, "select 1 from communities where name_ci = 'fieldnotes'");
  if (existing) return;

  const passwordHash = await hashPassword(SEED_PASSWORD);

  await transaction(async (tx) => {
    const members = await seedAccounts(tx, passwordHash);
    const communities = new Map<string, string>();

    for (const community of COMMUNITIES) {
      const row = await one<{ id: string }>(
        tx,
        `insert into communities (name, name_ci, title, description, type, owner_id, member_count, show_mod_names)
         values ($1, $2, $3, $4, $5, $6, $7, false) returning id`,
        [
          community.name,
          community.name,
          community.title,
          '',
          community.type,
          members.get(community.owner),
          community.memberCount,
        ],
      );
      const communityId = String(row?.id);
      communities.set(community.name, communityId);

      for (const [index, rule] of community.rules.entries()) {
        await tx.query(
          'insert into community_rules (community_id, position, title, description) values ($1, $2, $3, $4)',
          [communityId, index, rule, ''],
        );
      }
      for (const username of community.members) {
        await tx.query('insert into memberships (community_id, member_id) values ($1, $2)', [
          communityId,
          members.get(username),
        ]);
      }
      for (const username of community.moderators) {
        await tx.query('insert into moderators (community_id, member_id, is_owner) values ($1, $2, $3)', [
          communityId,
          members.get(username),
          username === community.owner,
        ]);
      }
      for (const username of community.approved) {
        await tx.query('insert into approved_posters (community_id, member_id) values ($1, $2)', [
          communityId,
          members.get(username),
        ]);
      }
    }

    const postIds = new Map<string, string>();
    for (const post of POSTS) {
      const bodyMd = BODIES[post.title] ?? '';
      const row = await one<{ id: string }>(
        tx,
        `insert into posts (community_id, author_id, title, body_md, body_html, score, created_at, hot_rank)
         values ($1, $2, $3, $4, $5, $6, now() - make_interval(hours => $7::integer), 0) returning id`,
        [
          communities.get(post.community),
          members.get(post.author),
          post.title,
          bodyMd,
          renderMarkdown(bodyMd),
          post.score,
          post.ageHours,
        ],
      );
      postIds.set(post.title, String(row?.id));
      await tx.query(`update posts set hot_rank = ${hotRankSql('score')} where id = $1`, [row?.id]);
    }

    const heronId = postIds.get('Grey heron at the weir, 6:40 this morning') ?? null;
    let parentId: string | null = null;
    let path: string[] = [];
    for (const [index, reply] of REPLY_CHAIN.entries()) {
      const row: { id: string } | null = await one<{ id: string }>(
        tx,
        `insert into comments (post_id, parent_id, author_id, body_md, body_html, depth, path, state, created_at)
         values ($1, $2, $3, $4, $5, $6, $7::bigint[], 'published', now() - make_interval(mins => $8::integer))
         returning id`,
        [
          heronId,
          parentId,
          members.get(reply.author),
          reply.body,
          renderMarkdown(reply.body),
          index + 1,
          path,
          150 - index * 20,
        ],
      );
      const commentId: string = String(row?.id);
      if (path.length > 0) {
        await tx.query('update comments set descendant_count = descendant_count + 1 where id = any($1::bigint[])', [
          path,
        ]);
      }
      path = [...path, commentId];
      parentId = commentId;
    }
    await tx.query('update posts set comment_count = $2 where id = $1', [heronId, REPLY_CHAIN.length]);
  });
}
