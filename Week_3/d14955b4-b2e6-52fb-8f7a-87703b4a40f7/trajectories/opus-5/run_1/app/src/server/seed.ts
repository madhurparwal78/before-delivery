import { limits } from './config';
import { one, query } from './db';
import { SCHEMA_SQL } from './schema';
import { hashPassword } from './auth';
import { sanitise } from '../shared/sanitiser';
import { resolveLinkStage } from './domain/unfurl';
import { bucketLine, eventForensics, linkLine, sanitiserLine, signatureLine } from './domain/verdicts';
import type { ForensicsLine, Topic } from '../shared/types';
import type { StoredEvent } from './data/threads';

interface SeedGame {
  id: string;
  slug: string;
  name: string;
  launcherOrigin: string;
  widgetSecret: string;
  serverSecret: string;
}

const GAMES: SeedGame[] = [
  {
    id: 'game-gloamrunner',
    slug: 'gloamrunner',
    name: 'Gloamrunner',
    launcherOrigin: 'https://launcher.gloamrunner.example',
    widgetSecret: 'gloam-widget-4c1e9a',
    serverSecret: 'gloam-server-8d27b3',
  },
  {
    id: 'game-tiny-ferry',
    slug: 'tiny-ferry',
    name: 'Tiny Ferry Co.',
    launcherOrigin: 'https://play.tinyferry.example',
    widgetSecret: 'ferry-widget-2a6f10',
    serverSecret: 'ferry-server-5e93c4',
  },
];

const STAFF = [
  {
    id: 'staff-wren',
    gameId: 'game-gloamrunner',
    name: 'Wren Ashdown',
    email: 'wren@gloamrunner.example',
    password: 'lantern-keeper-42',
    role: 'developer',
  },
  {
    id: 'staff-pim',
    gameId: 'game-tiny-ferry',
    name: 'Pim Okafor',
    email: 'pim@tinyferry.example',
    password: 'harbour-bell-77',
    role: 'developer',
  },
  {
    id: 'staff-juno',
    gameId: 'game-gloamrunner',
    name: 'Juno Reyes',
    email: 'juno@gloamrunner.example',
    password: 'moth-lamp-31',
    role: 'moderator',
  },
] as const;

const JUNO_RULES: Array<{ effect: 'grant' | 'deny'; action: string; topic: string }> = [
  { effect: 'grant', action: 'read', topic: '*' },
  { effect: 'grant', action: 'reply', topic: '*' },
  { effect: 'grant', action: 'close', topic: '*' },
  { effect: 'grant', action: 'receipts', topic: '*' },
  { effect: 'deny', action: 'receipts', topic: '*' },
  { effect: 'deny', action: 'read', topic: 'purchase' },
];

interface SeedPlayer {
  rowId: string;
  gameId: string;
  playerId: string;
  name: string;
}

const PLAYERS: SeedPlayer[] = [
  { rowId: 'ply-ash', gameId: 'game-gloamrunner', playerId: 'p-ash-17', name: 'Ashveil' },
  { rowId: 'ply-moth', gameId: 'game-gloamrunner', playerId: 'p-moth-02', name: 'Mothwing' },
  { rowId: 'ply-kestrel', gameId: 'game-gloamrunner', playerId: 'p-kestrel-9', name: 'Kestrel' },
  { rowId: 'ply-tallow', gameId: 'game-gloamrunner', playerId: 'p-tallow-4', name: 'Tallow' },
  { rowId: 'ply-otter', gameId: 'game-tiny-ferry', playerId: 'p-otter-5', name: 'Otter' },
];

interface SeedThread {
  id: string;
  gameId: string;
  playerRowId: string;
  topic: Topic;
  status: 'waiting' | 'answered' | 'closed';
  lastPlayerMessageAt: string;
  waitingSince: string | null;
  firstReplyAt: string | null;
  firstClosedAt: string | null;
  lastClosedAt: string | null;
}

