import { h, clear, trapFocus, append } from './dom.js';
import { bus } from './bus.js';
import { canEdit, state } from './state.js';
import {
  ActionFailure,
  addHoliday,
  assign,
  createLink,
  deleteItem,
  postComment,
  removeHoliday,
  saveBaseline,
  saveTaskFields,
  setPercent,
  unassign,
} from './actions.js';
import { api } from './api.js';
import { ALERTS, LINK_TYPE_LABELS } from '../shared/copy.js';
import { formatHours } from '../shared/hours.js';
import { longDate, isIsoDate } from '../shared/dates.js';
import type { Comment, Item, LinkType, WorkloadDay, WorkloadPerson } from '../shared/types.js';

let host: HTMLElement | null = null;

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  heading: HTMLElement;
  alert: HTMLElement;
  close(): void;
  showAlert(text: string): void;
}

let openHandle: DialogHandle | null = null;

function dialogHost(): HTMLElement {
  if (!host) {
    host = h('div', { id: 'dialog-host' });
    document.body.appendChild(host);
  }
  return host;
}

export function closeOpenDialog(): void {
  openHandle?.close();
}

/** The control to return focus to: an element, or the focus key of one that may be redrawn. */
export type Opener = HTMLElement | string | null;

function focusOpener(opener: Opener): void {
  const key = typeof opener === 'string' ? opener : opener?.dataset.focusKey;
  const target = key ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null;
  if (target) target.focus();
  else if (opener && typeof opener !== 'string') opener.focus();
}

