import { api, ApiError } from '../../api/client.ts';
import type { Me, WorkbookDetail } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import type { CalculationDef, Extract, QueryResult, Source } from '../../../shared/model.ts';
import type { Params } from '../../router.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { seedExtract } from '../../shell/events.ts';
import { useSession } from '../../shell/session.tsx';
import { SheetEditor } from './editor.tsx';
import type { FieldEntry } from './model.ts';
import { PublishedSheet } from './published.tsx';
import { calculationEntry } from './sheet-data.ts';
import type { SheetRecord } from './sheet-data.ts';
import type { FirstQuery } from './use-sheet-view.ts';
import './sheet.css';

type Loaded = { first: FirstQuery } & (
  | { mode: 'edit'; record: SheetRecord; workbook: WorkbookDetail; source: Source; calculations: { calculation: CalculationDef; entry: FieldEntry }[] }
  | { mode: 'view'; record: SheetRecord; workbook: WorkbookDetail; canCopy: boolean }
);

/** The view's gen-1 query, asked before the page paints; a refusal leaves it to the view, which shows its notice. */
async function firstQuery(sheetId: string): Promise<FirstQuery> {
  try {
    return { result: await api.post<QueryResult>(`/api/sheets/${sheetId}/query?gen=1`, { filters: [], parameters: {}, sets: {} }) };
  } catch (caught) {
    if (!(caught instanceof ApiError)) throw caught;
    return { result: null };
  }
}

/** The source's extract state, so `status "Extract state"` is filled on first paint rather than when the stream catches up. */
async function seedExtractState(source: string): Promise<void> {
  try {
    const { rows: _rows, ...info } = await api.get<Extract>(`/api/sources/${source}/extract`);
    seedExtract(source, info);
  } catch (caught) {
    if (!(caught instanceof ApiError)) throw caught;
  }
}

/**
 * Who edits what: a creator of the workbook's project edits its sheets; a personal copy (only its owner can open it)
 * is edited by that owner; everyone else gets the published view, and an explorer may copy it.
 */
async function load(me: Me | null, workbookId: string, sheetId: string): Promise<Loaded> {
  const [record, workbook] = await Promise.all([
    api.get<SheetRecord>(`/api/sheets/${sheetId}`),
    api.get<WorkbookDetail>(`/api/workbooks/${workbookId}`),
  ]);
  const role = me?.projects.find((project) => project.id === workbook.project)?.role ?? 'viewer';
  const early = Promise.all([firstQuery(record.id), seedExtractState(workbook.source)]);
  if (!record.copy && role !== 'creator') {
    const [first] = await early;
    return { mode: 'view', record, workbook, canCopy: role === 'explorer', first };
  }
  const [source, calculations, [first]] = await Promise.all([
    api.get<Source>(`/api/sources/${workbook.source}`),
    Promise.all(record.calculations.map(async (calculation) => ({ calculation, entry: await calculationEntry(record.id, calculation) }))),
    early,
  ]);
  return { mode: 'edit', record, workbook, source, calculations, first };
}

/** `/workbooks/<id>/sheets/<sheet id>`: the sheet editor, or the published view for anyone who may not edit it. */
export function SheetPage({ params }: { params: Params }) {
  const { me } = useSession();
  const workbookId = params.id ?? '';
  const sheetId = params.sheet ?? '';
  const loaded = useLoad(() => load(me, workbookId, sheetId), [workbookId, sheetId]);
  if (loaded.error) return <ErrorPage error={loaded.error} />;
  const page = loaded.data;
  if (!page) return null;
  return page.mode === 'edit' ? (
    <SheetEditor
      key={page.record.id}
      record={page.record}
      workbook={page.workbook}
      source={page.source}
      calculations={page.calculations}
      first={page.first}
    />
  ) : (
    <PublishedSheet key={page.record.id} record={page.record} workbook={page.workbook} canCopy={page.canCopy} first={page.first} />
  );
}
