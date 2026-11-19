import type { ApplicationState } from '../../types';
import type { Funnel as FunnelData, Stage } from './jobModel';

/** The rows after Offered count where an application ended, not stages it reached. */
const ENDED: ApplicationState[] = ['rejected', 'withdrawn'];

const dash = '—';

function medianText(minutes: number | null): string {
  if (minutes === null) return dash;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** The poster's hiring funnel: reached counts, conversion rates and the median time to first view. */
export function Funnel({ funnel, stages }: { funnel: FunnelData; stages: Stage[] }) {
  return (
    <section aria-label="Hiring funnel" className="funnel surface stack-s">
      {funnel.rows.map((row) => {
        const reached = !ENDED.includes(row.stage);
        const label = row.stage === 'rejected' ? 'Not selected' : (stages.find((stage) => stage.state === row.stage)?.label ?? row.stage);
        const rate = reached ? (row.rate === null ? dash : `${row.rate}%`) : '';
        const automatic = row.stage === 'rejected' && (row.automatic ?? 0) > 0 ? ` (${row.automatic} automatic)` : '';
        return (
          <p key={row.stage} className="funnel-row" data-stage={row.stage} data-count={row.count} data-rate={reached && row.rate !== null ? row.rate : ''}>
            {`${label} · `}
            <span className="funnel-count">{row.count}</span>
            {`${automatic}${reached ? ` · ${rate}` : ''}`}
          </p>
        );
      })}
      <p className="muted" data-median-first-view={funnel.median_first_view_minutes ?? ''}>
        {`Median time to first view: ${medianText(funnel.median_first_view_minutes)}`}
      </p>
    </section>
  );
}
