import { useEffect, useState } from 'react';
import { api, type Notice } from './types.js';
import { useLive } from './live.js';
import { hhmm } from './time.js';

export function NoticesPage(): JSX.Element {
  const live = useLive();
  const [notices, setNotices] = useState<Notice[]>([]);

  const load = (): void => {
    void api<{ notices: Notice[] }>('/api/notices').then((x) => setNotices(x.notices));
  };
  useEffect(load, []);
  useEffect(() => { if (live.notices.size) load(); }, [live.notices]);

  const mailDown = live.status?.services.mail === 'down';

  return (
    <div className="page">
      <h1>Notices</h1>
      <div role="status" aria-live="polite" id="mail-status">
        {mailDown ? 'Mail is unreachable. Notices are queued and each will be sent once when it is back.' : ''}
      </div>
      <ul className="notices-ul" aria-label="Notices">
        {notices.map((n) => (
          <li key={n.id} className="notice-row">
            {n.subject} · to {n.to} · {n.state === 'sent' && n.sent_at ? `Sent ${hhmm(n.sent_at)}` : 'Queued'}
          </li>
        ))}
        {notices.length === 0 ? <li className="dim">No notices</li> : null}
      </ul>
    </div>
  );
}
