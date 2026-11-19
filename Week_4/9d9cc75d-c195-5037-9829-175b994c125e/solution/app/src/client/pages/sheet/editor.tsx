import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { WorkbookDetail } from '../../api/types.ts';
import { isMeasurePill } from '../../../shared/twin.ts';
import type { CalculationDef, Cell, Filter, FilterStep, ReferenceLine, SetDef, SheetShape, Source } from '../../../shared/model.ts';
import { useDepthField } from '../../shell/depth-field.ts';
import { ExtractState } from '../../shell/extract-state.tsx';
import { useShelfDrag } from './drag.ts';
import type { DragItem, Drop } from './drag.ts';
import { FieldsPanel, optionSelector } from './fields-panel.tsx';
import { FilterDialog } from './filter-dialog.tsx';
import {
  drill,
  drillState,
  insertPill,
  movePill,
  nextSort,
  pillField,
  pillFor,
  removePill,
  replacePill,
  shelfPills,
  stepFilter,
  stepPill,
  viewDimensions,
  viewMeasures,
  withAgg,
  withLevel,
} from './model.ts';
import type { FieldEntry, PillShelf, Shelf } from './model.ts';
import { useRegionKeys } from './regions.ts';
import { calculationEntry, setEntry, shapeOf, sourceEntries } from './sheet-data.ts';
import type { SheetRecord } from './sheet-data.ts';
import { pillSelector, ShelvesPanel } from './shelves-panel.tsx';
import type { PillAction } from './shelves-panel.tsx';
import { TableCalcDialog } from './table-calc-dialog.tsx';
import { AlertDialog, CalculationDialog, ReferenceLineDialog, SetDialog } from './tools/index.ts';
import { useAnnouncements } from './use-announcements.ts';
import { useSheetView } from './use-sheet-view.ts';
import type { FirstQuery } from './use-sheet-view.ts';
import { ViewPanel } from './view-panel.tsx';

type OpenDialog =
  | { type: 'filter'; field: FieldEntry; existing: Filter | null; index: number | null }
  | { type: 'table-calc'; shelf: PillShelf; index: number }
  | { type: 'calculation'; calculation: CalculationDef | null }
  | { type: 'set' }
  | { type: 'line' }
  | { type: 'alert' };

const LINE_WORDS = { average: 'Average', median: 'Median', constant: 'Constant' } as const;

interface EditorProps {
  record: SheetRecord;
  workbook: WorkbookDetail;
  source: Source;
  calculations: { calculation: CalculationDef; entry: FieldEntry }[];
  first: FirstQuery;
}

function isPillShelf(shelf: Shelf): shelf is PillShelf {
  return shelf !== 'Filters';
}

