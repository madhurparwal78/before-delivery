import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../shared/copy';
import { ApiFailure, login, peekResume, takeSignInNotice } from '../lib/api';
import { navigate } from '../lib/router';

export function SignInPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const notice = takeSignInNotice();
    if (notice !== null) setAnnouncement(notice);
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const nextEmailError = email.trim() === '' ? COPY.signInEmailError : '';
    const nextPasswordError = password === '' ? COPY.signInPasswordError : '';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError !== '' || nextPasswordError !== '') return;
    setPending(true);
    setAnnouncement(COPY.signingIn);
    try {
      await login(email.trim(), password);
      const resume = peekResume();
      navigate(resume === null ? '/inbox' : resume.url);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        setEmailError(error.fields.email ?? '');
        setPasswordError(error.fields.password ?? '');
        setAnnouncement('');
      } else {
        setAnnouncement(COPY.badCredentials);
      }
    } finally {
      setPending(false);
    }
  };

  const errors: Array<{ text: string; focus: () => void }> = [];
  if (emailError !== '') errors.push({ text: emailError, focus: () => emailRef.current?.focus() });
  if (passwordError !== '') errors.push({ text: passwordError, focus: () => passwordRef.current?.focus() });

  return (
    <div className="column form-page">
      <h1>{COPY.signInHeading}</h1>
      <form onSubmit={submit} noValidate>
        {errors.length > 0 && (
          <div className="error-summary">
            <ul>
              {errors.map((entry) => (
                <li key={entry.text}>
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      entry.focus();
                    }}
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="field">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            name="email"
            type="text"
            ref={emailRef}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailError !== '' && <p className="field-error">{emailError}</p>}
        </div>
        <div className="field">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            name="password"
            type="password"
            ref={passwordRef}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordError !== '' && <p className="field-error">{passwordError}</p>}
        </div>
        <button className="accent-button" type="submit">
          Sign in
        </button>
      </form>
      <p className="live-region" role="status" aria-label="Sign-in announcements" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
