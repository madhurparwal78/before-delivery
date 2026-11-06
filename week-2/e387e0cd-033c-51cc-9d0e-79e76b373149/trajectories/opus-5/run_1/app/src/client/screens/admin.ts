import {
  ERROR_COPY,
  fileDownloadedCopy,
  PENDING_COPY,
  STATE_COPY,
  SUCCESS_COPY,
} from '../../shared/copy';
import { download, get, request, RequestFailed } from '../api';
import { button, dataTable, element, heading } from '../dom';
import { showDateTime, showMonth } from '../format';
import { Cleanup, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { Choice, Field, problemsSummary, selectField, textField } from '../ui/fields';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

export async function filesScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'files');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const body = await get<{ months: Array<{ month: string; cases: number }> }>(
    `/api/w/${slug}/files`,
  );
  const ended = body.months.filter((entry) => entry.month < frame.workspace.today.slice(0, 7));
  const choices: Choice[] = body.months.map((entry) => ({
    value: entry.month,
    label: showMonth(entry.month),
  }));
  const latest = ended.length === 0 ? body.months[body.months.length - 1] : ended[ended.length - 1];
  const stateText = element('p', { className: 'file-state', text: STATE_COPY.filesIdle });

  const railSelect = selectField('Month', 'month', choices, latest?.month);
  let sheetSelect: Field | null = null;

  const currentMonth = (): string => sheetSelect?.control.value ?? railSelect.control.value;

  const describe = (): void => {
    const month = currentMonth();
    const found = body.months.find((entry) => entry.month === month);
    stateText.textContent =
      found !== undefined && found.cases === 0
        ? STATE_COPY.filesEmpty(showMonth(month))
        : STATE_COPY.filesIdle;
  };
  railSelect.control.addEventListener('change', describe);

  const downloadButton = button('Download file', () => {
    note.say(PENDING_COPY.downloadFile, 'pending');
    void download(`/api/w/${slug}/files/regulator?month=${encodeURIComponent(currentMonth())}`)
      .then((file) => note.say(fileDownloadedCopy(file.fileName)))
      .catch((error: unknown) => {
        note.say(
          error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
          'refused',
        );
      });
  }, { className: 'control primary' });

  const sheet = new Dialog(frame.layer, {
    name: 'Choose month',
    style: 'bottom-sheet',
    build: (controller) => {
      const field = selectField('Month', 'month', choices, currentMonth());
      sheetSelect = field;
      field.control.addEventListener('change', () => {
        railSelect.control.value = field.control.value;
        describe();
      });
      const done = button('Done', () => controller.close(), { className: 'control primary' });
      return {
        body: [
          element('h2', { text: 'Choose month', className: 'dialog-title' }),
          field.node,
          dialogActions(done),
        ],
        first: () => field.control,
      };
    },
  });
  frame.dialogs.push(sheet);
  const chooseButton = button('Choose month', () => sheet.open(chooseButton), {
    className: 'control narrow-only',
  });

  describe();
  frame.work.append(
    heading(1, "Regulator's monthly files"),
    element('div', {
      className: 'files-layout',
      children: [
        element('div', { className: 'month-rail wide-only', children: [railSelect.node] }),
        element('div', {
          className: 'panel download-panel',
          children: [chooseButton, downloadButton, stateText, note.node],
        }),
      ],
    }),
  );
  return () => frame.destroy();
}

