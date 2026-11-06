import type { ImportPlanView, Member, RejectedEntry } from '../../shared/api.js';
import { copy, rejectionReasons } from '../copy.js';
import { openDialog } from '../dialog.js';
import { clear, el, on } from '../dom.js';
import { api, newIdempotencyKey, RequestFailed } from '../net.js';
import type { StatusBoard } from './status.js';
import type { WorkspaceStore } from './store.js';

const ZIP_LIMIT_BYTES = 5_000_000;

export function openScheduleDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const title = el('input', { type: 'text', id: 'session-title', 'aria-label': 'Session title' });
  const startsAt = el('input', { type: 'text', id: 'session-start', 'aria-label': 'Starts at' });
  startsAt.value = new Date(Date.now() + 3_600_000).toISOString();
  const submit = el('button', { type: 'button' }, ['Schedule']);

  const dialog = openDialog(
    { role: 'dialog', name: 'Schedule session', heading: 'Schedule session' },
    () => [
      el('div', { class: 'field' }, [el('label', { for: 'session-title' }, ['Session title']), title]),
      el('div', { class: 'field' }, [el('label', { for: 'session-start' }, ['Starts at']), startsAt]),
      el('div', { class: 'dialog-actions' }, [submit]),
    ],
  );

  on(submit, 'click', () => {
    void (async () => {
      submit.disabled = true;
      statuses.pending('Session status', copy.session.pending);
      try {
        await api(`/api/projects/${store.projectId}/sessions`, {
          method: 'POST',
          body: { title: title.value, scheduled_for: new Date(startsAt.value).toISOString() },
        });
        await store.loadProject();
        dialog.close();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Session status', copy.generic);
      } finally {
        submit.disabled = false;
      }
    })();
  });
}

export function openMembersDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const email = el('input', { type: 'email', id: 'learner-email', 'aria-label': 'Learner email' });
  const name = el('input', { type: 'text', id: 'learner-name', 'aria-label': 'Learner name' });
  const invite = el('button', { type: 'button' }, ['Send invite']);
  const list = el('div', { role: 'list', 'aria-label': 'Members' });
  const membersStatus = statuses.create('Members status');

  openDialog({ role: 'dialog', name: 'Members', heading: 'Members' }, () => [
    el('div', { class: 'field' }, [el('label', { for: 'learner-email' }, ['Learner email']), email]),
    el('div', { class: 'field' }, [el('label', { for: 'learner-name' }, ['Learner name']), name]),
    invite,
    list,
    membersStatus,
  ]);

  const redraw = (): void => {
    clear(list);
    for (const member of store.participants) {
      const row = el('div', { role: 'listitem', class: 'member-row' }, [
        el('span', { class: 'who' }, [member.name]),
      ]);
      if (member.email_status === 'queued') {
        row.append(el('span', { class: 'chip' }, ['Email queued']));
      }
      if (member.role === 'student') {
        const remove = el('button', { type: 'button', 'aria-label': `Remove ${member.name}` }, [
          'Remove',
        ]);
        on(remove, 'click', () => confirmRemoval(store, statuses, member, redraw));
        row.append(remove);
      }
      list.append(row);
    }
  };
  redraw();

  on(invite, 'click', () => {
    void (async () => {
      invite.disabled = true;
      statuses.pending('Members status', copy.members.pending);
      try {
        const created = await api<{ member: Member; invite: { email: string; email_status: string } }>(
          `/api/projects/${store.projectId}/invites`,
          {
            method: 'POST',
            body: { email: email.value.trim(), name: name.value.trim() },
            idempotencyKey: newIdempotencyKey(),
          },
        );
        const chip = el('span', { class: 'chip' }, [
          created.invite.email_status === 'sent' ? 'Email sent' : 'Email queued',
        ]);
        statuses.set('Members status', copy.members.success(created.invite.email), chip);
        email.value = '';
        name.value = '';
        await store.loadProject();
        redraw();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Members status', inviteError(cause));
      } finally {
        invite.disabled = false;
      }
    })();
  });
}

function inviteError(cause: RequestFailed): string {
  if (cause.code === 'seat_taken') return copy.members.seatTaken;
  if (cause.code === 'group_full') return copy.members.groupFull;
  if (cause.field('email') !== undefined) return copy.signIn.fieldError;
  if (cause.field('name') !== undefined) return copy.members.nameError;
  return copy.generic;
}

