import type { IndexTableDto } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import {
  button,
  formAlert,
  labelledField,
  labelledTextarea,
  liveRegion,
  runAction,
} from '../ui';

function parseFactors(text: string): Record<string, string> {
  const factors: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const [code, factor] = trimmed.split(/[\s,=:]+/);
    if (code === undefined || factor === undefined) continue;
    factors[code.toUpperCase()] = factor;
  }
  return factors;
}

export function renderIndexTables(ctx: ScreenContext): ScreenHandle {
  const updates = liveRegion('Index table updates');
  const tablesHost = el('div', { class: 'index-tables' });
  const isChair = ctx.user?.roles.includes('chair') ?? false;
  const alert = formAlert();
  const effectiveDate = labelledField({
    label: 'Effective date',
    id: 'table-date',
    hint: 'YYYY-MM-DD',
  });
  const factors = labelledTextarea({ label: 'Factors', id: 'table-factors', rows: 8 });
  const submit = button('Load table', { variant: 'primary', onClick: () => void load() });

  const form = el(
    'form',
    {
      class: 'form',
      attrs: { 'aria-label': 'Load index table', novalidate: 'novalidate' },
      on: {
        submit: (event: SubmitEvent) => {
          event.preventDefault();
          void load();
        },
      },
    },
    alert.element,
    effectiveDate.wrapper,
    factors.wrapper,
    submit,
  );

  const container = el(
    'div',
    { class: 'screen' },
    el('h1', { class: 'page-heading', text: 'Index tables' }),
    updates,
    isChair ? form : null,
    tablesHost,
  );

  function paint(tables: IndexTableDto[]): void {
    replace(
      tablesHost,
      tables.map((table) =>
        el(
          'table',
          {
            class: 'data-table',
            attrs: { 'aria-label': `Index table effective ${table.effectiveDate}` },
          },
          el(
            'caption',
            { class: 'data-table__caption' },
            `Index table effective ${table.effectiveDate}`,
          ),
          el(
            'thead',
            {},
            el('tr', {}, el('th', { text: 'Class' }), el('th', { class: 'num', text: 'Factor' })),
          ),
          el(
            'tbody',
            {},
            Object.entries(table.factors).map(([classCode, factor]) =>
              el(
                'tr',
                {},
                el('td', { text: classCode }),
                el('td', { class: 'num mono', text: factor }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  async function reload(): Promise<void> {
    const result = await api.indexTables.list();
    paint(result.tables);
  }

  async function load(): Promise<void> {
    const date = effectiveDate.input.value.trim();
    const result = await runAction({
      control: submit,
      region: updates,
      pending: copy.indexTable.pending,
      run: () =>
        api.indexTables.load({ effectiveDate: date, factors: parseFactors(factors.textarea.value) }),
      success: (loaded) => copy.indexTable.loaded(loaded.table.effectiveDate),
      failure: (error) => {
        if (error.code === 'effective_date_taken') return copy.indexTable.dateTaken(date);
        if (error.code === 'effective_date_conflict') return copy.indexTable.runsExist(date);
        if (error.code === 'classes_in_use') {
          const codes = /: (.+)\.$/.exec(error.message)?.[1] ?? '';
          return copy.indexTable.classesMissing(codes.split(', ').filter((code) => code.length > 0));
        }
        if (error.status === 422) {
          alert.fields(
            Object.entries(error.fields).map(([field, message]) => ({
              message,
              focus: () =>
                (field === 'effectiveDate' ? effectiveDate.input : factors.textarea).focus(),
            })),
          );
          return Object.values(error.fields)[0] ?? error.message;
        }
        return error.message;
      },
    });
    if (result) {
      alert.reset();
      await reload();
    }
  }

  void reload();
  return { element: container };
}
