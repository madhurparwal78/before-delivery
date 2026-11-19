import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

interface WaitlistDialogProps {
  readonly tierName: string;
  readonly pending: boolean;
  readonly onJoin: (name: string, email: string) => void;
  readonly onClose: () => void;
}

export function WaitlistDialog({ tierName, pending, onJoin, onClose }: WaitlistDialogProps): ReactNode {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  return (
    <Dialog title="Join the waitlist" closable={!pending} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) onJoin(name, email);
        }}
      >
        <h2>Join the waitlist</h2>
        <p>{`${tierName} is sold out. We will offer you the next seat that comes back.`}</p>
        <div className="field">
          <label htmlFor="waitlist-name">Full name</label>
          <input id="waitlist-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="waitlist-email">Email</label>
          <input id="waitlist-email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="dialog-actions">
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Joining' : 'Join waitlist'}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
