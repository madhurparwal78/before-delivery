import { useEffect, useRef, useState } from 'react';
import { announce, announcementState, subscribeToAnnouncements } from '../announce.js';
import { Icon } from './Icon.jsx';

const TOAST_SECONDS = 6;

function useAnnouncements(initialPolite) {
  const [current, setCurrent] = useState(() => ({ polite: initialPolite ?? '', assertive: '', toast: null }));
  useEffect(() => subscribeToAnnouncements(() => setCurrent(announcementState())), []);
  return current;
}

function Toast({ toast }) {
  const held = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!held.current) announce.dismissToast();
    }, TOAST_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div
      className={`toast toast-${toast.tone}`}
      onPointerEnter={() => {
        held.current = true;
      }}
      onPointerLeave={() => {
        held.current = false;
      }}
      onFocusCapture={() => {
        held.current = true;
      }}
      onBlurCapture={() => {
        held.current = false;
      }}
    >
      <span>{toast.message}</span>
      <button type="button" className="icon-button" aria-label="Dismiss message" onClick={() => announce.dismissToast()}>
        <Icon name="cross" size={16} />
      </button>
    </div>
  );
}

/**
 * The two live regions: counts and work in progress politely, outcomes and refusals
 * assertively. The visible toast mirrors whichever was announced last.
 */
export function LiveRegions({ initialPolite }) {
  const current = useAnnouncements(initialPolite);
  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden">
        {current.polite}
      </div>
      <div role="alert" aria-live="assertive" className="visually-hidden">
        {current.assertive}
      </div>
      {current.toast ? <Toast toast={current.toast} /> : null}
    </>
  );
}
