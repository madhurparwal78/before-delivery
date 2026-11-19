import type { App } from '../app';
import {
  messageBlock,
  numberField,
  radioGroupField,
  renderDialog,
  selectField,
  textareaField,
  textField,
} from '../components/dialog';

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const CARRY_OPTIONS = [
  { value: 'next_business', label: 'Next business day' },
  { value: 'fixed', label: 'Fixed date' },
];

export function renderDialogForState(app: App): HTMLElement {
  const dialog = app.state.dialog;
  if (!dialog) throw new Error('no dialog open');
  switch (dialog.kind) {
    case 'add-client':
      return renderDialog(app, {
        title: 'Add client',
        confirmLabel: 'Save client',
        content: [
          textField(app, 'name', 'Business name'),
          textField(app, 'display_name', 'Owner name'),
          textField(app, 'owner.email', 'Owner email', { kind: 'email' }),
          textField(app, 'owner.password', 'Owner password', { kind: 'password' }),
          messageBlock(app),
        ],
        onConfirm: () => app.submitAddClient(),
      });
    case 'register':
      return renderDialog(app, {
        title: 'Register in a state',
        confirmLabel: 'Register',
        content: [
          selectField(
            app,
            'state',
            'State',
            'Choose a state',
            app.state.states.map((state) => ({
              value: state.code,
              label: `${state.name} (${state.code})`,
            })),
          ),
          radioGroupField(app, 'frequency', 'Filing frequency', FREQUENCIES),
          textField(app, 'first_period', 'First period', {
            hint: '2026-05, 2026-Q2 or 2026',
          }),
          messageBlock(app),
        ],
        onConfirm: () => app.submitRegistration(),
      });
    case 'holidays':
      return renderDialog(app, {
        title: `Holidays for ${dialog.stateCode ?? ''}`,
        confirmLabel: 'Save holidays',
        content: [
          textareaField(app, 'holidays', 'Holiday dates', 'One date per line, as YYYY-MM-DD.'),
          messageBlock(app),
        ],
        onConfirm: () => app.submitHolidays(),
      });
    case 'edition':
      return renderDialog(app, {
        title: 'Publish rule change',
        confirmLabel: 'Publish',
        content: [
          textField(app, 'effective_date', 'Effective date', { hint: '2026-06-01' }),
          numberField(app, 'due_day', 'Due day'),
          radioGroupField(app, 'carry', 'Carry-forward', CARRY_OPTIONS),
          textField(app, 'rate', 'Reference rate', { hint: '4.500' }),
          numberField(app, 'extension_days', 'Extension days'),
          messageBlock(app),
        ],
        onConfirm: () => app.submitEdition(),
      });
    case 'mark-filed':
      return renderDialog(app, {
        title: 'Mark filed',
        confirmLabel: 'Confirm filing',
        content: [
          messageBlock(app) ??
            null,
        ],
        onConfirm: () => app.confirmFiling(),
      });
    case 'file-extension':
      return renderDialog(app, {
        title: 'File extension',
        confirmLabel: 'Confirm extension',
        content: [messageBlock(app) ?? null],
        onConfirm: () => app.confirmExtension(),
      });
    case 'record-amendment':
      return renderDialog(app, {
        title: 'Record amendment',
        confirmLabel: 'Save amendment',
        content: [
          textField(app, 'gross_sales', 'Amended gross sales'),
          textField(app, 'tax_due', 'Amended tax due'),
          textareaField(app, 'note', 'Note'),
          messageBlock(app),
        ],
        onConfirm: () => app.submitAmendment(),
      });
    case 'send-back':
      return renderDialog(app, {
        title: 'Send back',
        confirmLabel: 'Send back',
        sheet: true,
        content: [textareaField(app, 'reason', 'Reason'), messageBlock(app)],
        onConfirm: () => app.submitSendBack(),
      });
  }
}
