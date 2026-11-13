import { useState } from 'preact/hooks';
import { ApiError, del, get, patch, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { dropDialog, holdDialog } from '../lib/resume.js';
import type { Member, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatDateTime } from '../../shared/brussels.js';
import { ROLES, roleLabel } from '../../shared/options.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field, RadioGroup } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, TableFrame } from '../components/layout.js';

const DIALOG = 'add-member';

const CONTROL_IDS = {
  name: 'member-name',
  email: 'member-email',
  password: 'member-password',
  role: 'member-role',
};

export function MembersScreen({ session }: { session: Session }) {
  const members = usePolling(() => get<{ members: Member[] }>('/api/members'), 'members');
  const dialog = useOverlay();
  const [draft, setDraft] = useState({
    name: '',
    email: '',
    password: '',
    role: 'assistant',
  });
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState('');

  const rows = members.data?.members ?? [];

  const change = (next: Partial<typeof draft>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      holdDialog(DIALOG, merged);
      return merged;
    });
  };

  const refuse = (error: unknown): void => {
    if (!(error instanceof ApiError)) return;
    const { failure } = error;
    setProblems(
      Object.keys(failure.fields).length > 0
        ? problemsOf(failure.fields)
        : problemsOf({}, failure.message),
    );
    announce(failure.message);
  };

  const save = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(draft.name)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(draft.email)) fields['email'] = fieldCopy.email;
    if (draft.password.length < 10 || draft.password.length > 128) {
      fields['password'] = 'Use a starting password of 10 to 128 characters.';
    }
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending('save');
    try {
      await post<{ member: Member }>('/api/members', {
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
      });
      announce(copy.memberAdded);
      setProblems(noProblems);
      setDraft({ name: '', email: '', password: '', role: 'assistant' });
      dropDialog(DIALOG);
      dialog.close();
      await members.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const reRole = async (member: Member, role: string): Promise<void> => {
    setPending(member.id);
    try {
      await patch(`/api/members/${member.id}`, { role });
      await members.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  const remove = async (member: Member): Promise<void> => {
    setPending(member.id);
    try {
      await del(`/api/members/${member.id}`);
      await members.reload();
    } catch (error) {
      refuse(error);
    } finally {
      setPending('');
    }
  };

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Members</h1>
      {dialog.mounted ? null : (
        <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
      )}
      <TableFrame name="Members">
        <table class="table" aria-label="Members">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Added</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{roleLabel(member.role)}</td>
                <td class="tabular">
                  {member.createdAt === undefined
                    ? ''
                    : formatDateTime(Date.parse(member.createdAt))}
                </td>
                <td>
                  {member.role === 'owner' ? null : (
                    <span class="actions-row">
                      <ActionButton
                        label={member.role === 'assistant' ? 'Make bookkeeper' : 'Make assistant'}
                        variant="quiet"
                        pending={pending === member.id}
                        onPress={() =>
                          void reRole(member, member.role === 'assistant' ? 'bookkeeper' : 'assistant')
                        }
                      />
                      <ActionButton
                        label={`Remove ${member.name}`}
                        variant="danger"
                        pending={pending === member.id}
                        onPress={() => void remove(member)}
                      />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

      <BottomBar>
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          onClick={() => {
            holdDialog(DIALOG, draft);
            dialog.open();
          }}
        >
          Add member
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="Add member">
          <h2 class="dialog__heading">Add member</h2>
          <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
          <Field
            id={CONTROL_IDS.name}
            label="Name"
            value={draft.name}
            onInput={(value) => change({ name: value })}
            problem={problems.fields['name']}
          />
          <Field
            id={CONTROL_IDS.email}
            label="Email"
            type="email"
            value={draft.email}
            onInput={(value) => change({ email: value })}
            problem={problems.fields['email']}
          />
          <Field
            id={CONTROL_IDS.password}
            label="Starting password"
            type="password"
            value={draft.password}
            onInput={(value) => change({ password: value })}
            problem={problems.fields['password']}
          />
          <RadioGroup
            id={CONTROL_IDS.role}
            label="Role"
            value={draft.role}
            options={ROLES.filter((role) => role.value !== 'owner')}
            onChange={(value) => change({ role: value })}
            problem={problems.fields['role']}
          />
          <DialogActions>
            <ActionButton label="Save member" pending={pending === 'save'} onPress={() => void save()} />
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                dropDialog(DIALOG);
                dialog.close();
              }}
            >
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
