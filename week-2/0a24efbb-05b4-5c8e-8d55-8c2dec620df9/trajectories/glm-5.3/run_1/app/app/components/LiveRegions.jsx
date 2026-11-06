import { useEffect, useState } from 'react';
import { CrossIcon } from './icons.jsx';

let listener = null;
export function announce(kind, message) {
  if (listener) listener({ kind, message, at: Date.now() });
}

export function LiveRegions() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    listener = ({ kind, message, at }) => {
      const entry = { message, at };
      if (kind === 'polite') {
        setPolite(message);
      } else {
        setAssertive(message);
      }
      setToast(entry);
    };
    return () => { listener = null; };
  }, []);

  // the toast stays about six seconds, then fades out on its own
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden" id="polite-region">{polite}</div>
      <div role="alert" aria-live="assertive" className="visually-hidden" id="assertive-region">{assertive}</div>
      {toast && (
        <div className={`toast ${toast.dismissed ? 'toast-out' : ''}`} role="group" aria-label="Announcement">
          <span>{toast.message}</span>
          <button type="button" className="toast-dismiss" aria-label="Dismiss" onClick={() => setToast(null)}>
            <CrossIcon />
          </button>
        </div>
      )}
    </>
  );
}
