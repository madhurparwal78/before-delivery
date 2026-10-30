import {
  REGION_LABELS,
  STAGE_NAMES,
  isStudioRole,
  visibleSections,
  type Currency,
  type Region,
  type StageKey,
} from '../../shared/domain.js';
import { formatAmount } from '../../shared/format.js';
import { Link, setPageTitle } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { TableRegion } from '../components/Panel.jsx';

interface OverviewProject {
  id: string;
  reference: string;
  name: string;
  brand: { id: string; name: string };
  region: Region;
  currentStage: StageKey;
  currency?: Currency;
  fees?: { signedOffCents: number; requestedCents: number; notYetRequestedCents: number };
  retentionHeldCents?: number;
}

function totalsByCurrency(
  projects: readonly OverviewProject[],
): { currency: Currency; signedOff: number; requested: number; notYet: number; retention: number }[] {
  const currencies: Currency[] = ['HKD', 'SGD'];
  return currencies
    .map((currency) => {
      const matching = projects.filter((project) => project.currency === currency);
      return {
        currency,
        signedOff: matching.reduce((total, project) => total + (project.fees?.signedOffCents ?? 0), 0),
        requested: matching.reduce((total, project) => total + (project.fees?.requestedCents ?? 0), 0),
        notYet: matching.reduce(
          (total, project) => total + (project.fees?.notYetRequestedCents ?? 0),
          0,
        ),
        retention: matching.reduce(
          (total, project) => total + (project.retentionHeldCents ?? 0),
          0,
        ),
      };
    })
    .filter((row) => projects.some((project) => project.currency === row.currency));
}

export function Rollouts(): JSX.Element {
  const { member } = useWorkspace();
  const { data } = useResource<{ projects: OverviewProject[] }>('/api/overview');
  setPageTitle('Rollouts · Marrow Hall Interiors');

  const projects = data?.projects ?? [];
  const studio = member ? isStudioRole(member.role) : false;
  const firstSection = member ? (visibleSections(member.role)[0] ?? 'stages') : 'stages';

  return (
    <>
      <section className="panel">
        <h1>Rollouts</h1>
        <p className="meta">
          {`${projects.length} ${projects.length === 1 ? 'rollout' : 'rollouts'} you can open.`}
        </p>
        <TableRegion label="Rollouts table">
          <table>
            <caption>Rollouts</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Name</th>
                <th scope="col">Brand</th>
                <th scope="col">Region</th>
                <th scope="col">Current stage</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <th scope="row">
                    <Link to={`/office/projects/${project.id}/${firstSection}`}>
                      {project.reference}
                    </Link>
                  </th>
                  <td>{project.name}</td>
                  <td>{project.brand.name}</td>
                  <td>{REGION_LABELS[project.region]}</td>
                  <td>{STAGE_NAMES[project.currentStage]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </section>

      {studio ? (
        <section className="panel">
          <h2>Fee and retention position</h2>
          <p className="meta">Each currency is shown on its own row and never added together.</p>
          <TableRegion label="Fee and retention position table">
            <table>
              <caption>Fee position</caption>
              <thead>
                <tr>
                  <th scope="col">Currency</th>
                  <th scope="col" className="numeric">
                    Signed off
                  </th>
                  <th scope="col" className="numeric">
                    Requested
                  </th>
                  <th scope="col" className="numeric">
                    Not yet requested
                  </th>
                  <th scope="col" className="numeric">
                    Retention held
                  </th>
                </tr>
              </thead>
              <tbody>
                {totalsByCurrency(projects).map((row) => (
                  <tr key={row.currency}>
                    <th scope="row">{row.currency}</th>
                    <td className="numeric">{formatAmount(row.signedOff, row.currency)}</td>
                    <td className="numeric">{formatAmount(row.requested, row.currency)}</td>
                    <td className="numeric">{formatAmount(row.notYet, row.currency)}</td>
                    <td className="numeric">{formatAmount(row.retention, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        </section>
      ) : null}
    </>
  );
}
