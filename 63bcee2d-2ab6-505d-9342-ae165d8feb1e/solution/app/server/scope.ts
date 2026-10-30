import { isStudio, type Member } from "./auth.js";
import { one, rows, type Db } from "./db.js";
import { defectsEndOn } from "./domain/calendar.js";
import { notFound } from "./http/errors.js";
import type { Currency, TimeZone } from "../shared/format.js";

// Who sees which project (brief: Scope). Anything outside a caller's scope answers the same 404 as an
// unknown id, at every nesting depth, so every project-scoped lookup goes through `visibleProject`.

export interface Store {
  code: string;
  name: string;
  weight: number;
}

export interface Project {
  id: string;
  number: number;
  reference: string;
  name: string;
  brandId: string;
  brandName: string;
  region: "HK" | "SG" | "MO";
  currency: Currency;
  timeZone: TimeZone;
  defectsPeriodMonths: number;
  practicalCompletionOn: string | null;
  contract: { companyId: string; companyName: string; contractSumCents: number } | null;
  stores: Store[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refuses an id that cannot name any record with the same 404 as an unknown one. */
export function knownId(id: string): string {
  if (!UUID.test(id)) throw notFound();
  return id;
}

interface ProjectRow {
  id: string; number: number; reference: string; name: string; brand_id: string; brand_name: string; region: Project["region"];
  currency: Currency; time_zone: TimeZone; defects_period_months: number; practical_completion_on: string | null;
  company_id: string | null; company_name: string | null; contract_sum_cents: number | null;
}

export async function loadProject(db: Db, id: string, lock = false): Promise<Project | undefined> {
  const row = await one<ProjectRow>(db,
    `SELECT p.id, p.number, p.reference, p.name, p.brand_id, b.name AS brand_name, p.region, p.currency, p.time_zone,
       p.defects_period_months, p.practical_completion_on, k.company_id, c.name AS company_name, k.contract_sum_cents
     FROM projects p JOIN brands b ON b.id = p.brand_id
     LEFT JOIN contracts k ON k.project_id = p.id LEFT JOIN companies c ON c.id = k.company_id
     WHERE p.id = $1 ${lock ? "FOR UPDATE OF p" : ""}`, [knownId(id)]);
  if (!row) return undefined;
  const stores = await rows<Store>(db, "SELECT code, name, weight FROM stores WHERE project_id = $1 ORDER BY position", [id]);
  return {
    id: row.id, number: row.number, reference: row.reference, name: row.name, brandId: row.brand_id, brandName: row.brand_name,
    region: row.region, currency: row.currency, timeZone: row.time_zone, defectsPeriodMonths: row.defects_period_months,
    practicalCompletionOn: row.practical_completion_on, stores,
    contract: row.company_id ? { companyId: row.company_id, companyName: row.company_name ?? "", contractSumCents: Number(row.contract_sum_cents) } : null,
  };
}

/** Whether the member's company holds the project's contract. */
export const holdsContract = (member: Member, project: Project): boolean =>
  member.role === "contractor" && !!project.contract && project.contract.companyId === member.companyId;

export function canSeeProject(member: Member, project: Project): boolean {
  if (isStudio(member)) return true;
  if (member.role === "client_approver") return project.brandId === member.brandId;
  return holdsContract(member, project);
}

/** The project when the member may see it, else 404. `lock` takes the project row FOR UPDATE. */
export async function visibleProject(db: Db, member: Member, id: string, lock = false): Promise<Project> {
  const project = await loadProject(db, id, lock);
  if (!project || !canSeeProject(member, project)) throw notFound();
  return project;
}

export function projectJson(project: Project) {
  return {
    id: project.id, reference: project.reference, name: project.name, brand: { id: project.brandId, name: project.brandName },
    region: project.region, currency: project.currency, timeZone: project.timeZone, stores: project.stores,
    defectsPeriodMonths: project.defectsPeriodMonths, practicalCompletionOn: project.practicalCompletionOn,
    defectsEndOn: defectsEndOn(project.practicalCompletionOn, project.defectsPeriodMonths),
    contract: project.contract ? { companyName: project.contract.companyName, contractSumCents: project.contract.contractSumCents } : null,
  };
}
