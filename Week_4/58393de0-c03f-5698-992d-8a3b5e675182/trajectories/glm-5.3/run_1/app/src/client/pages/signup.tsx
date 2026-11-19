import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { postJson } from '../api.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import type { Account } from '../../shared/types.js';
import { setNotices } from '../main.js';

export function SignUp(props: { ctx: AppCtx }): VNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState<'educator' | 'personal'>(
    new URLSearchParams(location.search).get('type') === 'educator' ? 'educator' : 'personal',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.ctx.account) {
      const home = props.ctx.account.kind === 'educator' ? '/dashboard' : props.ctx.account.kind === 'student' ? '/class' : '/projects';
      props.ctx.navigate(home);
    }
  }, [props.ctx.account]);

  const submit = async () => {
    setBusy(true);
    setFieldErrors({});
    const res = await postJson<{ account: Account; verificationEmailSent: boolean }>('/api/auth/signup', {
      displayName: name, email, password, accountType,
    });
    setBusy(false);
    if (!res.ok) {
      const fields = (res.error as { fields?: Record<string, string> }).fields ?? {};
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        mapped[k === 'displayName' ? 'name' : k] = v;
      }
      setFieldErrors(mapped);
      if (Object.keys(fields).length === 0) say(res.error.message);
      return;
    }
    say(accountType === 'educator' ? M.unverifiedReminder(res.data.account.email ?? '') : M.unverifiedReminder(res.data.account.email ?? ''));
    if (!res.data.verificationEmailSent) {
      say(M.mailUnavailable);
      setNotices([M.mailUnavailable]);
    } else {
      setNotices([M.unverifiedReminder(res.data.account.email ?? '')]);
    }
    props.ctx.refresh();
    props.ctx.navigate(res.data.account.kind === 'educator' ? '/dashboard' : '/projects');
  };

  return (
    <main>
      <div class="auth-card">
        <h1>Create your account</h1>
        <p style="color:var(--slate)">Educators run classrooms. Personal makers design at home.</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div class="field">
            <label htmlFor="su-name">Name</label>
            <input id="su-name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-describedby={fieldErrors.name ? 'su-name-err' : undefined} />
            {fieldErrors.name && <span class="err" id="su-name-err" role="alert">{fieldErrors.name}</span>}
          </div>
          <div class="field">
            <label htmlFor="su-email">Email</label>
            <input id="su-email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-describedby={fieldErrors.email ? 'su-email-err' : undefined} />
            {fieldErrors.email && <span class="err" id="su-email-err" role="alert">{fieldErrors.email}</span>}
          </div>
          <div class="field">
            <label htmlFor="su-pass">Password</label>
            <input id="su-pass" type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} aria-describedby={fieldErrors.password ? 'su-pass-err' : undefined} />
            {fieldErrors.password && <span class="err" id="su-pass-err" role="alert">{fieldErrors.password}</span>}
          </div>
          <fieldset class="field" style="border:none;padding:0">
            <legend style="font-weight:600;margin-bottom:6px;">Account type</legend>
            <div class="radio-row" role="radiogroup" aria-label="Account type">
              <label><input type="radio" name="atype" value="educator" checked={accountType === 'educator'} onChange={() => setAccountType('educator')} />Educator</label>
              <label><input type="radio" name="atype" value="personal" checked={accountType === 'personal'} onChange={() => setAccountType('personal')} />Personal maker</label>
            </div>
          </fieldset>
          <button class="pill" type="submit" disabled={busy}>Create account</button>
        </form>
        <p style="margin-top:18px"><a href="/signin">Already have an account? Sign in</a></p>
      </div>
    </main>
  );
}
