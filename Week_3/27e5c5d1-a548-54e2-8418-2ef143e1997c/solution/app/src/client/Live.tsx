import type { ReactElement } from 'react';
import { COPY } from './copy.ts';
import { dismissNotice, useStore } from './store.ts';

/** The strip under the top bar; it keeps its height when empty so the board never moves. */
export function ServiceBanner(): ReactElement {
  const service = useStore((s) => s.service);
  return (
    <div role="status" aria-label="Service status" className="banner">
      {service.live === 'paused' && <p>{COPY.livePaused}</p>}
      {service.storage === 'down' && <p>{COPY.storageDown}</p>}
    </div>
  );
}

export function Notices(): ReactElement {
  const notices = useStore((s) => s.notices);
  return (
    <section aria-label="Notices" className="notices">
      {notices.map((notice) => (
        <div key={notice.id} className="notice">
          <p>{notice.text}</p>
          <button type="button" onClick={() => dismissNotice(notice.id)}>Dismiss notice</button>
        </div>
      ))}
    </section>
  );
}

export function Announcements(): ReactElement {
  const spoken = useStore((s) => s.spoken);
  return (
    <div role="status" aria-label="Board announcements" className="sr-only">
      {spoken.map((entry) => (
        <p key={entry.id}>{entry.text}</p>
      ))}
    </div>
  );
}

/** A sighted confirmation for saves and archives; not a live region, so nothing is announced twice. */
export function Toast(): ReactElement | null {
  const toast = useStore((s) => s.toast);
  return toast ? (
    <div className="toast" aria-hidden="true">
      {toast}
    </div>
  ) : null;
}
