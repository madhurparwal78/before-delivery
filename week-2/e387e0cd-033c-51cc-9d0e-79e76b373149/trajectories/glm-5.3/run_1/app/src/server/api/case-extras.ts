import { query } from '../db.js';
import { formatInstant } from '../domain/time.js';
import type { CaseRecord } from './helpers.js';

// The parts of a case body that come from other tables: stored-object digests,
// the current data request page and the review claim and decision.
export interface CaseExtras { digests: unknown[]; requestPage: Record<string, unknown> | null; review: Record<string, unknown> | null }

export async function caseExtras(row: CaseRecord, now = new Date()): Promise<CaseExtras> {
  const messages = await query<{ object_key: string; sha256: string }>('SELECT object_key, sha256 FROM messages WHERE case_id = $1', [row.id]);
  const certificates = await query<{ object_key: string; sha256: string }>('SELECT object_key, sha256 FROM certificates WHERE case_id = $1', [row.id]);
  const digests = [
    ...messages.rows.map((m) => ({ kind: 'message', objectKey: m.object_key, sha256: m.sha256 })),
    ...certificates.rows.map((c) => ({ kind: 'certificate', objectKey: c.object_key, sha256: c.sha256 })),
  ];

  let requestPage: Record<string, unknown> | null = null;
  if (row.data_sent_channel === 'request_page') {
    const pages = await query<{ status: string; sent_at: Date; ends_at: Date; contact_email: string; answer_decision: string | null }>(
      'SELECT status, sent_at, ends_at, contact_email, answer_decision FROM request_pages WHERE case_id = $1 ORDER BY sent_at DESC',
      [row.id],
    );
    if (pages.rows.length > 0) {
      const p = pages.rows[0];
      const live = p.status === 'live' && p.ends_at.getTime() > now.getTime();
      const status = p.status === 'answered' ? 'answered' : live ? 'live' : 'ended';
      requestPage = {
        status,
        sentAt: formatInstant(p.sent_at),
        endsAt: formatInstant(p.ends_at),
        remainingSeconds: live ? Math.max(0, Math.floor((p.ends_at.getTime() - now.getTime()) / 1000)) : 0,
        contactEmail: p.contact_email,
      };
    }
  }

  let review: Record<string, unknown> | null = null;
  if (row.path === 'review') {
    let claim: Record<string, unknown> | null = null;
    const claims = await query<{ member_id: string; member_name: string; claimed_at: Date; ends_at: Date }>('SELECT member_id, member_name, claimed_at, ends_at FROM review_claims WHERE case_id = $1', [row.id]);
    if (claims.rows.length > 0) {
      const c = claims.rows[0];
      const held = c.ends_at.getTime() > now.getTime();
      claim = {
        memberId: c.member_id,
        memberName: c.member_name,
        claimedAt: formatInstant(c.claimed_at),
        endsAt: formatInstant(c.ends_at),
        remainingSeconds: held ? Math.max(0, Math.floor((c.ends_at.getTime() - now.getTime()) / 1000)) : 0,
      };
    }
    const decision = row.review_decision !== null && row.review_decided_at !== null
      ? { decision: row.review_decision, reason: row.review_reason, decidedBy: row.review_decided_by, decidedAt: formatInstant(row.review_decided_at) }
      : null;
    review = { claim, decision };
  }

  return { digests, requestPage, review };
}
