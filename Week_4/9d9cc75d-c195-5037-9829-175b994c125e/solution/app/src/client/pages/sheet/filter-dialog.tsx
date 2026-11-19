import { useState } from 'react';
import { generalErrorCopy } from '../../api/client.ts';
import { useLoad } from '../../api/use-load.ts';
import { formatCell, measureCaption } from '../../../shared/display.ts';
import type { Cell, Filter, FilterStep, MeasurePill, ParameterDef } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Checkbox, Select, TextField } from '../../ui/fields.tsx';
import { blankFilter, isMeasureFilter } from './model.ts';
import type { FieldEntry } from './model.ts';
import { calcDraft, draftCalc, TableCalcFields } from './table-calc-dialog.tsx';

interface FilterDialogProps {
  field: FieldEntry;
  /** the filter being edited, or null for a new one */
  existing: Filter | null;
  /** the view's measures, offered by `combobox "By"` */
  measures: readonly MeasurePill[];
  /** the view's dimensions, offered as chosen fields of a table calculation */
  dimensions: readonly string[];
  numberParameters: readonly ParameterDef[];
  /** the field's members from rows passing every step before `step` */
  loadMembers: (field: string, step: FilterStep) => Promise<Cell[]>;
  onApply: (filter: Filter) => void;
  onClose: () => void;
  /** where focus goes on Escape or Close: the option or pill that opened the dialog */
  returnFocus: () => HTMLElement | null;
}

const NO_PARAMETER = '';

function numberOrNull(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function key(cell: Cell): string {
  return JSON.stringify(cell);
}

function Radio({ name, label, checked, onSelect }: { name: string; label: string; checked: boolean; onSelect: () => void }) {
  return (
    <label className="check">
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      <span>{label}</span>
    </label>
  );
}

function MeasureFilterForm({ field, existing, dimensions, onApply }: Pick<FilterDialogProps, 'field' | 'existing' | 'dimensions' | 'onApply'>) {
  const [atLeast, setAtLeast] = useState(existing?.min == null ? '' : String(existing.min));
  const [atMost, setAtMost] = useState(existing?.max == null ? '' : String(existing.max));
  const [calc, setCalc] = useState(() => calcDraft(existing?.table_calc ?? null));
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const table_calc = draftCalc(calc, dimensions);
        onApply({
          ...blankFilter(field.name),
          step: table_calc ? 'table_calc' : 'measure',
          agg: existing?.agg ?? (field.lod ? 'AVG' : 'SUM'),
          table_calc,
          min: numberOrNull(atLeast),
          max: numberOrNull(atMost),
        });
      }}
    >
      <div className="form-row">
        <TextField label="At least" type="number" value={atLeast} onChange={setAtLeast} />
        <TextField label="At most" type="number" value={atMost} onChange={setAtMost} />
      </div>
      <TableCalcFields draft={calc} dimensions={dimensions} onChange={setCalc} />
      <div className="dialog-actions">
        <Button variant="primary" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}

function DimensionFilterForm({ field, existing, measures, numberParameters, loadMembers, onApply }: Omit<FilterDialogProps, 'dimensions' | 'onClose' | 'returnFocus'>) {
  const [mode, setMode] = useState<'members' | 'top'>(existing?.step === 'top' ? 'top' : 'members');
  const [source, setSource] = useState(existing?.step === 'source');
  const [context, setContext] = useState(existing?.step === 'context');
  const parameterOf = typeof existing?.n === 'string' ? existing.n.slice(1) : NO_PARAMETER;
  const [parameter, setParameter] = useState(parameterOf);
  const [count, setCount] = useState(typeof existing?.n === 'number' ? String(existing.n) : '');
  const previousBy = existing?.by ?? null;
  const byIndex = previousBy ? measures.findIndex((m) => measureCaption(m) === measureCaption(previousBy)) : 0;
  const [by, setBy] = useState(String(Math.max(0, byIndex)));
  const listStep: FilterStep = existing?.step === 'source' ? 'source' : existing?.step === 'context' ? 'context' : 'dimension';
  const members = useLoad(() => loadMembers(field.name, listStep), [field.name]);
  const [chosen, setChosen] = useState<Set<string> | null>(existing && existing.step !== 'top' ? new Set(existing.values.map(key)) : null);
  const list = members.data ?? [];
  const picked = chosen ?? new Set(list.map(key));

  const step = (): FilterStep => {
    if (source) return 'source';
    if (context) return 'context';
    return mode === 'top' ? 'top' : 'dimension';
  };

  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        const base = { ...blankFilter(field.name), step: step() };
        if (mode === 'top') {
          onApply({
            ...base,
            n: parameter === NO_PARAMETER ? (numberOrNull(count) ?? 0) : `@${parameter}`,
            by: measures[Number(by)] ?? null,
          });
        } else {
          onApply({ ...base, values: list.filter((member) => picked.has(key(member))) });
        }
      }}
    >
      <fieldset className="choice-group choice-row">
        <legend className="sr-only">Filter by</legend>
        <Radio name="filter-mode" label="Members" checked={mode === 'members'} onSelect={() => setMode('members')} />
        <Radio name="filter-mode" label="Top N" checked={mode === 'top'} onSelect={() => setMode('top')} />
      </fieldset>
      {mode === 'members' ? (
        <fieldset className="choice-group check-list member-list">
          <legend className="sr-only">Members</legend>
          {members.error ? <p className="field-error">{generalErrorCopy(members.error) ?? 'Something went wrong. Try again.'}</p> : null}
          {list.map((member) => (
            <Checkbox
              key={key(member)}
              label={formatCell(member)}
              checked={picked.has(key(member))}
              onChange={(checked) => {
                const next = new Set(picked);
                if (checked) next.add(key(member));
                else next.delete(key(member));
                setChosen(next);
              }}
            />
          ))}
        </fieldset>
      ) : (
        <div className="form-grid">
          <div className="form-row">
            <TextField label="Top N" type="number" value={count} onChange={setCount} disabled={parameter !== NO_PARAMETER} />
            <Select
              label="Use parameter"
              value={parameter}
              options={[{ value: NO_PARAMETER, label: 'None' }, ...numberParameters.map((p) => ({ value: p.name, label: p.name }))]}
              onChange={setParameter}
            />
          </div>
          <Select
            label="By"
            value={by}
            options={measures.map((measure, index) => ({ value: String(index), label: measureCaption(measure) }))}
            onChange={setBy}
          />
        </div>
      )}
      <fieldset className="choice-group">
        <legend className="sr-only">Query step</legend>
        <Checkbox label="Data source filter" checked={source} onChange={setSource} />
        <Checkbox label="Context filter" checked={context} onChange={setContext} />
      </fieldset>
      <div className="dialog-actions">
        <Button variant="primary" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}

/** `dialog "Filter {field}"`: members or Top N for a dimension, a range and an optional table calculation for a measure. */
export function FilterDialog(props: FilterDialogProps) {
  const { field, existing, onClose, returnFocus } = props;
  const measure = existing ? isMeasureFilter(existing) : field.kind === 'measure';
  return (
    <Dialog name={`Filter ${field.name}`} onClose={onClose} returnFocus={returnFocus}>
      {measure ? (
        <MeasureFilterForm field={field} existing={existing} dimensions={props.dimensions} onApply={props.onApply} />
      ) : (
        <DimensionFilterForm
          field={field}
          existing={existing}
          measures={props.measures}
          numberParameters={props.numberParameters}
          loadMembers={props.loadMembers}
          onApply={props.onApply}
        />
      )}
    </Dialog>
  );
}
