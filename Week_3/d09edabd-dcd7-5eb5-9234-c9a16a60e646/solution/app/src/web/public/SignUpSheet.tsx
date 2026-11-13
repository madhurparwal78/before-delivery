import { Field } from '../pages/Field';
import { useAuthForm } from '../pages/useAuthForm';

/** The page's last stop: opening a venue creates the owner account and its starter rooms. */
export function SignUpSheet() {
  const { errors, busy, submit } = useAuthForm('/api/auth/signup');
  return (
    <section className="tour-section tour-signup">
      <div className="sheet-card">
        <h2>Open your bench</h2>
        <p className="sheet-lede">Your workspace starts with five rooms to open, the Vault included.</p>
        <form className="auth-form" aria-label="Create your venue" onSubmit={submit} noValidate>
          <Field label="Email" name="email" type="email" autoComplete="email" error={errors.email} />
          <Field label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." error={errors.password} />
          <Field label="Your name" name="displayName" type="text" autoComplete="name" error={errors.displayName} />
          <Field label="Venue name" name="venueName" type="text" autoComplete="organization" error={errors.venueName} />
          {errors.form ? (
            <p className="form-error" role="alert">
              {errors.form}
            </p>
          ) : null}
          <button className="btn primary wide" type="submit" disabled={busy}>
            Create venue
          </button>
        </form>
      </div>
    </section>
  );
}
