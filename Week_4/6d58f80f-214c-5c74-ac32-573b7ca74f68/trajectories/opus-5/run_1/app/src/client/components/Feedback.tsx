import { STORAGE_OUTAGE } from '../../shared/copy.js';
import { dismissNotice, useGlobal } from '../lib/store.js';

export const Announcements = (): JSX.Element => {
  const announcement = useGlobal((state) => state.announcement);
  return (
    <div role="status" aria-live="polite" aria-label="Announcements" className="visually-hidden">
      {announcement === null ? '' : announcement.text}
    </div>
  );
};

export const Notices = (): JSX.Element => {
  const notices = useGlobal((state) => state.notices);
  return (
    <section aria-label="Notices" className="notices">
      {notices.map((notice) => (
        <div className="notice" key={notice.id}>
          <p style={{ margin: 0 }}>{notice.text}</p>
          <button type="button" className="quiet" onClick={() => dismissNotice(notice.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </section>
  );
};

export const ServiceStatusBanner = (): JSX.Element => {
  const status = useGlobal((state) => state.status);
  const down = status.storage === 'down';
  return (
    <section
      aria-label="Service status"
      className={down ? 'banner' : 'visually-hidden'}
    >
      {down ? STORAGE_OUTAGE : ''}
    </section>
  );
};
