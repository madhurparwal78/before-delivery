import { type ReactNode } from 'react';
import { ROLES, type Role } from '../../shared/domain.ts';
import { useAppState } from '../lib/hooks.ts';
import { type DialogState, store } from '../lib/store.ts';
import { Overlay } from './Dialog.tsx';

function fieldProps(
  fields: Record<string, string>,
  key: string,
): { 'aria-invalid'?: 'true'; 'aria-describedby'?: string } {
  if (fields[key] === undefined) return {};
  return { 'aria-invalid': 'true', 'aria-describedby': `field-error-${key}` };
}

function FieldError({ fields, field }: { fields: Record<string, string>; field: string }): ReactNode {
  const message = fields[field];
  if (message === undefined) return null;
  return (
    <span className="field-error" id={`field-error-${field}`}>
      {message}
    </span>
  );
}

function openerFocusKey(dialog: DialogState): string {
  switch (dialog.kind) {
    case 'verify':
      return 'verify-button';
    case 'deprecate':
      return 'deprecate-button';
    case 'reinstate':
      return 'reinstate-button';
    case 'suppress':
      return `tag:Suppress ${dialog.tag}`;
    case 'term':
      return dialog.termId === null ? 'new-term' : `term-edit:${dialog.termId}`;
    case 'adduser':
      return 'add-user';
    case 'resetpw':
      return `reset-password:${dialog.userId}`;
  }
}

function dialogName(dialog: DialogState): string {
  switch (dialog.kind) {
    case 'verify':
      return 'Verify asset';
    case 'deprecate':
      return 'Deprecate asset';
    case 'reinstate':
      return 'Reinstate asset';
    case 'suppress':
      return 'Suppress tag';
    case 'term':
      return dialog.termId === null ? 'New term' : 'Edit term';
    case 'adduser':
      return 'Add user';
    case 'resetpw':
      return 'Reset password';
  }
}

function DialogBody({ dialog }: { dialog: DialogState }): ReactNode {
  const fields = 'fields' in dialog ? dialog.fields : {};
  switch (dialog.kind) {
    case 'verify':
      return (
        <>
          {dialog.pending ? <span data-upload-progress className="upload-progress" /> : null}
          <label htmlFor="verify-file">Evidence file</label>
          <input
            id="verify-file"
            type="file"
            data-focus-key="field:evidence"
            {...fieldProps(fields, 'evidence')}
            onChange={(event) =>
              store.updateDialog({ file: event.target.files?.[0] ?? null })
            }
          />
          <FieldError fields={fields} field="evidence" />
          <label htmlFor="verify-note">Note</label>
          <textarea
            id="verify-note"
            data-focus-key="field:note"
            value={dialog.note}
            {...fieldProps(fields, 'note')}
            onChange={(event) => store.updateDialog({ note: event.target.value })}
          />
          <FieldError fields={fields} field="note" />
          <button
            type="button"
            data-focus-key="verify-submit"
            onClick={() => void store.submitVerify()}
          >
            Verify asset
          </button>
        </>
      );
    case 'deprecate':
      return (
        <>
          <label htmlFor="deprecate-reason">Reason</label>
          <textarea
            id="deprecate-reason"
            data-focus-key="field:reason"
            value={dialog.reason}
            {...fieldProps(fields, 'reason')}
            onChange={(event) => store.updateDialog({ reason: event.target.value })}
          />
          <FieldError fields={fields} field="reason" />
          <button type="button" onClick={() => void store.submitDeprecate()}>
            Deprecate asset
          </button>
        </>
      );
    case 'reinstate':
      return (
        <button type="button" onClick={() => void store.submitReinstate()}>
          Reinstate asset
        </button>
      );
    case 'suppress':
      return (
        <>
          <label htmlFor="suppress-justification">Justification</label>
          <textarea
            id="suppress-justification"
            data-focus-key="field:justification"
            value={dialog.justification}
            {...fieldProps(fields, 'justification')}
            onChange={(event) => store.updateDialog({ justification: event.target.value })}
          />
          <FieldError fields={fields} field="justification" />
          <button type="button" onClick={() => void store.submitSuppression()}>
            Suppress tag
          </button>
        </>
      );
    case 'term':
      return (
        <>
          <label htmlFor="term-name">Term name</label>
          <input
            id="term-name"
            type="text"
            data-focus-key="field:name"
            value={dialog.name}
            {...fieldProps(fields, 'name')}
            onChange={(event) => store.updateDialog({ name: event.target.value })}
          />
          <FieldError fields={fields} field="name" />
          <label htmlFor="term-definition">Definition</label>
          <textarea
            id="term-definition"
            data-focus-key="field:definition"
            value={dialog.definition}
            {...fieldProps(fields, 'definition')}
            onChange={(event) => store.updateDialog({ definition: event.target.value })}
          />
          <FieldError fields={fields} field="definition" />
          <button type="button" data-focus-key="save-term" onClick={() => void store.submitTerm()}>
            Save term
          </button>
        </>
      );
    case 'adduser':
      return (
        <>
          <label htmlFor="user-name">Name</label>
          <input
            id="user-name"
            type="text"
            data-focus-key="field:name"
            value={dialog.name}
            {...fieldProps(fields, 'name')}
            onChange={(event) => store.updateDialog({ name: event.target.value })}
          />
          <FieldError fields={fields} field="name" />
          <label htmlFor="user-email">Email</label>
          <input
            id="user-email"
            type="email"
            data-focus-key="field:email"
            value={dialog.email}
            {...fieldProps(fields, 'email')}
            onChange={(event) => store.updateDialog({ email: event.target.value })}
          />
          <FieldError fields={fields} field="email" />
          <label htmlFor="user-role">Role</label>
          <select
            id="user-role"
            data-focus-key="field:role"
            value={dialog.role}
            {...fieldProps(fields, 'role')}
            onChange={(event) => store.updateDialog({ role: event.target.value as Role })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <FieldError fields={fields} field="role" />
          <label htmlFor="user-password">Password</label>
          <input
            id="user-password"
            type="password"
            data-focus-key="field:password"
            value={dialog.password}
            {...fieldProps(fields, 'password')}
            onChange={(event) => store.updateDialog({ password: event.target.value })}
          />
          <FieldError fields={fields} field="password" />
          <button type="button" onClick={() => void store.submitAddUser()}>
            Create user
          </button>
        </>
      );
    case 'resetpw':
      return (
        <>
          <label htmlFor="reset-password-field">New password</label>
          <input
            id="reset-password-field"
            type="password"
            data-focus-key="field:password"
            value={dialog.password}
            {...fieldProps(fields, 'password')}
            onChange={(event) => store.updateDialog({ password: event.target.value })}
          />
          <FieldError fields={fields} field="password" />
          <button type="button" onClick={() => void store.submitResetPassword()}>
            Reset password
          </button>
        </>
      );
  }
}

export function Dialogs(): ReactNode {
  const state = useAppState();
  const dialog = state.dialog;
  if (dialog === null) return null;
  return (
    <Overlay
      name={dialogName(dialog)}
      open={dialog !== null}
      motion={state.motion}
      onClose={() => store.closeDialog(openerFocusKey(dialog))}
      className="dialog"
    >
      <h2>{dialogName(dialog)}</h2>
      <DialogBody dialog={dialog} />
      <button type="button" onClick={() => store.closeDialog(openerFocusKey(dialog))}>
        Cancel
      </button>
      <p role="status" aria-label="Dialog status">
        {'error' in dialog ? dialog.error : ''}
      </p>
    </Overlay>
  );
}
