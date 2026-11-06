import { useId, useState } from 'react';
import { ROLES, ROLE_LABELS, type Currency, type Role } from '../../shared/domain.js';
import { centsToDecimal } from '../../shared/format.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { setPageTitle } from '../lib/router.jsx';
import { clearDraft, readDraft } from '../lib/drafts.js';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { Dialog, focusFirstDialogButton } from '../components/Dialog.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../components/Fields.jsx';
import { TableRegion } from '../components/Panel.jsx';
import { focusWhenReady } from '../lib/focus.js';

interface MemberEntry {
  id: string;
  name: string;
  role: Role;
  organisation: string;
  email?: string;
  phone?: string;
  status?: string;
  approvalLimits?: Record<Currency, number | null> | null;
  version?: number;
}

interface MemberForm {
  email: string;
  name: string;
  role: Role;
  brandId: string;
  companyName: string;
  limitHkd: string;
  limitSgd: string;
}

const EMPTY_FORM: MemberForm = {
  email: '',
  name: '',
  role: 'designer',
  brandId: '',
  companyName: '',
  limitHkd: '',
  limitSgd: '',
};

function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function limitsText(limits: Record<Currency, number | null> | null | undefined): string {
  if (!limits) return '—';
  const parts: string[] = [];
  if (limits.HKD !== null && limits.HKD !== undefined) {
    parts.push(`HKD ${centsToDecimal(limits.HKD)}`);
  }
  if (limits.SGD !== null && limits.SGD !== undefined) {
    parts.push(`SGD ${centsToDecimal(limits.SGD)}`);
  }
  return parts.length === 0 ? '—' : parts.join('; ');
}

