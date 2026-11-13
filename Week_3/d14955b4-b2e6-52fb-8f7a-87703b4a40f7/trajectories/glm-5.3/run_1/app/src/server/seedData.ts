// Seeded data. Applied only when the database holds no games.
import { hashPassword } from './passwords';

export interface SeedRefund {
  refund_id: string;
  receipt_id: string;
  amount_minor: number;
  currency: string;
  occurred_at: string;
}
export interface SeedPurchase {
  receipt_id: string;
  item: string;
  amount_minor: number;
  currency: string;
  occurred_at: string;
}
export interface SeedEvent {
  id: string;
  type: 'purchase.receipt' | 'purchase.refunded' | 'match.finished';
  occurred_at: string;
  body: Record<string, unknown>;
  refused?: { verdict: string };
}
export interface SeedReply {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}
export interface SeedPlayerMessage {
  id: string;
  body: string;
  created_at: string;
}
export interface SeedThread {
  player_id: string;
  player_name: string;
  topic: 'bug' | 'account' | 'purchase' | 'other';
  status: 'waiting' | 'answered' | 'closed';
  created_at: string;
  last_player_message_at: string;
  waiting_since: string | null;
  first_closed_at?: string;
  events: SeedEvent[];
  player_messages: SeedPlayerMessage[];
  replies: SeedReply[];
}
export interface SeedGame {
  id: string;
  slug: string;
  name: string;
  launcher_origin: string;
  widget_secret: string;
  server_secret: string;
  staff: { id: string; name: string; email: string; password: string; role: 'developer' | 'moderator'; rules?: { id: string; effect: 'grant' | 'deny'; action: 'read' | 'reply' | 'close' | 'receipts'; topic: 'bug' | 'account' | 'purchase' | 'other' | '*' }[] }[];
  players: SeedThread[];
}

