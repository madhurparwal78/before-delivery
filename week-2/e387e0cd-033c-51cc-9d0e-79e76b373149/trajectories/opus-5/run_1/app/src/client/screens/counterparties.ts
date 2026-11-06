import {
  ERROR_COPY,
  importSavedCopy,
  PENDING_COPY,
  previewReadCopy,
  STATE_COPY,
  SUCCESS_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { carry, takeCarried } from '../carry';
import { button, dataTable, definition, element, heading } from '../dom';
import { clearDraft, readDraft, saveDraft } from '../draft';
import { showDate, showDateTime } from '../format';
import { Cleanup, navigate, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import {
  Choice,
  Field,
  longTextField,
  monoField,
  problemsSummary,
  radioGroup,
  selectField,
  textField,
} from '../ui/fields';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

interface CounterpartyBody {
  id: string;
  legalName: string;
  lei: string;
  jurisdictionCode: string;
  licenceNumber: string;
  dueDiligence: string;
  network: string;
  contactEmail: string;
  notes: string;
  updatedAt: string;
}

interface CounterpartyPage extends CounterpartyBody {
  previousNames: Array<{ name: string; from: string; until: string }>;
  addresses: string[];
}

const DUE_DILIGENCE: readonly Choice[] = [
  { value: 'trusted', label: 'Trusted' },
  { value: 'pending', label: 'Pending' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'blocked', label: 'Blocked' },
];

const ADD_DIALOG = 'Add counterparty';

async function jurisdictionChoices(slug: string): Promise<Choice[]> {
  const body = await get<{ jurisdictions: Array<{ code: string; name: string }> }>(
    `/api/w/${slug}/rules`,
  );
  return [
    { value: '', label: 'Choose a jurisdiction' },
    ...body.jurisdictions.map((entry) => ({ value: entry.code, label: entry.name })),
  ];
}

export async function counterpartiesScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'counterparties');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  const choices = await jurisdictionChoices(slug);
  const tableHost = element('div', { className: 'table-host' });

  const refresh = async (): Promise<void> => {
    const body = await get<{ counterparties: CounterpartyBody[] }>(
      `/api/w/${slug}/counterparties`,
    );
    tableHost.replaceChildren(
      dataTable<CounterpartyBody>(
        'Counterparties',
        [
          {
            label: 'Legal name',
            cell: (row) =>
              element('a', {
                text: row.legalName,
                className: 'control link',
                attributes: { href: `/w/${slug}/counterparties/${row.id}` },
              }),
          },
          { label: 'LEI', cell: (row) => element('span', { text: row.lei, className: 'mono' }) },
          { label: 'Jurisdiction', cell: (row) => row.jurisdictionCode },
          {
            label: 'Due diligence',
            cell: (row) =>
              DUE_DILIGENCE.find((entry) => entry.value === row.dueDiligence)?.label ??
              row.dueDiligence,
          },
          {
            label: 'Network',
            cell: (row) => (row.network === 'on_network' ? 'On the network' : 'Off the network'),
          },
        ],
        body.counterparties,
        STATE_COPY.emptyTable,
      ),
    );
  };

  const dialog = new Dialog(frame.layer, {
    name: ADD_DIALOG,
    style: 'side-sheet',
    build: (controller) => {
      const legalName = textField('Legal name', 'legalName');
      const lei = monoField('LEI', 'lei');
      const jurisdiction = selectField('Jurisdiction', 'jurisdictionCode', choices, '');
      const licenceNumber = textField('Licence number', 'licenceNumber');
      const dueDiligence = radioGroup('Due diligence', 'dueDiligence', DUE_DILIGENCE, 'pending');
      const contactEmail = textField('Contact email', 'contactEmail');
      const notes = longTextField('Notes', 'notes');
      const counter = element('p', { className: 'counter mono', text: STATE_COPY.notesCounter(0) });
      notes.node.insertBefore(counter, notes.node.lastChild);
      notes.control.addEventListener('input', () => {
        counter.textContent = STATE_COPY.notesCounter([...notes.control.value].length);
      });
      const addresses = longTextField('Wallet addresses', 'addresses');
      addresses.control.classList.add('mono');
      const problems = problemsSummary();
      const fields: Field[] = [
        legalName,
        lei,
        jurisdiction,
        licenceNumber,
        contactEmail,
        notes,
        addresses,
      ];
      const draft = readDraft(window.location.pathname);
      if (draft !== null && draft.dialog === ADD_DIALOG) {
        for (const field of fields) {
          const value = draft.fields[field.name];
          if (value !== undefined) field.control.value = value;
        }
      }
      const send = async (): Promise<void> => {
        problems.clear();
        for (const field of fields) field.clearError();
        note.say(PENDING_COPY.addCounterparty, 'pending');
        saveDraft({
          route: window.location.pathname,
          dialog: ADD_DIALOG,
          fields: Object.fromEntries(fields.map((field) => [field.name, field.control.value])),
        });
        try {
          const body = await request<{ counterparty: CounterpartyBody }>(
            'POST',
            `/api/w/${slug}/counterparties`,
            {
              legalName: legalName.control.value,
              lei: lei.control.value,
              jurisdictionCode: jurisdiction.control.value,
              licenceNumber: licenceNumber.control.value,
              dueDiligence: dueDiligence.value(),
              contactEmail: contactEmail.control.value,
              notes: notes.control.value,
              addresses: addresses.control.value
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line !== ''),
            },
          );
          clearDraft();
          carry(SUCCESS_COPY.addCounterparty);
          controller.close();
          navigate(`/w/${slug}/counterparties/${body.counterparty.id}`);
        } catch (error) {
          if (!(error instanceof RequestFailed)) {
            note.say(ERROR_COPY.not_found, 'refused');
            return;
          }
          if (error.failure.code !== 'session_ended') clearDraft();
          note.say(error.failure.message, 'refused');
          if (Object.keys(error.failure.fields).length > 0) problems.show(error.failure.fields, fields);
          else problems.showOne(error.failure.message);
          problems.focus();
        }
      };
      const submit = button('Save counterparty', () => void send(), { className: 'control primary' });
      const cancel = button('Cancel', () => controller.close());
      return {
        body: [
          element('h2', { text: ADD_DIALOG, className: 'dialog-title' }),
          problems.node,
          legalName.node,
          lei.node,
          jurisdiction.node,
          licenceNumber.node,
          dueDiligence.node,
          contactEmail.node,
          notes.node,
          addresses.node,
          dialogActions(submit, cancel),
        ],
        first: () => legalName.control,
      };
    },
  });
  frame.dialogs.push(dialog);
  const addButton = button('Add counterparty', () => dialog.open(addButton), {
    className: 'control primary',
  });

  frame.work.append(
    heading(1, 'Counterparties'),
    element('div', {
      className: 'toolbar-row',
      children: [
        addButton,
        element('a', {
          text: 'Import spreadsheet',
          className: 'control link',
          attributes: { href: `/w/${slug}/counterparties/import` },
        }),
      ],
    }),
    note.node,
    tableHost,
  );
  const draft = readDraft(window.location.pathname);
  if (draft !== null && draft.dialog === ADD_DIALOG) dialog.open(addButton);
  await refresh();
  return () => frame.destroy();
}

