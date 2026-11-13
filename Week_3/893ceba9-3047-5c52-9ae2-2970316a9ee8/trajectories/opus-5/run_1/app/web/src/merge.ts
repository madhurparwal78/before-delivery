// The merge screen: counts, conflicts, branch actions and operations.

import { Conflict, DeskError, Operation, Preview, Project, api } from './api';
import { labelledField, openModal } from './dialog';
import { clear, el, localTime, statusWord } from './dom';
import { announce, announceAcross, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { navigate } from './router';
import { openRestore } from './tm';

export async function renderMerge(
  screen: HTMLElement,
  project: Project,
  search: URLSearchParams,
): Promise<void> {
  const branch = search.get('branch') ?? 'main';
  const body = el('div', { class: 'content-column' });
  screen.append(body);

  const paint = async (): Promise<void> => {
    const [preview, operations] = await Promise.all([
      api.get<Preview>(
        `/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/merge-preview`,
      ),
      api.get<{ operations: Operation[] }>(`/api/projects/${project.slug}/operations`),
    ]);
    clear(body);
    body.append(
      el('h1', { text: `Merge ${branch} into main` }),
      el('dl', { class: 'counts card' }, [
        el('dt', { text: 'New keys' }),
        el('dd', { class: 'tabular', text: String(preview.new_keys) }),
        el('dt', { text: 'Edited keys' }),
        el('dd', { class: 'tabular', text: String(preview.edited_keys) }),
        el('dt', { text: 'Deleted keys' }),
        el('dd', { class: 'tabular', text: String(preview.deleted_keys) }),
        el('dt', { text: 'Below MQM threshold' }),
        el('dd', { class: 'tabular', text: String(preview.below_threshold) }),
      ]),
      conflictTable(project, branch, preview, paint),
      branchActions(project, branch, preview, paint),
      operationList(project, operations.operations, paint),
    );
  };

  await paint();
}

function conflictTable(
  project: Project,
  branch: string,
  preview: Preview,
  reload: () => Promise<void>,
): HTMLElement {
  const card = el('div', { class: 'card' }, [el('h2', { text: 'Conflicts' })]);
  if (preview.conflicts.length === 0) {
    card.append(el('p', { text: 'No conflicts with main.' }));
    return card;
  }
  card.append(
    el('table', { class: 'plain-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Key' }),
          el('th', { text: 'Field' }),
          el('th', { text: 'Base' }),
          el('th', { text: 'Main' }),
          el('th', { text: 'Branch' }),
          el('th', { text: 'Resolution' }),
        ]),
      ]),
      el('tbody', {}, preview.conflicts.map((conflict) =>
        el('tr', {}, [
          el('td', { text: conflict.key }),
          el('td', { text: conflict.field }),
          el('td', { text: conflict.base ?? '' }),
          el('td', { text: conflict.main ?? '' }),
          el('td', { text: conflict.branch ?? '' }),
          el('td', {}, [
            conflict.resolution
              ? el('span', { text: `${conflict.resolution.choice}: ${conflict.resolution.value ?? ''}` })
              : el('button', {
                  type: 'button',
                  class: 'button outline',
                  text: `Resolve ${conflict.key} ${conflict.field}`,
                  onclick: (event: Event) =>
                    void holdAndResolve(project, branch, conflict, event.currentTarget as HTMLElement, reload),
                }),
          ]),
        ]),
      )),
    ]),
  );
  return card;
}

