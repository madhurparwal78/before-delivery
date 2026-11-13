import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query, transaction } from './db';
import { newId, newToken } from './crypto';
import { SEED_GAMES } from './seedData';
import { hashPassword } from './passwords';
import { computeSanitiser } from './sanitiser';
import { sanitisedFirstLink, classLinkForStorage } from './linkChecks';
import type { SanitiserResult } from './sanitiser';

let schemaApplied = false;

function schemaPath(): string {
  const fromCwd = join(process.cwd(), 'db', 'schema.sql');
  if (existsSync(fromCwd)) return fromCwd;
  return join(import.meta.dirname ?? process.cwd(), '..', '..', 'db', 'schema.sql');
}

export async function migrate(): Promise<void> {
  if (schemaApplied) return;
  const schema = readFileSync(schemaPath(), 'utf8');
  await transaction(async (client) => {
    client.query('SELECT pg_advisory_xact_lock(918273645)');
    await client.query(schema);
    const existing = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM games');
    if (Number(existing.rows[0].count) === 0) {
      await seed(client);
    }
  });
  schemaApplied = true;
}

type Client = Parameters<Parameters<typeof transaction>[0]>[0];

async function seed(client: Client): Promise<void> {
  const hashes = new Map<string, string>();
  for (const game of SEED_GAMES) {
    for (const member of game.staff) {
      hashes.set(member.email, await hashPassword(member.password));
    }
  }
  const accessKey = newToken(48);
  await client.query('INSERT INTO access_key (singleton, key) VALUES (true, $1) ON CONFLICT DO NOTHING', [accessKey]);
  let rulePosition = 0;
  for (const game of SEED_GAMES) {
    await client.query(
      'INSERT INTO games (id, slug, name, launcher_origin, widget_secret, server_secret) VALUES ($1,$2,$3,$4,$5,$6)',
      [game.id, game.slug, game.name, game.launcher_origin, game.widget_secret, game.server_secret],
    );
    for (const member of game.staff) {
      await client.query(
        'INSERT INTO staff (id, game_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)',
        [member.id, game.id, member.name, member.email, hashes.get(member.email), member.role],
      );
      for (const rule of member.rules ?? []) {
        rulePosition += 1;
        await client.query(
          'INSERT INTO rules (id, moderator_id, effect, action, topic, position) VALUES ($1,$2,$3,$4,$5,$6)',
          [rule.id, member.id, rule.effect, rule.action, rule.topic, rulePosition],
        );
      }
    }
    for (const player of game.players) {
      await client.query('INSERT INTO players (id, game_id, name) VALUES ($1,$2,$3)', [player.player_id, game.id, player.player_name]);
      await client.query('INSERT INTO buckets (game_id, player_id, tokens, last_refill) VALUES ($1,$2,8, now())', [game.id, player.player_id]);
      await client.query(
        'INSERT INTO threads (id, game_id, player_id, topic, status, waiting_since, last_player_message_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)',
        [newId('thr'), game.id, player.player_id, player.topic, player.status, player.waiting_since, player.created_at],
      );
      const threadId = (await client.query<{ id: string }>('SELECT id FROM threads WHERE game_id=$1 AND player_id=$2', [game.id, player.player_id])).rows[0].id;
      const entries: { at: string; run: () => Promise<void> }[] = [];
      for (const event of player.events) {
        entries.push({
          at: event.occurred_at,
          run: async () => {
            const refused = event.refused !== undefined;
            const body = event.body as {
              receipt_id?: string; refund_id?: string; item?: string; amount_minor?: number; currency?: string;
              refund_applied?: boolean | null; match_id?: string; mode?: string; result?: string; duration_seconds?: number;
            };
            await client.query(
              `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at,
                event_type, event_verdict, event_receipt_id, event_refund_id, event_refund_applied, event_item, event_amount_minor, event_currency,
                event_match_id, event_mode, event_result, event_duration_seconds)
               VALUES ($1,$2,$3,'event','game_server',$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
              [
                event.id, threadId, game.id, game.name, event.occurred_at, event.type,
                refused ? 'refused' : 'accepted', body.receipt_id ?? null, body.refund_id ?? null,
                !refused && event.type === 'purchase.refunded' ? (body.refund_applied ?? null) : null,
                body.item ?? null, body.amount_minor ?? null, body.currency ?? null,
                body.match_id ?? null, body.mode ?? null, body.result ?? null, body.duration_seconds ?? null,
              ],
            );
            await client.query(
              `INSERT INTO verdicts (message_id, settled, signature_verdict, bucket_previous, bucket_level, bucket_capacity,
                sanitiser_verdict, sanitiser_before, sanitiser_after, sanitiser_removed, link_verdict, link_url, link_address)
               VALUES ($1, true, $2, NULL, NULL, NULL, 'no player text', NULL, NULL, '[]', 'no link', NULL, NULL)`,
              [event.id, refused ? event.refused!.verdict : 'signature valid'],
            );
          },
        });
      }
      for (const message of player.player_messages) {
        entries.push({
          at: message.created_at,
          run: async () => {
            await client.query(
              `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at)
               VALUES ($1,$2,$3,'player','player',$4,$5,$6)`,
              [message.id, threadId, game.id, player.player_name, message.body, message.created_at],
            );
            await insertPlayerVerdict(client, message.id, message.body);
          },
        });
      }
      for (const reply of player.replies) {
        entries.push({
          at: reply.created_at,
          run: async () => {
            await client.query(
              `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at)
               VALUES ($1,$2,$3,'reply',$4,$5,$6,$7)`,
              [reply.id, threadId, game.id, reply.author_name === 'Wren Ashdown' ? 'developer' : 'moderator', reply.author_name, reply.body, reply.created_at],
            );
            await client.query(
              `INSERT INTO verdicts (message_id, settled, signature_verdict, sanitiser_verdict, link_verdict)
               VALUES ($1, true, 'signature valid', 'no player text', 'no link')`,
              [reply.id],
            );
          },
        });
      }
      entries.sort((a, b) => a.at.localeCompare(b.at));
      for (const entry of entries) await entry.run();
      for (const event of player.events) {
        const body = event.body as { receipt_id?: string; refund_id?: string; item?: string; amount_minor?: number; currency?: string };
        if (event.refused === undefined && event.type === 'purchase.receipt') {
          await client.query(
            'INSERT INTO purchases (game_id, receipt_id, message_id, item, amount_minor, currency, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [game.id, body.receipt_id, event.id, body.item, body.amount_minor, body.currency, event.occurred_at],
          );
        }
        if (event.refused === undefined && event.type === 'purchase.refunded') {
          await client.query(
            'INSERT INTO refunds (game_id, refund_id, message_id, receipt_id, amount_minor, currency, applied, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [game.id, body.refund_id, event.id, body.receipt_id, body.amount_minor, body.currency, true, event.occurred_at],
          );
        }
      }
      if (player.first_closed_at) {
        await client.query('INSERT INTO closes (thread_id, closed_at) VALUES ($1,$2)', [threadId, player.first_closed_at]);
      }
    }
  }
}

async function insertPlayerVerdict(client: Client, messageId: string, body: string): Promise<void> {
  const sanitiser: SanitiserResult = computeSanitiser(body);
  const first = sanitisedFirstLink(sanitiser.after);
  const checked = first ? await classLinkForStorage(first) : null;
  const verdict = checked ? checked.verdict : 'no link';
  const address = checked?.address ?? null;
  await client.query(
    `INSERT INTO verdicts (message_id, settled, signature_verdict, bucket_previous, bucket_level, bucket_capacity,
      sanitiser_verdict, sanitiser_before, sanitiser_after, sanitiser_removed, link_verdict, link_url, link_address)
     VALUES ($1,$2,'signature valid',$3,$4,8,$5,$6,$7,$8,$9,$10,$11)`,
    [
      messageId, true, 8, 7, sanitiser.verdict, body, sanitiser.after,
      JSON.stringify(sanitiser.removed), verdict, checked?.url ?? null, address,
    ],
  );
}
