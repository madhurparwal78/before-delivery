import { useAnnouncer } from '../lib/announce';

export function Announcements() {
  const current = useAnnouncer((s) => s.current);
  return (
    <div id="announcements" role="status" aria-live="polite" aria-label="Announcements" className="visually-hidden">
      {current}
    </div>
  );
}
