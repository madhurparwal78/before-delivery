// The dashboard page's live state: one query per sheet with its own `gen`, the selection, the parameter values.
// An answer is applied only if it is that sheet's newest; the selection is announced once every sheet it changed
// has applied its newest answer.
import { useEffect, useRef, useState } from 'react';
import { api, generalErrorCopy } from '../../api/client.ts';
import { act, commit } from '../../api/use-load.ts';
import type { Dashboard, ParameterDef, ParameterValue, QueryRequest, QueryResult } from '../../../shared/model.ts';
import type { MarkInfo } from '../../chart/props.ts';
import { parameterCopy } from '../../shell/controls.tsx';
import { planSelection, selectionCopy } from './selection.ts';
import type { Selection } from './selection.ts';

export interface SheetView {
  /** the last good answer; a refusal keeps it */
  result: QueryResult | null;
  /** waiting for the newest answer */
  busy: boolean;
  notice: string;
}

interface Pending {
  text: string;
  sheets: Set<string>;
}

interface Live {
  parameters: Record<string, ParameterValue>;
  selection: Selection | null;
}

const REFUSED = 'view_refused';

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function parameterDefaults(parameters: readonly ParameterDef[]): Record<string, ParameterValue> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.value]));
}

interface Board {
  views: Readonly<Record<string, SheetView>>;
  parameters: Readonly<Record<string, ParameterValue>>;
  selection: Selection | null;
  select: (sheet: string, mark: MarkInfo | null) => void;
  setParameter: (name: string, value: ParameterValue) => void;
}

/**
 * Queries every sheet on mount. `select` runs the source sheet's actions; `setParameter` queries every sheet again.
 * Both report their announcement through `announce`.
 */
export function useBoard(dashboard: Dashboard, parameterDefs: readonly ParameterDef[], announce: (text: string) => void): Board {
  const sheetIds = dashboard.objects.map((object) => object.sheet);
  const [views, setViews] = useState<Record<string, SheetView>>(() =>
    Object.fromEntries(sheetIds.map((id) => [id, { result: null, busy: false, notice: '' }])),
  );
  const [parameters, setParameters] = useState(() => parameterDefaults(parameterDefs));
  const [selection, setSelection] = useState<Selection | null>(null);
  const live = useRef<Live>({ parameters, selection: null });
  const gens = useRef<Record<string, number>>({});
  const pending = useRef<Pending | null>(null);

  const patch = (sheet: string, change: Partial<SheetView>) =>
    setViews((all) => ({ ...all, [sheet]: { result: null, busy: false, notice: '', ...all[sheet], ...change } }));

  const settle = (sheet: string, change: Partial<SheetView>) =>
    commit(() => {
      patch(sheet, { ...change, busy: false });
      const waiting = pending.current;
      if (!waiting) return;
      waiting.sheets.delete(sheet);
      if (waiting.sheets.size === 0) {
        pending.current = null;
        announce(waiting.text);
      }
    });

  const query = (sheet: string): void => {
    const gen = (gens.current[sheet] ?? 0) + 1;
    gens.current[sheet] = gen;
    const { parameters: values, selection: chosen } = live.current;
    const body: QueryRequest = { filters: chosen?.filters[sheet] ?? [], parameters: values, sets: chosen?.sets ?? {} };
    patch(sheet, { busy: true });
    void act(
      async () => {
        const result = await api.post<QueryResult>(`/api/sheets/${sheet}/query?gen=${gen}`, body);
        if (gens.current[sheet] === gen) settle(sheet, { result, notice: result.notices[0] ?? '' });
      },
      (caught) => {
        if (gens.current[sheet] !== gen) return;
        const message = caught.body.error === REFUSED ? caught.body.message : undefined;
        settle(sheet, { notice: message ?? generalErrorCopy(caught) ?? 'Something went wrong. Try again.' });
      },
    );
  };

  useEffect(() => {
    sheetIds.forEach(query);
  }, []);

  const apply = (next: Selection | null, previous: Selection | null) => {
    const affected = unique([...(next?.targets ?? []), ...(previous?.targets ?? [])]);
    const values = { ...live.current.parameters, ...next?.parameters };
    live.current = { parameters: values, selection: next };
    setSelection(next);
    setParameters(values);
    const text = selectionCopy(next, affected.length);
    if (affected.length === 0) {
      pending.current = null;
      announce(text);
      return;
    }
    pending.current = { text, sheets: new Set(affected) };
    affected.forEach(query);
  };

  const select = (sheet: string, mark: MarkInfo | null) => {
    const previous = live.current.selection;
    if (mark === null) {
      if (previous?.source === sheet) apply(null, previous);
      return;
    }
    apply(planSelection(dashboard.actions, sheet, mark, parameterDefs), previous);
  };

  const setParameter = (name: string, value: ParameterValue) => {
    const values = { ...live.current.parameters, [name]: value };
    live.current = { ...live.current, parameters: values };
    setParameters(values);
    announce(parameterCopy(name, value));
    sheetIds.forEach(query);
  };

  return { views, parameters, selection, select, setParameter };
}
