import { useEffect, useId, useState } from 'react';
import type { FieldError, User } from '../../shared/types.js';
import { ApiFailure, apiSend } from '../api.js';
import { useApp } from '../app.js';

const USES = ['Teaching', 'Research', 'Analysis', 'Tinkering'] as const;

interface SignUpFormProps {
  /** Set when an invited person has no account yet. */
  invitation?: { token: string; email: string } | null;
  onInvitedDone?: (notebookId: string) => void;
}

/** The underline-field sign-up form, used on the landing page and at /signup. */
export function SignUpForm({ invitation = null, onInvitedDone }: SignUpFormProps): JSX.Element {
  const app = useApp();
  const base = useId();
  const ids = {
    displayName: `${base}-display-name`,
    email: `${base}-email`,
    password: `${base}-password`,
    use: `${base}-use`,
  };
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState(invitation ? invitation.email : '');
  const [password, setPassword] = useState('');
  const [use, setUse] = useState<string>(USES[0]);
  const invitedEmail = invitation === null ? null : invitation.email;
  useEffect(() => {
    if (invitedEmail !== null) setEmail(invitedEmail);
  }, [invitedEmail]);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [mailFailure, setMailFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const fieldError = (path: string): string | null => {
    const found = errors.find((error) => error.path === path);
    return found ? found.message : null;
  };

  const fieldId = (path: string): string => {
    if (path === 'display_name') return ids.displayName;
    if (path === 'password') return ids.password;
    return ids.email;
  };

  const fieldLabel = (path: string): string => {
    if (path === 'display_name') return 'Display name';
    if (path === 'password') return 'Password';
    return 'Email';
  };

  const submit = async (): Promise<void> => {
    setErrors([]);
    setMailFailure(null);
    setNotice(null);
    setSending(true);
    try {
      await apiSend<{ user: User }>('POST', '/api/auth/signup', {
        display_name: displayName,
        email,
        password,
        use,
        ...(invitation ? { invitation_token: invitation.token } : {}),
      });
      if (invitation) {
        setNotice('You are in. Opening the notebook…');
        const accepted = await apiSend<{ notebook_id: string }>(
          'POST',
          `/api/invitations/${encodeURIComponent(invitation.token)}/accept`,
        );
        const me = await apiSend<{ user: User | null }>('GET', '/api/me');
        app.setUser(me.user);
        if (onInvitedDone) onInvitedDone(accepted.notebook_id);
        else app.navigate(`/notebooks/${accepted.notebook_id}`);
        return;
      }
      setNotice('Check your inbox to verify your email.');
      setDisplayName('');
      setEmail('');
      setPassword('');
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) setErrors(error.fieldErrors);
      else if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        setMailFailure('We could not send email right now. Try again in a minute.');
      } else throw error;
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="signup-form"
      aria-label="Create your account"
      id="create-your-account"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {errors.length > 0 ? (
        <div className="error-summary" role="alert">
          <p>Please fix the following:</p>
          <ul>
            {errors.map((error) => (
              <li key={`${error.path}-${error.message}`}>
                <a
                  href={`#${fieldId(error.path)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(fieldId(error.path))?.focus();
                  }}
                >
                  {`${fieldLabel(error.path)} ${error.message}`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {mailFailure ? (
        <div className="error-summary" role="alert">
          <p>{mailFailure}</p>
        </div>
      ) : null}
      {notice ? <p className="form-notice">{notice}</p> : null}

      <div className="field">
        <label htmlFor={ids.displayName}>Display name</label>
        <input
          id={ids.displayName}
          name="display_name"
          type="text"
          placeholder="Your name *"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        {fieldError('display_name') ? <p className="field-error">{fieldError('display_name')}</p> : null}
      </div>
      <div className="field">
        <label htmlFor={ids.email}>Email</label>
        <input
          id={ids.email}
          name="email"
          type="email"
          placeholder="you@example.test *"
          value={email}
          readOnly={invitation !== null}
          aria-readonly={invitation !== null ? true : undefined}
          onChange={(event) => setEmail(event.target.value)}
        />
        {fieldError('email') ? <p className="field-error">{fieldError('email')}</p> : null}
      </div>
      <div className="field">
        <label htmlFor={ids.password}>Password</label>
        <input
          id={ids.password}
          name="password"
          type="password"
          placeholder="At least 10 characters *"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {fieldError('password') ? <p className="field-error">{fieldError('password')}</p> : null}
      </div>
      <div className="field">
        <label htmlFor={ids.use}>I mostly use notebooks for</label>
        <select id={ids.use} name="use" value={use} onChange={(event) => setUse(event.target.value)}>
          {USES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="button-embossed button-submit" disabled={sending}>
        Create account
      </button>
    </form>
  );
}