const THREADS: SeedThread[] = [
  {
    id: 'thr-ashveil',
    gameId: 'game-gloamrunner',
    playerRowId: 'ply-ash',
    topic: 'purchase',
    status: 'waiting',
    lastPlayerMessageAt: '2026-11-02T19:12:00Z',
    waitingSince: '2026-11-02T19:12:00Z',
    firstReplyAt: null,
    firstClosedAt: null,
    lastClosedAt: null,
  },
  {
    id: 'thr-mothwing',
    gameId: 'game-gloamrunner',
    playerRowId: 'ply-moth',
    topic: 'bug',
    status: 'answered',
    lastPlayerMessageAt: '2026-11-01T09:30:00Z',
    waitingSince: null,
    firstReplyAt: '2026-11-01T11:02:00Z',
    firstClosedAt: null,
    lastClosedAt: null,
  },
  {
    id: 'thr-kestrel',
    gameId: 'game-gloamrunner',
    playerRowId: 'ply-kestrel',
    topic: 'account',
    status: 'closed',
    lastPlayerMessageAt: '2026-10-30T14:00:00Z',
    waitingSince: null,
    firstReplyAt: '2026-10-30T15:10:00Z',
    firstClosedAt: '2026-10-30T15:30:00Z',
    lastClosedAt: '2026-10-30T15:30:00Z',
  },
  {
    id: 'thr-tallow',
    gameId: 'game-gloamrunner',
    playerRowId: 'ply-tallow',
    topic: 'other',
    status: 'waiting',
    lastPlayerMessageAt: '2026-11-02T21:45:00Z',
    waitingSince: '2026-11-02T21:45:00Z',
    firstReplyAt: null,
    firstClosedAt: null,
    lastClosedAt: null,
  },
  {
    id: 'thr-otter',
    gameId: 'game-tiny-ferry',
    playerRowId: 'ply-otter',
    topic: 'purchase',
    status: 'waiting',
    lastPlayerMessageAt: '2026-11-02T08:15:00Z',
    waitingSince: '2026-11-02T08:15:00Z',
    firstReplyAt: null,
    firstClosedAt: null,
    lastClosedAt: null,
  },
];

async function seedPlayerMessage(args: {
  id: string;
  gameId: string;
  threadId: string;
  playerRowId: string;
  playerName: string;
  body: string;
  at: string;
}): Promise<void> {
  const sanitised = sanitise(args.body);
  const stage = await resolveLinkStage(sanitised.after);
  const lines: ForensicsLine[] = [
    signatureLine('signature valid'),
    bucketLine(limits.bucketCapacity, limits.bucketCapacity - 1),
    sanitiserLine(sanitised),
    linkLine(stage),
  ];
  await query(
    `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
        body, created_at, forensics, unfurl)
      VALUES ($1, $2, $3, $4, 'player', 'player', $5, $6, $7, $8::jsonb, $9::jsonb)`,
    [
      args.id,
      args.gameId,
      args.threadId,
      args.playerRowId,
      args.playerName,
      args.body,
      args.at,
      JSON.stringify(lines),
      stage.unfurl === null ? null : JSON.stringify(stage.unfurl),
    ],
  );
}

async function seedReply(args: {
  id: string;
  gameId: string;
  threadId: string;
  playerRowId: string;
  authorRole: 'developer' | 'moderator';
  authorName: string;
  body: string;
  at: string;
}): Promise<void> {
  await query(
    `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
        body, created_at, forensics)
      VALUES ($1, $2, $3, $4, 'reply', $5, $6, $7, $8, '[]'::jsonb)`,
    [args.id, args.gameId, args.threadId, args.playerRowId, args.authorRole, args.authorName, args.body, args.at],
  );
}

async function seedEvent(args: {
  id: string;
  gameId: string;
  threadId: string;
  playerRowId: string;
  event: StoredEvent;
  signatureVerdict: string;
  at: string;
}): Promise<void> {
  await query(
    `INSERT INTO messages (id, game_id, thread_id, player_row_id, kind, author_role, author_name,
        body, created_at, event, forensics)
      VALUES ($1, $2, $3, $4, 'event', 'game_server', 'Game server', NULL, $5, $6::jsonb, $7::jsonb)`,
    [
      args.id,
      args.gameId,
      args.threadId,
      args.playerRowId,
      args.at,
      JSON.stringify(args.event),
      JSON.stringify(eventForensics(args.signatureVerdict)),
    ],
  );
}