export const SEED_GAMES: SeedGame[] = [
  {
    id: 'game-gloamrunner',
    slug: 'gloamrunner',
    name: 'Gloamrunner',
    launcher_origin: 'https://launcher.gloamrunner.example',
    widget_secret: 'gloam-widget-4c1e9a',
    server_secret: 'gloam-server-8d27b3',
    staff: [
      {
        id: 'staff-wren',
        name: 'Wren Ashdown',
        email: 'wren@gloamrunner.example',
        password: 'lantern-keeper-42',
        role: 'developer',
      },
      {
        id: 'staff-juno',
        name: 'Juno Reyes',
        email: 'juno@gloamrunner.example',
        password: 'moth-lamp-31',
        role: 'moderator',
        rules: [
          { id: 'rule-juno-1', effect: 'grant', action: 'read', topic: '*' },
          { id: 'rule-juno-2', effect: 'grant', action: 'reply', topic: '*' },
          { id: 'rule-juno-3', effect: 'grant', action: 'close', topic: '*' },
          { id: 'rule-juno-4', effect: 'grant', action: 'receipts', topic: '*' },
          { id: 'rule-juno-5', effect: 'deny', action: 'receipts', topic: '*' },
          { id: 'rule-juno-6', effect: 'deny', action: 'read', topic: 'purchase' },
        ],
      },
    ],
    players: [
      {
        player_id: 'p-ash-17',
        player_name: 'Ashveil',
        topic: 'purchase',
        status: 'waiting',
        created_at: '2026-11-02T17:40:00Z',
        last_player_message_at: '2026-11-02T19:12:00Z',
        waiting_since: '2026-11-02T19:12:00Z',
        events: [
          {
            id: 'msg-ash-match',
            type: 'match.finished',
            occurred_at: '2026-11-02T17:40:00Z',
            body: {
              nonce: 'seed-ash-match-1',
              type: 'match.finished',
              player_id: 'p-ash-17',
              occurred_at: '2026-11-02T17:40:00Z',
              match_id: 'm-5521',
              mode: 'Hollow Run',
              result: 'lost',
              duration_seconds: 1260,
            },
          },
          {
            id: 'msg-ash-rcpt1001',
            type: 'purchase.receipt',
            occurred_at: '2026-11-02T18:04:00Z',
            body: {
              nonce: 'seed-ash-rcpt-1',
              type: 'purchase.receipt',
              player_id: 'p-ash-17',
              occurred_at: '2026-11-02T18:04:00Z',
              receipt_id: 'gr-rcpt-1001',
              item: 'Lantern Pack',
              amount_minor: 499,
              currency: 'USD',
            },
          },
          {
            id: 'msg-ash-rcpt1002',
            type: 'purchase.receipt',
            occurred_at: '2026-11-02T18:20:00Z',
            body: {
              nonce: 'seed-ash-rcpt-2',
              type: 'purchase.receipt',
              player_id: 'p-ash-17',
              occurred_at: '2026-11-02T18:20:00Z',
              receipt_id: 'gr-rcpt-1002',
              item: 'Ember Lantern Bundle',
              amount_minor: 1200,
              currency: 'JPY',
            },
          },
          {
            id: 'msg-ash-rfnd1002a',
            type: 'purchase.refunded',
            occurred_at: '2026-11-02T18:41:00Z',
            body: {
              nonce: 'seed-ash-rfnd-1',
              type: 'purchase.refunded',
              player_id: 'p-ash-17',
              occurred_at: '2026-11-02T18:41:00Z',
              refund_id: 'gr-rfnd-1002a',
              receipt_id: 'gr-rcpt-1002',
              amount_minor: 400,
              currency: 'JPY',
            },
          },
          {
            id: 'msg-ash-refused',
            type: 'purchase.receipt',
            occurred_at: '2026-11-02T19:20:00Z',
            body: {
              nonce: 'seed-ash-rcpt-1',
              type: 'purchase.receipt',
              player_id: 'p-ash-17',
              occurred_at: '2026-11-02T18:04:00Z',
              receipt_id: 'gr-rcpt-1001',
              item: 'Lantern Pack',
              amount_minor: 499,
              currency: 'USD',
            },
            refused: { verdict: 'signature refused: nonce already seen' },
          },
        ],
        player_messages: [
          { id: 'msg-ash-player', body: 'i never got the lantern pack', created_at: '2026-11-02T19:12:00Z' },
        ],
        replies: [],
      },
      {
        player_id: 'p-moth-02',
        player_name: 'Mothwing',
        topic: 'bug',
        status: 'answered',
        created_at: '2026-11-01T09:30:00Z',
        last_player_message_at: '2026-11-01T09:30:00Z',
        waiting_since: null,
        events: [],
        player_messages: [
          { id: 'msg-moth-player', body: 'The Hollow boss freezes after the *second* lantern.', created_at: '2026-11-01T09:30:00Z' },
        ],
        replies: [
          {
            id: 'msg-moth-reply',
            author_name: 'Wren Ashdown',
            body: 'Thanks, I can reproduce it. A fix ships in the next patch.',
            created_at: '2026-11-01T11:02:00Z',
          },
        ],
      },
      {
        player_id: 'p-kestrel-9',
        player_name: 'Kestrel',
        topic: 'account',
        status: 'closed',
        created_at: '2026-10-30T14:00:00Z',
        last_player_message_at: '2026-10-30T14:00:00Z',
        waiting_since: null,
        first_closed_at: '2026-10-30T15:30:00Z',
        events: [],
        player_messages: [
          { id: 'msg-kestrel-player', body: 'How do I change my display name?', created_at: '2026-10-30T14:00:00Z' },
        ],
        replies: [
          {
            id: 'msg-kestrel-reply',
            author_name: 'Juno Reyes',
            body: 'Open Settings, then Profile, and edit the name field.',
            created_at: '2026-10-30T15:10:00Z',
          },
        ],
      },
      {
        player_id: 'p-tallow-4',
        player_name: 'Tallow',
        topic: 'other',
        status: 'waiting',
        created_at: '2026-11-02T21:45:00Z',
        last_player_message_at: '2026-11-02T21:45:00Z',
        waiting_since: '2026-11-02T21:45:00Z',
        events: [],
        player_messages: [
          {
            id: 'msg-tallow-player',
            body: "free skins here <script>alert('gotcha')</script> [claim now](javascript:alert(1)) http://169.254.169.254/latest/meta-data/",
            created_at: '2026-11-02T21:45:00Z',
          },
        ],
        replies: [],
      },
    ],
  },
  {
    id: 'game-tiny-ferry',
    slug: 'tiny-ferry',
    name: 'Tiny Ferry Co.',
    launcher_origin: 'https://play.tinyferry.example',
    widget_secret: 'ferry-widget-2a6f10',
    server_secret: 'ferry-server-5e93c4',
    staff: [
      {
        id: 'staff-pim',
        name: 'Pim Okafor',
        email: 'pim@tinyferry.example',
        password: 'harbour-bell-77',
        role: 'developer',
      },
    ],
    players: [
      {
        player_id: 'p-otter-5',
        player_name: 'Otter',
        topic: 'purchase',
        status: 'waiting',
        created_at: '2026-11-02T08:15:00Z',
        last_player_message_at: '2026-11-02T08:15:00Z',
        waiting_since: '2026-11-02T08:15:00Z',
        events: [],
        player_messages: [
          { id: 'msg-otter-player', body: "Harbour Bell skin didn't show up after I paid.", created_at: '2026-11-02T08:15:00Z' },
        ],
        replies: [],
      },
    ],
  },
];

export async function seedPasswords(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const game of SEED_GAMES) {
    for (const member of game.staff) {
      hashes.set(member.email, await hashPassword(member.password));
    }
  }
  return hashes;
}
