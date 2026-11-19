import { useState } from 'react';
import { ApiFailure, apiSend } from '../lib/api.js';
import { Link, useQuery, useRouter } from '../lib/router.js';
import { homePathFor, useSession } from '../lib/session.js';
import { TopBar } from '../components/TopBar.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import { isReturnableNext } from '../../shared/returnPath.js';
import { fieldMessages } from '../../shared/fields.js';
import type { Account } from '../../shared/types.js';

const formName = 'signin';

export function SignIn(): JSX.Element {
  const query = useQuery();
  const { navigate } = useRouter();
  const { setAccount } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);
  const [pending, setPending] = useState(false);

  const next = query.get('next');
  const signUpHref = next === null ? '/signup' : `/signup?next=${encodeURIComponent(next)}`;

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const account = await apiSend<Account>('POST', '/api/auth/signin', { email, password });
      setAccount(account);
      setErrors(noFormErrors);
      navigate(next !== null && isReturnableNext(next) ? next : homePathFor(account), { replace: true });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'invalid_credentials') {
        setErrors({ fields: { email: fieldMessages.credentials }, token: Date.now() });
      } else if (error instanceof ApiFailure && error.code === 'validation') {
        setErrors({ fields: error.fieldErrors, token: Date.now() });
      } else {
        setErrors({ fields: { email: fieldMessages.credentials }, token: Date.now() });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <TopBar />
      <div className="centred-form">
        <h1>Sign in to Rushes</h1>
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
            Sign in
          </button>
        </form>
        <p>
          <Link to={signUpHref}>Create an account</Link>
        </p>
      </div>
    </>
  );
}