export function openDialog(options: {
  label: string;
  heading?: string;
  opener: Opener;
  className?: string;
  onClose?: () => void;
}): DialogHandle {
  closeOpenDialog();
  const heading = h('h2', { class: 'dialog-heading', text: options.heading ?? options.label });
  const alert = h('div', { role: 'alert', class: 'dialog-alert' });
  const body = h('div', { class: 'dialog-body' });
  const root = h('div', {
    class: `dialog ${options.className ?? ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.label,
  });
  append(root, [heading, alert, body]);
  const backdrop = h('div', { class: 'dialog-backdrop' }, [root]);

  let release = (): void => {};
  const handle: DialogHandle = {
    root,
    body,
    heading,
    alert,
    close(): void {
      if (openHandle !== handle) return;
      openHandle = null;
      release();
      backdrop.remove();
      options.onClose?.();
      focusOpener(options.opener);
    },
    showAlert(text: string): void {
      alert.textContent = text;
    },
  };
  release = trapFocus(root, handle.close);
  dialogHost().appendChild(backdrop);
  openHandle = handle;
  return handle;
}

function field(
  label: string,
  input: HTMLInputElement,
): HTMLElement {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' }, [h('label', { for: id, text: label }), input]);
}

function textInput(value: string, attributes: Record<string, string> = {}): HTMLInputElement {
  const input = h('input', { type: 'text', value, autocomplete: 'off', ...attributes });
  input.value = value;
  return input as HTMLInputElement;
}

function numberInput(value: number, min: number, max: number, step = 1): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    min: String(min),
    max: String(max),
    step: String(step),
  }) as HTMLInputElement;
  input.value = String(value);
  return input;
}

interface ComboOption {
  value: string;
  label: string;
}

interface Combo {
  node: HTMLElement;
  input: HTMLInputElement;
  value(): string | null;
}

/** A combobox that filters its options as you type, with the Arrow keys and Enter. */
function combobox(label: string, options: ComboOption[], onPick?: (value: string) => void): Combo {
  const listId = `l-${Math.random().toString(36).slice(2, 9)}`;
  const input = textInput('', {
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
  });
  const list = h('ul', { id: listId, role: 'listbox', class: 'combo-list', hidden: true });
  let chosen: string | null = null;
  let active = 0;
  let shown: ComboOption[] = options;

  const draw = (): void => {
    clear(list);
    shown.forEach((option, index) => {
      const item = h('li', {
        role: 'option',
        'aria-selected': index === active ? 'true' : 'false',
        'data-value': option.value,
        id: `${listId}-${index}`,
        text: option.label,
        class: index === active ? 'active' : '',
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(index);
      });
      list.appendChild(item);
    });
    list.hidden = shown.length === 0;
    input.setAttribute('aria-expanded', shown.length > 0 ? 'true' : 'false');
    if (shown.length > 0 && active < shown.length) {
      input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const pick = (index: number): void => {
    const option = shown[index];
    if (!option) return;
    chosen = option.value;
    input.value = option.label;
    shown = [];
    draw();
    onPick?.(option.value);
  };

  input.addEventListener('input', () => {
    const needle = input.value.trim().toLowerCase();
    chosen = null;
    shown = options.filter((option) => option.label.toLowerCase().includes(needle));
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (shown.length === 0) {
        shown = options;
        active = 0;
      } else active = Math.min(active + 1, shown.length - 1);
      draw();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
      draw();
    } else if (event.key === 'Enter' && shown.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      pick(active);
    }
  });

  draw();
  const node = field(label, input);
  node.appendChild(list);
  return { node, input, value: (): string | null => chosen };
}

/* ----------------------------------------------------------- new project */

export function openNewProjectDialog(opener: Opener): void {
  const handle = openDialog({ label: 'New project', opener });
  const name = textInput('');
  const choices = state.workspaces.filter((workspace) => workspace.role !== 'viewer');
  const select = h(
    'select',
    {},
    choices.map((workspace) => h('option', { value: workspace.id, text: workspace.name })),
  ) as HTMLSelectElement;
  const selectField = field('Workspace', select as unknown as HTMLInputElement);
  const create = h('button', { type: 'button', class: 'primary', text: 'Create project' });
  create.addEventListener('click', () => {
    void (async () => {
      create.disabled = true;
      try {
        const answer = await api.post<{ project: { id: string } }>('/api/projects', {
          name: name.value,
          workspace: select.value,
        });
        location.href = `/projects/${answer.project.id}`;
      } catch {
        handle.showAlert(ALERTS.projectName);
        create.disabled = false;
      }
    })();
  });
  append(handle.body, [field('Project name', name), selectField, create]);
  name.focus();
}

/* ------------------------------------------------------------ task details */

interface TaskDialogState {
  itemId: string;
  appendComment(comment: Comment): void;
}

let taskDialog: TaskDialogState | null = null;

export function pushCommentToOpenDialog(itemId: string, comment: Comment): void {
  if (taskDialog?.itemId === itemId) taskDialog.appendComment(comment);
}

export function openTaskDetails(item: Item, opener: Opener): void {
  let edited: Item = item;
  const handle = openDialog({
    label: 'Task details',
    heading: 'Task details',
    opener,
    onClose: () => {
      taskDialog = null;
    },
  });

  const readOnly = !canEdit();
  const name = textInput(edited.name, readOnly ? { readonly: 'true' } : {});
  const start = textInput(edited.chosenStart ?? '', readOnly || edited.kind === 'group' ? { readonly: 'true' } : {});
  const duration = numberInput(edited.duration, 0, 999);
  const percent = numberInput(edited.percent, 0, 100);
  if (readOnly || edited.kind === 'group') {
    duration.readOnly = true;
    percent.readOnly = true;
  }

  const fields = h('div', { class: 'fields' }, [
    field('Name', name),
    field('Start', start),
    field('Duration', duration),
    field('Percent complete', percent),
  ]);
  handle.body.appendChild(fields);

  if (!readOnly) {
    const save = h('button', { type: 'button', class: 'primary', text: 'Save task' });
    const remove = h('button', { type: 'button', text: 'Delete task' });
    save.addEventListener('click', () => {
      void (async () => {
        save.disabled = true;
        handle.showAlert('');
        if (edited.kind !== 'group') {
          if (!isIsoDate(start.value.trim())) {
            start.setAttribute('aria-invalid', 'true');
            handle.showAlert(ALERTS.itemStart);
            save.disabled = false;
            return;
          }
          start.removeAttribute('aria-invalid');
        }
        try {
          await saveTaskFields(edited, {
            name: name.value,
            start: start.value.trim(),
            duration: Number(duration.value),
            percent: Number(percent.value),
          });
          handle.close();
        } catch (error) {
          const failure = error as ActionFailure;
          handle.showAlert(failure.text);
          if (failure.field === 'name') name.setAttribute('aria-invalid', 'true');
          if (failure.field === 'start') start.setAttribute('aria-invalid', 'true');
          if (failure.field === 'duration') duration.setAttribute('aria-invalid', 'true');
          if (failure.field === 'percent') percent.setAttribute('aria-invalid', 'true');
          if (failure.conflictItem) {
            edited = failure.conflictItem;
            name.value = edited.name;
            start.value = edited.chosenStart ?? '';
            duration.value = String(edited.duration);
            percent.value = String(edited.percent);
          }
          save.disabled = false;
        }
      })();
    });
    remove.addEventListener('click', () => {
      void (async () => {
        remove.disabled = true;
        const target = edited;
        const bars = (state.project?.items ?? []).filter((entry) => entry.kind !== 'group');
        const index = bars.findIndex((entry) => entry.id === target.id);
        const neighbour = bars[index + 1] ?? bars[index - 1] ?? null;
        handle.close();
        try {
          await deleteItem(target);
        } catch (error) {
          bus.setAlert((error as ActionFailure).text);
          return;
        }
        if (neighbour) {
          document
            .querySelector<HTMLElement>(`[data-focus-key="bar:${neighbour.id}"]`)
            ?.focus();
        }
      })();
    });
    handle.body.appendChild(h('div', { class: 'row' }, [save, remove]));
  }

  if (edited.kind === 'task') {
    const region = h('section', { role: 'region', 'aria-label': 'Assignees' }, [
      h('h3', { text: 'Assignees' }),
    ]);
    const list = h('ul', { role: 'list', 'aria-label': 'Assignees', class: 'plain-list' });
    const drawAssignees = (): void => {
      clear(list);
      for (const assignee of [...edited.assignees].sort((a, b) => a.name.localeCompare(b.name))) {
        const entry = h('li', { role: 'listitem' }, [
          `${assignee.name}, ${formatHours(assignee.hours)} hours a day`,
        ]);
        if (!readOnly) {
          const remove = h('button', { type: 'button', text: `Remove ${assignee.name}` });
          remove.addEventListener('click', () => {
            void (async () => {
              remove.disabled = true;
              try {
                edited = await unassign(edited, assignee.userId, assignee.name);
                drawAssignees();
              } catch (error) {
                handle.showAlert((error as ActionFailure).text);
                remove.disabled = false;
              }
            })();
          });
          entry.appendChild(remove);
        }
        list.appendChild(entry);
      }
    };
    drawAssignees();
    region.appendChild(list);

    if (!readOnly) {
      const people = (state.workload?.people ?? []).filter(
        (person) => !edited.assignees.some((assignee) => assignee.userId === person.userId),
      );
      const combo = combobox(
        'Add person',
        people.map((person) => ({ value: person.userId, label: person.name })),
      );
      const hours = numberInput(8, 0.5, 24, 0.5);
      const assignButton = h('button', { type: 'button', text: 'Assign' });
      assignButton.addEventListener('click', () => {
        void (async () => {
          const userId = combo.value();
          if (!userId) return;
          const person = people.find((entry) => entry.userId === userId)!;
          assignButton.disabled = true;
          try {
            edited = await assign(edited, userId, person.name, Number(hours.value));
            combo.input.value = '';
            drawAssignees();
          } catch (error) {
            handle.showAlert((error as ActionFailure).text);
          }
          assignButton.disabled = false;
        })();
      });
      append(region, [combo.node, field('Hours a day', hours), assignButton]);
    }
    handle.body.appendChild(region);
  }

  const commentsRegion = h('section', { role: 'region', 'aria-label': 'Comments' }, [
    h('h3', { text: 'Comments' }),
  ]);
  const commentList = h('ul', { role: 'list', 'aria-label': 'Comments', class: 'plain-list' });
  commentsRegion.appendChild(commentList);
  const addComment = (comment: Comment): void => {
    commentList.appendChild(h('li', { role: 'listitem', text: `${comment.author.name}: ${comment.text}` }));
  };
  taskDialog = { itemId: edited.id, appendComment: addComment };
  void (async () => {
    const answer = await api.get<{ comments: Comment[] }>(`/api/items/${edited.id}/comments`);
    state.comments.set(edited.id, answer.comments);
    clear(commentList);
    for (const comment of answer.comments) addComment(comment);
  })();

  if (!readOnly) {
    const box = h('textarea', { rows: '2' }) as HTMLTextAreaElement;
    const boxId = `c-${Math.random().toString(36).slice(2, 9)}`;
    box.id = boxId;
    const post = h('button', { type: 'button', text: 'Post comment', disabled: true });
    const submit = (): void => {
      void (async () => {
        post.disabled = true;
        try {
          await postComment(edited, box.value);
          box.value = '';
        } catch (error) {
          handle.showAlert((error as ActionFailure).text);
          post.disabled = false;
        }
      })();
    };
    box.addEventListener('input', () => {
      post.disabled = box.value.trim() === '';
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey && box.value.trim() !== '') {
        event.preventDefault();
        submit();
      }
    });
    post.addEventListener('click', submit);
    append(commentsRegion, [
      h('div', { class: 'field' }, [h('label', { for: boxId, text: 'New comment' }), box]),
      post,
    ]);
  }
  handle.body.appendChild(commentsRegion);

  name.focus();
}

/* --------------------------------------------------------------- add link */

export function openAddLinkDialog(from: Item, opener: Opener): void {
  const handle = openDialog({
    label: 'Add link',
    heading: `Link from ${from.name}`,
    opener,
  });
  const candidates = state.project!.items.filter(
    (item) => item.kind !== 'group' && item.id !== from.id,
  );
  const combo = combobox(
    'Successor',
    candidates.map((item) => ({ value: item.id, label: `${item.row} ${item.name}` })),
  );

  const radios: HTMLInputElement[] = [];
  const group = h('div', { role: 'radiogroup', 'aria-label': 'Link type', class: 'radios' });
  (['FS', 'SS', 'FF', 'SF'] as LinkType[]).forEach((type, index) => {
    const id = `r-${type}-${Math.random().toString(36).slice(2, 7)}`;
    const radio = h('input', {
      type: 'radio',
      name: 'link-type',
      value: type,
      id,
      tabindex: index === 0 ? '0' : '-1',
    }) as HTMLInputElement;
    radio.checked = index === 0;
    radios.push(radio);
    group.appendChild(
      h('div', { class: 'radio' }, [radio, h('label', { for: id, text: LINK_TYPE_LABELS[type] })]),
    );
  });
  group.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const current = radios.findIndex((radio) => radio.checked);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (current + step + radios.length) % radios.length;
    radios.forEach((radio, index) => {
      radio.checked = index === next;
      radio.tabIndex = index === next ? 0 : -1;
    });
    radios[next].focus();
  });

  const lag = numberInput(0, -30, 30);
  const add = h('button', { type: 'button', class: 'primary', text: 'Add link' });
  add.addEventListener('click', () => {
    void (async () => {
      const successorId = combo.value();
      if (!successorId) return;
      const to = candidates.find((item) => item.id === successorId)!;
      const type = (radios.find((radio) => radio.checked)!.value ?? 'FS') as LinkType;
      add.disabled = true;
      try {
        await createLink(from, to, type, Number(lag.value));
        handle.close();
      } catch (error) {
        handle.showAlert((error as ActionFailure).text);
        add.disabled = false;
      }
    })();
  });

  append(handle.body, [combo.node, group, field('Lag in working days', lag), add]);
  combo.input.focus();
}

/* --------------------------------------------------------------- holidays */

export function openHolidaysDialog(opener: Opener): void {
  const handle = openDialog({ label: 'Holidays', opener });
  const list = h('ul', { role: 'list', 'aria-label': 'Holidays', class: 'plain-list' });
  const draw = (): void => {
    clear(list);
    for (const holiday of state.project!.holidays) {
      const entry = h('li', { role: 'listitem' }, [`${longDate(holiday.date)} ${holiday.name}`]);
      if (canEdit()) {
        const remove = h('button', { type: 'button', text: `Remove ${holiday.name}` });
        remove.addEventListener('click', () => {
          void (async () => {
            remove.disabled = true;
            try {
              await removeHoliday(holiday.date, holiday.name);
              draw();
            } catch (error) {
              handle.showAlert((error as ActionFailure).text);
              remove.disabled = false;
            }
          })();
        });
        entry.appendChild(remove);
      }
      list.appendChild(entry);
    }
  };
  draw();
  handle.body.appendChild(list);

  if (canEdit()) {
    const date = textInput('');
    const name = textInput('');
    const add = h('button', { type: 'button', class: 'primary', text: 'Add holiday' });
    add.addEventListener('click', () => {
      void (async () => {
        handle.showAlert('');
        if (!isIsoDate(date.value.trim())) {
          handle.showAlert(ALERTS.holidayDate);
          return;
        }
        const label = name.value.trim();
        if (label.length < 1 || label.length > 60) {
          handle.showAlert(ALERTS.holidayName);
          return;
        }
        add.disabled = true;
        try {
          await addHoliday(date.value.trim(), label);
          date.value = '';
          name.value = '';
          draw();
        } catch (error) {
          handle.showAlert((error as ActionFailure).text);
        }
        add.disabled = false;
      })();
    });
    append(handle.body, [field('Date', date), field('Holiday name', name), add]);
    date.focus();
  }
}

/* --------------------------------------------------------------- baseline */

export function openBaselineDialog(opener: Opener): void {
  const handle = openDialog({ label: 'Save baseline', opener });
  const existing = state.project!.baseline;
  const name = textInput('');
  const save = h('button', { type: 'button', class: 'primary', text: 'Save baseline' });
  save.addEventListener('click', () => {
    void (async () => {
      handle.showAlert('');
      const label = name.value.trim();
      if (label.length < 1 || label.length > 60) {
        handle.showAlert(ALERTS.baselineName);
        return;
      }
      save.disabled = true;
      try {
        await saveBaseline(label, existing !== null);
        clear(handle.body);
        handle.heading.textContent = 'Baseline set';
        handle.root.classList.add('baseline-set');
        const back = h('button', { type: 'button', class: 'primary', text: 'Back to plan' });
        back.addEventListener('click', handle.close);
        handle.body.appendChild(back);
        back.focus();
      } catch (error) {
        handle.showAlert((error as ActionFailure).text);
        save.disabled = false;
      }
    })();
  });
  append(handle.body, [
    field('Baseline name', name),
    existing ? h('p', { class: 'replace-note', text: `This replaces the baseline ${existing.name}.` }) : null,
    save,
  ]);
  name.focus();
}

/* --------------------------------------------------------- progress sheet */

export function openProgressSheet(item: Item, opener: Opener): void {
  const handle = openDialog({
    label: 'Update progress',
    heading: item.name,
    opener,
    className: 'sheet',
  });
  const slider = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    'aria-label': 'Percent complete',
  }) as HTMLInputElement;
  slider.value = String(item.percent);
  const readout = h('span', { class: 'readout', text: `${item.percent}%` });
  slider.setAttribute('aria-valuetext', `${item.percent}%`);
  slider.addEventListener('input', () => {
    readout.textContent = `${slider.value}%`;
    slider.setAttribute('aria-valuetext', `${slider.value}%`);
  });

  const save = h('button', { type: 'button', class: 'primary', text: 'Save progress' });
  const cancel = h('button', { type: 'button', text: 'Cancel' });
  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      try {
        await setPercent(item, Number(slider.value));
        handle.close();
      } catch (error) {
        handle.showAlert((error as ActionFailure).text);
        save.disabled = false;
      }
    })();
  });
  cancel.addEventListener('click', handle.close);
  append(handle.body, [
    h('div', { class: 'slider-row' }, [slider, readout]),
    h('div', { class: 'row' }, [save, cancel]),
  ]);
  slider.focus();
}

/* ------------------------------------------------------- workload breakdown */

export function openWorkloadDay(
  person: WorkloadPerson,
  day: WorkloadDay,
  opener: Opener,
): void {
  const handle = openDialog({
    label: `${person.name}, ${longDate(day.date)}`,
    opener,
  });
  const list = h(
    'ul',
    { role: 'list', 'aria-label': 'Assignments', class: 'plain-list' },
    day.assignments.map((assignment) =>
      h('li', {
        role: 'listitem',
        text: `${assignment.project}: ${assignment.item}, ${formatHours(assignment.hours)} hours`,
      }),
    ),
  );
  handle.body.appendChild(list);
  const close = h('button', { type: 'button', text: 'Close' });
  close.addEventListener('click', handle.close);
  handle.body.appendChild(close);
  close.focus();
}
