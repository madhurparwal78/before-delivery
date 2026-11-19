import type { CreditsResponse, PlanResponse } from '../../shared/api.js';
import { emptyStates } from '../../shared/copy.js';
import { formatUsd } from '../../shared/money.js';
import { planByCode } from '../../shared/plans.js';
import { api } from '../lib/api.js';
import { useBreakpoint, useLoader } from '../lib/hooks.js';
import { Link } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { EmptyState } from '../components/StatusRegion.js';
import { PlanCreditList } from '../components/PlanCreditList.js';
import { Icon } from '../components/Icon.js';

interface StudioPiece {
  slug: string;
  title: string;
  state: string;
  version: number;
  edition_count: number | null;
  price_cents: number | null;
  editions_sold: number;
  remix_of: { slug: string; title: string; creator_display_name: string } | null;
}

export function Studio(): JSX.Element {
  const session = useSession();
  const breakpoint = useBreakpoint();
  const pieces = useLoader(
    () => api.get<{ pieces: StudioPiece[] }>('/api/me/pieces'),
    [],
  );
  const credits = useLoader(() => api.get<CreditsResponse>('/api/me/credits'), []);
  const plan = useLoader(() => api.get<PlanResponse>('/api/me/plan'), []);

  if (!session.loading && !session.isCreator) {
    return (
      <div className="shell studio">
        <h1 className="display">Only creator accounts can start pieces.</h1>
        <Link to="/gallery" className="next-action">
          Browse the gallery
          <Icon name="arrow-right" className="next-action__arrow" />
        </Link>
      </div>
    );
  }

  const rows = pieces.data?.pieces ?? [];
  const planLabel = plan.data?.plan
    ? `${planByCode(plan.data.plan.code).name} · ${plan.data.plan.state.replace('_', ' ')}`
    : 'No plan';

  return (
    <div className="shell studio">
      <h1 className="studio__title display">Your studio.</h1>

      <div className="studio__summary">
        <p className="tabular">
          <span className="muted">Credits available</span>{' '}
          <strong>{credits.data?.available ?? 0}</strong>
        </p>
        <p className="tabular">
          <span className="muted">Reserved</span> <strong>{credits.data?.held ?? 0}</strong>
        </p>
        <p>
          <span className="muted">Plan</span> <strong>{planLabel}</strong>
        </p>
        <Link to="/studio/credits" className="arrow-link">
          Plans and credits
          <Icon name="arrow-right" className="arrow-link__arrow" />
        </Link>
      </div>

      {rows.length === 0 && !pieces.loading ? (
        <EmptyState sentence={emptyStates.studio} actionLabel="Start a piece" actionTo="/" />
      ) : breakpoint === 'phone' ? (
        <ul className="studio__stack" aria-label="Your pieces">
          {rows.map((piece) => (
            <li key={piece.slug} className="studio__card">
              <Link to={`/studio/pieces/${piece.slug}`} className="studio__card-title display">
                {piece.title}
              </Link>
              <p>
                <span className="muted">State</span> <span>{piece.state}</span>
              </p>
              <p className="tabular">
                <span className="muted">Version</span> <span>{piece.version}</span>
              </p>
              <p className="tabular">
                <span className="muted">Editions sold</span>{' '}
                <span>
                  {piece.editions_sold}
                  {piece.edition_count === null ? '' : ` of ${piece.edition_count}`}
                </span>
              </p>
              <p className="tabular">
                <span className="muted">Price</span>{' '}
                <span>{piece.price_cents === null ? '—' : `$${formatUsd(piece.price_cents)}`}</span>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <table className="data-table" aria-label="Your pieces">
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">State</th>
              <th scope="col">Version</th>
              <th scope="col">Editions sold</th>
              <th scope="col" className="amount">
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((piece) => (
              <tr key={piece.slug}>
                <th scope="row">
                  <Link to={`/studio/pieces/${piece.slug}`}>{piece.title}</Link>
                  {piece.remix_of && (
                    <span className="muted"> · remix of {piece.remix_of.title}</span>
                  )}
                </th>
                <td>{piece.state}</td>
                <td className="tabular">{piece.version}</td>
                <td className="tabular">
                  {piece.editions_sold}
                  {piece.edition_count === null ? '' : ` of ${piece.edition_count}`}
                </td>
                <td className="amount tabular">
                  {piece.price_cents === null ? '—' : `$${formatUsd(piece.price_cents)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function StudioCredits(): JSX.Element {
  return (
    <div className="shell studio">
      <h1 className="studio__title display">Plans and credits.</h1>
      <PlanCreditList />
    </div>
  );
}