export function Members({ restoreForm }: { restoreForm: string | null }): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { member, refresh, handleFailure } = useWorkspace();
  const errors = useFormErrors();
  const { data } = useResource<{ members: MemberEntry[] }>('/api/members');
  const brands = useResource<{ brands: { id: string; name: string }[] }>(
    member?.role === 'director' ? '/api/brands' : null,
  );
  const [dialog, setDialog] = useState<
    { kind: 'invite' } | { kind: 'edit'; target: MemberEntry } | { kind: 'remove'; target: MemberEntry } | null
  >(() => (restoreForm === 'invite-member' ? { kind: 'invite' } : null));
  const [form, setForm] = useState<MemberForm>(() => {
    if (restoreForm === 'invite-member' && member) {
      const draft = readDraft(member.id, 'invite-member');
      if (draft) {
        clearDraft(member.id, 'invite-member');
        return { ...EMPTY_FORM, ...(draft as Partial<MemberForm>) };
      }
    }
    return EMPTY_FORM;
  });
  const [busy, setBusy] = useState(false);

  setPageTitle('Members · Marrow Hall Interiors');

  const isDirector = member?.role === 'director';
  const members = data?.members ?? [];

  const focusInvite = (): void => focusWhenReady('[data-focus="invite-member"]');

  const showFieldErrors = (caught: ApiError): void => {
    errors.set(caught.errors);
    const first = Object.keys(caught.errors)[0];
    if (first) focusFieldError(formId, first);
    else focusFirstDialogButton();
  };

  const sendInvitation = async (): Promise<void> => {
    const limits: Record<string, number> = {};
    const hkd = parseAmount(form.limitHkd);
    const sgd = parseAmount(form.limitSgd);
    if (Number.isNaN(hkd) || Number.isNaN(sgd)) {
      errors.set({
        ...(Number.isNaN(hkd) ? { 'approvalLimits.HKD': fieldErrorCopy.badAmount() } : {}),
        ...(Number.isNaN(sgd) ? { 'approvalLimits.SGD': fieldErrorCopy.badAmount() } : {}),
      });
      const first = Number.isNaN(hkd) ? 'approvalLimits.HKD' : 'approvalLimits.SGD';
      focusFieldError(formId, first);
      return;
    }
    if (hkd !== null) limits.HKD = hkd;
    if (sgd !== null) limits.SGD = sgd;

    setBusy(true);
    errors.clear();
    startPending(pending.sendInvitation);
    try {
      await request('/api/invitations', {
        body: {
          email: form.email,
          name: form.name,
          role: form.role,
          ...(form.role === 'client_approver' ? { brandId: form.brandId } : {}),
          ...(form.role === 'contractor' ? { companyName: form.companyName } : {}),
          ...(form.role === 'project_lead' ? { approvalLimits: limits } : {}),
        },
      });
      setDialog(null);
      setForm(EMPTY_FORM);
      refresh();
      say(success.invitationSent(form.email));
      focusInvite();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        showFieldErrors(caught);
      } else if (caught instanceof ApiError && caught.code === 'member_exists') {
        problem(refusal.otherIllegal('already a member'));
        focusFirstDialogButton();
      } else {
        handleFailure(caught, {
          draft: { formKey: 'invite-member', values: { ...form } },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const saveMember = async (target: MemberEntry): Promise<void> => {
    const hkd = parseAmount(form.limitHkd);
    const sgd = parseAmount(form.limitSgd);
    const limits: Record<string, number | null> = {
      HKD: Number.isNaN(hkd) ? null : hkd,
      SGD: Number.isNaN(sgd) ? null : sgd,
    };
    setBusy(true);
    errors.clear();
    startPending(pending.saveMember);
    try {
      await request(`/api/members/${target.id}`, {
        method: 'PATCH',
        body: {
          version: target.version,
          role: form.role,
          ...(form.role === 'project_lead' ? { approvalLimits: limits } : {}),
        },
      });
      setDialog(null);
      refresh();
      say(success.memberUpdated(target.name));
      focusInvite();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        showFieldErrors(caught);
      } else if (caught instanceof ApiError && caught.code === 'stale_version') {
        problem(
          refusal.newerVersion(
            caught.extra<string>('savedBy') ?? '',
            caught.extra<string>('savedAt') ?? '',
          ),
        );
        focusFirstDialogButton();
      } else {
        handleFailure(caught, { draft: { formKey: 'edit-member', values: { ...form } } });
      }
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (target: MemberEntry): Promise<void> => {
    setBusy(true);
    startPending(pending.removeMember);
    try {
      await request(`/api/members/${target.id}`, { method: 'DELETE' });
      setDialog(null);
      refresh();
      say(success.memberRemoved(target.name));
      focusInvite();
    } catch (caught) {
      handleFailure(caught);
      focusFirstDialogButton();
    } finally {
      setBusy(false);
    }
  };

  const roleField = (
    <Field formId={formId} path="role" label="Role" errors={errors.errors}>
      {(attributes) => (
        <select
          {...attributes}
          value={form.role}
          onChange={(event) => setForm({ ...form, role: event.target.value as Role })}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );

  const conditionalFields = (
    <>
      {form.role === 'client_approver' ? (
        <Field formId={formId} path="brandId" label="Brand" errors={errors.errors}>
          {(attributes) => (
            <select
              {...attributes}
              value={form.brandId}
              onChange={(event) => setForm({ ...form, brandId: event.target.value })}
            >
              <option value="">Choose a brand</option>
              {(brands.data?.brands ?? []).map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      {form.role === 'contractor' ? (
        <Field formId={formId} path="companyName" label="Company name" errors={errors.errors}>
          {(attributes) => (
            <input
              {...attributes}
              type="text"
              value={form.companyName}
              onChange={(event) => setForm({ ...form, companyName: event.target.value })}
            />
          )}
        </Field>
      ) : null}
      {form.role === 'project_lead' ? (
        <>
          <Field
            formId={formId}
            path="approvalLimits.HKD"
            label="Approval limit HKD"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="decimal"
                value={form.limitHkd}
                onChange={(event) => setForm({ ...form, limitHkd: event.target.value })}
              />
            )}
          </Field>
          <Field
            formId={formId}
            path="approvalLimits.SGD"
            label="Approval limit SGD"
            errors={errors.errors}
          >
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                inputMode="decimal"
                value={form.limitSgd}
                onChange={(event) => setForm({ ...form, limitSgd: event.target.value })}
              />
            )}
          </Field>
        </>
      ) : null}
    </>
  );

  return (
    <section className="panel">
      <h1>Members</h1>
      {isDirector ? (
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            data-focus="invite-member"
            onClick={() => {
              errors.clear();
              setForm(EMPTY_FORM);
              setDialog({ kind: 'invite' });
            }}
          >
            Invite member
          </button>
        </div>
      ) : null}

      <TableRegion label="Members table">
        <table>
          <caption>Members</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Organisation</th>
              {isDirector ? <th scope="col">Email</th> : null}
              {isDirector ? <th scope="col">Phone</th> : null}
              {isDirector ? <th scope="col">Approval limits</th> : null}
              {isDirector ? <th scope="col">Status</th> : null}
              {isDirector ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((entry) => (
              <tr key={entry.id}>
                <th scope="row">{entry.name}</th>
                <td>{ROLE_LABELS[entry.role]}</td>
                <td>{entry.organisation}</td>
                {isDirector ? <td>{entry.email}</td> : null}
                {isDirector ? <td>{entry.phone === '' ? '—' : entry.phone}</td> : null}
                {isDirector ? <td>{limitsText(entry.approvalLimits)}</td> : null}
                {isDirector ? <td>{entry.status === 'removed' ? 'Removed' : 'Active'}</td> : null}
                {isDirector ? (
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        onClick={() => {
                          errors.clear();
                          setForm({
                            ...EMPTY_FORM,
                            email: entry.email ?? '',
                            name: entry.name,
                            role: entry.role,
                            limitHkd:
                              entry.approvalLimits?.HKD != null
                                ? centsToDecimal(entry.approvalLimits.HKD)
                                : '',
                            limitSgd:
                              entry.approvalLimits?.SGD != null
                                ? centsToDecimal(entry.approvalLimits.SGD)
                                : '',
                          });
                          setDialog({ kind: 'edit', target: entry });
                        }}
                      >
                        {`Edit ${entry.name}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: 'remove', target: entry })}
                      >
                        {`Remove ${entry.name}`}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>

      {dialog?.kind === 'invite' ? (
        <Dialog
          title="Invite member"
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.sendInvitation}
                onPress={() => void sendInvitation()}
              >
                Send invitation
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          <Field formId={formId} path="email" label="Email" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            )}
          </Field>
          <Field formId={formId} path="name" label="Name" errors={errors.errors}>
            {(attributes) => (
              <input
                {...attributes}
                type="text"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            )}
          </Field>
          {roleField}
          {conditionalFields}
        </Dialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <Dialog
          title={`Edit ${dialog.target.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.saveMember}
                onPress={() => void saveMember(dialog.target)}
              >
                Save member
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <ErrorSummary formId={formId} errors={errors.errors} />
          {roleField}
          {conditionalFields}
        </Dialog>
      ) : null}

      {dialog?.kind === 'remove' ? (
        <Dialog
          title={`Remove ${dialog.target.name}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <ActionButton
                className="primary"
                busy={busy}
                pendingLabel={pending.removeMember}
                onPress={() => void removeMember(dialog.target)}
              >
                Remove from workspace
              </ActionButton>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            {`${dialog.target.name} will lose access to Plumbline straight away. Anything they had
              unsaved is discarded.`}
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}
