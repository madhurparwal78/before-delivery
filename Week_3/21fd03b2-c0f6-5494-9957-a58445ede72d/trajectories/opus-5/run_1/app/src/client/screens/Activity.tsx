import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_PHRASES, formatActivityTime } from '../../shared/activity.js';
import type { ActivityEvent, ActivityResponse } from '../../shared/api.js';
import { emptyCopy, noticeCopy } from '../../shared/copy.js';
import { ApiFault, api } from '../api.js';
import { AccountMenu } from '../components/AccountMenu.jsx';
import { LiveRegions } from '../components/LiveRegions.jsx';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';
import { announce } from '../regions.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.jsx';

export function Activity({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { me } = useSession();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const olderButton = useRef<HTMLButtonElement | null>(null);

  const fetchPage = async (before: string | null): Promise<void> => {
    announce('notices', noticeCopy.loading);
    try {
      const query = before === null ? '' : `?before=${encodeURIComponent(before)}`;
      const response = await api<ActivityResponse>(
        `/api/workspaces/${workspaceId}/activity${query}`,
      );
      setEvents((current) => {
        const next = before === null ? response.events : [...current, ...response.events];
        if (next.length > 0) announce('notices', noticeCopy.showing(next.length));
        else announce('notices', '');
        return next;
      });
      setNextBefore(response.nextBefore);
      setLoaded(true);
      olderButton.current?.focus();
    } catch (error) {
      if (error instanceof ApiFault && error.status === 404) setMissing(true);
    }
  };

  useEffect(() => {
    void fetchPage(null);
  }, [workspaceId]);

  if (missing) return <NotFound />;

  return (
    <div className="screen">
      <Toolbar>
        <a className="chip" data-chip href={`/w/${workspaceId}`}>
          Projects
        </a>
        <a className="chip" data-chip href={`/w/${workspaceId}/settings`}>
          Settings
        </a>
        <ToolbarDivider />
        {me ? <AccountMenu me={me} workspaceId={workspaceId} /> : null}
        <Wordmark />
      </Toolbar>
      <div className="screen-body">
        <section className="panel">
          <div className="panel-head">
            <h1 className="panel-title">Activity</h1>
          </div>
          <div className="panel-body">
            {loaded && events.length === 0 ? <p className="empty">{emptyCopy.activity}</p> : null}
            <ul className="list" aria-label="Activity">
              {events.map((event) => (
                <li key={event.id}>
                  <span>
                    {event.actor.displayName} {ACTIVITY_PHRASES[event.action]} {event.targetName}
                  </span>
                  <time className="muted num" dateTime={event.at}>
                    {formatActivityTime(event.at)}
                  </time>
                </li>
              ))}
            </ul>
            {nextBefore !== null ? (
              <button
                type="button"
                className="chip"
                ref={olderButton}
                onClick={() => void fetchPage(nextBefore)}
              >
                Show older
              </button>
            ) : null}
          </div>
        </section>
      </div>
      <LiveRegions />
    </div>
  );
}
