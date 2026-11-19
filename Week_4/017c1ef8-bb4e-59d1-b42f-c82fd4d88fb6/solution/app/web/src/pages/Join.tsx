import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { AuthFrame } from '../auth/AuthFrame';
import { CONFIRM_EMAIL_KEY } from '../auth/confirm-email';
import { Alert, Button, Field, FieldErrorSummary, type FieldProblem } from '../ui';

const FIELDS = [
  { name: 'name', label: 'Name' },
  { name: 'email', label: 'Email' },
  { name: 'handle', label: 'Handle' },
  { name: 'password', label: 'Password' },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];

export default function Join() {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<FieldName, string>>({ name: '', email: '', handle: '', password: '' });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await api.post('/api/auth/signup', values);
      sessionStorage.setItem(CONFIRM_EMAIL_KEY, values.email.trim());
      navigate('/confirm', { state: { email: values.email.trim() } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors(Object.fromEntries(FIELDS.flatMap(({ name }) => (error.field(name) ? [[name, error.field(name)]] : []))));
      } else {
        setErrors({});
        setFailure('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const problems: FieldProblem[] = FIELDS.flatMap(({ name, label }) => {
    const message = errors[name];
    return message ? [{ name, label, message }] : [];
  });

  return (
    <AuthFrame title="Join" lead="Every rule is stated and shown.">
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <FieldErrorSummary problems={problems} />
        <Alert>{failure}</Alert>
        {FIELDS.map(({ name, label }) => (
          <Field
            key={name}
            name={name}
            label={label}
            value={values[name]}
            error={errors[name]}
            type={name === 'password' ? 'password' : name === 'email' ? 'email' : 'text'}
            role="textbox"
            autoComplete={name === 'password' ? 'new-password' : name === 'email' ? 'email' : name === 'name' ? 'name' : 'username'}
            autoCapitalize={name === 'handle' || name === 'email' ? 'none' : undefined}
            spellCheck={false}
            onChange={(event) => setValues({ ...values, [name]: event.target.value })}
          />
        ))}
        <Button type="submit" disabled={busy}>
          Create account
        </Button>
      </form>
      <p className="auth-aside">
        Already a member? <Link to="/signin">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
