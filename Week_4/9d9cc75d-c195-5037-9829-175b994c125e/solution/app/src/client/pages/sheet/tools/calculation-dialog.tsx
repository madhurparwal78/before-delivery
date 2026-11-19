import { useEffect, useRef, useState } from 'react';
import { api, generalErrorCopy } from '../../../api/client.ts';
import { act, commit, useLoad } from '../../../api/use-load.ts';
import type { CalculationDef, FormulaCheck } from '../../../../shared/model.ts';
import { Button } from '../../../ui/button.tsx';
import { Dialog } from '../../../ui/dialog.tsx';
import { TextField } from '../../../ui/fields.tsx';
import { Status } from '../../../ui/live.tsx';
import { FormulaBox } from './formula-box.tsx';
import { landingStep } from './query-order.ts';
import { QueryStrip } from './query-strip.tsx';
import type { CalculationDialogProps } from './types.ts';

interface Config {
  formula_debounce_ms: number;
}

function statusText(check: FormulaCheck | null, note: string | null, refusal: string | null): string {
  if (refusal) return refusal;
  if (note) return note;
  if (!check) return '';
  return check.valid ? 'Formula is valid.' : check.message;
}

export function CalculationDialog({ sheetId, calculation, fieldNames, parameters, setNames, onSaved, onClose }: CalculationDialogProps) {
  const [name, setName] = useState(calculation?.name ?? '');
  const [formula, setFormula] = useState(calculation?.formula ?? '');
  const [check, setCheck] = useState<FormulaCheck | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const config = useLoad(() => api.get<Config>('/api/config'), []);
  const debounce = useRef<number | undefined>(undefined);
  debounce.current = config.data?.formula_debounce_ms;
  const latest = useRef(formula);
  const edits = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sendCheck = (text: string, mine: number) =>
    act(
      async () => {
        const result = await api.post<FormulaCheck>('/api/formula/check', { sheet: sheetId, formula: text });
        if (mine === edits.current) commit(() => setCheck(result));
      },
      (caught) => {
        if (mine === edits.current) setNote(generalErrorCopy(caught));
      },
    );

  const arm = () => {
    clearTimeout(timer.current);
    if (debounce.current === undefined || latest.current === '') return;
    const text = latest.current;
    const mine = edits.current;
    timer.current = setTimeout(() => void sendCheck(text, mine), debounce.current);
  };

  const edit = (next: string) => {
    latest.current = next;
    edits.current += 1;
    setFormula(next);
    setCheck(null);
    setNote(null);
    setRefusal(null);
    setErrors((current) => ({ ...current, formula: '' }));
    arm();
  };

  useEffect(arm, [config.data]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = () =>
    act(
      async () => {
        const body = { name, formula };
        let saved: CalculationDef;
        if (calculation) {
          await api.put(`/api/calculations/${calculation.id}`, body);
          saved = { id: calculation.id, ...body };
        } else {
          saved = await api.post<CalculationDef>(`/api/sheets/${sheetId}/calculations`, body);
        }
        commit(() => {
          onSaved(saved);
          onClose();
        });
      },
      (caught) => {
        setErrors(caught.fields);
        setRefusal(generalErrorCopy(caught) ?? caught.fieldMessage('formula'));
      },
    );

  const landed = check?.valid ? landingStep(formula, check) : null;

  return (
    <Dialog name="Calculation" onClose={onClose}>
      <form
        className="form-grid calc-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Calculation name"
          value={name}
          onChange={(next) => {
            setName(next);
            setErrors((current) => ({ ...current, name: '' }));
          }}
          error={errors.name}
        />
        <QueryStrip landed={landed} />
        <FormulaBox
          value={formula}
          onChange={edit}
          names={[...fieldNames, ...parameters.map((parameter) => `@${parameter.name}`), ...setNames]}
          error={errors.formula}
        />
        <div className="calc-status">
          <Status name="Formula check" text={statusText(check, note, refusal)} />
        </div>
        <div className="dialog-actions">
          <Button variant="primary" type="submit">
            Save calculation
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
