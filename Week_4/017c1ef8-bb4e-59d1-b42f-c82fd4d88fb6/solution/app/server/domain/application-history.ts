import { rows, type Db } from '../db.js';
import { statusText, type ApplicationState, type HistoryBy } from './application-stages.js';

interface HistoryEntry {
  state: ApplicationState;
  status_text: string;
  at: string;
  by: HistoryBy;
  reason: string | null;
}

/** An application's history in the order it was written, as the API shows it. */
export async function historyOf(db: Db, applicationId: string): Promise<HistoryEntry[]> {
  const entries = await rows<{ state: ApplicationState; at: Date; by: HistoryBy; reason: string | null }>(
    db,
    'SELECT state, at, by, reason FROM application_history WHERE application_id = $1 ORDER BY seq',
    [applicationId],
  );
  return entries.map((entry) => ({ state: entry.state, status_text: statusText(entry.state), at: entry.at.toISOString(), by: entry.by, reason: entry.reason }));
}
