import { h } from './dom';
import { expander, labelledInput, openDialog } from './ui';
import { OPERATOR_CHOICES } from './choices';
import type { AutomationDetail, JsonObject, JsonValue, StepNode, TriggerNode } from '../shared/types';

export interface TableChoice {
  id: string;
  name: string;
  columns: { name: string; type: 'text' | 'number' }[];
}

export interface StepPanelContext {
  automation: AutomationDetail;
  tables: TableChoice[];
  reason: string | null;
  saveFields: (stepId: string, fields: JsonObject) => Promise<void>;
  saveName: (stepId: string, name: string) => Promise<void>;
  saveSample: (stepId: string, raw: string) => Promise<void>;
  fieldValue: (stepId: string, key: string) => JsonValue | undefined;
}

type AnyNode = StepNode | TriggerNode;

function text(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function onCommit(input: HTMLElement, commit: () => void): void {
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && input.tagName !== 'TEXTAREA') {
      event.preventDefault();
      commit();
    }
  });
}

function valueEntries(value: JsonValue | undefined): [string, string][] {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([name, item]) => [name, text(item)]);
}

export function openStepPanel(
  context: StepPanelContext,
  node: AnyNode,
  returnFocus: () => HTMLElement | null,
): void {
  openDialog({
    name: `Step settings: ${node.name}`,
    returnFocus,
    focusSelector: 'input',
    build: (close) => {
      const nameField = labelledInput('Step name', 'text', { value: node.name, disabled: context.reason });
      onCommit(nameField.input, () => {
        if (nameField.input.value !== node.name) void context.saveName(node.id, nameField.input.value);
      });
      const settings = () => h('div', { class: 'settings-body' }, ...settingsControls(context, node));
      const connections = () =>
        h(
          'ul',
          { class: 'connection-list' },
          ...context.automation.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) =>
              h('li', {
                class: 'connection-item',
                text: `${edge.port} ${edge.order} to ${
                  context.automation.steps.find((step) => step.id === edge.to)?.name ?? edge.to
                }`,
              }),
            ),
        );
      const help = () =>
        h(
          'div',
          { class: 'template-help' },
          h('p', { class: 'mono', text: '{{trigger.<path>}}' }),
          h('p', { class: 'mono', text: '{{steps.<id>.<path>}}' }),
          h('p', { class: 'mono', text: '{{loop.item.<path>}}' }),
          h('p', { class: 'mono', text: '{{loop.index}}' }),
          h('p', { class: 'mono', text: '{{run.id}}' }),
          h('p', {
            class: 'body-text',
            text: `Paths available here: trigger, ${context.automation.steps
              .filter((step) => step.id !== node.id)
              .map((step) => `steps.${step.id}`)
              .join(', ')}`,
          }),
        );
      return h(
        'div',
        { class: 'dialog-body step-panel' },
        h('h2', { class: 'display display-small', text: `Step settings: ${node.name}` }),
        nameField.wrapper,
        expander('Settings', true, settings),
        expander('Connections', false, connections),
        expander('Template help', false, help),
        h('button', { type: 'button', class: 'pill pill-secondary', text: 'Close', onclick: close }),
      );
    },
  });
}

function fieldSaver(context: StepPanelContext, node: AnyNode, key: string, read: () => JsonValue): () => void {
  return () => {
    void context.saveFields(node.id, { [key]: read() });
  };
}

