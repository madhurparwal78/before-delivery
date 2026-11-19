import { q1 } from '../db.js';
import { SAMPLE_SHEET_ID } from '../access.js';
import { createSampleSource } from './ingest.js';
import type { SheetSpec } from '../../shared/types.js';

const PROJECT_ID = 'sample-project';
const WORKBOOK_ID = 'sample-workbook';
const SOURCE_ID = 'sample-source';

const SAMPLE_SHEET: SheetSpec = {
  name: 'Sales by Region',
  rows: ['Region'],
  columns: [{ field: 'Sales', agg: 'SUM', table_calc: null }],
  color: null,
  size: null,
  label: [],
  detail: [],
  filters: [{ field: 'Region', step: 'source', values: ['East', 'North', 'South', 'West'] }],
  chart: 'automatic',
  totals: false,
  reference_lines: [],
  trend: false,
  sort: {},
};

/** The bundled sample behind the home page's live sheet. It belongs to no member, so no route exposes it. */
export async function ensureSample(): Promise<void> {
  const existing = await q1<{ id: string }>('SELECT id FROM sheets WHERE id = $1', [SAMPLE_SHEET_ID]);
  if (existing !== null) return;
  await q1("INSERT INTO projects (id, name) VALUES ($1, 'Lozenge sample') ON CONFLICT (id) DO NOTHING", [PROJECT_ID]);
  const source = await q1<{ id: string }>('SELECT id FROM sources WHERE id = $1', [SOURCE_ID]);
  if (source === null) await createSampleSource(PROJECT_ID, 'Fernhollow Tea', SOURCE_ID);
  await q1(
    `INSERT INTO workbooks (id, project_id, source_id, name, state) VALUES ($1, $2, $3, 'Fernhollow sample', 'published')
     ON CONFLICT (id) DO NOTHING`,
    [WORKBOOK_ID, PROJECT_ID, SOURCE_ID],
  );
  await q1(
    `INSERT INTO sheets (id, workbook_id, name, spec, version, ord) VALUES ($1, $2, $3, $4, 1, 0)
     ON CONFLICT (id) DO NOTHING`,
    [SAMPLE_SHEET_ID, WORKBOOK_ID, SAMPLE_SHEET.name, JSON.stringify(SAMPLE_SHEET)],
  );
}