async function seedGloamrunner(): Promise<void> {
  await seedEvent({
    id: 'msg-ash-1',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    event: {
      type: 'match.finished',
      verdict: 'accepted',
      match_id: 'm-5521',
      mode: 'Hollow Run',
      result: 'lost',
      duration_seconds: 1_260,
    },
    signatureVerdict: 'signature valid',
    at: '2026-11-02T17:40:00Z',
  });
  await seedEvent({
    id: 'msg-ash-2',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    event: {
      type: 'purchase.receipt',
      verdict: 'accepted',
      receipt_id: 'gr-rcpt-1001',
      item: 'Lantern Pack',
      amount_minor: 499,
      currency: 'USD',
    },
    signatureVerdict: 'signature valid',
    at: '2026-11-02T18:04:00Z',
  });
  await seedEvent({
    id: 'msg-ash-3',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    event: {
      type: 'purchase.receipt',
      verdict: 'accepted',
      receipt_id: 'gr-rcpt-1002',
      item: 'Ember Lantern Bundle',
      amount_minor: 1_200,
      currency: 'JPY',
    },
    signatureVerdict: 'signature valid',
    at: '2026-11-02T18:20:00Z',
  });
  await seedEvent({
    id: 'msg-ash-4',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    event: {
      type: 'purchase.refunded',
      verdict: 'accepted',
      refund_id: 'gr-rfnd-1002a',
      receipt_id: 'gr-rcpt-1002',
      amount_minor: 400,
      currency: 'JPY',
    },
    signatureVerdict: 'signature valid',
    at: '2026-11-02T18:41:00Z',
  });
  await seedPlayerMessage({
    id: 'msg-ash-5',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    playerName: 'Ashveil',
    body: 'i never got the lantern pack',
    at: '2026-11-02T19:12:00Z',
  });
  await seedEvent({
    id: 'msg-ash-6',
    gameId: 'game-gloamrunner',
    threadId: 'thr-ashveil',
    playerRowId: 'ply-ash',
    event: {
      type: 'purchase.receipt',
      verdict: 'refused',
      receipt_id: 'gr-rcpt-1002',
      item: 'Ember Lantern Bundle',
      amount_minor: 1_200,
      currency: 'JPY',
    },
    signatureVerdict: 'signature refused: nonce already seen',
    at: '2026-11-02T19:20:00Z',
  });

  await query(
    `INSERT INTO purchases (game_id, receipt_id, item, amount_minor, currency, player_row_id, message_id, occurred_at)
      VALUES ('game-gloamrunner', 'gr-rcpt-1001', 'Lantern Pack', 499, 'USD', 'ply-ash', 'msg-ash-2', '2026-11-02T18:04:00Z'),
             ('game-gloamrunner', 'gr-rcpt-1002', 'Ember Lantern Bundle', 1200, 'JPY', 'ply-ash', 'msg-ash-3', '2026-11-02T18:20:00Z')`,
  );
  await query(
    `INSERT INTO refunds (game_id, refund_id, receipt_id, amount_minor, currency, player_row_id, message_id, occurred_at)
      VALUES ('game-gloamrunner', 'gr-rfnd-1002a', 'gr-rcpt-1002', 400, 'JPY', 'ply-ash', 'msg-ash-4', '2026-11-02T18:41:00Z')`,
  );

  await seedPlayerMessage({
    id: 'msg-moth-1',
    gameId: 'game-gloamrunner',
    threadId: 'thr-mothwing',
    playerRowId: 'ply-moth',
    playerName: 'Mothwing',
    body: 'The Hollow boss freezes after the *second* lantern.',
    at: '2026-11-01T09:30:00Z',
  });
  await seedReply({
    id: 'msg-moth-2',
    gameId: 'game-gloamrunner',
    threadId: 'thr-mothwing',
    playerRowId: 'ply-moth',
    authorRole: 'developer',
    authorName: 'Wren Ashdown',
    body: 'Thanks, I can reproduce it. A fix ships in the next patch.',
    at: '2026-11-01T11:02:00Z',
  });

  await seedPlayerMessage({
    id: 'msg-kestrel-1',
    gameId: 'game-gloamrunner',
    threadId: 'thr-kestrel',
    playerRowId: 'ply-kestrel',
    playerName: 'Kestrel',
    body: 'How do I change my display name?',
    at: '2026-10-30T14:00:00Z',
  });
  await seedReply({
    id: 'msg-kestrel-2',
    gameId: 'game-gloamrunner',
    threadId: 'thr-kestrel',
    playerRowId: 'ply-kestrel',
    authorRole: 'moderator',
    authorName: 'Juno Reyes',
    body: 'Open Settings, then Profile, and edit the name field.',
    at: '2026-10-30T15:10:00Z',
  });

  await seedPlayerMessage({
    id: 'msg-tallow-1',
    gameId: 'game-gloamrunner',
    threadId: 'thr-tallow',
    playerRowId: 'ply-tallow',
    playerName: 'Tallow',
    body:
      "free skins here <script>alert('gotcha')</script> [claim now](javascript:alert(1)) http://169.254.169.254/latest/meta-data/",
    at: '2026-11-02T21:45:00Z',
  });
}

