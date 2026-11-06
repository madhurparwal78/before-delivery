import { useId, useState } from 'react';
import { ROLE_LABELS, type Role } from '../../shared/domain.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { setPageTitle, useRouter } from '../lib/router.jsx';
import { useResource, useWorkspace, type SignedInMember } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { ErrorSummary, Field, focusFieldError, useFormErrors } from '../components/Fields.jsx';
import { NotFound } from './NotFound.jsx';

interface InvitationPayload {
  invitation: { email: string; name: string; role: Role; organisation: string };
}

export function Join({ token }: { token: string }): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { setMember, refresh } = useWorkspace();
  const { navigate } = useRouter();
  const errors = useFormErrors();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, error } = useResource<InvitationPayload>(
    `/api/invitations/${encodeURIComponent(token)}`,
  );

  setPageTitle('Join Marrow Hall Interiors · Marrow Hall Interiors');

  if (error) return <NotFound />;

  const submit = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.join);
    try {
      await request(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        body: { name, password },
      });
      const session = await request<{ member: SignedInMember }>('/api/session');
      setMember(session.member);
      refresh();
      say(success.joined(session.member.name));
      navigate('/office');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
        const first = Object.keys(caught.errors)[0];
        if (first) focusFieldError(formId, first);
      } else if (caught instanceof ApiError && caught.code === 'not_found') {
        problem(refusal.notFound);
      } else {
        problem(refusal.networkFailure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel form-card">
      <h1>Join Marrow Hall Interiors</h1>
      {data ? (
        <dl className="meta">
          <dt>Email</dt>
          <dd>{data.invitation.email}</dd>
          <dt>Role</dt>
          <dd>{ROLE_LABELS[data.invitation.role]}</dd>
          <dt>Organisation</dt>
          <dd>{data.invitation.organisation}</dd>
        </dl>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorSummary formId={formId} errors={errors.errors} />
        <Field formId={formId} path="name" label="Your name" errors={errors.errors}>
          {(attributes) => (
            <input
              {...attributes}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          formId={formId}
          path="password"
          label="Choose a password"
          errors={errors.errors}
          hint="Between 12 and 128 characters."
        >
          {(attributes) => (
            <input
              {...attributes}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <ActionButton
          className="primary"
          busy={busy}
          pendingLabel={pending.join}
          onPress={() => void submit()}
        >
          Join workspace
        </ActionButton>
      </form>
    </section>
  );
}
