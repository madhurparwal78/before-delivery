import { useId, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal } from '../lib/copy.js';
import { Link, setPageTitle, useRouter } from '../lib/router.jsx';
import { takePendingRestore } from '../lib/drafts.js';
import { useWorkspace, type SignedInMember } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { Field, useFormErrors } from '../components/Fields.jsx';

export function SignIn(): JSX.Element {
  const formId = useId();
  const { startPending, say, problem } = useAnnouncer();
  const { setMember, refresh } = useWorkspace();
  const { navigate, query } = useRouter();
  const errors = useFormErrors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  setPageTitle('Sign in · Marrow Hall Interiors');

  const submit = async (): Promise<void> => {
    setBusy(true);
    errors.clear();
    startPending(pending.signIn);
    try {
      const result = await request<{ member: { id: string; name: string } }>('/api/session', {
        body: { email, password },
      });
      const session = await request<{ member: SignedInMember }>('/api/session');
      setMember(session.member);
      refresh();
      const restore = takePendingRestore(result.member.id);
      const next = query.get('next');
      if (restore && next && restore.path === next) {
        navigate(`${next}${next.includes('?') ? '&' : '?'}restore=${restore.formKey}`);
        return;
      }
      navigate(next && next.startsWith('/office') ? next : '/office');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_credentials') {
        problem(refusal.wrongCredentials);
      } else if (caught instanceof ApiError && caught.code === 'validation') {
        errors.set(caught.errors);
      } else {
        problem(refusal.networkFailure);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel form-card">
      <h1>Sign in to Plumbline</h1>
      <p className="meta">Marrow Hall Interiors delivery workspace.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field formId={formId} path="email" label="Email" errors={errors.errors}>
          {(attributes) => (
            <input
              {...attributes}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field formId={formId} path="password" label="Password" errors={errors.errors}>
          {(attributes) => (
            <input
              {...attributes}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <ActionButton
          className="primary"
          busy={busy}
          pendingLabel={pending.signIn}
          onPress={() => void submit()}
        >
          Sign in
        </ActionButton>
      </form>
      <hr className="hairline" />
      <p className="meta">
        <Link to="/">Marrow Hall Interiors public site</Link>
      </p>
    </section>
  );
}