async function seedTinyFerry(): Promise<void> {
  await seedPlayerMessage({
    id: 'msg-otter-1',
    gameId: 'game-tiny-ferry',
    threadId: 'thr-otter',
    playerRowId: 'ply-otter',
    playerName: 'Otter',
    body: "Harbour Bell skin didn't show up after I paid.",
    at: '2026-11-02T08:15:00Z',
  });
}

async function seed(): Promise<void> {
  for (const game of GAMES) {
    await query(
      `INSERT INTO games (id, slug, name, launcher_origin, widget_secret, server_secret)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [game.id, game.slug, game.name, game.launcherOrigin, game.widgetSecret, game.serverSecret],
    );
  }
  for (const member of STAFF) {
    await query(
      `INSERT INTO staff (id, game_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)`,
      [member.id, member.gameId, member.name, member.email, await hashPassword(member.password), member.role],
    );
  }
  let ruleIndex = 1;
  for (const rule of JUNO_RULES) {
    await query(`INSERT INTO rules (id, moderator_id, effect, action, topic) VALUES ($1, 'staff-juno', $2, $3, $4)`, [
      `rule-juno-${ruleIndex}`,
      rule.effect,
      rule.action,
      rule.topic,
    ]);
    ruleIndex += 1;
  }
  for (const player of PLAYERS) {
    await query(`INSERT INTO players (id, game_id, player_id, name) VALUES ($1, $2, $3, $4)`, [
      player.rowId,
      player.gameId,
      player.playerId,
      player.name,
    ]);
    await query(`INSERT INTO buckets (player_row_id, tokens, updated_at) VALUES ($1, $2, now())`, [
      player.rowId,
      limits.bucketCapacity,
    ]);
  }
  for (const thread of THREADS) {
    await query(
      `INSERT INTO threads (id, game_id, player_row_id, topic, status, created_at, last_player_message_at,
          waiting_since, first_reply_at, first_closed_at, last_closed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10)`,
      [
        thread.id,
        thread.gameId,
        thread.playerRowId,
        thread.topic,
        thread.status,
        thread.lastPlayerMessageAt,
        thread.waitingSince,
        thread.firstReplyAt,
        thread.firstClosedAt,
        thread.lastClosedAt,
      ],
    );
  }
  await seedGloamrunner();
  await seedTinyFerry();
}

/** The schema is applied on every start; the seed only fills an empty database. */
export async function applySchemaAndSeed(): Promise<void> {
  await query(SCHEMA_SQL);
  const existing = await one<{ total: string }>(`SELECT count(*) AS total FROM games`);
  if (Number(existing?.total ?? 0) > 0) return;
  await seed();
}
