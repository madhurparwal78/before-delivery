import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { postJson } from '../api.js';
import { say } from '../status.js';
import type { Account } from '../../shared/types.js';

export function SignIn(props: { ctx: AppCtx }): VNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.ctx.account) {
      const a = props.ctx.account;
      props.ctx.navigate(a.kind === 'educator' ? '/dashboard' : a.kind === 'student' ? '/class' : '/projects');
    }
  }, [props.ctx.account]);

  const submit = async () => {
    setBusy(true);
    const res = await postJson<{ account: Account }>('/api/auth/signin', { email, password });
    setBusy(false);
    if (!res.ok) {
      say(res.error.message);
      return;
    }
    await props.ctx.refresh();
    const a = res.data.account;
    props.ctx.navigate(a.kind === 'educator' ? '/dashboard' : a.kind === 'student' ? '/class' : '/projects');
  };

  return (
    <main>
      <div class="auth-card">
        <h1>Sign in</h1>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div class="field">
            <label htmlFor="si-email">Email</label>
            <input id="si-email" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label htmlFor="si-pass">Password</label>
            <input id="si-pass" type="password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
          </div>
          <button class="pill" type="submit" disabled={busy}>Sign in</button>
        </form>
        <p style="margin-top:18px"><a href="/signup">New here? Create an account</a></p>
      </div>
    </main>
  );
}
