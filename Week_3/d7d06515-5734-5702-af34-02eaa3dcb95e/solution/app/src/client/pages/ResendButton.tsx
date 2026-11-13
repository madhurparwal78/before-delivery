// "Send a new link" / "Resend link": asks for a fresh confirmation email and reports the outcome inline and in the announcements.
import { useState } from 'react';
import { copy } from '../../shared/copy.ts';
import { post } from '../api.ts';
import { announce } from '../ui/announce.tsx';
import { resendFailure } from './errors.ts';

interface ResendButtonProps {
  label: string;
  /** Body of POST /api/auth/verify/resend: the address or the old token. */
  target: { email: string } | { token: string };
  /** Address named in the accepted message. */
  email: string;
  /** Reports the outcome to the page, which owns where the copy shows. */
  onResult: (message: string, accepted: boolean) => void;
}

export function ResendButton({ label, target, email, onResult }: ResendButtonProps) {
  const [pending, setPending] = useState(false);

  const send = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      await post('/api/auth/verify/resend', target);
      const message = copy.resendAccepted(email);
      onResult(message, true);
      announce(message);
    } catch (error) {
      const message = resendFailure(error);
      onResult(message, false);
      announce(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <button type="button" className="btn btn-outline" aria-disabled={pending || undefined} onClick={() => void send()}>
      {label}
    </button>
  );
}
