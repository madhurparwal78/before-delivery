import { ApiFailure, api } from '../api';
import { h, replace } from '../dom';
import { notice } from '../regions';
import { navigate, type ScreenCtx } from '../router';
import { intercept } from '../shell';
import { setStreamHandlers } from '../stream';
import { actionButton, labelledInput, openDialog, VIEWER_REASON, withReason } from '../ui';
import type { JsonObject } from '../../shared/types';

interface TableSummary {
  id: string;
  name: string;
  columns: { name: string; type: 'text' | 'number' }[];
  row_count: number;
}

interface TableDetail {
  id: string;
  name: string;
  columns: { name: string; type: 'text' | 'number' }[];
  rows: JsonObject[];
}

export async function renderTables(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const reason = ctx.workspace?.role === 'viewer' ? VIEWER_REASON : null;
  const { tables } = await api<{ tables: TableSummary[] }>('GET', `/api/workspaces/${workspaceId}/tables`);
  const newButton = h('button', { type: 'button', class: 'pill pill-primary', text: 'New table' });
  newButton.addEventListener('click', () => openNewTable(workspaceId, newButton));
  return h(
    'section',
    { class: 'screen-section' },
    h('h1', { class: 'display', text: 'Tables' }),
    h('div', { class: 'actions-row' }, withReason(newButton, reason)),
    h(
      'ul',
      { class: 'row-list', role: 'list', 'aria-label': 'Tables' },
      ...tables.map((table) =>
        h(
          'li',
          { class: 'row-item', 'data-table-id': table.id },
          h('a', {
            class: 'row-title',
            href: `/w/${workspaceId}/tables/${table.id}`,
            onclick: intercept,
            text: table.name,
          }),
          h('span', { class: 'row-meta', text: `${table.row_count} rows` }),
        ),
      ),
    ),
  );
}

function openNewTable(workspaceId: string, returnFocus: HTMLElement): void {
  openDialog({
    name: 'New table',
    returnFocus,
    focusSelector: 'input',
    build: (close) => {
      const name = labelledInput('Table name', 'text');
      const columnHolder = h('div', { class: 'column-list' });
      const columns: { name: HTMLInputElement; type: HTMLSelectElement }[] = [];
      const addColumn = (): void => {
        const index = columns.length + 1;
        const columnName = labelledInput(`Column name ${index}`, 'text');
        const columnType = labelledInput(`Column type ${index}`, 'select', {
          choices: ['text', 'number'],
          value: 'text',
        });
        columns.push({
          name: columnName.input as HTMLInputElement,
          type: columnType.input as HTMLSelectElement,
        });
        columnHolder.append(h('div', { class: 'column-row' }, columnName.wrapper, columnType.wrapper));
      };
      addColumn();
      const create = actionButton(
        'Create table',
        async () => {
          try {
            await api('POST', `/api/workspaces/${workspaceId}/tables`, {
              name: name.input.value,
              columns: columns
                .filter((column) => column.name.value.trim() !== '')
                .map((column) => ({ name: column.name.value, type: column.type.value })),
            });
            notice('Table created');
            close();
            navigate(`/w/${workspaceId}/tables`);
          } catch (error) {
            if (error instanceof ApiFailure) notice(error.message);
          }
        },
        { variant: 'primary' },
      );
      return h(
        'div',
        { class: 'dialog-body' },
        h('h2', { class: 'display', text: 'New table' }),
        name.wrapper,
        columnHolder,
        h('button', { type: 'button', class: 'pill pill-secondary', text: 'Add column', onclick: addColumn }),
        create.element,
        h('button', { type: 'button', class: 'pill pill-secondary', text: 'Close', onclick: close }),
      );
    },
  });
}

export async function renderTableDetail(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const tableId = ctx.params.tid;
  const reason = ctx.workspace?.role === 'viewer' ? VIEWER_REASON : null;
  const table = await api<TableDetail>('GET', `/api/workspaces/${workspaceId}/tables/${tableId}`);
  const gridHolder = h('div', { class: 'table-holder' });

  const paintGrid = (detail: TableDetail): void => {
    replace(
      gridHolder,
      h(
        'table',
        { class: 'data-table', 'aria-label': detail.name },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col', text: 'Row id' }),
            ...detail.columns.map((column) => h('th', { scope: 'col', text: column.name })),
          ),
        ),
        h(
          'tbody',
          {},
          ...detail.rows.map((row) =>
            h(
              'tr',
              { 'data-row-id': String(row._row_id) },
              h('td', { text: String(row._row_id) }),
              ...detail.columns.map((column) =>
                h('td', { text: row[column.name] === null || row[column.name] === undefined ? '' : String(row[column.name]) }),
              ),
            ),
          ),
        ),
      ),
    );
  };
  paintGrid(table);

  const inputs = new Map<string, HTMLInputElement>();
  const newRowFields = table.columns.map((column) => {
    const field = labelledInput(`New row: ${column.name}`, column.type === 'number' ? 'number' : 'text', {
      disabled: reason,
    });
    inputs.set(column.name, field.input as HTMLInputElement);
    return field.wrapper;
  });
  const addRow = actionButton(
    'Add row',
    async () => {
      const values: JsonObject = {};
      for (const [name, input] of inputs) {
        if (input.value !== '') values[name] = input.value;
      }
      try {
        await api('POST', `/api/workspaces/${workspaceId}/tables/${tableId}/rows`, { values });
        notice('Row added');
        for (const input of inputs.values()) input.value = '';
        paintGrid(await api<TableDetail>('GET', `/api/workspaces/${workspaceId}/tables/${tableId}`));
      } catch (error) {
        if (error instanceof ApiFailure) notice(error.message);
      }
    },
    { variant: 'primary', reason },
  );

  const refresh = async (): Promise<void> => {
    paintGrid(await api<TableDetail>('GET', `/api/workspaces/${workspaceId}/tables/${tableId}`));
  };
  setStreamHandlers({
    table: (event) => {
      if (event.table_id === tableId) void refresh();
    },
    reconnect: () => void refresh(),
  });

  return h(
    'section',
    { class: 'screen-section' },
    h('h1', { class: 'display', text: table.name }),
    gridHolder,
    h('div', { class: 'card card-light add-row-form' }, ...newRowFields, addRow.element),
  );
}
