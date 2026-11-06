import { useState } from 'react';
import { COPY } from '../../shared/copy';
import { api } from '../api';
import { navigate, useRoute } from '../router';
import { sessionRestored } from '../session';
import { Link, Problems, TextField, classOf, useForm, useTitle, wantHeadingFocus } from '../ui/kit';

function landing(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/desk/jobs';
}

function enter(address: string): void {
  sessionRestored();
  wantHeadingFocus();
  navigate(address);
}

function SubmitLabel({ busy, label }: { busy: boolean; label: string }) {
  return <>{busy ? COPY.working : label}</>;
}

export function SignIn() {
  const route = useRoute();
  useTitle('Sign in');
  const form = useForm(null, () => ({ email: '', password: '' }));
  const send = () =>
    form.submit(async () => {
      await api('/api/sign-in', { method: 'POST', body: form.values });
      enter(landing(route.search.get('next')));
    });
  return (
    <main className="page narrow-page">
      <h1 tabIndex={-1} className="reveal"><span className="heading-line" data-part="heading-line">Sign in</span></h1>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Problems form={form} />
        <TextField form={form} name="email" label="Email" autoComplete="email" inputMode="email" />
        <TextField form={form} name="password" label="Password" autoComplete="current-password" type="password" />
        <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}><SubmitLabel busy={form.busy} label="Sign in" /></button>
      </form>
      <p className="form-foot"><Link className="nav-link" href="/sign-up">Start a desk</Link></p>
    </main>
  );
}

export function SignUp() {
  useTitle('Start a desk');
  const [fields] = useState(() => ({ name: '', email: '', password: '' }));
  const form = useForm(null, () => fields);
  const send = () =>
    form.submit(async () => {
      await api('/api/sign-up', { method: 'POST', body: form.values });
      enter('/desk/jobs');
    });
  return (
    <main className="page narrow-page">
      <h1 tabIndex={-1} className="reveal"><span className="heading-line" data-part="heading-line">Start a desk</span></h1>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Problems form={form} />
        <TextField form={form} name="name" label="Name" autoComplete="name" />
        <TextField form={form} name="email" label="Email" autoComplete="email" inputMode="email" />
        <TextField form={form} name="password" label="Password" autoComplete="new-password" type="password" />
        <button type="submit" className={classOf('primary')} aria-disabled={form.busy ? true : undefined}><SubmitLabel busy={form.busy} label="Start a desk" /></button>
      </form>
      <p className="form-foot"><Link className="nav-link" href="/sign-in">Sign in</Link></p>
    </main>
  );
}

