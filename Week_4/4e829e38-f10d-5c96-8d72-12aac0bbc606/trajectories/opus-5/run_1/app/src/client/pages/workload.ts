import { api, type Workload } from '../api.js';
import { clear, el, on } from '../dom.js';
import { openDialog } from '../dialog.js';
import { labelledField } from '../forms.js';
import { enableDrag, elementUnder } from '../drag.js';
import { onLive } from '../live.js';
import { announce, statusRegion } from '../status.js';
import { state } from '../state.js';

export async function renderWorkload(
  main: HTMLElement,
  teamId: string,
  from: string | null,
): Promise<void> {
  main.className = 'page page--workload';
  const team = state.me.teams.find((t) => t.id === teamId);
  if (!team) {
    main.append(
      el('h1', { class: 'page__title' }, 'Project not found'),
      el('p', { class: 'empty__sentence' }, 'That workload is not in your teams.'),
    );
    return;
  }
  const status = statusRegion('Workload status');
  const grid = el('div', { role: 'grid', 'aria-label': 'Workload', class: 'workload' });
  const scroller = el('div', { class: 'workload__scroll' }, grid);
  main.append(
    el('header', { class: 'page__header' }, el('h1', { class: 'page__title' }, team.name)),
    status,
    scroller,
  );

  let data: Workload;

  const reassign = async (taskId: string, taskName: string, personId: string) => {
    const task = await api.get<{ version: number }>(`/api/tasks/${taskId}`);
    await api.patch(`/api/tasks/${taskId}`, { version: task.version, assigneeId: personId });
    const person = data.people.find((p) => p.id === personId);
    announce('Workload status', `${taskName} reassigned to ${person ? person.name : ''}`);
  };

  const openReassign = (taskId: string, taskName: string, opener: HTMLElement) => {
    openDialog({
      name: 'Reassign task',
      opener,
      build: (handle) => {
        const assignee = labelledField({
          name: 'Assignee',
          kind: 'select',
          options: data.people.map((person) => person.name),
        });
        const confirm = el('button', { type: 'submit', class: 'pill pill--dark' }, 'Reassign');
        const form = el('form', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, 'Reassign task'),
          assignee.wrap,
          el('div', { class: 'dialog-actions' }, confirm),
        ]) as HTMLFormElement;
        on(form, 'submit', (event) => {
          event.preventDefault();
          if (confirm.getAttribute('aria-busy') === 'true') return;
          confirm.setAttribute('aria-busy', 'true');
          const chosen = data.people.find(
            (person) => person.name === (assignee.input as HTMLSelectElement).value,
          );
          if (!chosen) return;
          void reassign(taskId, taskName, chosen.id).then(() => handle.close());
        });
        return form;
      },
    });
  };

  const openCell = (cellNode: HTMLElement) => {
    const personId = cellNode.dataset.person as string;
    const date = cellNode.dataset.date as string;
    const person = data.people.find((p) => p.id === personId);
    const cell = person?.cells.find((c) => c.date === date);
    if (!person || !cell) return;
    openDialog({
      name: `Tasks for ${person.name} on ${date}`,
      opener: cellNode,
      variant: 'popover',
      build: () => {
        const chips = cell.tasks.map((task) => {
          const chip = el(
            'button',
            { type: 'button', class: 'chip chip--task', 'data-task': task.id },
            task.name,
          );
          on(chip, 'keydown', (event) => {
            if (event.key === 'r' || event.key === 'R') {
              event.preventDefault();
              openReassign(task.id, task.name, chip);
            }
          });
          enableDrag(chip, {
            onStart: () => chip.classList.add('is-dragging'),
            onDrop: (x, y) => {
              chip.classList.remove('is-dragging');
              const row = elementUnder<HTMLElement>(x, y, '[data-person-row]');
              const target = row?.dataset.personRow;
              if (target && target !== personId) void reassign(task.id, task.name, target);
            },
          });
          return chip;
        });
        return el('div', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, `Tasks for ${person.name} on ${date}`),
          chips.length > 0
            ? el('div', { class: 'chip-row' }, chips)
            : el('p', { class: 'empty__sentence' }, 'Nothing on this day.'),
        ]);
      },
    });
  };

  const draw = () => {
    clear(grid);
    const header = el('div', { role: 'row', class: 'workload__row workload__row--head' }, [
      el('div', { role: 'columnheader', class: 'workload__cell workload__cell--name' }, 'Person'),
      ...data.days.map((day) =>
        el('div', { role: 'columnheader', class: 'workload__cell tabular' }, day),
      ),
    ]);
    grid.appendChild(header);
    for (const person of data.people) {
      const row = el('div', {
        role: 'row',
        class: 'workload__row',
        'data-person-row': person.id,
      });
      row.appendChild(
        el('div', { role: 'rowheader', class: 'workload__cell workload__cell--name' }, person.name),
      );
      for (const cell of person.cells) {
        const node = el(
          'div',
          {
            role: 'gridcell',
            tabindex: '-1',
            class: `workload__cell workload__cell--value${cell.over ? ' is-over' : ''}`,
            'data-person': person.id,
            'data-date': cell.date,
            'data-total': cell.total.toFixed(2),
            'data-over': cell.over ? 'true' : 'false',
          },
          cell.text,
        );
        row.appendChild(node);
      }
      grid.appendChild(row);
    }
    const first = grid.querySelector<HTMLElement>('.workload__cell--value');
    if (first) first.tabIndex = 0;
  };

  on(grid, 'keydown', (event) => {
    const current = (event.target as HTMLElement).closest(
      '.workload__cell--value',
    ) as HTMLElement | null;
    if (!current) return;
    const row = current.parentElement as HTMLElement;
    const cells = Array.from(row.querySelectorAll<HTMLElement>('.workload__cell--value'));
    const index = cells.indexOf(current);
    const rows = Array.from(grid.querySelectorAll<HTMLElement>('[data-person-row]'));
    const rowIndex = rows.indexOf(row);
    const move = (node: HTMLElement | undefined) => {
      if (!node) return;
      for (const other of grid.querySelectorAll<HTMLElement>('.workload__cell--value')) {
        other.tabIndex = -1;
      }
      node.tabIndex = 0;
      node.focus();
    };
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(cells[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(cells[index - 1]);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = rows[rowIndex + 1];
      if (next) move(Array.from(next.querySelectorAll<HTMLElement>('.workload__cell--value'))[index]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const previous = rows[rowIndex - 1];
      if (previous) {
        move(Array.from(previous.querySelectorAll<HTMLElement>('.workload__cell--value'))[index]);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openCell(current);
    }
  });

  const load = async () => {
    const query = from ? `?from=${encodeURIComponent(from)}` : '';
    data = await api.get<Workload>(`/api/teams/${teamId}/workload${query}`);
    draw();
  };

  await load();

  const stop = onLive((event) => {
    if (
      (event.type === 'workload_changed' || event.type === 'task_upserted') &&
      event.teamId === teamId
    ) {
      void load();
    }
  });
  main.addEventListener('page:teardown', stop, { once: true });
}
