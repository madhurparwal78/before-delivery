import type { Company, CompanyRequest, ContactRef, FeatureStatus } from '../../shared/types';
import type { Queryable } from '../db';

interface CompanyRow {
  id: string;
  name: string;
  domains: string[] | null;
  note_count: string;
}

const COMPANY_SELECT = `SELECT companies.id, companies.name,
    ARRAY(SELECT domain FROM company_domains
            WHERE company_domains.company_id = companies.id ORDER BY domain) AS domains,
    (SELECT COUNT(*) FROM notes
       JOIN contacts ON contacts.id = notes.contact_id
      WHERE contacts.company_id = companies.id) AS note_count
  FROM companies`;

async function loadContacts(db: Queryable, companyIds: readonly string[]): Promise<Map<string, ContactRef[]>> {
  if (companyIds.length === 0) return new Map();
  const { rows } = await db.query<{ company_id: string; id: string; name: string; email: string }>(
    `SELECT company_id, id, name, email FROM contacts
      WHERE company_id = ANY($1::text[]) ORDER BY lower(name), id`,
    [companyIds],
  );
  const byCompany = new Map<string, ContactRef[]>();
  for (const row of rows) {
    const list = byCompany.get(row.company_id) ?? [];
    list.push({ id: row.id, name: row.name, email: row.email });
    byCompany.set(row.company_id, list);
  }
  return byCompany;
}

function toCompany(row: CompanyRow, contacts: ContactRef[]): Company {
  return {
    id: row.id,
    name: row.name,
    domains: row.domains ?? [],
    contacts,
    noteCount: Number(row.note_count),
  };
}

export async function listCompanies(db: Queryable, workspaceId: string): Promise<Company[]> {
  const { rows } = await db.query<CompanyRow>(
    `${COMPANY_SELECT} WHERE companies.workspace_id = $1 ORDER BY lower(companies.name), companies.id`,
    [workspaceId],
  );
  const contacts = await loadContacts(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toCompany(row, contacts.get(row.id) ?? []));
}

export async function findCompany(
  db: Queryable,
  workspaceId: string,
  companyId: string,
): Promise<Company | null> {
  const { rows } = await db.query<CompanyRow>(
    `${COMPANY_SELECT} WHERE companies.workspace_id = $1 AND companies.id = $2`,
    [workspaceId, companyId],
  );
  const row = rows[0];
  if (!row) return null;
  const contacts = await loadContacts(db, [companyId]);
  return toCompany(row, contacts.get(companyId) ?? []);
}

export async function loadCompanyRequests(db: Queryable, companyId: string): Promise<CompanyRequest[]> {
  const { rows } = await db.query<{
    feature_id: string;
    feature_name: string;
    status: FeatureStatus;
    release_name: string | null;
    target_date: string | null;
    release_status: string | null;
  }>(
    `SELECT features.id AS feature_id, features.name AS feature_name, features.status,
            releases.name AS release_name, releases.target_date, releases.status AS release_status
       FROM insights
       JOIN notes ON notes.id = insights.note_id
       JOIN contacts ON contacts.id = notes.contact_id
       JOIN features ON features.id = insights.feature_id
       LEFT JOIN releases ON releases.id = features.release_id
      WHERE contacts.company_id = $1
      GROUP BY features.id, features.name, features.status,
               releases.name, releases.target_date, releases.status
      ORDER BY lower(features.name), features.id`,
    [companyId],
  );
  return rows.map((row) => {
    const shipped = row.release_status === 'shipped';
    return {
      featureId: row.feature_id,
      featureName: row.feature_name,
      status: row.status,
      releaseName: shipped ? row.release_name : null,
      targetMonth: shipped && row.target_date ? row.target_date.slice(0, 7) : null,
      shipped,
    };
  });
}
