import { pool } from '../db';
import { loadCategory, loadProgram, loadRound, queueEmail, roundEntryState } from '../data';
import { sendMail } from '../providers/mail';
import { objectExists, putObject } from '../providers/storage';
import { buildPacket, packetKey } from '../routes/director';
import { dateLabel } from '../domain/time';
import { drawArtwork } from '../seed';

const AWARD_WORD: Record<string, string> = {
  winner: 'Winner',
  finalist: 'Finalist',
  honourable_mention: 'Honourable mention',
};

async function deliverQueuedEmails(): Promise<void> {
  const pending = await pool.query<{ id: string; to_addr: string; subject: string; body: string }>(
    'SELECT id, to_addr, subject, body FROM emails WHERE sent_at IS NULL ORDER BY queued_at LIMIT 20',
  );
  for (const mail of pending.rows) {
    await sendMail(mail.to_addr, mail.subject, mail.body);
    await pool.query('UPDATE emails SET sent_at = now() WHERE id = $1', [mail.id]);
  }
}

async function rewritePackets(): Promise<void> {
  const jobs = await pool.query<{ round_id: string }>('SELECT round_id FROM packet_jobs ORDER BY updated_at');
  for (const job of jobs.rows) {
    const round = await loadRound(pool, job.round_id);
    if (round === null) {
      await pool.query('DELETE FROM packet_jobs WHERE round_id = $1', [job.round_id]);
      continue;
    }
    const category = await loadCategory(pool, round.category_id);
    const program = category === null ? null : await loadProgram(pool, category.program_id);
    if (category === null || program === null) continue;
    const label =
      round.ballot_deadline === null ? null : dateLabel(round.ballot_deadline, program.time_zone);
    const packet = await buildPacket(pool, round, category.name, label, roundEntryState(round.kind));
    await putObject(packetKey(round.id), Buffer.from(JSON.stringify(packet)), 'application/json');
    await pool.query('DELETE FROM packet_jobs WHERE round_id = $1', [job.round_id]);
  }
}

async function queueResultsEmails(): Promise<void> {
  const due = await pool.query<{ id: string }>(
    'SELECT id FROM categories WHERE published = true AND results_queued = false AND embargo_at <= now()',
  );
  for (const row of due.rows) {
    const category = await loadCategory(pool, row.id);
    if (category === null) continue;
    const program = await loadProgram(pool, category.program_id);
    if (program === null) continue;

    const entries = await pool.query<{
      studio_id: string;
      email: string;
      entry_number: number;
      title: string;
      state: string;
      award: string | null;
      round_one_score: string | null;
      final_score: string | null;
    }>(
      `SELECT e.studio_id, s.email, e.entry_number, e.title, e.state, e.award,
              r1.score AS round_one_score, rf.score AS final_score
       FROM entries e
       JOIN studios s ON s.id = e.studio_id
       JOIN rounds o ON o.category_id = e.category_id AND o.kind = 'round_1'
       JOIN round_results r1 ON r1.round_id = o.id AND r1.entry_id = e.id
       LEFT JOIN rounds f ON f.category_id = e.category_id AND f.kind = 'final'
       LEFT JOIN round_results rf ON rf.round_id = f.id AND rf.entry_id = e.id
       WHERE e.category_id = $1
       ORDER BY e.entry_number`,
      [category.id],
    );

    const byStudio = new Map<string, { email: string; lines: string[] }>();
    for (const entry of entries.rows) {
      const outcome = entry.award === null ? 'Not shortlisted' : AWARD_WORD[entry.award];
      const score = entry.award === null ? entry.round_one_score : entry.final_score;
      const line = `Entry ${entry.entry_number} — ${entry.title}: ${outcome} (${
        score === null ? '—' : Number(score).toFixed(2)
      })`;
      const bucket = byStudio.get(entry.studio_id);
      if (bucket) bucket.lines.push(line);
      else byStudio.set(entry.studio_id, { email: entry.email, lines: [line] });
    }

    for (const [studioId, bucket] of byStudio) {
      await queueEmail(
        pool,
        `results:${category.id}:${studioId}`,
        bucket.email,
        `Cutline results: ${category.name} ${program.year}`,
        [`${category.name} ${program.year} results are published.`, ...bucket.lines].join('\n'),
      );
    }
    await pool.query('UPDATE categories SET results_queued = true WHERE id = $1', [row.id]);
  }
}

async function writeMissingArtwork(): Promise<void> {
  const generated = await pool.query<{ id: string; storage_key: string }>(
    'SELECT id, storage_key FROM assets WHERE generated = true',
  );
  for (const asset of generated.rows) {
    if (await objectExists(asset.storage_key)) continue;
    await putObject(asset.storage_key, drawArtwork(asset.id), 'image/png');
  }
}

function loop(name: string, everyMs: number, task: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void task()
      .catch((error: unknown) => {
        process.stderr.write(`${name} retrying: ${String(error)}\n`);
      })
      .finally(() => {
        running = false;
      });
  }, everyMs).unref();
}

export function startWorkers(): void {
  loop('mailer', 2000, deliverQueuedEmails);
  loop('jury-packets', 2000, rewritePackets);
  loop('embargo', 1000, queueResultsEmails);
  loop('artwork', 5000, writeMissingArtwork);
}