function confirmRemoval(
  store: WorkspaceStore,
  statuses: StatusBoard,
  member: Member,
  redraw: () => void,
): void {
  const remove = el('button', { type: 'button', class: 'danger' }, ['Remove']);
  const cancel = el('button', { type: 'button' }, ['Cancel']);
  const dialog = openDialog(
    {
      role: 'alertdialog',
      name: `Remove ${member.name}?`,
      heading: `Remove ${member.name}?`,
      destructive: true,
    },
    () => [
      el('p', {}, [copy.members.confirmBody]),
      el('div', { class: 'dialog-actions' }, [remove, cancel]),
    ],
  );
  on(cancel, 'click', () => dialog.close());
  on(remove, 'click', () => {
    void (async () => {
      remove.disabled = true;
      statuses.pending('Members status', copy.members.removalPending(member.name));
      try {
        await api(`/api/projects/${store.projectId}/members/${member.user_id}`, {
          method: 'DELETE',
        });
        await store.loadProject();
        statuses.set('Members status', copy.members.removed(member.name));
        redraw();
        dialog.close();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Members status', copy.generic);
      } finally {
        remove.disabled = false;
      }
    })();
  });
}

export function openNewFileDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const path = el('input', { type: 'text', id: 'new-file-path', 'aria-label': 'File path' });
  const create = el('button', { type: 'button' }, ['Create file']);
  const dialog = openDialog(
    { role: 'dialog', name: 'New file', heading: 'New file' },
    () => [
      el('div', { class: 'field' }, [el('label', { for: 'new-file-path' }, ['File path']), path]),
      el('div', { class: 'dialog-actions' }, [create]),
    ],
  );
  on(create, 'click', () => {
    void (async () => {
      create.disabled = true;
      try {
        const created = await api<{ file: { id: string } }>(
          `/api/projects/${store.projectId}/files`,
          { method: 'POST', body: { path: path.value, content: '' } },
        );
        await store.loadFiles();
        await store.openFile(created.file.id);
        dialog.close();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Editor status', copy.generic);
      } finally {
        create.disabled = false;
      }
    })();
  });
}

export function openRenameDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const selected = store.selectedPath;
  const isFolder = selected !== null && !store.files.some((file) => file.path === selected);
  const path = el('input', { type: 'text', id: 'rename-path', 'aria-label': 'New path' });
  path.value = selected ?? '';
  const save = el('button', { type: 'button' }, ['Save name']);
  const dialog = openDialog({ role: 'dialog', name: 'Rename', heading: 'Rename' }, () => [
    el('div', { class: 'field' }, [el('label', { for: 'rename-path' }, ['New path']), path]),
    el('div', { class: 'dialog-actions' }, [save]),
  ]);

  on(save, 'click', () => {
    void (async () => {
      if (selected === null) return;
      save.disabled = true;
      try {
        if (isFolder) {
          await api(`/api/projects/${store.projectId}/folders/rename`, {
            method: 'POST',
            body: { from: selected, to: path.value },
          });
        } else {
          const file = store.files.find((item) => item.path === selected);
          if (file === undefined) return;
          await api(`/api/projects/${store.projectId}/files/${file.id}`, {
            method: 'PATCH',
            body: { path: path.value },
          });
        }
        store.selectedPath = path.value;
        await store.loadFiles();
        dialog.close();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Editor status', copy.generic);
      } finally {
        save.disabled = false;
      }
    })();
  });
}

export function openDeleteDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const file = store.files.find((item) => item.path === store.selectedPath);
  if (file === undefined) return;
  const remove = el('button', { type: 'button', class: 'danger' }, ['Delete']);
  const cancel = el('button', { type: 'button' }, ['Cancel']);
  const dialog = openDialog(
    {
      role: 'alertdialog',
      name: `Delete ${file.path}?`,
      heading: `Delete ${file.path}?`,
      destructive: true,
    },
    () => [el('div', { class: 'dialog-actions' }, [remove, cancel])],
  );
  on(cancel, 'click', () => dialog.close());
  on(remove, 'click', () => {
    void (async () => {
      remove.disabled = true;
      try {
        await api(`/api/projects/${store.projectId}/files/${file.id}`, { method: 'DELETE' });
        await store.loadFiles();
        dialog.close();
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Editor status', copy.generic);
      } finally {
        remove.disabled = false;
      }
    })();
  });
}

function describeRejection(entries: RejectedEntry[]): Node[] {
  const lines: Node[] = [
    document.createTextNode(copy.importing.rejected(entries.length)),
  ];
  for (const entry of entries) {
    const reason = rejectionReasons[entry.reason];
    lines.push(
      el('div', {}, [`${entry.path} — ${reason === undefined ? entry.reason : reason(entry.limit)}`]),
    );
  }
  return lines;
}

