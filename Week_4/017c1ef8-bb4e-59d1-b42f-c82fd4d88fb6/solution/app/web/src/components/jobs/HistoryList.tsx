import { useConfig } from '../../clock';
import { formatDate, formatTime } from '../../format';
import type { HistoryEntry } from './jobModel';

/** Who an entry is attributed to; `viewer` is how the page's reader relates to the application. */
function attribution(entry: HistoryEntry, viewer: 'applicant' | 'poster'): string {
  if (entry.by === 'automatic') return `Automatic: ${entry.reason ?? ''}`;
  if (entry.by === 'hiring_team') return 'Hiring team';
  return viewer === 'applicant' ? 'You' : 'Applicant';
}

/** An application's attributed history: `<status text> · <date> at <time> · <who>`. */
export function HistoryList({ title, history, viewer }: { title: string; history: HistoryEntry[]; viewer: 'applicant' | 'poster' }) {
  const { time_zone: zone } = useConfig();
  return (
    <ul className="plain-list history" aria-label={`History for ${title}`}>
      {history.map((entry) => (
        <li key={`${entry.state}-${entry.at}`}>{`${entry.status_text} · ${formatDate(entry.at, zone)} at ${formatTime(entry.at, zone)} · ${attribution(entry, viewer)}`}</li>
      ))}
    </ul>
  );
}