// holdAndResolve asks the server for a hold before opening the dialog.
async function holdAndResolve(
  project: Project,
  branch: string,
  conflict: Conflict,
  opener: HTMLElement,
  reload: () => Promise<void>,
): Promise<void> {
  clearProblem();
  announce('Holding conflict.');
  let heldUntil = '';
  try {
    const answer = await api.post<{ conflict_id: string; held_until: string }>(
      `/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/conflicts/${encodeURIComponent(conflict.id)}/hold`,
    );
    heldUntil = answer.held_until;
    announce(`Holding this conflict for you until ${localTime(heldUntil)}.`);
  } catch (error) {
    announce('');
    if (error instanceof DeskError) problem(failureCopy(error));
    return;
  }

  openModal({
    name: 'Resolve conflict',
    opener,
    body: (handle) => {
      const value = el('textarea', { 'data-field': 'value', rows: '3', disabled: true });
      const radios = (['main', 'branch', 'custom'] as const).map((choice) => {
        const label = choice === 'custom' ? 'Write a new value' : `Keep ${choice}`;
        const input = el('input', {
          type: 'radio',
          name: 'choice',
          value: choice,
          'aria-label': label,
          onchange: () => {
            value.disabled = choice !== 'custom';
            if (choice === 'custom') value.focus();
          },
        });
        return el('label', { class: 'radio' }, [input, label]);
      });
      const save = el('button', { type: 'submit', class: 'button primary', text: 'Save resolution' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          const chosen = form.querySelector<HTMLInputElement>('input[name="choice"]:checked');
          if (!chosen) {
            showFieldErrors(form, { value: 'Choose which value to keep.' });
            return;
          }
          save.disabled = true;
          announce('Saving resolution.');
          try {
            await api.put(
              `/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/conflicts/${encodeURIComponent(conflict.id)}`,
              chosen.value === 'custom'
                ? { choice: 'custom', value: value.value }
                : { choice: chosen.value },
            );
            announce('Resolution saved.');
            handle.close();
            await reload();
          } catch (error) {
            save.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Resolve conflict' }),
        el('p', { text: `${conflict.key} (${conflict.field})` }),
        ...radios,
        labelledField('New value', value),
        el('div', { class: 'dialog-actions' }, [
          save,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

function branchActions(
  project: Project,
  branch: string,
  preview: Preview,
  reload: () => Promise<void>,
): HTMLElement {
  const transition = async (to: string, button: HTMLButtonElement): Promise<void> => {
    clearProblem();
    button.disabled = true;
    announce('Updating branch.');
    try {
      await api.post(
        `/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/transitions`,
        { to },
      );
      announce(`Branch ${branch} is ${statusWord(to)}.`);
      await reload();
    } catch (error) {
      button.disabled = false;
      announce('');
      if (error instanceof DeskError) problem(failureCopy(error, { from: statusWord(preview.state) }));
    }
  };

  const request = el('button', { type: 'button', class: 'button outline', text: 'Request review' });
  request.addEventListener('click', () => void transition('in_review', request));
  const reopen = el('button', { type: 'button', class: 'button outline', text: 'Reopen branch' });
  reopen.addEventListener('click', () => void transition('open', reopen));
  const merge = el('button', { type: 'button', class: 'button primary', text: 'Merge into main' });
  merge.addEventListener('click', async () => {
    clearProblem();
    merge.disabled = true;
    announce(`Merging ${branch} into main.`);
    try {
      await api.post(`/api/projects/${project.slug}/branches/${encodeURIComponent(branch)}/merge`);
      announceAcross(`Merged ${branch} into main.`);
      navigate(`/projects/${project.slug}`);
    } catch (error) {
      merge.disabled = false;
      announce('');
      if (error instanceof DeskError) problem(failureCopy(error, { from: statusWord(preview.state) }));
    }
  });
  const abandon = el('button', { type: 'button', class: 'button quiet', text: 'Abandon branch' });
  abandon.addEventListener('click', () => {
    openModal({
      name: 'Abandon branch',
      opener: abandon,
      body: (handle) => [
        el('h2', { text: 'Abandon branch' }),
        el('p', { text: `Abandoning ${branch} leaves main untouched and closes the branch for good.` }),
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'button primary',
            text: 'Abandon',
            onclick: async () => {
              handle.close();
              await transition('abandoned', abandon);
            },
          }),
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ],
    });
  });

  return el('div', { class: 'card branch-actions' }, [
    el('h2', { text: 'Branch' }),
    el('p', { text: `${branch} is ${statusWord(preview.state)}.` }),
    el('div', { class: 'action-row' }, [request, reopen, merge, abandon]),
  ]);
}

function operationList(
  project: Project,
  operations: Operation[],
  reload: () => Promise<void>,
): HTMLElement {
  const card = el('div', { class: 'card' }, [el('h2', { text: 'Operations' })]);
  if (operations.length === 0) {
    card.append(el('p', { text: 'No imports or merges yet.' }));
    return card;
  }
  for (const operation of operations) {
    card.append(
      el('div', { class: 'import-row' }, [
        el('span', { text: `${operation.label} at ${localTime(operation.at)}` }),
        el('button', {
          type: 'button',
          class: 'button outline',
          text: 'Restore',
          disabled: !operation.restorable,
          onclick: (event: Event) =>
            openRestore(project, operation.id, operation.kind, event.currentTarget as HTMLElement, reload),
        }),
      ]),
    );
  }
  return card;
}
