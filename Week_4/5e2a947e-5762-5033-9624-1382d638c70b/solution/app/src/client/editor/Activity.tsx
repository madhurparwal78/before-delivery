import { useLayoutEffect, useState } from 'preact/hooks';
import type { ActivityEntry } from '../../shared/model.ts';
import { COPY } from '../../shared/rules.ts';
import { api } from '../api.ts';
import type { MapSession } from './session.ts';
import { useSession } from './useSession.ts';

/** Every change as its published sentence, newest first, filterable by person. */
export function Activity(props: { session: MapSession }) {
  const { session } = props;
  useSession(session);
  const [person, setPerson] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  useLayoutEffect(() => {
    const query = person ? `?person=${encodeURIComponent(person)}` : '';
    void api<{ entries: ActivityEntry[] }>('GET', `/api/maps/${session.mapId}/activity${query}`).then((r) => setEntries(r.entries));
  }, [person, session.activityTick]);
  const open = (entry: ActivityEntry): void => {
    if (entry.topic_id && session.display.topics[entry.topic_id]) session.requestFocus(entry.topic_id);
    else session.notice(COPY.missing_topic);
  };
  return (
    <div role="region" aria-label="Activity" class="activity">
      <label class="field-col">
        <span>Person</span>
        <select aria-label="Person" value={person} onChange={(event) => setPerson(event.currentTarget.value)}>
          <option value="">Everyone</option>
          {session.roster.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <ol class="activity-list">
        {entries.map((entry) => (
          <li key={entry.seq}>
            <button type="button" class="activity-row" onClick={() => open(entry)}>
              {entry.sentence}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