function settingsControls(context: StepPanelContext, node: AnyNode): HTMLElement[] {
  const reason = context.reason;
  const controls: HTMLElement[] = [];
  const fields = node.fields;
  const tableNames = context.tables.map((table) => table.name);

  const simple = (
    label: string,
    key: string,
    kind: 'text' | 'textarea' | 'number' = 'text',
  ): void => {
    const field = labelledInput(label, kind === 'number' ? 'number' : kind, {
      value: text(fields[key]),
      disabled: reason,
    });
    onCommit(
      field.input,
      fieldSaver(context, node, key, () =>
        kind === 'number' ? Number((field.input as HTMLInputElement).value) : field.input.value,
      ),
    );
    controls.push(field.wrapper);
  };

  const tableSelect = (label = 'Table'): void => {
    const current = context.tables.find((table) => table.id === text(fields.table));
    const field = labelledInput(label, 'select', {
      choices: ['', ...tableNames],
      value: current === undefined ? '' : current.name,
      disabled: reason,
    });
    onCommit(
      field.input,
      fieldSaver(context, node, 'table', () => {
        const chosen = context.tables.find((table) => table.name === (field.input as HTMLSelectElement).value);
        return chosen === undefined ? '' : chosen.id;
      }),
    );
    controls.push(field.wrapper);
  };

  const pairList = (
    nameLabel: string,
    valueLabel: string,
    key: string,
    addLabel: string,
  ): void => {
    const entries = valueEntries(fields[key]);
    if (entries.length === 0) entries.push(['', '']);
    const holder = h('div', { class: 'pair-list' });
    const save = (): void => {
      const object: JsonObject = {};
      for (const [nameInput, valueInput] of inputs) {
        if (nameInput.value.trim() === '') continue;
        object[nameInput.value] = valueInput.value;
      }
      void context.saveFields(node.id, { [key]: object });
    };
    const inputs: [HTMLInputElement, HTMLInputElement][] = [];
    const addRow = (name: string, value: string): void => {
      const index = inputs.length + 1;
      const nameField = labelledInput(`${nameLabel} ${index}`, 'text', { value: name, disabled: reason });
      const valueField = labelledInput(`${valueLabel} ${index}`, 'text', { value, disabled: reason });
      inputs.push([nameField.input as HTMLInputElement, valueField.input as HTMLInputElement]);
      onCommit(nameField.input, save);
      onCommit(valueField.input, save);
      holder.append(h('div', { class: 'pair-row' }, nameField.wrapper, valueField.wrapper));
    };
    for (const [name, value] of entries) addRow(name, value);
    const group = h('div', { role: 'group', 'aria-label': key === 'values' ? 'Values' : 'Body', class: 'pair-group' }, holder);
    controls.push(group);
    const addButton = h('button', {
      type: 'button',
      class: 'pill pill-secondary',
      text: addLabel,
      onclick: () => addRow('', ''),
    });
    if (reason !== null) addButton.setAttribute('disabled', '');
    controls.push(addButton);
  };

  const columnFields = (): void => {
    const table = context.tables.find((item) => item.id === text(fields.table));
    if (table === undefined) return;
    const values = valueEntries(fields.values);
    const save = (): void => {
      const object: JsonObject = {};
      for (const [column, input] of columnInputs) object[column] = input.value;
      void context.saveFields(node.id, { values: object });
    };
    const columnInputs: [string, HTMLInputElement][] = [];
    for (const column of table.columns) {
      const existing = values.find(([name]) => name === column.name);
      const field = labelledInput(`Column ${column.name}`, 'text', {
        value: existing === undefined ? '' : existing[1],
        disabled: reason,
      });
      columnInputs.push([column.name, field.input as HTMLInputElement]);
      onCommit(field.input, save);
      controls.push(field.wrapper);
    }
  };

  const sampleField = (): void => {
    const field = labelledInput('Sample data (JSON)', 'textarea', {
      value: JSON.stringify((node as TriggerNode).sample ?? {}, null, 2),
      disabled: reason,
    });
    onCommit(field.input, () => void context.saveSample(node.id, field.input.value));
    controls.push(field.wrapper);
  };

  switch (node.kind) {
    case 'form': {
      simple('Form path', 'path');
      const formFields = Array.isArray(fields.form_fields) ? [...fields.form_fields] : [];
      const holder = h('div', { class: 'pair-list' });
      const inputs: { name: HTMLInputElement; label: HTMLInputElement; type: HTMLSelectElement }[] = [];
      const save = (): void => {
        void context.saveFields(node.id, {
          form_fields: inputs
            .filter((row) => row.name.value.trim() !== '')
            .map((row) => ({ name: row.name.value, label: row.label.value, type: row.type.value })),
        });
      };
      const addRow = (name: string, label: string, type: string): void => {
        const index = inputs.length + 1;
        const nameField = labelledInput(`Field name ${index}`, 'text', { value: name, disabled: reason });
        const labelField = labelledInput(`Field label ${index}`, 'text', { value: label, disabled: reason });
        const typeField = labelledInput(`Field type ${index}`, 'select', {
          choices: ['text', 'number'],
          value: type,
          disabled: reason,
        });
        inputs.push({
          name: nameField.input as HTMLInputElement,
          label: labelField.input as HTMLInputElement,
          type: typeField.input as HTMLSelectElement,
        });
        onCommit(nameField.input, save);
        onCommit(labelField.input, save);
        onCommit(typeField.input, save);
        holder.append(h('div', { class: 'pair-row' }, nameField.wrapper, labelField.wrapper, typeField.wrapper));
      };
      for (const entry of formFields) {
        const row = entry as JsonObject;
        addRow(text(row.name), text(row.label), text(row.type) === 'number' ? 'number' : 'text');
      }
      if (formFields.length === 0) addRow('', '', 'text');
      controls.push(holder);
      const addButton = h('button', {
        type: 'button',
        class: 'pill pill-secondary',
        text: 'Add form field',
        onclick: () => addRow('', '', 'text'),
      });
      if (reason !== null) addButton.setAttribute('disabled', '');
      controls.push(addButton);
      sampleField();
      break;
    }
    case 'schedule':
      simple('Schedule', 'schedule');
      sampleField();
      break;
    case 'webhook':
      simple('Hook path', 'path');
      sampleField();
      break;
    case 'row_added':
      tableSelect();
      sampleField();
      break;
    case 'manual':
      sampleField();
      break;
    case 'set':
      pairList('Value name', 'Value', 'values', 'Add value');
      break;
    case 'filter':
    case 'branch': {
      simple('Left', 'left');
      const operator = labelledInput('Operator', 'select', {
        choices: OPERATOR_CHOICES,
        value: text(fields.operator) === '' ? 'equals' : text(fields.operator),
        disabled: reason,
      });
      onCommit(operator.input, fieldSaver(context, node, 'operator', () => operator.input.value));
      controls.push(operator.wrapper);
      simple('Right', 'right');
      break;
    }
    case 'loop': {
      const source = labelledInput('Loop over', 'select', {
        choices: ['A list', 'All rows of a table'],
        value: text(fields.source) === 'table' ? 'All rows of a table' : 'A list',
        disabled: reason,
      });
      onCommit(
        source.input,
        fieldSaver(context, node, 'source', () =>
          (source.input as HTMLSelectElement).value === 'All rows of a table' ? 'table' : 'list',
        ),
      );
      controls.push(source.wrapper);
      simple('List', 'list');
      tableSelect();
      break;
    }
    case 'wait':
      simple('Seconds', 'seconds', 'number');
      break;
    case 'send_email':
      simple('To', 'to');
      simple('Subject', 'subject');
      simple('Body', 'body');
      break;
    case 'add_row':
      tableSelect();
      columnFields();
      break;
    case 'update_row':
      tableSelect();
      simple('Row id', 'row_id');
      columnFields();
      break;
    case 'call_webhook':
      simple('URL', 'url');
      pairList('Body name', 'Body value', 'body', 'Add body value');
      break;
    default:
      break;
  }
  return controls;
}
