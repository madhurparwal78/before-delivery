import { useRef, useState } from 'react';
import { api, ApiError, generalErrorCopy } from '../../api/client.ts';
import type { WorkbookDetail } from '../../api/types.ts';
import { act } from '../../api/use-load.ts';
import type { ParameterValue } from '../../../shared/model.ts';
import { navigate } from '../../router.ts';
import { Controls, parameterCopy } from '../../shell/controls.tsx';
import { useDepthField } from '../../shell/depth-field.ts';
import { ExportControls } from '../../shell/export-controls.tsx';
import { ExtractState } from '../../shell/extract-state.tsx';
import { FiltersSheet } from '../../shell/filters-sheet.tsx';
import { Button } from '../../ui/button.tsx';
import { Status } from '../../ui/live.tsx';
import { viewMeasures } from './model.ts';
import { useRegionKeys } from './regions.ts';
import { shapeOf } from './sheet-data.ts';
import type { SheetRecord } from './sheet-data.ts';
import { AlertDialog } from './tools/index.ts';
import { useAnnouncements } from './use-announcements.ts';
import { useSheetView } from './use-sheet-view.ts';
import type { FirstQuery } from './use-sheet-view.ts';
import { ViewPanel } from './view-panel.tsx';

interface PublishedProps {
  record: SheetRecord;
  workbook: WorkbookDetail;
  /** explorers may copy a sheet they cannot edit */
  canCopy: boolean;
  first: FirstQuery;
}

/**
 * The published view on the plum field: Controls (parameters, alerts, exports), View and Data table in two columns
 * from 768, one column below with Controls behind `button "Filters"`.
 */
export function PublishedSheet({ record, workbook, canCopy, first }: PublishedProps) {
  useDepthField('plum');
  const root = useRef<HTMLDivElement>(null);
  useRegionKeys(root);
  const view = useSheetView(record.id, shapeOf(record), record.version, first);
  const [announcement, announce] = useAnnouncements();
  const [values, setValues] = useState<Record<string, ParameterValue>>({});
  const [alertOpen, setAlertOpen] = useState(false);
  const [copyError, setCopyError] = useState('');

  const apply = (name: string, value: ParameterValue) => {
    const next = { ...values, [name]: value };
    setValues(next);
    announce(parameterCopy(name, value));
    void view.refresh(next);
  };

  const copy = () =>
    act(
      async () => {
        const made = await api.post<{ id: string }>(`/api/sheets/${record.id}/copy`);
        navigate(`/workbooks/${workbook.id}/sheets/${made.id}`);
      },
      (error: ApiError) => setCopyError(generalErrorCopy(error) ?? 'Something went wrong. Try again.'),
    );

  return (
    <div className="sheet-page">
      <header className="sheet-head">
        <h1 className="sheet-name">{view.shape.name}</h1>
        <ExtractState source={workbook.source} />
        {canCopy ? (
          <Button variant="primary" onClick={() => void copy()}>
            Copy sheet
          </Button>
        ) : null}
        <Status name="Copy state" text={copyError} banner />
      </header>
      <div className="sheet-published" ref={root}>
        <div className="published-side">
          <FiltersSheet>
            <div data-region="Controls">
              <Controls parameters={workbook.parameters} values={values} onApply={apply}>
                <Button onClick={() => setAlertOpen(true)}>New alert</Button>
              </Controls>
            </div>
          </FiltersSheet>
        </div>
        <div className="sheet-stage">
          <ViewPanel name={view.shape.name} view={view} announcement={announcement} />
        </div>
        <section className="sheet-card export-card" aria-label="Exports">
          <h2 className="panel-title">Export</h2>
          <ExportControls target={{ sheet: record.id }} filters={[]} parameters={values} />
        </section>
      </div>
      {alertOpen ? (
        <AlertDialog
          sheetId={record.id}
          measures={viewMeasures(view.shape)}
          onSaved={(name) => {
            setAlertOpen(false);
            announce(`Saved ${name}.`);
          }}
          onClose={() => setAlertOpen(false)}
        />
      ) : null}
    </div>
  );
}
