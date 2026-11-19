import { useEffect, useState } from 'react';
import { ApiFailure, apiGet, apiSend } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { homePathFor, useSession } from '../lib/session.js';
import { TopBar } from '../components/TopBar.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import { NotFound } from './NotFound.js';
import type { Account, InviteView } from '../../shared/types.js';

const formName = 'invite';

export function InviteAcceptance({ token }: { token: string }): JSX.Element {
  const { navigate } = useRouter();
  const { setAccount } = useSession();
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void apiGet<InviteView>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((error: unknown) => {
        setGone(error instanceof ApiFailure && error.code === 'invite_used' ? 'This invite has already been used.' : 'missing');
      });
  }, [token]);

  if (gone === 'missing') {
    return <NotFound />;
  }
  if (gone !== null) {
    return (
      <>
        <TopBar />
        <div className="centred-form">
          <h1>{gone}</h1>
        </div>
      </>
    );
  }
  if (invite === null) {
    return (
      <>
        <TopBar />
        <div className="centred-form" />
      </>
    );
  }

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const account = await apiSend<Account>('POST', `/api/invites/${encodeURIComponent(token)}/accept`, {
        handle,
        password,
      });
      setAccount(account);
      navigate(homePathFor(account), { replace: true });
    } catch (error) {
      setErrors({ fields: error instanceof ApiFailure ? error.fieldErrors : {}, token: Date.now() });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <TopBar />
      <div className="centred-form">
        <h1>Join {invite.workspaceName}</h1>
        <p>
          Invited as <span className="mono">{invite.email}</span>
        </p>
        <ErrorSummary formName={formName} errors={errors} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor={`${formName}-handle`}>Handle</label>
            <input
              type="text"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              {...fieldProps(formName, 'handle', errors)}
            />
            <FieldError formName={formName} field="handle" errors={errors} />
          </div>
          <div className="field">
            <label htmlFor={`${formName}-password`}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...fieldProps(formName, 'password', errors)}
            />
            <FieldError formName={formName} field="password" errors={errors} />
          </div>
          <button type="submit" className="primary" disabled={pending}>
            Join {invite.workspaceName}
          </button>
        </form>
      </div>
    </>
  );
}
