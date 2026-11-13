// dialog "Corbel Draft Pro": emails a numbered quote; there is no checkout (brief: Pro quote).
import { useState } from 'react';
import { COPY, copy } from '../../../shared/copy.ts';
import { post } from '../../api.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { announce } from '../../ui/announce.tsx';
import { quoteFailure } from '../errors.ts';

interface QuoteResponse { quote: { number: string; amount: string; currency: string; sent_to: string } }

export function ProDialog({ onClose }: { onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string; sent: boolean } | null>(null);

  const requestQuote = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    setOutcome(null);
    try {
      const { quote } = await post<QuoteResponse>('/api/quotes', {});
      const message = copy.quoteSent(quote.sent_to);
      setOutcome({ message, sent: true });
      announce(message);
    } catch (error) {
      const message = quoteFailure(error);
      setOutcome({ message, sent: false });
      announce(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog label="Corbel Draft Pro" onClose={onClose}>
      <h2>Corbel Draft Pro</h2>
      <p>{COPY.proBody}</p>
      {outcome ? <p className={outcome.sent ? 'success-copy' : 'form-error'}>{outcome.message}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" aria-disabled={pending || undefined} onClick={() => void requestQuote()}>
          {pending ? 'Sending quote…' : 'Email me a quote'}
        </button>
      </div>
    </Dialog>
  );
}