interface KeyBody {
  id: string;
  label: string;
  startsWith: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function partnerKeysScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'partner-keys');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const tableHost = element('div', { className: 'table-host' });
  let revokeDialog: Dialog | null = null;
  let shownKey: Dialog | null = null;

  const refresh = async (): Promise<void> => {
    const body = await get<{ keys: KeyBody[] }>(`/api/w/${slug}/partner-keys`);
    tableHost.replaceChildren(
      dataTable<KeyBody>(
        'Partner keys',
        [
          { label: 'Label', cell: (key) => key.label },
          { label: 'Key starts', cell: (key) => element('span', { text: key.startsWith, className: 'mono' }) },
          {
            label: 'Created',
            cell: (key) =>
              element('span', { text: showDateTime(key.createdAt, frame.workspace), className: 'mono' }),
          },
          {
            label: 'Last used',
            cell: (key) =>
              element('span', {
                text: key.lastUsedAt === null ? 'Never used' : showDateTime(key.lastUsedAt, frame.workspace),
                className: 'mono',
              }),
          },
          {
            label: 'Status',
            cell: (key) => {
              if (key.revokedAt !== null) return 'Revoked';
              const control = button('Revoke', () => {
                revokeDialog?.destroy();
                revokeDialog = new Dialog(frame.layer, {
                  name: 'Revoke key',
                  build: (controller) => {
                    const cancel = button('Cancel', () => controller.close());
                    const confirm = button('Revoke key', () => {
                      note.say(PENDING_COPY.revokeKey, 'pending');
                      void request('DELETE', `/api/w/${slug}/partner-keys/${key.id}`)
                        .then(() => {
                          note.say(SUCCESS_COPY.revokeKey);
                          controller.close();
                          void refresh();
                        })
                        .catch((error: unknown) => {
                          note.say(
                            error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
                            'refused',
                          );
                          controller.close();
                        });
                    }, { className: 'control primary' });
                    return {
                      body: [
                        element('h2', { text: 'Revoke key', className: 'dialog-title' }),
                        element('p', { text: `${key.label} will stop working at once.` }),
                        dialogActions(cancel, confirm),
                      ],
                      first: () => cancel,
                    };
                  },
                });
                frame.dialogs.push(revokeDialog);
                revokeDialog.open(control);
              });
              return element('span', { children: [element('span', { text: 'Active' }), control] });
            },
          },
        ],
        body.keys,
        STATE_COPY.emptyTable,
      ),
    );
  };

  const createDialog = new Dialog(frame.layer, {
    name: 'Create key',
    build: (controller) => {
      const label = textField('Label', 'label');
      const problems = problemsSummary();
      const submit = button('Create', () => {
        problems.clear();
        note.say(PENDING_COPY.createKey, 'pending');
        void request<{ key: KeyBody; secret: string }>('POST', `/api/w/${slug}/partner-keys`, {
          label: label.control.value,
        })
          .then((body) => {
            note.say(SUCCESS_COPY.createKey);
            controller.close();
            void refresh();
            shownKey?.destroy();
            shownKey = new Dialog(frame.layer, {
              name: 'New partner key',
              build: (inner) => {
                const copy = button('Copy key', () => {
                  void navigator.clipboard?.writeText(body.secret);
                });
                const done = button('Done', () => inner.close(), { className: 'control primary' });
                return {
                  body: [
                    element('h2', { text: 'New partner key', className: 'dialog-title' }),
                    element('p', { text: body.secret, className: 'mono secret' }),
                    dialogActions(copy, done),
                  ],
                  first: () => copy,
                };
              },
            });
            frame.dialogs.push(shownKey);
            shownKey.open(null);
          })
          .catch((error: unknown) => {
            if (!(error instanceof RequestFailed)) {
              note.say(ERROR_COPY.not_found, 'refused');
              return;
            }
            note.say(error.failure.message, 'refused');
            problems.show(error.failure.fields, [label]);
            problems.focus();
          });
      }, { className: 'control primary' });
      const cancel = button('Cancel', () => controller.close());
      return {
        body: [
          element('h2', { text: 'Create key', className: 'dialog-title' }),
          problems.node,
          label.node,
          dialogActions(submit, cancel),
        ],
        first: () => label.control,
      };
    },
  });
  frame.dialogs.push(createDialog);
  const createButton = button('Create key', () => createDialog.open(createButton), {
    className: 'control primary',
  });

  frame.work.append(
    heading(1, 'Partner keys'),
    element('div', { className: 'toolbar-row', children: [createButton] }),
    note.node,
    tableHost,
  );
  await refresh();
  return () => {
    revokeDialog?.destroy();
    shownKey?.destroy();
    frame.destroy();
  };
}

interface MemberBody {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  compliance_officer: 'Compliance officer',
  compliance_analyst: 'Compliance analyst',
  operations_lead: 'Operations lead',
  finance_lead: 'Finance lead',
  support_agent: 'Support agent',
};