export function openImportDialog(store: WorkspaceStore, statuses: StatusBoard): void {
  const input = el('input', { type: 'file', id: 'starter-zip', accept: '.zip' });
  const check = el('button', { type: 'button' }, ['Check zip']);
  const dialog = openDialog(
    { role: 'dialog', name: 'Import zip', heading: 'Import zip' },
    () => [
      el('div', { class: 'field' }, [el('label', { for: 'starter-zip' }, ['Starter zip']), input]),
      el('p', {}, [copy.importing.limits]),
      el('div', { class: 'dialog-actions' }, [check]),
    ],
  );

  on(check, 'click', () => {
    void (async () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      if (file.size > ZIP_LIMIT_BYTES) {
        statuses.error('Import status', copy.importing.uploadTooLarge(ZIP_LIMIT_BYTES));
        return;
      }
      check.disabled = true;
      statuses.pending('Import status', copy.importing.pending);
      try {
        const planned = await api<{ import: ImportPlanView }>(
          `/api/projects/${store.projectId}/imports`,
          { method: 'POST', zip: file },
        );
        const plan = planned.import;
        statuses.set(
          'Import status',
          copy.importing.planned({
            added: plan.entries.filter((entry) => entry.status === 'new').length,
            changed: plan.entries.filter((entry) => entry.status === 'changed').length,
            unchanged: plan.entries.filter((entry) => entry.status === 'unchanged').length,
            orphans: plan.only_in_project.length,
          }),
        );
        dialog.close();
        openReviewImportDialog(store, statuses, plan);
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Import status', ...importError(cause));
      } finally {
        check.disabled = false;
      }
    })();
  });
}

function importError(cause: RequestFailed): (string | Node)[] {
  if (cause.code === 'import_rejected') {
    const entries = cause.extra['entries'];
    return describeRejection(Array.isArray(entries) ? (entries as RejectedEntry[]) : []);
  }
  if (cause.code === 'too_large') {
    const limit = cause.extra['limit_bytes'];
    return [copy.importing.uploadTooLarge(typeof limit === 'number' ? limit : ZIP_LIMIT_BYTES)];
  }
  if (cause.code === 'storage_unavailable') return [copy.importing.storageOutage];
  if (cause.code === 'import_plan_expired') return [copy.importing.expiredPlan];
  if (cause.code === 'import_plan_stale') return [copy.importing.stalePlan];
  if (cause.code === 'import_already_applied') return [copy.importing.alreadyApplied];
  if (cause.code === 'session_in_progress') return [copy.importing.sessionRunning];
  return [copy.generic];
}

function openReviewImportDialog(
  store: WorkspaceStore,
  statuses: StatusBoard,
  plan: ImportPlanView,
): void {
  const decisions = new Map<string, 'keep' | 'replace'>();
  const groups: Node[] = [];
  for (const entry of plan.entries.filter((item) => item.status === 'changed')) {
    decisions.set(entry.path, 'keep');
    const group = el('fieldset', { class: 'decision-group', role: 'radiogroup', 'aria-label': entry.path }, [
      el('legend', {}, [entry.path]),
    ]);
    for (const [value, label] of [
      ['keep', "Keep student's"],
      ['replace', 'Replace with zip'],
    ] as const) {
      const radio = el('input', {
        type: 'radio',
        name: `decision-${entry.path}`,
        'aria-label': label,
        ...(value === 'keep' ? { checked: true } : {}),
      });
      on(radio, 'change', () => decisions.set(entry.path, value));
      group.append(el('label', {}, [radio, label]));
    }
    groups.push(group);
  }

  const newFiles = el('div', { role: 'list', 'aria-label': 'New files' });
  for (const entry of plan.entries.filter((item) => item.status === 'new')) {
    newFiles.append(el('div', { role: 'listitem', class: 'mono' }, [entry.path]));
  }
  const orphans = el('div', { role: 'list', 'aria-label': 'Only in project' });
  for (const path of plan.only_in_project) {
    orphans.append(el('div', { role: 'listitem', class: 'mono' }, [path]));
  }

  const apply = el('button', { type: 'button' }, ['Apply import']);
  const dialog = openDialog(
    { role: 'dialog', name: 'Review import', heading: 'Review import' },
    () => [...groups, newFiles, orphans, el('div', { class: 'dialog-actions' }, [apply])],
  );

  on(apply, 'click', () => {
    void (async () => {
      apply.disabled = true;
      try {
        const applied = await api<{
          import: { added: number; replaced: number; kept: number };
        }>(`/api/imports/${plan.id}/apply`, {
          method: 'POST',
          body: { decisions: Object.fromEntries(decisions) },
        });
        dialog.close();
        await store.loadFiles();
        await store.reloadOpenFiles();
        statuses.set('Import status', copy.importing.applied(applied.import));
      } catch (cause) {
        if (!(cause instanceof RequestFailed)) throw cause;
        statuses.error('Import status', ...importError(cause));
      } finally {
        apply.disabled = false;
      }
    })();
  });
}
