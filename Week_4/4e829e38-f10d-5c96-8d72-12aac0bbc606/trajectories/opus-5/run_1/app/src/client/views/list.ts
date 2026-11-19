import { api, ApiCallError, type Field, type Task } from '../api.js';
import { confirmDelete, openDialog } from '../dialog.js';
import { clear, el, on } from '../dom.js';
import { openAddField, openEditField, openFormulaEditor } from '../fields.js';
import { animate } from '../motion.js';
import { patchTask } from '../save.js';
import { announce } from '../status.js';
import {
  cellName,
  memberName,
  pendingFocus,
  takePendingFocus,
  topLevelOf,
  traceLine,
  valueText,
  type ProjectContext,
  type View,
} from './shared.js';

const STATUS = 'List status';

export function createListView(context: ProjectContext): View {
  const node = el('div', { class: 'list' });
  const toolbar = el('div', { class: 'list__toolbar' });
  const grid = el('div', { role: 'grid', 'aria-label': 'Tasks', class: 'grid' });
  const traceHost = el('div', { class: 'trace-host', 'aria-hidden': 'false' });
  const addSection = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Add section');
  node.append(toolbar, traceHost, grid, addSection);

  const selected = new Set<string>();
  let anchor: string | null = null;

  const columns = (): string[] => [
    'Name',
    'Assignee',
    'Due',
    'Effort',
    ...context.project.fields.map((field) => field.name),
  ];

  const rowOf = (taskId: string): HTMLElement | null =>
    grid.querySelector<HTMLElement>(`[data-task="${taskId}"]`);

  const taskRows = (): HTMLElement[] => Array.from(grid.querySelectorAll<HTMLElement>('[data-task]'));

  const navCells = (row: HTMLElement): HTMLElement[] =>
    Array.from(row.querySelectorAll<HTMLElement>('[data-nav="1"]'));

  const setRovingCell = (cell: HTMLElement) => {
    for (const other of grid.querySelectorAll<HTMLElement>('[data-nav="1"]')) other.tabIndex = -1;
    cell.tabIndex = 0;
    cell.focus();
  };

  const refreshSelection = () => {
    for (const row of taskRows()) {
      row.setAttribute('aria-selected', selected.has(row.dataset.task as string) ? 'true' : 'false');
    }
  };

  const cellValue = (task: Task, key: string, field: Field | null): string => {
    if (field) return valueText(task.values[field.name]);
    switch (key) {
      case 'Name':
        return task.name;
      case 'Assignee':
        return memberName(context.project, task.assigneeId);
      case 'Due':
        return task.due ?? '';
      case 'Effort':
        return task.effort === null ? '' : String(task.effort);
      default:
        return '';
    }
  };

  const buildCell = (task: Task, key: string): HTMLElement => {
    const field = context.project.fields.find((candidate) => candidate.name === key) ?? null;
    const value = cellValue(task, key, field);
    const cell = el('div', {
      role: 'gridcell',
      'data-nav': '1',
      'data-column': key,
      tabindex: '-1',
      class: `cell cell--${key.toLowerCase().replace(/\s+/g, '-')}`,
      'aria-label': field ? cellName(field, task.values[field.name]) : `${key}, ${value === '' ? 'blank' : value}`,
    });
    if (key === 'Name') {
      const open = el(
        'button',
        { type: 'button', class: 'cell__open', tabindex: '-1', 'aria-label': `Open ${task.name}` },
        task.name,
      );
      on(open, 'click', () => context.openTask(task.id, open));
      cell.appendChild(open);
      if (task.completed) cell.appendChild(el('span', { class: 'chip chip--done' }, 'Complete'));
    } else {
      cell.appendChild(el('span', { class: 'cell__value tabular' }, value));
    }
    if (field && field.type === 'formula') cell.dataset.formulaField = field.id;
    return cell;
  };

  const buildRow = (task: Task): HTMLElement => {
    const row = el('div', {
      role: 'row',
      'data-task': task.id,
      'data-section': task.section,
      'data-position': String(task.position),
      'aria-level': task.parentId === null ? '1' : '2',
      'aria-selected': selected.has(task.id) ? 'true' : 'false',
      class: task.parentId === null ? 'row' : 'row row--subtask',
    });
    for (const key of columns()) row.appendChild(buildCell(task, key));
    return row;
  };

  const startEdit = (cell: HTMLElement) => {
    const row = cell.closest('[data-task]') as HTMLElement | null;
    if (!row) return;
    const task = context.byId.get(row.dataset.task as string);
    if (!task) return;
    const key = cell.dataset.column as string;
    const field = context.project.fields.find((candidate) => candidate.name === key) ?? null;
    if (field && field.type === 'formula') return;
    const previous = cell.innerHTML;
    const current = cellValue(task, key, field);

    let editor: HTMLInputElement | HTMLSelectElement;
    if (key === 'Assignee') {
      editor = el('select', { class: 'cell__editor', 'aria-label': 'Assignee' }) as HTMLSelectElement;
      editor.appendChild(el('option', { value: '' }, 'Unassigned'));
      for (const member of context.project.members) {
        editor.appendChild(el('option', { value: member.id }, member.name));
      }
      (editor as HTMLSelectElement).value = task.assigneeId ?? '';
    } else if (field && field.type === 'single_select') {
      editor = el('select', { class: 'cell__editor', 'aria-label': key }) as HTMLSelectElement;
      editor.appendChild(el('option', { value: '' }, 'Blank'));
      for (const option of field.options) {
        editor.appendChild(el('option', { value: option }, option));
      }
      (editor as HTMLSelectElement).value = current;
    } else {
      editor = el('input', {
        class: 'cell__editor',
        'aria-label': key,
        type: key === 'Due' || (field && field.type === 'date') ? 'date' : 'text',
        value: current,
      }) as HTMLInputElement;
    }
    clear(cell);
    cell.appendChild(editor);
    editor.focus();

    const finish = (commit: boolean) => {
      if (!commit) {
        cell.innerHTML = previous;
        setRovingCell(cell);
        return;
      }
      const raw = (editor as HTMLInputElement).value;
      const body: Record<string, unknown> = { version: task.version };
      if (key === 'Name') body.name = raw;
      else if (key === 'Assignee') body.assigneeId = raw === '' ? null : raw;
      else if (key === 'Due') body.due = raw === '' ? null : raw;
      else if (key === 'Effort') body.effort = raw === '' ? null : Number(raw);
      else if (field) {
        body.values = {
          [field.name]:
            field.type === 'multi_select'
              ? raw
                  .split(',')
                  .map((part) => part.trim())
                  .filter((part) => part !== '')
              : field.type === 'number'
                ? raw === ''
                  ? null
                  : Number(raw)
                : raw === ''
                  ? null
                  : raw,
        };
      }
      cell.innerHTML = previous;
      setRovingCell(cell);
      void patchTask(task.id, body, { toastOnSuccess: true });
    };

    on(editor as HTMLElement, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
  };

  const indent = async (row: HTMLElement) => {
    const task = context.byId.get(row.dataset.task as string);
    if (!task) return;
    const siblings = topLevelOf(context, task.section);
    const above = siblings.filter((candidate) => candidate.position < task.position).pop();
    if (!above || task.parentId !== null) {
      announce(STATUS, `Can't indent ${task.name}`);
      return;
    }
    try {
      await api.patch<Task>(`/api/tasks/${task.id}`, {
        version: task.version,
        parentId: above.id,
      });
      announce(STATUS, `${task.name} is now a subtask of ${above.name}`);
    } catch (err) {
      if (err instanceof ApiCallError) announce(STATUS, `Can't indent ${task.name}`);
    }
  };

  const outdent = async (row: HTMLElement) => {
    const task = context.byId.get(row.dataset.task as string);
    if (!task) return;
    if (task.parentId === null) {
      announce(STATUS, `Can't outdent ${task.name}`);
      return;
    }
    try {
      await api.patch<Task>(`/api/tasks/${task.id}`, { version: task.version, parentId: null });
      announce(STATUS, `${task.name} is no longer a subtask`);
    } catch (err) {
      if (err instanceof ApiCallError) announce(STATUS, `Can't outdent ${task.name}`);
    }
  };

  const toggleComplete = async (row: HTMLElement) => {
    const task = context.byId.get(row.dataset.task as string);
    if (!task) return;
    const outcome = await patchTask(task.id, {
      version: task.version,
      completed: !task.completed,
    });
    if (outcome.task) {
      announce(
        STATUS,
        `${task.name} marked ${outcome.task.completed ? 'complete' : 'not complete'}`,
      );
    }
  };

  on(grid, 'keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.classList.contains('cell__editor')) return;
    const row = target.closest('[data-task]') as HTMLElement | null;
    const cell = target.closest('[data-nav="1"]') as HTMLElement | null;

    if (row && event.ctrlKey && event.key === ']') {
      event.preventDefault();
      void indent(row);
      return;
    }
    if (row && event.ctrlKey && event.key === '[') {
      event.preventDefault();
      void outdent(row);
      return;
    }
    if (row && event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      void toggleComplete(row);
      return;
    }
    if (row && event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const rows = taskRows();
      const index = rows.indexOf(row);
      const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1);
      const next = rows[nextIndex];
      if (!next) return;
      if (anchor === null || selected.size === 0) {
        anchor = row.dataset.task as string;
        selected.clear();
        selected.add(anchor);
      }
      const anchorIndex = rows.findIndex((candidate) => candidate.dataset.task === anchor);
      selected.clear();
      const from = Math.min(anchorIndex, nextIndex);
      const to = Math.max(anchorIndex, nextIndex);
      for (let i = from; i <= to; i += 1) selected.add(rows[i].dataset.task as string);
      refreshSelection();
      announce(STATUS, `${selected.size} task${selected.size === 1 ? '' : 's'} selected`);
      const column = cell?.dataset.column ?? 'Name';
      const target2 = navCells(next).find((candidate) => candidate.dataset.column === column);
      if (target2) setRovingCell(target2);
      return;
    }
    if (!cell) return;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      if (selected.size > 0) {
        selected.clear();
        anchor = null;
        refreshSelection();
      }
      const owner = cell.closest('[role="row"]') as HTMLElement;
      const cells = navCells(owner);
      const index = cells.indexOf(cell);
      if (event.key === 'ArrowRight' && cells[index + 1]) setRovingCell(cells[index + 1]);
      else if (event.key === 'ArrowLeft' && cells[index - 1]) setRovingCell(cells[index - 1]);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const all = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]')).filter(
          (candidate) => navCells(candidate).length > 0,
        );
        const rowIndex = all.indexOf(owner);
        const nextRow = all[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
        if (!nextRow) return;
        const nextCells = navCells(nextRow);
        const match =
          nextCells.find((candidate) => candidate.dataset.column === cell.dataset.column) ??
          nextCells[Math.min(index, nextCells.length - 1)];
        if (match) setRovingCell(match);
      }
      return;
    }
    if (event.key === 'Enter' && target === cell) {
      event.preventDefault();
      startEdit(cell);
    }
  });

  const buildToolbar = () => {
    clear(toolbar);
    for (const field of context.project.fields.filter((candidate) => candidate.type === 'multi_select')) {
      const trigger = el(
        'button',
        { type: 'button', class: 'pill pill--ghost' },
        `Set ${field.name} for selection`,
      );
      on(trigger, 'click', () => openSetField(field, trigger));
      toolbar.appendChild(trigger);
    }
  };

  const openSetField = (field: Field, opener: HTMLElement) => {
    openDialog({
      name: `Set ${field.name}`,
      opener,
      build: (handle) => {
        const boxes = field.options.map((option) => {
          const input = el('input', {
            type: 'checkbox',
            'aria-label': option,
            value: option,
          }) as HTMLInputElement;
          return { option, input };
        });
        const apply = el('button', { type: 'submit', class: 'pill pill--dark' }, `Apply ${field.name.toLowerCase()}`);
        const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
        on(cancel, 'click', handle.close);
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, `Set ${field.name}`),
          el(
            'div',
            { class: 'stack' },
            boxes.map((box) =>
              el('label', { class: 'checkbox' }, [box.input, el('span', {}, box.option)]),
            ),
          ),
          el('div', { class: 'dialog-actions' }, [apply, cancel]),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          if (apply.getAttribute('aria-busy') === 'true') return;
          apply.setAttribute('aria-busy', 'true');
          const chosen = boxes.filter((box) => box.input.checked).map((box) => box.option);
          const ids = Array.from(selected);
          void Promise.all(
            ids.map((id) => {
              const task = context.byId.get(id);
              if (!task) return Promise.resolve();
              return api
                .patch(`/api/tasks/${id}`, {
                  version: task.version,
                  values: { [field.name]: chosen },
                })
                .catch(() => undefined);
            }),
          ).then(() => {
            announce(
              STATUS,
              `${field.name} set on ${ids.length} task${ids.length === 1 ? '' : 's'}`,
            );
            handle.close();
          });
        });
        return form;
      },
    });
  };

  /** The published next control after a field delete. */
  const nextFieldControl = (fieldId: string): string => {
    const fields = context.project.fields;
    const index = fields.findIndex((candidate) => candidate.id === fieldId);
    const neighbour = fields[index + 1] ?? fields[index - 1];
    if (!neighbour) return '[aria-label="Add field"]';
    const label =
      neighbour.type === 'formula'
        ? `Edit formula for ${neighbour.name}`
        : `Edit field ${neighbour.name}`;
    return `[aria-label="${label}"]`;
  };

  /** The published next control after a section delete. */
  const nextSectionControl = (sectionId: string): string => {
    const sections = context.project.sections;
    const index = sections.findIndex((candidate) => candidate.id === sectionId);
    const neighbour = sections[index + 1] ?? sections[index - 1];
    return neighbour
      ? `[data-section-group="${neighbour.id}"] .section-heading`
      : '[aria-label="Add field"]';
  };

  const buildHeader = (): HTMLElement => {
    const header = el('div', { role: 'row', class: 'row row--head' });
    for (const key of ['Name', 'Assignee', 'Due', 'Effort']) {
      header.appendChild(el('div', { role: 'columnheader', class: 'cell cell--head' }, key));
    }
    for (const field of context.project.fields) {
      const head = el('div', { role: 'columnheader', class: 'cell cell--head' }, [
        el('span', {}, field.name),
      ]);
      const editLabel =
        field.type === 'formula' ? `Edit formula for ${field.name}` : `Edit field ${field.name}`;
      const edit = el(
        'button',
        { type: 'button', class: 'icon-button', 'aria-label': editLabel },
        field.type === 'formula' ? 'fx' : 'Edit',
      );
      on(edit, 'click', () => {
        if (field.type === 'formula') openFormulaEditor(context.project, field, edit);
        else openEditField(field, edit);
      });
      const remove = el(
        'button',
        { type: 'button', class: 'icon-button', 'aria-label': 'Delete field' },
        'Delete',
      );
      on(remove, 'click', () => {
        confirmDelete({
          name: field.name,
          opener: remove,
          onDelete: async () => {
            pendingFocus.selector = nextFieldControl(field.id);
            await api.del(`/api/fields/${field.id}`);
            announce(STATUS, 'Field deleted');
          },
        });
      });
      head.append(edit, remove);
      header.appendChild(head);
    }
    const addField = el(
      'button',
      { type: 'button', class: 'icon-button', 'aria-label': 'Add field' },
      'Add field',
    );
    on(addField, 'click', () => openAddField(context.project, addField));
    header.appendChild(el('div', { role: 'columnheader', class: 'cell cell--head' }, addField));
    return header;
  };

  const rebuild = () => {
    clear(grid);
    buildToolbar();
    grid.appendChild(el('div', { role: 'rowgroup', class: 'grid__head' }, buildHeader()));
    const sections = context.project.sections;
    for (const section of sections) {
      const group = el('div', {
        role: 'rowgroup',
        'aria-label': section.name,
        'data-section-group': section.id,
        class: 'grid__group',
      });
      const heading = el(
        'button',
        { type: 'button', class: 'section-heading', 'aria-expanded': 'true' },
        section.name,
      );
      on(heading, 'click', () => {
        const open = heading.getAttribute('aria-expanded') === 'true';
        heading.setAttribute('aria-expanded', open ? 'false' : 'true');
        for (const row of group.querySelectorAll<HTMLElement>('[data-task], .row--add')) {
          row.hidden = open;
        }
      });
      const removeSection = el(
        'button',
        { type: 'button', class: 'icon-button', 'aria-label': 'Delete section' },
        'Delete section',
      );
      if (sections.length <= 1) removeSection.disabled = true;
      on(removeSection, 'click', () => {
        confirmDelete({
          name: section.name,
          opener: removeSection,
          onDelete: async () => {
            pendingFocus.selector = nextSectionControl(section.id);
            await api.del(`/api/sections/${section.id}`);
            announce(STATUS, 'Section deleted');
          },
        });
      });
      group.appendChild(
        el('div', { role: 'row', class: 'row row--section' }, [
          el('div', { role: 'gridcell', class: 'cell cell--section' }, [heading, removeSection]),
        ]),
      );
      for (const task of context.tasks.filter((candidate) => candidate.section === section.id)) {
        group.appendChild(buildRow(task));
      }
      const addTask = el('input', {
        class: 'input input--add',
        'aria-label': 'Add task',
        type: 'text',
        tabindex: '0',
      }) as HTMLInputElement;
      on(addTask, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const name = addTask.value.trim();
        if (name === '') return;
        if (addTask.getAttribute('aria-busy') === 'true') return;
        addTask.setAttribute('aria-busy', 'true');
        addTask.value = '';
        void api
          .post(`/api/projects/${context.project.id}/tasks`, { name, section: section.id })
          .catch(() => undefined)
          .finally(() => {
            addTask.removeAttribute('aria-busy');
            addTask.focus();
          });
      });
      group.appendChild(
        el('div', { role: 'row', class: 'row row--add' }, [
          el('div', { role: 'gridcell', class: 'cell cell--add' }, addTask),
        ]),
      );
      grid.appendChild(group);
    }
    const first = grid.querySelector<HTMLElement>('[data-nav="1"]');
    if (first) first.tabIndex = 0;
    takePendingFocus(node);
  };

  on(addSection, 'click', () => {
    openDialog({
      name: 'Add section',
      opener: addSection,
      build: (handle) => {
        const name = el('input', { class: 'input', 'aria-label': 'Section name' }) as HTMLInputElement;
        const create = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Add section');
        const cancel = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Cancel');
        on(cancel, 'click', handle.close);
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, 'Add section'),
          name,
          el('div', { class: 'dialog-actions' }, [create, cancel]),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          void api
            .post(`/api/projects/${context.project.id}/sections`, { name: name.value })
            .then(() => handle.close())
            .catch(() => undefined);
        });
        return form;
      },
    });
  });

  /** Inserts a new row in place so the Add task row keeps its focus. */
  const insertRow = (task: Task) => {
    const group = grid.querySelector<HTMLElement>(`[data-section-group="${task.section}"]`);
    if (!group) {
      rebuild();
      return;
    }
    const row = buildRow(task);
    const siblings = Array.from(group.querySelectorAll<HTMLElement>('[data-task]'));
    if (task.parentId === null) {
      const after = siblings.find((candidate) => {
        const other = context.byId.get(candidate.dataset.task as string);
        return other !== undefined && other.parentId === null && other.position > task.position;
      });
      group.insertBefore(row, after ?? group.querySelector('.row--add'));
      return;
    }
    const parentRow = siblings.find((candidate) => candidate.dataset.task === task.parentId);
    if (!parentRow) {
      rebuild();
      return;
    }
    let cursor: HTMLElement = parentRow;
    while (cursor.nextElementSibling instanceof HTMLElement) {
      const next = cursor.nextElementSibling;
      const other = next.dataset.task ? context.byId.get(next.dataset.task) : undefined;
      if (!other || other.parentId !== task.parentId || other.position > task.position) break;
      cursor = next;
    }
    cursor.after(row);
  };

  const upsert = (task: Task) => {
    const existing = rowOf(task.id);
    if (!existing) {
      insertRow(task);
      return;
    }
    const held = existing.contains(document.activeElement);
    const focusedColumn = held
      ? (document.activeElement as HTMLElement).closest('[data-nav="1"]')?.getAttribute('data-column')
      : null;
    const moved =
      existing.dataset.section !== task.section ||
      existing.dataset.position !== String(task.position) ||
      (task.parentId === null) !== (existing.getAttribute('aria-level') === '1');
    if (moved) {
      existing.remove();
      insertRow(task);
      const row = rowOf(task.id);
      if (focusedColumn && row) {
        const cell = navCells(row).find((candidate) => candidate.dataset.column === focusedColumn);
        if (cell) setRovingCell(cell);
      }
      return;
    }
    for (const cell of navCells(existing)) {
      const key = cell.dataset.column as string;
      const field = context.project.fields.find((candidate) => candidate.name === key) ?? null;
      const next = cellValue(task, key, field);
      const label = field
        ? cellName(field, task.values[field.name])
        : `${key}, ${next === '' ? 'blank' : next}`;
      const changed = cell.getAttribute('aria-label') !== label;
      cell.setAttribute('aria-label', label);
      if (key === 'Name') {
        const open = cell.querySelector<HTMLElement>('.cell__open');
        if (open) {
          open.textContent = task.name;
          open.setAttribute('aria-label', `Open ${task.name}`);
        }
      } else {
        const value = cell.querySelector<HTMLElement>('.cell__value');
        if (value) value.textContent = next;
      }
      if (changed && field && field.type === 'formula') {
        cell.setAttribute('data-motion', 'fading');
        animate(
          240,
          () => undefined,
          () => cell.setAttribute('data-motion', 'settled'),
        );
      }
    }
  };

  const remove = (taskId: string) => {
    const row = rowOf(taskId);
    if (!row) return;
    const held = row.contains(document.activeElement);
    const rows = taskRows();
    const index = rows.indexOf(row);
    const group = row.closest('[data-section-group]') as HTMLElement | null;
    row.remove();
    if (!held) return;
    const left = taskRows();
    const next = left[index] ?? left[index - 1];
    if (next) {
      const cell = navCells(next).find((candidate) => candidate.dataset.column === 'Name');
      if (cell) setRovingCell(cell);
      return;
    }
    const add = group?.querySelector<HTMLElement>('.input--add');
    if (add) add.focus();
  };

  const trace = (taskIds: string[]) => {
    clear(traceHost);
    const points = taskIds
      .map((id) => rowOf(id))
      .filter((row): row is HTMLElement => row !== null)
      .map((row) => {
        const box = row.getBoundingClientRect();
        const host = traceHost.getBoundingClientRect();
        return { x: box.left - host.left + 6, y: box.top - host.top + box.height / 2 };
      });
    const line = traceLine(points);
    if (line) traceHost.appendChild(line);
  };

  rebuild();
  return { node, upsert, remove, rebuild, trace };
}
