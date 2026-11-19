import { api, ApiCallError, upload, type RuleRun, type TaskDetail } from '../api.js';
import { confirmDelete, openDialog } from '../dialog.js';
import { clear, el, on, trapFocus } from '../dom.js';
import { openDecideDialog } from '../decide.js';
import { animate, fixed2, reducedMotion } from '../motion.js';
import { clearStorageOutage, showStorageOutage } from '../outage.js';
import { patchTask } from '../save.js';
import { announce, statusRegion } from '../status.js';
import { settings, state, viewport } from '../state.js';
import { cellName, memberName, valueText, type ProjectContext } from './shared.js';

const APPROVAL_CHIP: Record<string, string> = {
  requested: 'Awaiting approval',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};

export interface DetailPanel {
  node: HTMLElement;
  taskId: string;
  close: () => void;
  refresh: () => Promise<void>;
  applyHold: (field: string, holder: { id: string; name: string } | null) => void;
  applyViewing: (viewing: { id: string; name: string }[]) => void;
  addRun: (run: RuleRun) => void;
  applyApproval: (status: string) => void;
}

export async function openDetail(options: {
  context: ProjectContext;
  taskId: string;
  opener: HTMLElement | null;
  host: HTMLElement;
  onClose: () => void;
}): Promise<DetailPanel> {
  const { context, taskId } = options;
  let detail = await api.get<TaskDetail>(`/api/tasks/${taskId}`);
  const asDialog = viewport() !== 1280;

  const node = el(asDialog ? 'div' : 'aside', {
    role: asDialog ? 'dialog' : 'complementary',
    'aria-modal': asDialog ? 'true' : null,
    'aria-label': `Task: ${detail.name}`,
    class: asDialog ? `task-detail task-detail--sheet task-detail--${viewport()}` : 'task-detail',
  });

  const close = () => {
    releaseTrap?.();
    void api.post(`/api/tasks/${taskId}/presence`, { leaving: true }).catch(() => undefined);
    void api.del(`/api/tasks/${taskId}/hold`, { field: 'name' }).catch(() => undefined);
    void api.del(`/api/tasks/${taskId}/hold`, { field: 'description' }).catch(() => undefined);
    node.remove();
    options.onClose();
    if (options.opener && options.opener.isConnected) options.opener.focus();
  };

  const releaseTrap = asDialog ? trapFocus(node, close) : null;

  const closeButton = el(
    'button',
    { type: 'button', class: 'icon-button', 'aria-label': 'Close task' },
    'Close task',
  );
  on(closeButton, 'click', close);

  const title = el('h2', { class: 'task-detail__title' }, detail.name);
  const approvalChip = el('span', { class: 'chip chip--status' });
  const header = el('header', { class: 'task-detail__header' }, [title, approvalChip, closeButton]);

  const nameInput = el('input', {
    class: 'input',
    'aria-label': 'Name',
    value: detail.name,
  }) as HTMLInputElement;
  const nameLock = el('p', { class: 'field__hint field__hint--lock', hidden: true });
  const saveName = el('button', { type: 'button', class: 'pill pill--dark' }, 'Save name');
  const descriptionInput = el('textarea', {
    class: 'input input--area',
    'aria-label': 'Description',
  }) as HTMLTextAreaElement;
  descriptionInput.value = detail.description;
  const descriptionLock = el('p', { class: 'field__hint field__hint--lock', hidden: true });
  const saveDescription = el(
    'button',
    { type: 'button', class: 'pill pill--dark' },
    'Save description',
  );

  const assignee = el('select', { class: 'input', 'aria-label': 'Assignee', role: 'combobox' }) as HTMLSelectElement;
  assignee.appendChild(el('option', { value: '' }, 'Unassigned'));
  for (const member of context.project.members) {
    assignee.appendChild(el('option', { value: member.id }, member.name));
  }
  assignee.value = detail.assigneeId ?? '';
  const start = el('input', {
    class: 'input',
    type: 'date',
    'aria-label': 'Start',
    value: detail.start ?? '',
  }) as HTMLInputElement;
  const due = el('input', {
    class: 'input',
    type: 'date',
    'aria-label': 'Due',
    value: detail.due ?? '',
  }) as HTMLInputElement;
  const effort = el('input', {
    class: 'input',
    type: 'text',
    'aria-label': 'Effort',
    value: detail.effort === null ? '' : String(detail.effort),
  }) as HTMLInputElement;

  const valuesHost = el('div', { class: 'task-detail__values' });
  const viewingList = el('ul', { class: 'detail-list', 'aria-label': 'Viewing now' });
  const runsList = el('ul', { class: 'detail-list detail-list--runs', 'aria-label': 'Rule runs' });
  const historyList = el('ul', { class: 'detail-list', 'aria-label': 'History' });
  const attachmentsList = el('ul', { class: 'detail-list', 'aria-label': 'Attachments' });
  const attachmentAlert = el('div', { role: 'alert', class: 'field__error', hidden: true });

  const fileInput = el('input', { type: 'file', class: 'visually-hidden' }) as HTMLInputElement;
  const attachFile = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Attach file');
  on(attachFile, 'click', () => fileInput.click());
  on(fileInput, 'change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    attachmentAlert.hidden = true;
    void upload(`/api/tasks/${taskId}/attachments`, file)
      .then(() => {
        clearStorageOutage();
        void refresh();
      })
      .catch((err) => {
        if (err instanceof ApiCallError) {
          attachmentAlert.hidden = false;
          if (err.failure.error === 'file_too_large') {
            attachmentAlert.textContent = `File is larger than ${settings.uploadLabel}`;
          } else if (err.failure.error === 'storage_unavailable') {
            attachmentAlert.textContent =
              'Attachment failed: file storage is unavailable. Nothing was saved.';
            showStorageOutage();
          } else {
            attachmentAlert.textContent = err.failure.errors?.file ?? 'Choose a file to attach';
          }
        }
      })
      .finally(() => {
        fileInput.value = '';
      });
  });

  const deleteTask = el('button', { type: 'button', class: 'pill pill--dark' }, 'Delete task');
  on(deleteTask, 'click', () => {
    confirmDelete({
      name: detail.name,
      opener: deleteTask,
      onDelete: async () => {
        await api.del(`/api/tasks/${taskId}`);
        announce('List status', 'Task deleted');
        close();
      },
    });
  });

  const approver = el('select', { class: 'input', 'aria-label': 'Approver', role: 'combobox' }) as HTMLSelectElement;
  for (const member of context.project.members) {
    approver.appendChild(el('option', { value: member.id }, member.name));
  }
  const requestApproval = el(
    'button',
    { type: 'button', class: 'pill pill--ghost' },
    'Request approval',
  );
  const decide = el('button', { type: 'button', class: 'pill pill--dark' }, 'Decide');
  on(requestApproval, 'click', () => {
    if (requestApproval.getAttribute('aria-busy') === 'true') return;
    requestApproval.setAttribute('aria-busy', 'true');
    void api
      .post(`/api/tasks/${taskId}/approval`, { approverId: approver.value })
      .then(() => void refresh())
      .catch(() => undefined)
      .finally(() => requestApproval.removeAttribute('aria-busy'));
  });
  on(decide, 'click', () => openDecideDialog({ taskId, taskName: detail.name, opener: decide }));

  const staleDialog = (field: 'name' | 'description', mine: string) => {
    openDialog({
      name: 'This task changed',
      opener: field === 'name' ? saveName : saveDescription,
      build: (handle) => {
        const loadLatest = el('button', { type: 'button', class: 'pill pill--dark' }, 'Load latest');
        const keepMine = el('button', { type: 'button', class: 'pill pill--ghost' }, 'Keep my edit');
        on(loadLatest, 'click', () => {
          void api.get<TaskDetail>(`/api/tasks/${taskId}`).catch(() => null).then((fresh) => {
            if (!fresh) return;
            detail = fresh;
            editBase[field] = null;
            if (field === 'name') nameInput.value = fresh.name;
            else descriptionInput.value = fresh.description;
            draw();
            handle.close();
          });
        });
        on(keepMine, 'click', () => {
          void api.get<TaskDetail>(`/api/tasks/${taskId}`).catch(() => null).then(async (fresh) => {
            if (!fresh) return;
            await patchTask(taskId, { version: fresh.version, [field]: mine });
            editBase[field] = null;
            handle.close();
            void refresh();
          });
        });
        return el('div', { class: 'dialog-body stack' }, [
          el('h2', { class: 'dialog-title' }, 'This task changed'),
          el('p', { class: 'dialog-copy' }, 'Someone saved this task after you opened it.'),
          el('div', { class: 'dialog-actions' }, [loadLatest, keepMine]),
        ]);
      },
    });
  };

  /** The version a field was opened at, so a later save can be refused as stale. */
  const editBase: Record<'name' | 'description', number | null> = { name: null, description: null };

  const takeHold = (field: 'name' | 'description') => {
    if (editBase[field] === null) editBase[field] = detail.version;
    void api.post(`/api/tasks/${taskId}/hold`, { field }).catch(() => undefined);
  };
  on(nameInput, 'focus', () => takeHold('name'));
  on(descriptionInput, 'focus', () => takeHold('description'));

  const saveField = async (field: 'name' | 'description', value: string) => {
    const outcome = await patchTask(taskId, {
      version: editBase[field] ?? detail.version,
      [field]: value,
    });
    if (outcome.stale) {
      staleDialog(field, value);
      return;
    }
    if (outcome.task) {
      detail = { ...detail, ...outcome.task };
      editBase[field] = null;
      await api.del(`/api/tasks/${taskId}/hold`, { field }).catch(() => undefined);
      void refresh();
    }
  };
  on(saveName, 'click', () => {
    if (saveName.getAttribute('aria-busy') === 'true') return;
    saveName.setAttribute('aria-busy', 'true');
    void saveField('name', nameInput.value).finally(() => saveName.removeAttribute('aria-busy'));
  });
  on(saveDescription, 'click', () => {
    if (saveDescription.getAttribute('aria-busy') === 'true') return;
    saveDescription.setAttribute('aria-busy', 'true');
    void saveField('description', descriptionInput.value).finally(() =>
      saveDescription.removeAttribute('aria-busy'),
    );
  });

  const saveOnChange = (
    control: HTMLInputElement | HTMLSelectElement,
    build: () => Record<string, unknown>,
  ) => {
    on(control, 'change', () => {
      void patchTask(taskId, { version: detail.version, ...build() }, { toastOnSuccess: true }).then(
        (outcome) => {
          if (outcome.task) detail = { ...detail, ...outcome.task };
        },
      );
    });
  };
  saveOnChange(assignee, () => ({ assigneeId: assignee.value === '' ? null : assignee.value }));
  saveOnChange(start, () => ({ start: start.value === '' ? null : start.value }));
  saveOnChange(due, () => ({ due: due.value === '' ? null : due.value }));
  saveOnChange(effort, () => ({ effort: effort.value === '' ? null : Number(effort.value) }));

  const drawRuns = (runs: RuleRun[]) => {
    clear(runsList);
    for (const run of runs) runsList.appendChild(runRow(run, false));
  };

  const runRow = (run: RuleRun, entering: boolean): HTMLElement => {
    const row = el('li', {
      class: 'run',
      'data-depth': String(run.depth),
      'data-run': run.id,
      'data-motion': entering && !reducedMotion() ? 'entering' : 'settled',
      'data-slide-offset': entering && !reducedMotion() ? '8.00' : '0.00',
      style: `padding-left:${run.depth * 16}px`,
    });
    row.append(
      el('span', { 'data-part': 'summary', class: 'run__summary' }, run.summary),
      el('span', { 'data-part': 'detail', class: 'run__detail' }, run.detail),
    );
    return row;
  };

  const addRun = (run: RuleRun) => {
    if (runsList.querySelector(`[data-run="${run.id}"]`)) return;
    const row = runRow(run, true);
    runsList.appendChild(row);
    animate(
      160,
      (eased) => {
        const offset = 8 * (1 - eased);
        row.setAttribute('data-slide-offset', fixed2(offset));
        row.style.setProperty('--slide', `${offset}px`);
      },
      () => {
        row.setAttribute('data-slide-offset', '0.00');
        row.setAttribute('data-motion', 'settled');
        row.style.removeProperty('--slide');
      },
    );
  };

  const applyHold = (field: string, holder: { id: string; name: string } | null) => {
    const input = field === 'name' ? nameInput : descriptionInput;
    const lock = field === 'name' ? nameLock : descriptionLock;
    if (holder && holder.id !== state.me.id) {
      input.setAttribute('aria-readonly', 'true');
      input.readOnly = true;
      lock.hidden = false;
      lock.textContent = `Being edited by ${holder.name}`;
      return;
    }
    input.removeAttribute('aria-readonly');
    input.readOnly = false;
    lock.hidden = true;
    lock.textContent = '';
  };

  const applyViewing = (viewing: { id: string; name: string }[]) => {
    clear(viewingList);
    for (const person of viewing) {
      viewingList.appendChild(el('li', { 'data-person': person.id }, person.name));
    }
  };

  const applyApproval = (status: string) => {
    approvalChip.textContent = APPROVAL_CHIP[status] ?? '';
    approvalChip.hidden = !(status in APPROVAL_CHIP);
    decide.hidden = !(status === 'requested' && detail.approval.approverId === state.me.id);
  };

  const draw = () => {
    title.textContent = detail.name;
    node.setAttribute('aria-label', `Task: ${detail.name}`);
    if (editBase.name === null) nameInput.value = detail.name;
    if (editBase.description === null) descriptionInput.value = detail.description;
    if (document.activeElement !== assignee) assignee.value = detail.assigneeId ?? '';
    if (document.activeElement !== start) start.value = detail.start ?? '';
    if (document.activeElement !== due) due.value = detail.due ?? '';
    if (document.activeElement !== effort) {
      effort.value = detail.effort === null ? '' : String(detail.effort);
    }

    clear(valuesHost);
    for (const field of context.project.fields) {
      const value = detail.values[field.name];
      const row = el('div', { class: 'detail-value', 'data-field': field.id }, [
        el('span', { class: 'detail-value__label' }, field.name),
        el(
          'span',
          { class: 'detail-value__value tabular', 'aria-label': cellName(field, value) },
          valueText(value),
        ),
      ]);
      valuesHost.appendChild(row);
    }

    clear(historyList);
    for (const entry of detail.history) {
      historyList.appendChild(el('li', {}, entry.text));
    }
    clear(attachmentsList);
    for (const attachment of detail.attachments) {
      attachmentsList.appendChild(
        el('li', { 'data-attachment': attachment.id }, [
          el('a', { href: `/api/attachments/${attachment.id}` }, attachment.name),
          el('span', { class: 'tabular' }, `${attachment.size} bytes`),
        ]),
      );
    }
    applyViewing(detail.viewing);
    applyApproval(detail.approval.status);
    for (const field of ['name', 'description']) {
      const hold = detail.holds.find((candidate) => candidate.field === field);
      applyHold(field, hold ? { id: hold.personId, name: hold.name } : null);
    }
    if (detail.assigneeId) {
      const owner = memberName(context.project, detail.assigneeId);
      assignee.setAttribute('data-owner', owner);
    }
  };

  const refresh = async () => {
    detail = await api.get<TaskDetail>(`/api/tasks/${taskId}`);
    draw();
    const runs = await api.get<{ runs: RuleRun[] }>(`/api/tasks/${taskId}/rule-runs`);
    drawRuns(runs.runs);
  };

  node.append(
    header,
    statusRegion('Approval status'),
    el('div', { class: 'task-detail__body stack' }, [
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, 'Name'),
        nameInput,
        nameLock,
        saveName,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field__label' }, 'Description'),
        descriptionInput,
        descriptionLock,
        saveDescription,
      ]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label' }, 'Assignee'), assignee]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label' }, 'Start'), start]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label' }, 'Due'), due]),
      el('div', { class: 'field' }, [el('span', { class: 'field__label' }, 'Effort'), effort]),
      valuesHost,
      el('div', { class: 'task-detail__approval' }, [requestApproval, approver, decide]),
      el('section', {}, [el('h3', { class: 'detail-heading' }, 'Viewing now'), viewingList]),
      el('section', {}, [el('h3', { class: 'detail-heading' }, 'Rule runs'), runsList]),
      el('section', {}, [el('h3', { class: 'detail-heading' }, 'History'), historyList]),
      el('section', {}, [
        el('h3', { class: 'detail-heading' }, 'Attachments'),
        attachmentAlert,
        attachmentsList,
        attachFile,
        fileInput,
      ]),
      deleteTask,
    ]),
  );

  options.host.replaceChildren(node);
  draw();
  const runs = await api.get<{ runs: RuleRun[] }>(`/api/tasks/${taskId}/rule-runs`);
  drawRuns(runs.runs);
  void api.post(`/api/tasks/${taskId}/presence`, {}).catch(() => undefined);
  const first = node.querySelector<HTMLElement>('input, button, select, textarea');
  if (first) first.focus();

  return { node, taskId, close, refresh, applyHold, applyViewing, addRun, applyApproval };
}
