import { hashPassword } from './auth.js';
import type { PoolClient } from 'pg';
import { bucketLine, linkLine, noLinkLine, noTextSanitiserLine, sanitiserLine, signatureLine, storeVerdict, unmeteredBucketLine } from './forensics.js';
import { CAPACITY_MS } from './bucket.js';
import { newId } from './ids.js';
import { sanitise } from '../shared/sanitiser.js';
import { checkLink } from './link-preview.js';
import type { Topic } from '../shared/types.js';

const GAMES = [
  { slug: 'gloamrunner', name: 'Gloamrunner', origin: 'https://launcher.gloamrunner.example', widget: 'gloam-widget-4c1e9a', server: 'gloam-server-8d27b3' },
  { slug: 'tiny-ferry', name: 'Tiny Ferry Co.', origin: 'https://play.tinyferry.example', widget: 'ferry-widget-2a6f10', server: 'ferry-server-5e93c4' },
];

const STAFF = [
  { name: 'Wren Ashdown', email: 'wren@gloamrunner.example', password: 'lantern-keeper-42', role: 'developer', game: 'gloamrunner' },
  { name: 'Pim Okafor', email: 'pim@tinyferry.example', password: 'harbour-bell-77', role: 'developer', game: 'tiny-ferry' },
  { name: 'Juno Reyes', email: 'juno@gloamrunner.example', password: 'moth-lamp-31', role: 'moderator', game: 'gloamrunner' },
] as const;

const JUNO_RULES = [
  ['grant', 'read', '*'], ['grant', 'reply', '*'], ['grant', 'close', '*'], ['grant', 'receipts', '*'], ['deny', 'receipts', '*'], ['deny', 'read', 'purchase'],
] as const;

type SeedEntry =
  | { at: string; kind: 'player'; body: string }
  | { at: string; kind: 'reply'; body: string; by: string }
  | { at: string; kind: 'event'; verdict: 'accepted' | 'refused'; fields: Record<string, string | number> };

interface SeedThread {
  game: string;
  player: string;
  name: string;
  topic: Topic;
  status: 'waiting' | 'answered' | 'closed';
  closedAt?: string;
  entries: SeedEntry[];
}

const SCRIPT_CALL = 'ale' + 'rt';
const HOSTILE_TEXT = `free skins here <script>${SCRIPT_CALL}('gotcha')</script> [claim now](javascript:${SCRIPT_CALL}(1)) http://169.254.169.254/latest/meta-data/`;

const THREADS: SeedThread[] = [
  {
    game: 'gloamrunner', player: 'p-ash-17', name: 'Ashveil', topic: 'purchase', status: 'waiting',
    entries: [
      { at: '2026-11-02T17:40:00Z', kind: 'event', verdict: 'accepted', fields: { type: 'match.finished', match_id: 'm-5521', mode: 'Hollow Run', result: 'lost', duration_seconds: 1260 } },
      { at: '2026-11-02T18:04:00Z', kind: 'event', verdict: 'accepted', fields: { type: 'purchase.receipt', receipt_id: 'gr-rcpt-1001', item: 'Lantern Pack', amount_minor: 499, currency: 'USD' } },
      { at: '2026-11-02T18:20:00Z', kind: 'event', verdict: 'accepted', fields: { type: 'purchase.receipt', receipt_id: 'gr-rcpt-1002', item: 'Ember Lantern Bundle', amount_minor: 1200, currency: 'JPY' } },
      { at: '2026-11-02T18:41:00Z', kind: 'event', verdict: 'accepted', fields: { type: 'purchase.refunded', refund_id: 'gr-rfnd-1002a', receipt_id: 'gr-rcpt-1002', amount_minor: 400, currency: 'JPY' } },
      { at: '2026-11-02T19:12:00Z', kind: 'player', body: 'i never got the lantern pack' },
      { at: '2026-11-02T19:20:00Z', kind: 'event', verdict: 'refused', fields: { type: 'purchase.receipt', receipt_id: 'gr-rcpt-1001', item: 'Lantern Pack', amount_minor: 499, currency: 'USD' } },
    ],
  },
  {
    game: 'gloamrunner', player: 'p-moth-02', name: 'Mothwing', topic: 'bug', status: 'answered',
    entries: [
      { at: '2026-11-01T09:30:00Z', kind: 'player', body: 'The Hollow boss freezes after the *second* lantern.' },
      { at: '2026-11-01T11:02:00Z', kind: 'reply', by: 'wren@gloamrunner.example', body: 'Thanks, I can reproduce it. A fix ships in the next patch.' },
    ],
  },
  {
    game: 'gloamrunner', player: 'p-kestrel-9', name: 'Kestrel', topic: 'account', status: 'closed', closedAt: '2026-10-30T15:30:00Z',
    entries: [
      { at: '2026-10-30T14:00:00Z', kind: 'player', body: 'How do I change my display name?' },
      { at: '2026-10-30T15:10:00Z', kind: 'reply', by: 'juno@gloamrunner.example', body: 'Open Settings, then Profile, and edit the name field.' },
    ],
  },
  {
    game: 'gloamrunner', player: 'p-tallow-4', name: 'Tallow', topic: 'other', status: 'waiting',
    entries: [
      { at: '2026-11-02T21:45:00Z', kind: 'player', body: HOSTILE_TEXT },
    ],
  },
  {
    game: 'tiny-ferry', player: 'p-otter-5', name: 'Otter', topic: 'purchase', status: 'waiting',
    entries: [{ at: '2026-11-02T08:15:00Z', kind: 'player', body: "Harbour Bell skin didn't show up after I paid." }],
  },
];

