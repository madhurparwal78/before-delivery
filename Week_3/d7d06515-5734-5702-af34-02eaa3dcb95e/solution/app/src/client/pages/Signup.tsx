// /signup: the Create account form (brief: Account).
import { useState, type FormEvent } from 'react';
import { STUDIO_ZONES } from '../../shared/zones.ts';
import { post } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { TextField } from '../ui/Field.tsx';
import { fieldMessages, GENERIC_ERROR } from './errors.ts';
import { PublicShell } from './PublicShell.tsx';

interface SignupResponse {
  user: { id: string; name: string; email: string; verified: boolean };
  email_status: 'sent' | 'not_sent';
}

export function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timeZone, setTimeZone] = useState<string>(STUDIO_ZONES[0]);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFailure('');
    try {
      const response = await post<SignupResponse>('/api/auth/signup', { name, email, password, time_zone: timeZone });
      const query = new URLSearchParams({ email: response.user.email });
      if (response.email_status === 'not_sent') query.set('mail', 'unavailable');
      navigate(`/check-inbox?${query}`);
    } catch (error) {
      const fields = fieldMessages(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0) setFailure(GENERIC_ERROR);
      setPending(false);
    }
  };

  return (
    <PublicShell>
      <h1>Create your account</h1>
      <p className="muted lead">Free trial, no card needed.</p>
      <form aria-label="Create account" noValidate onSubmit={(event) => void submit(event)} className="form">
        <TextField label="Name" value={name} onChange={setName} error={errors.name} autoComplete="name" />
        <TextField label="Email" kind="email" value={email} onChange={setEmail} error={errors.email} autoComplete="email" />
        <TextField label="Password" kind="secret" value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" />
        <div className="field">
          <label htmlFor="studio-zone">Studio time zone</label>
          <select
            id="studio-zone"
            className="input"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            aria-invalid={errors.time_zone ? true : undefined}
            aria-describedby={errors.time_zone ? 'studio-zone-error' : undefined}
          >
            {STUDIO_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          {errors.time_zone ? <p id="studio-zone-error" className="field-error">{errors.time_zone}</p> : null}
        </div>
        {failure ? <p role="alert" className="form-error">{failure}</p> : null}
        <button type="submit" className="btn btn-primary btn-wide" aria-disabled={pending || undefined}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="fine-print">Already have an account? <Link to="/signin">Sign in</Link></p>
    </PublicShell>
  );
}