export async function membersScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'members');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const tableHost = element('div', { className: 'table-host' });

  const refresh = async (): Promise<void> => {
    const body = await get<{ members: MemberBody[] }>(`/api/w/${slug}/members`);
    tableHost.replaceChildren(
      dataTable<MemberBody>(
        'Members',
        [
          { label: 'Name', cell: (member) => member.name },
          { label: 'Email', cell: (member) => element('span', { text: member.email, className: 'mono' }) },
          { label: 'Role', cell: (member) => ROLE_LABELS[member.role] ?? member.role },
          {
            label: 'Added',
            cell: (member) =>
              element('span', {
                text: showDateTime(member.createdAt, frame.workspace),
                className: 'mono',
              }),
          },
          {
            label: 'Remove',
            cell: (member) => {
              const control = button('Remove member', () => {
                note.say(PENDING_COPY.addMember, 'pending');
                void request('DELETE', `/api/w/${slug}/members/${member.id}`)
                  .then(() => {
                    note.say('Member removed.');
                    void refresh();
                  })
                  .catch((error: unknown) => {
                    note.say(
                      error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
                      'refused',
                    );
                  });
              });
              if (member.id === frame.member.id) control.setAttribute('disabled', 'disabled');
              return control;
            },
          },
        ],
        body.members,
        STATE_COPY.emptyTable,
      ),
    );
  };

  const dialog = new Dialog(frame.layer, {
    name: 'Add member',
    build: (controller) => {
      const name = textField('Name', 'name');
      const email = textField('Email', 'email');
      const role = selectField(
        'Role',
        'role',
        Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
        'compliance_analyst',
      );
      const password = textField('Starting password', 'password');
      const problems = problemsSummary();
      const fields: Field[] = [name, email, role, password];
      const submit = button('Add member', () => {
        problems.clear();
        note.say(PENDING_COPY.addMember, 'pending');
        void request('POST', `/api/w/${slug}/members`, {
          name: name.control.value,
          email: email.control.value,
          role: role.control.value,
          password: password.control.value,
        })
          .then(() => {
            note.say(SUCCESS_COPY.addMember);
            controller.close();
            void refresh();
          })
          .catch((error: unknown) => {
            if (!(error instanceof RequestFailed)) {
              note.say(ERROR_COPY.not_found, 'refused');
              return;
            }
            note.say(error.failure.message, 'refused');
            if (Object.keys(error.failure.fields).length > 0) {
              problems.show(error.failure.fields, fields);
            } else {
              problems.showOne(error.failure.message);
            }
            problems.focus();
          });
      }, { className: 'control primary' });
      const cancel = button('Cancel', () => controller.close());
      return {
        body: [
          element('h2', { text: 'Add member', className: 'dialog-title' }),
          problems.node,
          name.node,
          email.node,
          role.node,
          password.node,
          dialogActions(submit, cancel),
        ],
        first: () => name.control,
      };
    },
  });
  frame.dialogs.push(dialog);
  const addButton = button('Add member', () => dialog.open(addButton), { className: 'control primary' });

  frame.work.append(
    heading(1, 'Members'),
    element('div', { className: 'toolbar-row', children: [addButton] }),
    note.node,
    tableHost,
  );
  await refresh();
  return () => frame.destroy();
}

export async function listingScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'listing');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const panel = element('div', { className: 'panel listing-panel' });

  const paint = (listed: boolean): void => {
    const control = button(listed ? 'Withdraw listing' : 'List again', () => {
      note.say(PENDING_COPY.listing, 'pending');
      void request<{ listing: { slug: string; listed: boolean } }>(
        'PUT',
        `/api/w/${slug}/listing`,
        { listed: !listed },
      )
        .then((body) => {
          note.say(listed ? SUCCESS_COPY.withdrawListing : SUCCESS_COPY.listAgain);
          paint(body.listing.listed);
        })
        .catch((error: unknown) => {
          note.say(
            error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
            'refused',
          );
        });
    }, { className: 'control primary' });
    panel.replaceChildren(
      element('h2', { text: 'Public listing' }),
      element('p', {
        text: listed ? STATE_COPY.listingListed : STATE_COPY.listingNotListed,
        className: 'listing-state',
      }),
      control,
    );
  };

  const body = await get<{ listing: { slug: string; listed: boolean } }>(`/api/w/${slug}/listing`);
  paint(body.listing.listed);
  frame.work.append(heading(1, 'Directory listing'), note.node, panel);
  return () => frame.destroy();
}
