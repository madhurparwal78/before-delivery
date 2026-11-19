import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../../api/client.ts';
import type { WorkbookDetail } from '../../api/types.ts';
import { useLoad } from '../../api/use-load.ts';
import type { Dashboard, DashboardAction, Filter, SheetShape } from '../../../shared/model.ts';
import { placeObjects } from '../../../shared/layout.ts';
import { MarkDetails } from '../../chart/index.ts';
import type { MarkInfo } from '../../chart/index.ts';
import type { Params } from '../../router.ts';
import { Controls } from '../../shell/controls.tsx';
import { useDepthField } from '../../shell/depth-field.ts';
import { ErrorPage } from '../../shell/error-page.tsx';
import { ExportControls } from '../../shell/export-controls.tsx';
import { ExtractState } from '../../shell/extract-state.tsx';
import { FiltersSheet } from '../../shell/filters-sheet.tsx';
import { useSession } from '../../shell/session.tsx';
import { Button } from '../../ui/button.tsx';
import { Status, useAnnouncer } from '../../ui/live.tsx';
import { usePhone } from '../../ui/phone.ts';
import { ActionDialog } from './action-dialog.tsx';
import { ObjectsList } from './objects-list.tsx';
import type { ObjectRef } from './objects-list.tsx';
import { SheetRegion } from './sheet-region.tsx';
import type { Highlight } from './selection.ts';
import { Stage } from './stage.tsx';
import { useBoard } from './use-board.ts';
import { useRegionCycle } from './use-region-cycle.ts';
import './dashboard.css';

interface Sheet extends ObjectRef {
  shape: SheetShape;
}

interface Loaded {
  dashboard: Dashboard;
  workbook: WorkbookDetail;
  sheets: Sheet[];
}

const NO_FILTERS: Filter[] = [];
const NO_HIGHLIGHTS: Highlight[] = [];
const PHONE_HEIGHT = 320;
/** What a phone region spends on its padding and its header row, the rest of its height is the chart's. */
const PHONE_CHROME = 80;

async function loadDashboard(id: string): Promise<Loaded> {
  const dashboard = await api.get<Dashboard>(`/api/dashboards/${id}`);
  const [workbook, sheets] = await Promise.all([
    api.get<WorkbookDetail>(`/api/workbooks/${dashboard.workbook}`),
    Promise.all(
      dashboard.objects.map(async (object) => ({
        sheet: object.sheet,
        name: object.name,
        shape: await api.get<SheetShape>(`/api/sheets/${object.sheet}`),
      })),
    ),
  ]);
  return { dashboard, workbook, sheets };
}

function Board({ loaded }: { loaded: Loaded }) {
  const { workbook, sheets } = loaded;
  const { me } = useSession();
  const phone = usePhone();
  const [dashboard, setDashboard] = useState(loaded.dashboard);
  const [version, setVersion] = useState(workbook.version);
  const [announcement, announce] = useAnnouncer();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [tapped, setTapped] = useState<MarkInfo | null>(null);
  const [adding, setAdding] = useState(false);
  const board = useBoard(dashboard, workbook.parameters, announce);
  useRegionCycle();

  const creator = me?.projects.some((project) => project.id === workbook.project && project.role === 'creator') ?? false;
  const sheetOf = (id: string) => sheets.find((sheet) => sheet.sheet === id);
  const listed = phone ? dashboard.phone_order.flatMap((id) => sheetOf(id) ?? []) : sheets;
  const placedAll = placeObjects(dashboard.layout, dashboard.floating);

  const toggle = (object: ObjectRef) => {
    const next = new Set(hidden);
    const shown = next.delete(object.sheet);
    if (!shown) next.add(object.sheet);
    setHidden(next);
    announce(`${object.name} ${shown ? 'shown' : 'hidden'}.`);
  };

  const region = (sheet: Sheet, box: { x: number; y: number; w: number; h: number }, style: CSSProperties, fixedHeight?: number) => (
    <SheetRegion
      key={sheet.sheet}
      id={sheet.sheet}
      name={sheet.name}
      shape={sheet.shape}
      view={board.views[sheet.sheet] ?? { result: null, busy: false, notice: '' }}
      highlights={board.selection?.highlights[sheet.sheet] ?? NO_HIGHLIGHTS}
      box={box}
      fixedHeight={fixedHeight}
      style={style}
      phone={phone}
      onSelect={board.select}
      onTap={setTapped}
    />
  );

  const dimensionsOf = (id: string) =>
    board.views[id]?.result?.columns.filter((column) => column.role === 'dimension').map((column) => column.name) ?? [];

  const saved = (next: Dashboard, action: DashboardAction) => {
    setDashboard({ ...dashboard, actions: next.actions });
    setVersion(next.version ?? version + 1);
    setAdding(false);
    announce(`Saved ${action.name}.`);
  };

  return (
    <div className="board">
      <div className="board-head">
        <h1>{dashboard.name}</h1>
        <Status name="View announcements" text={announcement} />
      </div>
      <div className="board-tools">
        <ObjectsList objects={listed} hidden={hidden} onToggle={toggle} />
        <div className="board-controls" data-f6={phone ? undefined : ''}>
          <FiltersSheet>
            <Controls parameters={workbook.parameters} values={board.parameters} onApply={board.setParameter} />
          </FiltersSheet>
        </div>
        <section className="board-card">
          <h2 className="board-card-title">Action log</h2>
          <div role="log" aria-label="Action log" aria-live="polite" className="board-log">
            {board.selection?.log.map((line) => <p key={line}>{line}</p>)}
          </div>
          {creator ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add action
            </Button>
          ) : null}
        </section>
        <section className="board-card board-exports">
          <ExtractState source={workbook.source} />
          <ExportControls target={{ dashboard: dashboard.id }} filters={NO_FILTERS} parameters={board.parameters} />
        </section>
      </div>
      {phone ? (
        <div className="board-phone">
          {listed
            .filter((sheet) => !hidden.has(sheet.sheet))
            .map((sheet) => {
              const placed = placedAll.find((object) => object.sheet === sheet.sheet);
              const height = dashboard.phone_heights[sheet.sheet] ?? PHONE_HEIGHT;
              return region(sheet, { x: placed?.x ?? 0, y: placed?.y ?? 0, w: placed?.w ?? 0, h: placed?.h ?? 0 }, { minHeight: height }, height - PHONE_CHROME);
            })}
        </div>
      ) : (
        <Stage>
          {placeObjects(dashboard.layout, dashboard.floating, hidden).map((object) => {
            const sheet = sheetOf(object.sheet);
            return sheet
              ? region(sheet, object, { left: object.x, top: object.y, width: object.w, height: object.h })
              : null;
          })}
        </Stage>
      )}
      <MarkDetails mark={tapped} onClose={() => setTapped(null)} />
      {adding ? (
        <ActionDialog
          dashboard={dashboard}
          sheets={sheets}
          parameters={workbook.parameters}
          sets={workbook.sets}
          dimensions={dimensionsOf}
          version={version}
          onSaved={saved}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

export function DashboardPage({ params }: { params: Params }) {
  useDepthField('dashboard');
  const loaded = useLoad(() => loadDashboard(params.id ?? ''), [params.id]);
  if (loaded.error) return <ErrorPage error={loaded.error} />;
  if (!loaded.data) return null;
  return <Board loaded={loaded.data} />;
}
