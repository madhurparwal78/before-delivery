import { useState } from 'react';
import { measureCaption, TABLE_CALC_WORDS } from '../../../shared/display.ts';
import type { MeasurePill, TableCalc, TableCalcKind, TableCalcUsing } from '../../../shared/model.ts';
import { Button } from '../../ui/button.tsx';
import { Dialog } from '../../ui/dialog.tsx';
import { Checkbox, Select } from '../../ui/fields.tsx';

const NONE = 'none';
const KINDS: readonly TableCalcKind[] = ['run_total', 'prev_diff', 'share', 'rank'];
const USING: readonly { using: TableCalcUsing; label: string }[] = [
  { using: 'table_across', label: 'Table across' },
  { using: 'table_down', label: 'Table down' },
  { using: 'pane_down', label: 'Pane down' },
  { using: 'chosen', label: 'Chosen fields' },
];

const CALCULATION_OPTIONS = [{ value: NONE, label: 'None' }, ...KINDS.map((kind) => ({ value: kind, label: TABLE_CALC_WORDS[kind] }))];
const USING_OPTIONS = USING.map(({ using, label }) => ({ value: using, label }));

function isKind(value: string): value is TableCalcKind {
  return KINDS.some((kind) => kind === value);
}

function isUsing(value: string): value is TableCalcUsing {
  return USING.some((entry) => entry.using === value);
}

/** The draft behind `combobox "Calculation"`, `combobox "Compute using"` and the chosen-field checkboxes. */
interface CalcDraft {
  kind: TableCalcKind | null;
  using: TableCalcUsing;
  fields: string[];
}

export function calcDraft(calc: TableCalc | null): CalcDraft {
  return { kind: calc?.kind ?? null, using: calc?.using ?? 'table_across', fields: calc?.fields ?? [] };
}

export function draftCalc(draft: CalcDraft, dimensions: readonly string[]): TableCalc | null {
  if (!draft.kind) return null;
  const fields = draft.using === 'chosen' ? dimensions.filter((field) => draft.fields.includes(field)) : [];
  return { kind: draft.kind, using: draft.using, fields };
}

/** Calculation, Compute using and, for Chosen fields, one checkbox per view dimension. */
export function TableCalcFields({ draft, dimensions, onChange }: {
  draft: CalcDraft;
  dimensions: readonly string[];
  onChange: (draft: CalcDraft) => void;
}) {
  return (
    <>
      <div className="form-row">
        <Select
          label="Calculation"
          value={draft.kind ?? NONE}
          options={CALCULATION_OPTIONS}
          onChange={(value) => onChange({ ...draft, kind: isKind(value) ? value : null })}
        />
        <Select
          label="Compute using"
          value={draft.using}
          options={USING_OPTIONS}
          onChange={(value) => {
            if (isUsing(value)) onChange({ ...draft, using: value });
          }}
        />
      </div>
      {draft.using === 'chosen' ? (
        <fieldset className="choice-group">
          <legend className="field-label">Fields the calculation runs along</legend>
          {dimensions.map((field) => (
            <Checkbox
              key={field}
              label={field}
              checked={draft.fields.includes(field)}
              onChange={(checked) =>
                onChange({ ...draft, fields: checked ? [...draft.fields, field] : draft.fields.filter((f) => f !== field) })
              }
            />
          ))}
        </fieldset>
      ) : null}
    </>
  );
}

interface TableCalcDialogProps {
  pill: MeasurePill;
  /** the view's dimensions, offered as chosen fields */
  dimensions: readonly string[];
  onApply: (calc: TableCalc | null) => void;
  onClose: () => void;
}

/** `dialog "Table calculation"` for one measure pill. */
export function TableCalcDialog({ pill, dimensions, onApply, onClose }: TableCalcDialogProps) {
  const [draft, setDraft] = useState(() => calcDraft(pill.table_calc));
  return (
    <Dialog name="Table calculation" onClose={onClose}>
      <p className="dialog-lead">{measureCaption({ ...pill, table_calc: null })}</p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draftCalc(draft, dimensions));
        }}
      >
        <TableCalcFields draft={draft} dimensions={dimensions} onChange={setDraft} />
        <div className="dialog-actions">
          <Button variant="primary" type="submit">
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
