import type { Ctx, Method, Principal } from './http';
import { requireSession } from './http';
import { query } from './db';
import { forbidden, notFound } from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import { formatDateTime } from './datetime';

export function routeQueue(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
): void {
  router.add('GET', '/queue', async (ctx) => {
    const principal = requireSession(ctx);
    if (!['brand_reviewer', 'legal_reviewer', 'owner'].includes(principal.role)) throw notFound();
    const now = await readClock(cfg);
    void now;
    const rows = await query<{
      request_id: string;
      stage_n: number;
      stage_kind: string;
      asset_name: string;
      variant_label: string | null;
      application_class: string;
      requester_name: string;
      organisation_name: string | null;
      deadline: Date;
      escalation: string | null;
    }>(
      `SELECT r.id AS request_id, rs.n AS stage_n, rs.kind AS stage_kind, a.name AS asset_name,
              v.label AS variant_label, r.application_class, p.display_name AS requester_name,
              o.name AS organisation_name, r.deadline, r.escalation
         FROM request_stages rs
         JOIN requests r ON r.id = rs.request_id
         JOIN assets a ON a.id = r.asset_id
         LEFT JOIN variants v ON v.id = r.variant_id
         JOIN principals p ON p.id = r.requester_id
         LEFT JOIN organisations o ON o.id = p.organisation_id
        WHERE rs.assignee_id = $1 AND rs.decision IS NULL AND r.state = 'under_review'
        ORDER BY r.deadline ASC, r.id ASC`,
      [principal.id],
    );
    const applicationLabels: Record<string, string> = {
      internal_comms: 'Internal comms',
      social: 'Social',
      press_article: 'Press article',
      event: 'Event',
      film: 'Film',
      packaging: 'Packaging',
      co_brand: 'Co-brand',
      merchandise: 'Merchandise',
      partnership: 'Partnership',
    };
    return {
      rows: rows.map((row) => ({
        requestId: row.request_id,
        stage: row.stage_n,
        stageLabel: stageLabel(row.stage_kind),
        cardName: row.variant_label ? `${row.asset_name} — ${row.variant_label}` : row.asset_name,
        applicationLabel: applicationLabels[row.application_class] ?? row.application_class,
        requesterName: row.requester_name,
        organisationName: row.organisation_name ?? '',
        deadline: row.deadline.toISOString(),
        escalation: row.escalation,
      })),
    };
  });
}

function stageLabel(kind: string): string {
  return kind === 'legal' ? 'Legal review' : 'Brand review';
}

export { formatDateTime, Principal };
