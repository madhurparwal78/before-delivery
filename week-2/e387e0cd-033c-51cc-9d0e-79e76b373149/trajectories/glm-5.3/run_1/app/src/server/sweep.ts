import { query } from './db.js';
import { businessDateInZone, formatInstant } from './domain/time.js';
import { deleteObject } from './services/s3.js';

// Timed work runs here at least every ten seconds: answer windows, request
// page ends, scheduled threshold changes and erasure.
export async function sweep(): Promise<void> {
  const now = new Date();

  // Answer windows: from the due instant on, the case reads No response.
  await query(
    `UPDATE cases SET status = 'no_response'
     WHERE status = 'awaiting_answer' AND path = 'counterparty' AND answer_due_at IS NOT NULL AND answer_due_at <= $1`,
    [now],
  );

  // Data request pages end at their ending instant.
  await query(`UPDATE request_pages SET status = 'ended' WHERE status = 'live' AND ends_at <= $1`, [now]);

  // Scheduled threshold changes take effect at 00:00 business time.
  const due = await query<{ id: string; workspace_slug: string; jurisdiction_code: string; threshold_cents: string; takes_effect_on: string }>('SELECT id, workspace_slug, jurisdiction_code, threshold_cents, takes_effect_on FROM rule_changes WHERE state = $1 AND takes_effect_at <= $2', ['scheduled', now]);
  for (const change of due.rows) {
    const ws = await query<{ time_zone: string }>('SELECT time_zone FROM workspaces WHERE slug = $1', [change.workspace_slug]);
    if (ws.rows.length === 0) continue;
    const today = businessDateInZone(now, ws.rows[0].time_zone);
    if (today < change.takes_effect_on) continue;
    await query('UPDATE rule_changes SET state = $1 WHERE id = $2', ['in_force', change.id]);
    await query('UPDATE workspace_rules SET threshold_cents = $1, in_force_since = $2, change_threshold_cents = NULL, change_takes_effect_on = NULL WHERE workspace_slug = $3 AND jurisdiction_code = $4',
      [change.threshold_cents, change.takes_effect_on, change.workspace_slug, change.jurisdiction_code]);
  }

  // Erasure after the retention time.
  const dueCases = await query<{ id: string; workspace_slug: string }>('SELECT id, workspace_slug FROM cases WHERE erasure_status = $1 AND erasure_due_at IS NOT NULL AND erasure_due_at <= $2', ['scheduled', now]);
  for (const c of dueCases.rows) {
    await query('UPDATE cases SET erasure_status = $1 WHERE id = $2 AND erasure_status = $3', ['pending', c.id, 'scheduled']);
    const messages = await query<{ id: string; object_key: string; working: Record<string, unknown> | null }>('SELECT id, object_key, working FROM messages WHERE case_id = $1 AND erased = false', [c.id]);
    const certificates = await query<{ id: string; object_key: string }>('SELECT id, object_key FROM certificates WHERE case_id = $1 AND erased = false', [c.id]);
    let allDeleted = true;
    for (const m of messages.rows) {
      const result = await deleteObject(m.object_key);
      if (result.ok) {
        const working = m.working as Record<string, unknown> | null;
        const masked = working !== null ? eraseNames(working) : null;
        await query('UPDATE messages SET erased = true, working = $2 WHERE id = $1', [m.id, masked === null ? null : JSON.stringify(masked)]);
      } else {
        allDeleted = false;
      }
    }
    for (const cert of certificates.rows) {
      const result = await deleteObject(cert.object_key);
      if (result.ok) await query('UPDATE certificates SET erased = true WHERE id = $1', [cert.id]);
      else allDeleted = false;
    }
    await query(
      `UPDATE cases SET originator_name = NULL, originator_identity = NULL, originator_dob = NULL, beneficiary_name = NULL, erased = $2 WHERE id = $1`,
      [c.id, allDeleted],
    );
    if (allDeleted) {
      await query('UPDATE cases SET erasure_status = $1, erased = true, erased_at = $2 WHERE id = $3', ['erased', now, c.id]);
    }
  }

  // Expired partner request keys older than 24 hours are dropped.
  await query('DELETE FROM request_keys WHERE created_at < $1', [new Date(now.getTime() - 24 * 3600 * 1000)]).catch(() => {});
}

function eraseNames(working: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...working };
  for (const key of ['originator', 'beneficiary']) {
    const value = out[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...(value as Record<string, unknown>), name: null };
    }
  }
  return out;
}

export { formatInstant };
