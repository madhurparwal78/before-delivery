import { useEffect, useRef, useState } from 'react';
import { INBOX_OUTAGE } from '../../shared/copy.ts';
import { formatLeagueStamp } from '../../shared/leagueTime.ts';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';
import { LiveRegion, useAnnounce } from '../live.tsx';
import { Dialog } from './Dialog.tsx';

export const NoticesButton = () => {
  const { notices, noticesOutage, refreshNotices } = useApp();
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const announce = useAnnounce();

  const unread = notices?.unread ?? 0;
  const name = unread > 0 ? `Notices, ${unread} unread` : 'Notices';
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (notices === null) return;
    if (seen.current === null) {
      seen.current = new Set(notices.notices.map((notice) => notice.id));
      return;
    }
    for (const notice of [...notices.notices].reverse()) {
      if (seen.current.has(notice.id)) continue;
      seen.current.add(notice.id);
      announce('Notices', notice.message);
    }
  }, [notices, announce]);

  const markAllRead = async (): Promise<void> => {
    setMarking(true);
    try {
      await api.readAllNotices();
      await refreshNotices();
      announce('Notices', 'All notices marked read.');
    } finally {
      setMarking(false);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={opener}
        className="notices-button"
        aria-label={name}
        onClick={() => {
          setOpen(true);
          void refreshNotices();
        }}
      >
        <span aria-hidden="true" className="bell">
          ✉
        </span>
        {unread > 0 && (
          <span aria-hidden="true" className="unread-count mono">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <Dialog title="Notices" onClose={() => setOpen(false)} returnFocusTo={opener.current}>
          {noticesOutage ? (
            <p className="notice-outage">{INBOX_OUTAGE}</p>
          ) : (notices?.notices.length ?? 0) === 0 ? (
            <p className="empty">No notices yet.</p>
          ) : (
            <ul aria-label="Notices" className="notice-list">
              {notices!.notices.map((notice) => (
                <li key={notice.id} className={notice.read ? 'notice read' : 'notice'}>
                  <span className="notice-message">{notice.message}</span>
                  <span className="notice-stamp mono">{formatLeagueStamp(notice.created)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={() => void markAllRead()} disabled={marking}>
              {marking ? 'Marking…' : 'Mark all read'}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
      <LiveRegion name="Notices" />
    </>
  );
};
