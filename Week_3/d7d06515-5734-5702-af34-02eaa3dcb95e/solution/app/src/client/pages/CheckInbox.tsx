// /check-inbox?email=<email>: shown after sign-up (brief: Account).
import { useState } from 'react';
import { COPY, copy } from '../../shared/copy.ts';
import { useLocation } from '../router.tsx';
import { PublicShell } from './PublicShell.tsx';
import { ResendButton } from './ResendButton.tsx';

export function CheckInbox() {
  const { search } = useLocation();
  const email = search.get('email') ?? '';
  const [outcome, setOutcome] = useState<{ message: string; accepted: boolean } | null>(
    search.get('mail') === 'unavailable' ? { message: COPY.mailUnavailableConfirmation, accepted: false } : null,
  );

  return (
    <PublicShell>
      <h1>{COPY.checkInboxHeading}</h1>
      {outcome === null ? <p className="lead">{copy.confirmationSent(email)}</p> : null}
      {outcome ? <p className={outcome.accepted ? 'success-copy' : 'form-error'}>{outcome.message}</p> : null}
      <div className="form-actions">
        <ResendButton label="Send a new link" target={{ email }} email={email} onResult={(message, accepted) => setOutcome({ message, accepted })} />
      </div>
    </PublicShell>
  );
}
