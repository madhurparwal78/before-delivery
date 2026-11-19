import { useState } from 'react';
import { ApiFailure, apiSend } from '../lib/api.js';
import { Link, useQuery, useRouter } from '../lib/router.js';
import { homePathFor, useSession } from '../lib/session.js';
import { TopBar } from '../components/TopBar.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import { isReturnableNext } from '../../shared/returnPath.js';
import type { Account } from '../../shared/types.js';

const formName = 'signup';

export function SignUp(): JSX.Element {
  const query = useQuery();
  const { navigate } = useRouter();
  const { setAccount } = useSession();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);
  const [pending, setPending] = useState(false);

  const next = query.get('next');
  const signInHref = next === null ? '/signin' : `/signin?next=${encodeURIComponent(next)}`;

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const account = await apiSend<Account>('POST', '/api/auth/signup', {
        email,
        displayName,
        handle,
        password,
      });
      setAccount(account);
      setErrors(noFormErrors);
      navigate(next !== null && isReturnableNext(next) ? next : homePathFor(account), { replace: true });
    } catch (error) {
      setErrors({
        fields: error instanceof ApiFailure ? error.fieldErrors : {},
        token: Date.now(),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <TopBar />
      <div className="centred-form">
        <h1>Follow curators on Rushes</h1>
        <ErrorSummary formName={formName} errors={errors} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="field">
            <label htmlFor={`${formName}-email`}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              {...fieldProps(formName, 'email', errors)}
            />
            <FieldError formName={formName} field="email" errors={errors} />
          </div>
          <div className="field">
            <label htmlFor={`${formName}-displayName`}>Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              {...fieldProps(formName, 'displayName', errors)}
            />
            <FieldError formName={formName} field="displayName" errors={errors} />
          </div>
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
            Create account
          </button>
        </form>
        <p>
          <Link to={signInHref}>Sign in</Link>
        </p>
      </div>
    </>
  );
}
