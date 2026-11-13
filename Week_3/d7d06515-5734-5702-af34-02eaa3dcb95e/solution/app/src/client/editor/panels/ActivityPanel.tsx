// Activity tab: the server's activity entries, newest first, refreshed on every activity or change event.
import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry } from '../../../shared/types.ts';
import { get } from '../../api.ts';
import { useEditor } from '../store.ts';
import '../../styles/panels.css';

export function ActivityPanel() {
  const editor = useEditor();
  const drawingId = editor.drawing?.id;
  // The editor snapshot is rebuilt on every state change; the subscription must outlive that.
  const subscribe = useRef(editor.subscribe);
  subscribe.current = editor.subscribe;
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const latest = useRef(0);

  useEffect(() => {
    if (!drawingId) return undefined;
    const refresh = (): void => {
      const ticket = ++latest.current;
      void get<{ entries: ActivityEntry[] }>(`/api/drawings/${drawingId}/activity`).then((answer) => {
        if (ticket === latest.current) setEntries(answer.entries);
      });
    };
    refresh();
    const stops = [subscribe.current('activity', refresh), subscribe.current('change', refresh)];
    return () => {
      latest.current += 1;
      for (const stop of stops) stop();
    };
  }, [drawingId]);

  return (
    <div className="panel">
      <h3 className="panel-heading">Activity</h3>
      <div role="log" aria-label="Activity" className="activity-log">
        {entries.map((entry, index) => <p key={`${entry.at}-${index}`} className="activity-entry">{entry.text}</p>)}
      </div>
    </div>
  );
}
