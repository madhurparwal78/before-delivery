import '../styles/pages.css';
import { Brand } from './Brand';
import { Field } from './Field';
import { InternalLink } from './InternalLink';
import { useAuthForm } from './useAuthForm';

export default function SignInPage() {
  const { errors, busy, submit } = useAuthForm('/api/auth/login');
  return (
    <main className="plain-page">
      <div className="sheet-card">
        <InternalLink href="/" className="brand-link">
          <Brand />
        </InternalLink>
        <form className="auth-form" aria-label="Sign in" onSubmit={submit} noValidate>
          <h1>Sign in</h1>
          <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
          <Field label="Password" name="password" type="password" autoComplete="current-password" error={errors.password} />
          {errors.form ? (
            <p className="form-error" role="alert">
              {errors.form}
            </p>
          ) : null}
          <button className="btn primary wide" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <InternalLink href="/" className="text-link">
          Take the tour
        </InternalLink>
      </div>
    </main>
  );
}
