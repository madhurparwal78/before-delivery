import {
  PANEL_SHEET_CODES,
  PROJECT_SECTION_LABELS,
  REGION_LABELS,
  visibleSections,
  type Currency,
  type ProjectSection,
  type Region,
  type TimeZoneName,
} from '../../shared/domain.js';
import { focusWhenReady } from '../lib/focus.js';
import { setPageTitle, useRouter } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { NotFound } from './NotFound.jsx';
import { StagesPanel } from './panels/StagesPanel.jsx';
import { DrawingsPanel } from './panels/DrawingsPanel.jsx';
import { TendersPanel } from './panels/TendersPanel.jsx';
import { VariationsPanel } from './panels/VariationsPanel.jsx';
import { CertificatesPanel } from './panels/CertificatesPanel.jsx';
import { ShopDrawingsPanel } from './panels/ShopDrawingsPanel.jsx';
import { SiteWalkPanel } from './panels/SiteWalkPanel.jsx';
import { FinishesPanel } from './panels/FinishesPanel.jsx';

export interface ProjectStore {
  code: string;
  name: string;
  weight: number;
}

export interface ProjectRecord {
  id: string;
  reference: string;
  name: string;
  brand: { id: string; name: string };
  region: Region;
  currency: Currency;
  timeZone: TimeZoneName;
  stores: ProjectStore[];
  defectsPeriodMonths: number;
  practicalCompletionOn: string | null;
  defectsEndOn: string | null;
  contract: { companyName: string; contractSumCents: number } | null;
}

export interface Transmittal {
  id: string;
  number: string;
  purpose: string;
  issuedAt: string;
  issuedBy: string | null;
  sheets: { code: string; revision: string; bytes: number; sha256: string }[];
  zipBytes: number;
  zipSha256: string;
}

export interface PanelProps {
  project: ProjectRecord;
  transmittals: Transmittal[];
  revision: string;
  sheetCode: string;
  panelName: string;
  reloadTransmittals: () => void;
  restoreForm: string | null;
}

export function ProjectPage({
  projectId,
  section,
  restoreForm,
}: {
  projectId: string;
  section: ProjectSection;
  restoreForm: string | null;
}): JSX.Element {
  const { member } = useWorkspace();
  const { navigate } = useRouter();
  const project = useResource<{ project: ProjectRecord }>(
    `/api/projects/${projectId}`,
    [projectId],
  );
  const transmittals = useResource<{ transmittals: Transmittal[] }>(
    `/api/projects/${projectId}/transmittals`,
    [projectId],
  );

  if (project.error) return <NotFound />;
  const record = project.data?.project;
  const sections = member ? visibleSections(member.role) : [];

  if (record) setPageTitle(`${record.reference} ${record.name} · Marrow Hall Interiors`);
  if (record && !sections.includes(section)) return <NotFound />;

  const issued = transmittals.data?.transmittals ?? [];
  const revision = issued.length > 0 ? (issued[issued.length - 1]?.number ?? 'T-000') : 'T-000';

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const index = sections.indexOf(section);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    const target = sections[Math.max(0, Math.min(next, sections.length - 1))];
    if (target && target !== section) {
      navigate(`/office/projects/${projectId}/${target}`);
      focusWhenReady('[role="tablist"] [aria-selected="true"]');
    }
  };

  const panelProps: PanelProps | null = record
    ? {
        project: record,
        transmittals: issued,
        revision,
        sheetCode: PANEL_SHEET_CODES[section],
        panelName: PROJECT_SECTION_LABELS[section],
        reloadTransmittals: transmittals.reload,
        restoreForm,
      }
    : null;

  return (
    <>
      <section className="panel">
        <h1>{record ? `${record.reference} ${record.name}` : 'Project'}</h1>
        {record ? (
          <p className="meta">
            {`${record.brand.name} · ${REGION_LABELS[record.region]} · ${record.currency}${
              record.contract
                ? ` · Contract held by ${record.contract.companyName}`
                : ' · No contract yet'
            }`}
          </p>
        ) : null}
      </section>

      <div
        className="tabstrip"
        role="tablist"
        aria-label="Project sections"
        onKeyDown={onTabKeyDown}
      >
        {sections.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === section}
            tabIndex={key === section ? 0 : -1}
            onClick={() => navigate(`/office/projects/${projectId}/${key}`)}
          >
            {PROJECT_SECTION_LABELS[key]}
          </button>
        ))}
      </div>

      {panelProps ? <Panel section={section} props={panelProps} /> : null}
    </>
  );
}

function Panel({
  section,
  props,
}: {
  section: ProjectSection;
  props: PanelProps;
}): JSX.Element {
  switch (section) {
    case 'stages':
      return <StagesPanel {...props} />;
    case 'drawings':
      return <DrawingsPanel {...props} />;
    case 'tenders':
      return <TendersPanel {...props} />;
    case 'variations':
      return <VariationsPanel {...props} />;
    case 'certificates':
      return <CertificatesPanel {...props} />;
    case 'shop-drawings':
      return <ShopDrawingsPanel {...props} />;
    case 'site-walk':
      return <SiteWalkPanel {...props} />;
    case 'finishes':
      return <FinishesPanel {...props} />;
  }
}
