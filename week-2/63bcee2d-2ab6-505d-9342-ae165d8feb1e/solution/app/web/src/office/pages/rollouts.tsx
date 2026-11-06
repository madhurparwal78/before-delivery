import { formatAmount, type Currency } from "../../../../shared/format";
import { linkClick } from "../../router";
import { isStudio, useOffice } from "../context";
import { TableRegion } from "../layout";
import { sectionsFor } from "../project";
import { useResource } from "../resource";
import { OfficeShell } from "../shell";
import "./rollouts.css";

interface OverviewProject {
  id: string;
  reference: string;
  name: string;
  brand: { id: string; name: string };
  region: "HK" | "SG" | "MO";
  currentStage: string;
  currentStageName: string;
  currency?: Currency;
  fees?: { signedOffCents: number; requestedCents: number; notYetRequestedCents: number };
  retentionHeldCents?: number;
}

const REGIONS: Record<string, string> = { HK: "Hong Kong", SG: "Singapore", MO: "Macao" };
const CURRENCIES: Currency[] = ["HKD", "SGD"];

export function RolloutsPage() {
  const office = useOffice();
  const overview = useResource<{ projects: OverviewProject[] }>(office.member ? "/api/overview" : null);
  const studio = isStudio(office.member);
  const projects = overview.data?.projects ?? [];
  const firstTab = office.member ? sectionsFor(office.member.role)[0]?.key ?? "drawings" : "drawings";

  const total = (currency: Currency, pick: (p: OverviewProject) => number): number =>
    projects.filter((p) => p.currency === currency).reduce((sum, p) => sum + pick(p), 0);

  return (
    <OfficeShell title="Rollouts">
      <div className="page-head">
        <div>
          <p className="eyebrow">Marrow Hall Interiors · Delivery</p>
          <h1>Rollouts</h1>
        </div>
        <p className="rollouts-count">{overview.data ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}` : "Loading…"}</p>
      </div>
      <TableRegion label="Rollouts, scrolls sideways">
        <table className="rollouts-table">
          <caption>Every rollout you can see</caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Project</th>
              <th scope="col">Brand</th>
              <th scope="col">Region</th>
              <th scope="col">Current stage</th>
              {studio && (
                <>
                  <th scope="col" className="num">Fees signed off</th>
                  <th scope="col" className="num">Fees requested</th>
                  <th scope="col" className="num">Not yet requested</th>
                  <th scope="col" className="num">Retention held</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td className="reference">{project.reference}</td>
                <td>
                  <a href={`/office/projects/${project.id}/${firstTab}`} onClick={(event) => linkClick(event, `/office/projects/${project.id}/${firstTab}`)}>
                    {project.name}
                  </a>
                </td>
                <td>{project.brand.name}</td>
                <td>{REGIONS[project.region]}</td>
                <td><span className="stage-pill">{project.currentStageName}</span></td>
                {studio && project.currency && project.fees && (
                  <>
                    <td className="num">{formatAmount(project.currency, project.fees.signedOffCents)}</td>
                    <td className="num">{formatAmount(project.currency, project.fees.requestedCents)}</td>
                    <td className="num">{formatAmount(project.currency, project.fees.notYetRequestedCents)}</td>
                    <td className="num">{formatAmount(project.currency, project.retentionHeldCents ?? 0)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {studio && (
            <tfoot>
              {CURRENCIES.map((currency) => (
                <tr key={currency} className="total-row">
                  <th scope="row" colSpan={5}>{currency} total</th>
                  <td className="num">{formatAmount(currency, total(currency, (p) => p.fees?.signedOffCents ?? 0))}</td>
                  <td className="num">{formatAmount(currency, total(currency, (p) => p.fees?.requestedCents ?? 0))}</td>
                  <td className="num">{formatAmount(currency, total(currency, (p) => p.fees?.notYetRequestedCents ?? 0))}</td>
                  <td className="num">{formatAmount(currency, total(currency, (p) => p.retentionHeldCents ?? 0))}</td>
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </TableRegion>
    </OfficeShell>
  );
}