/** The editable sheet on the mid-pink field: Fields, Shelves, View and Data table, and every dialog they open. */
export function SheetEditor({ record, workbook, source, calculations: initialCalculations, first }: EditorProps) {
  useDepthField('sheet');
  const root = useRef<HTMLDivElement>(null);
  useRegionKeys(root);
  const view = useSheetView(record.id, shapeOf(record), record.version, first);
  const { shape, edit, refresh } = view;
  const [announcement, announce] = useAnnouncements();
  const [calculations, setCalculations] = useState(initialCalculations);
  const [sets, setSets] = useState<SetDef[]>(workbook.sets);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const returnFocus = useCallback(() => returnTo.current, []);

  const sourceFields = useMemo(() => sourceEntries(source), [source]);
  const setFields = useMemo(() => sets.map(setEntry), [sets]);
  const entries = useMemo(
    () => [...sourceFields, ...calculations.map((c) => c.entry), ...setFields],
    [sourceFields, calculations, setFields],
  );
  const entryByName = (name: string) => entries.find((entry) => entry.name === name);
  const hierarchy = source.hierarchy?.fields ?? [];
  const numberParameters = workbook.parameters.filter((parameter) => parameter.type === 'number');

  const focus = (selector: string) => root.current?.querySelector<HTMLElement>(selector)?.focus();
  const firstOption = () => root.current?.querySelector<HTMLElement>('[role="option"]')?.focus();

  const loadMembers = useCallback(
    async (field: string, step: FilterStep): Promise<Cell[]> =>
      (await api.post<{ members: Cell[] }>(`/api/sheets/${record.id}/members`, { field, step, filters: [], parameters: {} })).members,
    [record.id],
  );

  const filtered = (result: { rows: unknown[] }) => announce(`Filtered: ${result.rows.length} marks.`);

  const openFilter = (field: FieldEntry, existing: Filter | null, index: number | null, opener: HTMLElement | null) => {
    returnTo.current = opener;
    setDialog({ type: 'filter', field, existing, index });
  };

  const addField = (field: FieldEntry, shelf: Shelf, at: number | undefined, opener: HTMLElement | null) => {
    if (!isPillShelf(shelf)) {
      openFilter(field, null, null, opener);
      return;
    }
    void edit(insertPill(shape, shelf, pillFor(field), at));
    announce(`Added ${field.name} to ${shelf}.`);
    opener?.focus();
  };

  const applyFilter = (filter: Filter) => {
    if (dialog?.type !== 'filter') return;
    const index = dialog.index ?? shape.filters.length;
    const filters = dialog.index === null ? [...shape.filters, filter] : shape.filters.map((f, i) => (i === index ? filter : f));
    void edit({ ...shape, filters }, filtered);
    returnTo.current = root.current?.querySelector<HTMLElement>(pillSelector('Filters', index)) ?? null;
    setDialog(null);
  };

  const removeAt = (shelf: Shelf, index: number) => {
    const field = isPillShelf(shelf) ? pillField(shelfPills(shape, shelf)[index] ?? '') : (shape.filters[index]?.field ?? '');
    const next = isPillShelf(shelf) ? removePill(shape, shelf, index) : { ...shape, filters: shape.filters.filter((_, i) => i !== index) };
    void edit(next);
    announce(`Removed ${field} from ${shelf}.`);
    const left = isPillShelf(shelf) ? shelfPills(next, shelf).length : next.filters.length;
    if (left > index) focus(pillSelector(shelf, index));
    else if (left > 0) focus(pillSelector(shelf, index - 1));
    else firstOption();
  };

  const stepAt = (shelf: Shelf, index: number, by: -1 | 1) => {
    const to = index + by;
    let next: SheetShape | null;
    let field: string;
    if (isPillShelf(shelf)) {
      next = stepPill(shape, shelf, index, by);
      field = pillField(shelfPills(shape, shelf)[index] ?? '');
    } else {
      next = stepFilter(shape, index, by);
      field = shape.filters[index]?.field ?? '';
    }
    if (!next) return;
    void edit(next);
    announce(`Moved ${field} to position ${to + 1} on ${shelf}.`);
    focus(pillSelector(shelf, to));
  };

  const onPill = (shelf: Shelf, index: number, action: PillAction) => {
    if (action.type === 'remove') return removeAt(shelf, index);
    if (action.type === 'step') return stepAt(shelf, index, action.by);
    if (!isPillShelf(shelf)) {
      const filter = shape.filters[index];
      if (filter) {
        const field = entryByName(filter.field) ?? { key: filter.field, name: filter.field, kind: 'dimension', type: 'text', lod: false };
        openFilter(field, filter, index, root.current?.querySelector<HTMLElement>(pillSelector('Filters', index)) ?? null);
      }
      return;
    }
    const pill = shelfPills(shape, shelf)[index];
    if (pill === undefined) return;
    switch (action.type) {
      case 'agg':
        if (isMeasurePill(pill)) void edit(replacePill(shape, shelf, index, withAgg(pill, action.agg)));
        return;
      case 'level':
        void edit(replacePill(shape, shelf, index, withLevel(pill, action.level)));
        return;
      case 'table-calc':
        setDialog({ type: 'table-calc', shelf, index });
        return;
      case 'sort': {
        const field = pillField(pill);
        void edit({ ...shape, sort: { ...shape.sort, [field]: nextSort(shape.sort[field]) } });
        return;
      }
      case 'drill': {
        const state = drillState(shape, shelf, index, hierarchy);
        void edit(drill(shape, shelf, index, hierarchy));
        announce(`${state === 'collapse' ? 'Collapsed' : 'Expanded'} ${pillField(pill)}.`);
        focus(pillSelector(shelf, index, 'drill'));
        return;
      }
      case 'open-filter':
        return;
    }
  };

  const onDrop = (item: DragItem, drop: Drop) => {
    if (item.kind === 'field') {
      const field = entries.find((entry) => entry.key === item.name);
      const option = root.current?.querySelector<HTMLElement>(optionSelector(item.name)) ?? null;
      if (field) addField(field, drop.shelf, drop.index, option);
      return;
    }
    if (!isPillShelf(item.shelf)) return;
    const pill = shelfPills(shape, item.shelf)[item.index];
    if (pill === undefined) return;
    const name = pillField(pill);
    if (!isPillShelf(drop.shelf)) {
      const field = entryByName(name);
      if (field) openFilter(field, null, null, root.current?.querySelector<HTMLElement>(pillSelector(item.shelf, item.index)) ?? null);
      return;
    }
    const next = movePill(shape, item.shelf, item.index, drop.shelf, drop.index);
    const position = shelfPills(next, drop.shelf).indexOf(pill);
    void edit(next);
    announce(`Moved ${name} to position ${position + 1} on ${drop.shelf}.`);
    focus(pillSelector(drop.shelf, position));
  };

  const startDrag = useShelfDrag(onDrop);

  const savedCalculation = async (saved: CalculationDef) => {
    announce(`Saved ${saved.name}.`);
    const entry = await calculationEntry(record.id, saved);
    setCalculations((list) =>
      list.some((c) => c.calculation.id === saved.id)
        ? list.map((c) => (c.calculation.id === saved.id ? { calculation: saved, entry } : c))
        : [...list, { calculation: saved, entry }],
    );
    void refresh();
  };

  const tableCalcPill = dialog?.type === 'table-calc' ? shelfPills(shape, dialog.shelf)[dialog.index] : undefined;
  const otherNames = (except: string | null) => [
    ...sourceFields.map((f) => f.name),
    ...calculations.filter((c) => c.calculation.id !== except).map((c) => c.calculation.name),
  ];

  return (
    <div className="sheet-page">
      <header className="sheet-head">
        <h1 className="sheet-name">{shape.name}</h1>
        <ExtractState source={workbook.source} />
      </header>
      <div className="sheet-editor" ref={root}>
        <FieldsPanel
          groups={[
            { label: 'Dimensions', fields: sourceFields.filter((f) => f.kind === 'dimension') },
            { label: 'Measures', fields: sourceFields.filter((f) => f.kind === 'measure') },
            { label: 'Calculations', fields: calculations.map((c) => c.entry) },
            { label: 'Sets', fields: setFields },
          ]}
          calculations={calculations.map((c) => c.calculation)}
          onAdd={(field, shelf, option) => addField(field, shelf, undefined, option)}
          onDragStart={startDrag}
          onNewCalculation={() => setDialog({ type: 'calculation', calculation: null })}
          onEditCalculation={(calculation) => setDialog({ type: 'calculation', calculation })}
        />
        <ShelvesPanel
          shape={shape}
          hierarchy={hierarchy}
          onPill={onPill}
          onDragStart={startDrag}
          onChange={(next) => void edit(next)}
          onAddReferenceLine={() => setDialog({ type: 'line' })}
          onRemoveReferenceLine={(index) => void edit({ ...shape, reference_lines: shape.reference_lines.filter((_, i) => i !== index) })}
          onNewSet={() => setDialog({ type: 'set' })}
          onNewAlert={() => setDialog({ type: 'alert' })}
        />
        <div className="sheet-stage">
          <ViewPanel name={shape.name} view={view} announcement={announcement} />
        </div>
      </div>

      {dialog?.type === 'filter' ? (
        <FilterDialog
          field={dialog.field}
          existing={dialog.existing}
          measures={viewMeasures(shape)}
          dimensions={viewDimensions(shape)}
          numberParameters={numberParameters}
          loadMembers={loadMembers}
          onApply={applyFilter}
          onClose={() => setDialog(null)}
          returnFocus={returnFocus}
        />
      ) : null}
      {dialog?.type === 'table-calc' && tableCalcPill !== undefined && isMeasurePill(tableCalcPill) ? (
        <TableCalcDialog
          pill={tableCalcPill}
          dimensions={viewDimensions(shape)}
          onApply={(table_calc) => {
            void edit(replacePill(shape, dialog.shelf, dialog.index, { ...tableCalcPill, table_calc }));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'calculation' ? (
        <CalculationDialog
          sheetId={record.id}
          calculation={dialog.calculation}
          fieldNames={otherNames(dialog.calculation?.id ?? null)}
          parameters={workbook.parameters}
          setNames={sets.map((s) => s.name)}
          onSaved={(saved) => {
            setDialog(null);
            void savedCalculation(saved);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'set' ? (
        <SetDialog
          workbookId={workbook.id}
          existing={null}
          dimensions={sourceFields.filter((f) => f.kind === 'dimension').map((f) => f.name)}
          measures={viewMeasures(shape)}
          numberParameters={numberParameters}
          loadMembers={(field) => loadMembers(field, 'dimension')}
          onSaved={(saved) => {
            setDialog(null);
            setSets((list) => [...list.filter((s) => s.id !== saved.id), saved]);
            announce(`Saved ${saved.name}.`);
            void refresh();
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'line' ? (
        <ReferenceLineDialog
          numberParameters={numberParameters}
          onSave={(line: ReferenceLine) => {
            setDialog(null);
            void edit({ ...shape, reference_lines: [...shape.reference_lines, line] });
            announce(`Saved ${LINE_WORDS[line.type]}.`);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.type === 'alert' ? (
        <AlertDialog
          sheetId={record.id}
          measures={viewMeasures(shape)}
          onSaved={(name) => {
            setDialog(null);
            announce(`Saved ${name}.`);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
