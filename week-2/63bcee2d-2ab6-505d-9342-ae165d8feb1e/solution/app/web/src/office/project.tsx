import { createContext, useContext, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Currency, TimeZone } from "../../../shared/format";
import { navigate } from "../router";
import { NOT_FOUND } from "./copy";
import { useOffice, type Role, STUDIO_ROLES } from "./context";
import { TitleBlock } from "./layout";
import { CertificatesPanel } from "./panels/certificates";
import { DrawingsPanel } from "./panels/drawings";
import { FinishesPanel } from "./panels/finishes";
import { ShopDrawingsPanel } from "./panels/shopdrawings";
import { SiteWalkPanel } from "./panels/sitewalk";
import { StagesPanel } from "./panels/stages";
import { TendersPanel } from "./panels/tenders";
import { VariationsPanel } from "./panels/variations";
import { useResource } from "./resource";
import { OfficeShell } from "./shell";

// The project page: a tab per section the member's role can see, each panel opening with its title block.

export interface Project {
  id: string;
  reference: string;
  name: string;
  brand: { id: string; name: string };
  region: "HK" | "SG" | "MO";
  currency: Currency;
  timeZone: TimeZone;
  stores: { code: string; name: string; weight: number }[];
  defectsPeriodMonths: number;
  practicalCompletionOn: string | null;
  defectsEndOn: string | null;
  contract: { companyName: string; contractSumCents: number } | null;
}

interface ProjectView {
  project: Project;
  reloadProject: () => Promise<unknown>;
  /** The newest transmittal number, or T-000 before the first issue. */
  revision: string;
  reloadRevision: () => Promise<unknown>;
}

const ProjectContext = createContext<ProjectView | null>(null);

export function useProject(): ProjectView {
  const view = useContext(ProjectContext);
  if (!view) throw new Error("useProject outside ProjectPage");
  return view;
}

const CLIENT: Role[] = ["client_approver"];
const CONTRACTOR: Role[] = ["contractor"];

export const SECTIONS: { key: string; label: string; code: string; roles: Role[]; panel: () => ReactNode }[] = [
  { key: "stages", label: "Stages", code: "PL-01", roles: [...STUDIO_ROLES, ...CLIENT], panel: () => <StagesPanel /> },
  { key: "drawings", label: "Drawings", code: "PL-02", roles: [...STUDIO_ROLES, ...CLIENT, ...CONTRACTOR], panel: () => <DrawingsPanel /> },
  { key: "tenders", label: "Tenders", code: "PL-03", roles: [...STUDIO_ROLES, ...CLIENT, ...CONTRACTOR], panel: () => <TendersPanel /> },
  { key: "variations", label: "Variations", code: "PL-04", roles: [...STUDIO_ROLES, ...CONTRACTOR], panel: () => <VariationsPanel /> },
  { key: "certificates", label: "Certificates", code: "PL-05", roles: [...STUDIO_ROLES, ...CLIENT, ...CONTRACTOR], panel: () => <CertificatesPanel /> },
  { key: "shop-drawings", label: "Shop drawings", code: "PL-06", roles: [...STUDIO_ROLES, ...CONTRACTOR], panel: () => <ShopDrawingsPanel /> },
  { key: "site-walk", label: "Site walk", code: "PL-07", roles: [...STUDIO_ROLES, ...CONTRACTOR], panel: () => <SiteWalkPanel /> },
  { key: "finishes", label: "Finishes", code: "PL-08", roles: STUDIO_ROLES, panel: () => <FinishesPanel /> },
];

/** The sections a role sees, in tab order. */
export const sectionsFor = (role: Role) => SECTIONS.filter((section) => section.roles.includes(role));

/** The panel's title block for its section. */
export function PanelTitle({ section }: { section: string }) {
  const { revision } = useProject();
  const found = SECTIONS.find((item) => item.key === section);
  return found ? <TitleBlock code={found.code} name={found.label} revision={revision} /> : null;
}

export function ProjectPage({ id, section }: { id: string; section: string }) {
  const office = useOffice();
  const project = useResource<{ project: Project }>(office.member ? `/api/projects/${id}` : null);
  const canSeeSheets = office.member ? office.member.role !== "contractor" || !!project.data?.project.contract : false;
  const transmittals = useResource<{ transmittals: { number: string }[] }>(office.member && project.data && canSeeSheets
    ? `/api/projects/${id}/transmittals` : null);
  const tabs = office.member ? sectionsFor(office.member.role) : [];
  const active = tabs.find((tab) => tab.key === section);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const list = transmittals.data?.transmittals ?? [];
  const revision = list.length ? list.map((t) => t.number).sort().at(-1) ?? "T-000" : "T-000";

  // The tab strip scrolls inside itself on phones; keep the selected tab in view.
  useEffect(() => {
    const index = tabs.findIndex((tab) => tab.key === section);
    const tab = tabRefs.current[index];
    const strip = tab?.parentElement;
    if (!tab || !strip) return;
    if (tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth || tab.offsetLeft < strip.scrollLeft) {
      strip.scrollLeft = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    }
  }, [section, tabs, project.data]);

  useEffect(() => {
    if (project.data) document.title = `${project.data.project.reference} ${active?.label ?? ""} · Plumbline`;
  }, [project.data, active]);

  const go = (key: string): void => navigate(`/office/projects/${id}/${key}`);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const to = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    event.preventDefault();
    tabRefs.current[to]?.focus();
    go(tabs[to].key);
  };

  let body: ReactNode;
  if (project.failure || (office.member && !active)) {
    body = <section className="panel panel-body"><h1>Not found</h1><p>{NOT_FOUND}</p></section>;
  } else if (!project.data || !active) {
    body = <p className="loading-line">Loading project…</p>;
  } else {
    const view: ProjectView = { project: project.data.project, reloadProject: project.reload, revision, reloadRevision: transmittals.reload };
    body = (
      <ProjectContext.Provider value={view}>
        <div className="page-head">
          <div>
            <p className="eyebrow">{view.project.reference} · {view.project.brand.name} · {view.project.region}</p>
            <h1>{view.project.name}</h1>
          </div>
        </div>
        <div className="project-tabs" role="tablist" aria-label="Project sections">
          {tabs.map((tab, index) => (
            <button key={tab.key} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab"
              id={`tab-${tab.key}`} aria-controls={`panel-${tab.key}`} aria-selected={tab.key === section}
              tabIndex={tab.key === section ? 0 : -1} onClick={() => go(tab.key)} onKeyDown={(event) => onKey(event, index)}>
              {tab.label}
            </button>
          ))}
        </div>
        <section className="panel project-panel" role="tabpanel" id={`panel-${active.key}`} aria-labelledby={`tab-${active.key}`}>
          {active.panel()}
        </section>
      </ProjectContext.Provider>
    );
  }
  return <OfficeShell title="Project">{body}</OfficeShell>;
}
