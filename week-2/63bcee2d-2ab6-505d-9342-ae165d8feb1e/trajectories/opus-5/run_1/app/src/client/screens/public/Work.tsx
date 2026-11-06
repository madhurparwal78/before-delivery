import { useId } from 'react';
import { SECTORS, SECTOR_LABELS, type Sector } from '../../../shared/domain.js';
import { PublicShell } from '../../components/PublicShell.jsx';
import { PrimaryLink } from '../../components/Buttons.jsx';
import { Link, useRouter } from '../../lib/router.jsx';
import { useResource } from '../../lib/workspace.jsx';

interface Entry {
  slug: string;
  title: string;
  sector: Sector;
  location: string;
  summary: string;
  coverUrl: string;
}

interface SectorCounts {
  total: number;
  sectors: { key: Sector; label: string; count: number }[];
}

export function Work(): JSX.Element {
  const sectorName = useId();
  const viewName = useId();
  const listName = useId();
  const { query, navigate } = useRouter();

  const sectorParam = query.get('sector');
  const sector = SECTORS.includes(sectorParam as Sector) ? (sectorParam as Sector) : null;
  const view = query.get('view') === 'list' ? 'list' : 'grid';

  const counts = useResource<SectorCounts>('/api/public/sectors');
  const listing = useResource<{ caseStudies: Entry[] }>(
    sector ? `/api/public/case-studies?sector=${sector}` : '/api/public/case-studies',
    [sector],
  );

  const go = (next: { sector?: Sector | null; view?: 'grid' | 'list' }): void => {
    const params = new URLSearchParams();
    const nextSector = next.sector === undefined ? sector : next.sector;
    const nextView = next.view ?? view;
    if (nextSector) params.set('sector', nextSector);
    if (nextView === 'list') params.set('view', 'list');
    const search = params.toString();
    navigate(`/work${search === '' ? '' : `?${search}`}`);
  };

  const entries = listing.data?.caseStudies ?? [];
  const total = counts.data?.total ?? 0;
  const countFor = (key: Sector): number =>
    counts.data?.sectors.find((entry) => entry.key === key)?.count ?? 0;

  return (
    <PublicShell title="Work · Marrow Hall Interiors">
      <section className="section" data-tone="light">
        <div className="section-inner">
          <h1>Work</h1>
          <p>
            Rollouts delivered store by store. Filter by sector, or read the whole index.
          </p>

          <div className="filter-row">
            <div>
              <p className="group-heading" id={sectorName}>
                Sector
              </p>
              <div className="toggle-group" role="group" aria-labelledby={sectorName}>
                <button
                  type="button"
                  aria-pressed={sector === null}
                  onClick={() => go({ sector: null })}
                >
                  {`All (${total})`}
                </button>
                {SECTORS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={sector === key}
                    onClick={() => go({ sector: key })}
                  >
                    {`${SECTOR_LABELS[key]} (${countFor(key)})`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="group-heading" id={viewName}>
                View
              </p>
              <div className="toggle-group" role="radiogroup" aria-labelledby={viewName}>
                <div className="radio-row">
                  <input
                    type="radio"
                    id={`${viewName}-grid`}
                    name={`${viewName}-view`}
                    checked={view === 'grid'}
                    onChange={() => go({ view: 'grid' })}
                  />
                  <label htmlFor={`${viewName}-grid`}>Grid</label>
                </div>
                <div className="radio-row">
                  <input
                    type="radio"
                    id={`${viewName}-list`}
                    name={`${viewName}-view`}
                    checked={view === 'list'}
                    onChange={() => go({ view: 'list' })}
                  />
                  <label htmlFor={`${viewName}-list`}>List</label>
                </div>
              </div>
            </div>
          </div>

          <h2 id={listName}>Case studies</h2>
          <ul
            className={view === 'list' ? 'work-list' : 'work-grid'}
            aria-labelledby={listName}
          >
            {entries.map((entry) => (
              <li key={entry.slug}>
                {view === 'list' ? (
                  <>
                    <Link to={`/work/${entry.slug}`}>{entry.title}</Link>
                    <p className="meta">{`${SECTOR_LABELS[entry.sector]} · ${entry.location}`}</p>
                  </>
                ) : (
                  <Link to={`/work/${entry.slug}`} className="work-card">
                    <img src={entry.coverUrl} alt="" />
                    <span className="work-card-body">
                      <span>{entry.title}</span>
                    </span>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" data-tone="dark">
        <div className="section-inner">
          <h2>Start a project</h2>
          <p>Six to forty stores for one brand at a time, run on one record.</p>
          <p>
            <PrimaryLink to="/start" label="Start a project" />
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
