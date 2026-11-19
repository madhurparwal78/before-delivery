import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { postJson } from '../api.js';
import { say } from '../status.js';
import { M } from '../copy.js';
import type { Account } from '../../shared/types.js';

export function Join(props: { ctx: AppCtx }): VNode {
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pending = props.ctx.pendingJoin;

  useEffect(() => {
    if (props.ctx.account && props.ctx.account.kind === 'student') {
      props.ctx.navigate('/class');
    }
  }, [props.ctx.account]);

  const submit = async () => {
    setBusy(true);
    setFieldErrors({});
    const errors: Record<string, string> = {};

    // Skip the code step when a pending session already holds this code.
    const hasPending = pending !== null;
    if (!hasPending) {
      const codeRes = await postJson<{ classroom: { name: string } }>('/api/join/code', { code });
      if (!codeRes.ok) {
        setBusy(false);
        if (codeRes.error.error === 'too_many_attempts') errors.code = M.tooManyAttempts;
        else errors.code = M.codeNotOpen;
        setFieldErrors(errors);
        say(errors.code);
        return;
      }
    }

    const nickRes = await postJson<{ account: Account }>('/api/join/nickname', { nickname });
    setBusy(false);
    if (!nickRes.ok) {
      const fields = (nickRes.error as { fields?: Record<string, string> }).fields ?? {};
      if (fields.nickname) {
        setFieldErrors({ nickname: fields.nickname });
        say(fields.nickname);
      } else if (nickRes.error.error === 'nickname_taken') {
        setFieldErrors({ nickname: M.nicknameTaken });
        say(M.nicknameTaken);
      } else if (nickRes.error.error === 'join_closed') {
        setFieldErrors({ code: M.codeNotOpen });
        say(M.codeNotOpen);
      } else if (nickRes.error.error === 'classroom_full') {
        setFieldErrors({ code: M.classroomFull });
        say(M.classroomFull);
      } else {
        say(nickRes.error.message);
      }
      return;
    }
    const account = nickRes.data.account;
    say(M.joined(pending?.classroomName ?? 'the class', account.nickname ?? ''));
    await props.ctx.refresh();
    props.ctx.navigate('/class');
  };

  return (
    <main>
      <div class="auth-card">
        <h1>Join your class</h1>
        <p style="color:var(--slate)">Type the class code your instructor gave you, then your nickname. No email, no password.</p>
        {pending && <p style="color:var(--slate)">Class code already checked: <strong>{pending.classroomName}</strong></p>}
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {!pending && (
            <div class="field">
              <label htmlFor="join-code">Class code</label>
              <input id="join-code" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} aria-describedby={fieldErrors.code ? 'join-code-err' : undefined} autoComplete="off" />
              {fieldErrors.code && <span class="err" id="join-code-err" role="alert">{fieldErrors.code}</span>}
            </div>
          )}
          <div class="field">
            <label htmlFor="join-nick">Nickname</label>
            <input id="join-nick" value={nickname} onInput={(e) => setNickname((e.target as HTMLInputElement).value)} aria-describedby={fieldErrors.nickname ? 'join-nick-err' : undefined} />
            {fieldErrors.nickname && <span class="err" id="join-nick-err" role="alert">{fieldErrors.nickname}</span>}
          </div>
          <button class="pill" type="submit" disabled={busy}>Join class</button>
        </form>
      </div>
    </main>
  );
}