export async function counterpartyDetailScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const id = context.params.counterpartyId;
  const frame = await staffFrame(host, slug, 'counterparties');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  let page: CounterpartyPage;
  try {
    page = (await get<{ counterparty: CounterpartyPage }>(`/api/w/${slug}/counterparties/${id}`))
      .counterparty;
  } catch (error) {
    frame.work.append(heading(1, 'Page not found'), element('p', { text: STATE_COPY.unknownPage }));
    if (!(error instanceof RequestFailed)) throw error;
    return () => frame.destroy();
  }

  const title = heading(1, page.legalName);
  const details = element('div', { className: 'facts' });
  const history = element('div', { className: 'panel' });
  const paint = (): void => {
    title.textContent = page.legalName;
    history.replaceChildren(
      element('h2', { text: 'Previous names' }),
      element('ul', {
        className: 'plain-list',
        attributes: { role: 'list', 'aria-label': 'Previous names' },
        children: page.previousNames.map((entry) =>
          element('li', {
            text: `${entry.name} — ${showDate(entry.from)} to ${showDate(entry.until)}`,
          }),
        ),
      }),
      page.previousNames.length === 0
        ? element('p', { text: STATE_COPY.emptyTable, className: 'empty' })
        : element('span'),
      casesSent,
    );
    details.replaceChildren(
      definition('LEI', element('span', { text: page.lei, className: 'mono' })),
      definition('Jurisdiction', page.jurisdictionCode),
      definition('Licence number', element('span', { text: page.licenceNumber, className: 'mono' })),
      definition(
        'Due diligence',
        DUE_DILIGENCE.find((entry) => entry.value === page.dueDiligence)?.label ?? page.dueDiligence,
      ),
      definition('Network', page.network === 'on_network' ? 'On the network' : 'Off the network'),
      definition('Contact email', page.contactEmail),
      definition('Notes', page.notes),
      definition(
        'Wallet addresses',
        element('span', { text: page.addresses.join(', '), className: 'mono' }),
      ),
    );
  };

  const editDialog = new Dialog(frame.layer, {
    name: 'Edit counterparty',
    style: 'side-sheet',
    build: (controller) => {
      const legalName = textField('Legal name', 'legalName', page.legalName);
      const licenceNumber = textField('Licence number', 'licenceNumber', page.licenceNumber);
      const dueDiligence = radioGroup('Due diligence', 'dueDiligence', DUE_DILIGENCE, page.dueDiligence);
      const contactEmail = textField('Contact email', 'contactEmail', page.contactEmail);
      const notes = longTextField('Notes', 'notes', page.notes);
      const counter = element('p', {
        className: 'counter mono',
        text: STATE_COPY.notesCounter([...page.notes].length),
      });
      notes.node.insertBefore(counter, notes.node.lastChild);
      notes.control.addEventListener('input', () => {
        counter.textContent = STATE_COPY.notesCounter([...notes.control.value].length);
      });
      const problems = problemsSummary();
      const fields: Field[] = [legalName, licenceNumber, contactEmail, notes];
      const submit = button('Save changes', () => {
        problems.clear();
        note.say(PENDING_COPY.saveChanges, 'pending');
        const changes: Record<string, string> = {
          legalName: legalName.control.value,
          licenceNumber: licenceNumber.control.value,
          dueDiligence: dueDiligence.value(),
          notes: notes.control.value,
        };
        // An on-network counterparty keeps no compliance contact, so the key
        // only travels when the officer gave one.
        if (contactEmail.control.value !== '') changes.contactEmail = contactEmail.control.value;
        void request<{ counterparty: CounterpartyPage }>(
          'PATCH',
          `/api/w/${slug}/counterparties/${id}`,
          changes,
        )
          .then(async () => {
            note.say(SUCCESS_COPY.saveChanges);
            page = (
              await get<{ counterparty: CounterpartyPage }>(`/api/w/${slug}/counterparties/${id}`)
            ).counterparty;
            paint();
            controller.close();
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
          element('h2', { text: 'Edit counterparty', className: 'dialog-title' }),
          problems.node,
          legalName.node,
          licenceNumber.node,
          dueDiligence.node,
          contactEmail.node,
          notes.node,
          dialogActions(submit, cancel),
        ],
        first: () => legalName.control,
      };
    },
  });
  frame.dialogs.push(editDialog);
  const editButton = button('Edit counterparty', () => editDialog.open(editButton));
  if (frame.member.role !== 'compliance_officer' && frame.member.role !== 'compliance_analyst') {
    editButton.setAttribute('disabled', 'disabled');
  }

  const sent = await Promise.all(
    ['open', 'closed'].map((show) =>
      get<{ cases: CaseSummary[] }>(`/api/w/${slug}/cases?show=${show}`),
    ),
  );
  const casesSent = dataTable<CaseSummary>(
    'Cases sent',
    [
      {
        label: 'Reference',
        cell: (row) =>
          element('a', {
            text: row.reference,
            className: 'control link mono',
            attributes: { href: `/w/${slug}/cases/${row.id}` },
          }),
      },
      { label: 'Name as sent', cell: (row) => row.dataSent?.counterpartyNameAsSent ?? '' },
      {
        label: 'Data sent at',
        cell: (row) =>
          element('span', {
            className: 'mono',
            text: row.dataSent === null ? '' : showDateTime(row.dataSent.at, frame.workspace),
          }),
      },
    ],
    sent
      .flatMap((body) => body.cases)
      .filter((row) => row.counterparty !== null && row.counterparty.id === id),
    STATE_COPY.emptyTable,
  );

  paint();
  frame.work.append(title, note.node, details, editButton);
  frame.evidence.append(history);
  return () => frame.destroy();
}

interface CaseSummary {
  id: string;
  reference: string;
  counterparty: { id: string; name: string } | null;
  dataSent: { at: string; counterpartyNameAsSent: string | null } | null;
}

interface PreviewRow {
  row: number;
  legalName: string;
  outcome: string;
  matchedBy: string | null;
  counterpartyId: string | null;
  changedFields: string[];
  reason: string | null;
}

export async function importScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'counterparties');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const fileInput = element('input', {
    className: 'visually-hidden',
    attributes: { type: 'file', 'aria-label': 'Spreadsheet file', accept: '.csv,text/csv' },
  });
  const chosen = element('p', { className: 'chosen-file mono' });
  fileInput.addEventListener('change', () => {
    chosen.textContent = fileInput.files?.[0]?.name ?? '';
  });
  const chooseButton = button('Choose file', () => fileInput.click());
  const previewHost = element('div', { className: 'table-host' });
  const problems = problemsSummary();
  let text = '';

  const previewButton = button('Preview', () => {
    const file = fileInput.files?.[0] ?? null;
    if (file === null) {
      note.say('Choose a spreadsheet file first.', 'refused');
      problems.showOne('Choose a spreadsheet file first.');
      return;
    }
    problems.clear();
    note.say(PENDING_COPY.previewImport, 'pending');
    void file.text().then(async (content) => {
      text = content;
      try {
        const body = await request<{
          rows: PreviewRow[];
          summary: { matched: number; new: number; refused: number };
        }>('POST', `/api/w/${slug}/counterparties/import/preview`, content, 'text/csv');
        paintPreview(body.rows);
        note.say(
          previewReadCopy(body.rows.length, body.summary.matched, body.summary.new, body.summary.refused),
        );
      } catch (error) {
        note.say(
          error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
          'refused',
        );
      }
    });
  }, { className: 'control primary' });

  const saveButton = button('Save import', () => {
    if (text === '') {
      note.say('Preview the spreadsheet first.', 'refused');
      problems.showOne('Preview the spreadsheet first.');
      return;
    }
    problems.clear();
    note.say(PENDING_COPY.saveImport, 'pending');
    void request<{ created: number; updated: number; unchanged: number; rows: PreviewRow[] }>(
      'POST',
      `/api/w/${slug}/counterparties/import`,
      text,
      'text/csv',
    )
      .then((body) => {
        paintPreview(body.rows);
        note.say(importSavedCopy(body.created, body.updated, body.unchanged));
      })
      .catch((error: unknown) => {
        note.say(
          error instanceof RequestFailed ? error.failure.message : ERROR_COPY.not_found,
          'refused',
        );
      });
  });

  function paintPreview(rows: readonly PreviewRow[]): void {
    previewHost.replaceChildren(
      dataTable<PreviewRow>(
        'Preview rows',
        [
          { label: 'Row', cell: (row) => element('span', { text: String(row.row), className: 'mono' }) },
          { label: 'Legal name', cell: (row) => row.legalName },
          { label: 'Outcome', cell: (row) => row.outcome },
          {
            label: 'Reason',
            cell: (row) =>
              row.reason ?? (row.changedFields.length === 0 ? '' : row.changedFields.join(', ')),
          },
        ],
        [...rows],
        STATE_COPY.emptyTable,
      ),
    );
  }

  paintPreview([]);
  frame.work.append(
    heading(1, 'Import counterparties'),
    problems.node,
    element('div', {
      className: 'toolbar-row',
      children: [chooseButton, fileInput, chosen, previewButton, saveButton],
    }),
    note.node,
    previewHost,
  );
  return () => frame.destroy();
}
