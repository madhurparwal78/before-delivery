import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { postJson } from '../api.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import type { Account } from '../../shared/types.js';

export function Verify(props: { ctx: AppCtx }): VNode {
  const token = new URLSearchParams(location.search).get('token') ?? '';
  const [heading, setHeading] = useState('Checking your link…');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await postJson<{ account: Account }>('/api/auth/verify', { token });
      if (!alive) return;
      if (!res.ok) {
        if (res.error.error === 'already_verified') {
          setHeading(M.alreadyVerified);
          say(M.alreadyVerified);
        } else {
          setHeading(M.linkExpired);
        }
        setDone(true);
        return;
      }
      setHeading(M.verifySucceeded);
      say(M.verifySucceeded);
      setDone(true);
      await props.ctx.refresh();
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <main>
      <div class="auth-card">
        <h1>{heading}</h1>
        {done && (
          <p>
            <a class="pill" href={props.ctx.account
              ? props.ctx.account.kind === 'educator' ? '/dashboard' : props.ctx.account.kind === 'student' ? '/class' : '/projects'
              : '/projects'}>
              Go to your projects
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
