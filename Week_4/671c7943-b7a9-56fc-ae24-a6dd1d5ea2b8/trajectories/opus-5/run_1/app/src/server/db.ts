import pg from 'pg';
import { config } from './config.js';
import { startingContent } from '../content/seed.js';
import type {
  BudgetId,
  Content,
  MailOutcome,
  Project,
  ProjectTypeId,
  Statistic,
  StoredEnquiry,
} from '../shared/types.js';
import type { EnquiryValues } from '../shared/validation.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

const SCHEMA = `
create table if not exists content_state (
  only_row boolean primary key default true check (only_row),
  edition integer not null
);
create table if not exists projects (
  position integer primary key,
  slug text not null unique,
  title text not null,
  client text not null,
  category text not null,
  year integer not null,
  hue integer not null,
  motif text not null,
  role text not null,
  duration text not null,
  standfirst text not null,
  overview text not null,
  objectives jsonb not null,
  palette jsonb not null,
  screens jsonb not null,
  process jsonb not null,
  results jsonb not null
);
create table if not exists statistics (
  position integer primary key,
  statistic_id text not null unique,
  value integer not null,
  label text not null,
  note text not null,
  parts jsonb not null
);
create table if not exists enquiries (
  id bigserial primary key,
  reference text not null unique,
  submission_id uuid not null unique,
  brief_token text not null unique,
  name text not null,
  email text not null,
  project_type text not null,
  budget text not null,
  description text not null,
  mail text not null,
  stored_at timestamptz not null default now()
);
create sequence if not exists enquiry_reference_seq;
`;

const PROJECT_COLUMNS =
  'slug, title, client, category, year, hue, motif, role, duration, standfirst, overview, objectives, palette, screens, process, results';

interface ProjectRow {
  slug: string;
  title: string;
  client: string;
  category: Project['category'];
  year: number;
  hue: number;
  motif: Project['motif'];
  role: string;
  duration: string;
  standfirst: string;
  overview: string;
  objectives: string[];
  palette: Project['palette'];
  screens: Project['screens'];
  process: number[];
  results: Project['results'];
}

interface StatisticRow {
  statistic_id: string;
  value: number;
  label: string;
  note: string;
  parts: Statistic['parts'];
}

export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(
    'insert into content_state (only_row, edition) values (true, 1) on conflict do nothing',
  );
  const { rows } = await pool.query<{ count: string }>('select count(*)::text from projects');
  if (rows[0]!.count === '0') {
    await writeContent(startingContent(), 1);
  }
}

async function writeContent(content: Content, edition: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from projects');
    await client.query('delete from statistics');
    for (const [index, project] of content.projects.entries()) {
      await client.query(
        `insert into projects (position, ${PROJECT_COLUMNS})
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          index,
          project.slug,
          project.title,
          project.client,
          project.category,
          project.year,
          project.hue,
          project.motif,
          project.role,
          project.duration,
          project.standfirst,
          project.overview,
          JSON.stringify(project.objectives),
          JSON.stringify(project.palette),
          JSON.stringify(project.screens),
          JSON.stringify(project.process),
          JSON.stringify(project.results),
        ],
      );
    }
    for (const [index, statistic] of content.stats.entries()) {
      await client.query(
        `insert into statistics (position, statistic_id, value, label, note, parts)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          index,
          statistic.id,
          statistic.value,
          statistic.label,
          statistic.note,
          JSON.stringify(statistic.parts),
        ],
      );
    }
    await client.query('update content_state set edition = $1 where only_row', [edition]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadContent(): Promise<Content> {
  const [projects, stats] = await Promise.all([
    pool.query<ProjectRow>(`select ${PROJECT_COLUMNS} from projects order by position`),
    pool.query<StatisticRow>(
      'select statistic_id, value, label, note, parts from statistics order by position',
    ),
  ]);
  return {
    projects: projects.rows.map((row) => ({ ...row })),
    stats: stats.rows.map((row) => ({
      id: row.statistic_id,
      value: row.value,
      label: row.label,
      note: row.note,
      parts: row.parts,
    })),
  };
}

export async function replaceContent(content: Content): Promise<number> {
  const { rows } = await pool.query<{ edition: number }>(
    'select edition from content_state where only_row',
  );
  const edition = rows[0]!.edition + 1;
  await writeContent(content, edition);
  return edition;
}

export async function restoreStartingContent(): Promise<number> {
  await writeContent(startingContent(), 1);
  await pool.query('delete from enquiries');
  await pool.query('alter sequence enquiry_reference_seq restart with 1');
  return 1;
}

interface EnquiryRow {
  reference: string;
  name: string;
  email: string;
  project_type: ProjectTypeId;
  budget: BudgetId;
  description: string;
  mail: MailOutcome;
  brief_token: string;
}

const toEnquiry = (row: EnquiryRow): StoredEnquiry => ({
  reference: row.reference,
  name: row.name,
  email: row.email,
  projectType: row.project_type,
  budget: row.budget,
  description: row.description,
  mail: row.mail,
  briefToken: row.brief_token,
});

const ENQUIRY_COLUMNS =
  'reference, name, email, project_type, budget, description, mail, brief_token';

export async function storeEnquiry(
  submissionId: string,
  briefToken: string,
  values: EnquiryValues,
): Promise<StoredEnquiry> {
  const { rows } = await pool.query<EnquiryRow>(
    `insert into enquiries
       (reference, submission_id, brief_token, name, email, project_type, budget, description, mail)
     values
       ('SOL-' || lpad(nextval('enquiry_reference_seq')::text, 4, '0'),
        $1, $2, $3, $4, $5, $6, $7, 'not_sent')
     returning ${ENQUIRY_COLUMNS}`,
    [
      submissionId,
      briefToken,
      values.name,
      values.email,
      values.projectType,
      values.budget,
      values.description,
    ],
  );
  return toEnquiry(rows[0]!);
}

export async function markMailSent(submissionId: string): Promise<void> {
  await pool.query("update enquiries set mail = 'sent' where submission_id = $1", [submissionId]);
}

export async function findEnquiryBySubmission(
  submissionId: string,
): Promise<StoredEnquiry | null> {
  const { rows } = await pool.query<EnquiryRow>(
    `select ${ENQUIRY_COLUMNS} from enquiries where submission_id = $1`,
    [submissionId],
  );
  const row = rows[0];
  return row ? toEnquiry(row) : null;
}

export async function findEnquiryByToken(token: string): Promise<StoredEnquiry | null> {
  const { rows } = await pool.query<EnquiryRow>(
    `select ${ENQUIRY_COLUMNS} from enquiries where brief_token = $1`,
    [token],
  );
  const row = rows[0];
  return row ? toEnquiry(row) : null;
}

export async function listEnquiries(): Promise<StoredEnquiry[]> {
  const { rows } = await pool.query<EnquiryRow>(
    `select ${ENQUIRY_COLUMNS} from enquiries order by id`,
  );
  return rows.map(toEnquiry);
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