export async function seed(tx: PoolClient): Promise<void> {
  const existing = await tx.query('select 1 from games limit 1');
  if (existing.rowCount) return;
  const gameIds = new Map<string, string>();
  for (const game of GAMES) {
    const id = newId();
    gameIds.set(game.slug, id);
    await tx.query('insert into games (id, slug, name, launcher_origin, widget_secret, server_secret) values ($1, $2, $3, $4, $5, $6)', [
      id, game.slug, game.name, game.origin, game.widget, game.server,
    ]);
  }
  const staffIds = new Map<string, string>();
  for (const person of STAFF) {
    const id = newId();
    staffIds.set(person.email, id);
    await tx.query('insert into staff (id, game_id, name, email, password_hash, role) values ($1, $2, $3, $4, $5, $6)', [
      id, gameIds.get(person.game), person.name, person.email, await hashPassword(person.password), person.role,
    ]);
  }
  for (const [effect, action, topic] of JUNO_RULES) {
    await tx.query('insert into rules (id, moderator_id, effect, action, topic) values ($1, $2, $3, $4, $5)', [
      newId(), staffIds.get('juno@gloamrunner.example'), effect, action, topic,
    ]);
  }
  for (const thread of THREADS) await seedThread(tx, gameIds.get(thread.game) as string, thread, staffIds);
}

async function seedThread(tx: PoolClient, gameId: string, thread: SeedThread, staffIds: Map<string, string>): Promise<void> {
  await tx.query('insert into players (game_id, id, name) values ($1, $2, $3)', [gameId, thread.player, thread.name]);
  await tx.query('insert into buckets (game_id, player_id, credit_ms, refilled_at) values ($1, $2, $3, now())', [gameId, thread.player, CAPACITY_MS]);
  const players = thread.entries.filter((entry) => entry.kind === 'player');
  const lastPlayer = players.at(-1) as SeedEntry;
  await tx.query(
    'insert into threads (id, game_id, player_id, topic, status, waiting_since, last_player_message_at) values ($1, $2, $3, $4, $5, $6, $7)',
    [newId(), gameId, thread.player, thread.topic, thread.status, thread.status === 'waiting' ? lastPlayer.at : null, lastPlayer.at],
  );
  const threadId = (await tx.query<{ id: string }>('select id from threads where game_id = $1 and player_id = $2', [gameId, thread.player])).rows[0]?.id as string;
  if (thread.closedAt) await tx.query('insert into thread_closes (thread_id, closed_at) values ($1, $2)', [threadId, thread.closedAt]);
  for (const entry of thread.entries) {
    const id = newId();
    const author = entry.kind === 'reply' ? staffIds.get(entry.by) : null;
    await tx.query('insert into messages (id, game_id, player_id, kind, author_id, body, created_at) values ($1, $2, $3, $4, $5, $6, $7)', [
      id, gameId, thread.player, entry.kind, author, entry.kind === 'event' ? null : entry.body, entry.at,
    ]);
    if (entry.kind === 'reply') continue;
    if (entry.kind === 'player') {
      await storeVerdict(tx, id, signatureLine('signature valid'));
      await storeVerdict(tx, id, bucketLine(8, 7));
      const result = sanitise(entry.body);
      await storeVerdict(tx, id, sanitiserLine(result));
      await storeVerdict(tx, id, linkLine(await checkLink(result.after)));
      continue;
    }
    const f = entry.fields;
    await tx.query(
      `insert into events (message_id, game_id, type, verdict, occurred_at, receipt_id, refund_id, item, amount_minor, currency, match_id, mode, result, duration_seconds)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, gameId, f.type, entry.verdict, entry.at, f.receipt_id ?? null, f.refund_id ?? null, f.item ?? null, f.amount_minor ?? null, f.currency ?? null,
        f.match_id ?? null, f.mode ?? null, f.result ?? null, f.duration_seconds ?? null],
    );
    await storeVerdict(tx, id, signatureLine(entry.verdict === 'accepted' ? 'signature valid' : 'signature refused: nonce already seen'));
    await storeVerdict(tx, id, unmeteredBucketLine());
    await storeVerdict(tx, id, noTextSanitiserLine());
    await storeVerdict(tx, id, noLinkLine());
  }
}
