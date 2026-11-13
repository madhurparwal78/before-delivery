// /verify/<token>: the result of a confirmation link (brief: Account).
import { useEffect, useState } from 'react';
import { COPY } from '../../shared/copy.ts';
import { post } from '../api.ts';
import { Link } from '../router.tsx';
import { verifyFailure, type VerifyFailure } from './errors.ts';
import { PublicShell } from './PublicShell.tsx';
import { ResendButton } from './ResendButton.tsx';

type Result = { kind: 'pending' } | { kind: 'confirmed' } | VerifyFailure;

export function Verify({ token }: { token: string }) {
  const [result, setResult] = useState<Result>({ kind: 'pending' });
  const [resent, setResent] = useState<{ message: string; accepted: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    post('/api/auth/verify', { token }).then(
      () => { if (active) setResult({ kind: 'confirmed' }); },
      (error: unknown) => { if (active) setResult(verifyFailure(error)); },
    );
    return () => { active = false; };
  }, [token]);

  return (
    <PublicShell>
      <h1>Confirm your email</h1>
      {result.kind === 'confirmed' ? (
        <>
          <p className="lead">{COPY.verifyConfirmed}</p>
          <div className="form-actions"><Link to="/signin" className="btn btn-primary">Sign in</Link></div>
        </>
      ) : null}
      {result.kind === 'expired' || result.kind === 'replaced' ? (
        <>
          <p className="lead">{result.message}</p>
          {resent ? <p className={resent.accepted ? 'success-copy' : 'form-error'}>{resent.message}</p> : null}
          <div className="form-actions">
            <ResendButton label="Send a new link" target={{ token }} email={result.email} onResult={(message, accepted) => setResent({ message, accepted })} />
          </div>
        </>
      ) : null}
      {result.kind === 'unknown' ? <p className="lead">{result.message}</p> : null}
    </PublicShell>
  );
}
