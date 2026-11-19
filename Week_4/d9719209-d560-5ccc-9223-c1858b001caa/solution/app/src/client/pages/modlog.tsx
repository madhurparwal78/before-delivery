import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModLogEntry } from '../../shared/types.js';
import { get, query } from '../api.js';
import { announce } from '../announce.js';
import { CommunityHead, useCommunity } from '../community.js';
import { useLive } from '../live.js';
import { actionText, TargetCell, timeText } from '../modlog-cells.js';
import { Link } from '../router.js';
import { Button, Empty, Skeleton, pageTitle } from '../ui.js';
import './pages.css';

interface LogPage { items: ModLogEntry[]; nextCursor: string | null }

export function ModLogPage({ name }: { name: string }): React.JSX.Element {
  const community = useCommunity(name);
  const data = community.data;
  pageTitle(data ? `Mod log · c/${data.name}` : 'Mod log');
  const isModerator = data?.viewer.isModerator ?? false;
  const showModerator = (data?.showModNames ?? false) || isModerator;
  const [entries, setEntries] = useState<ModLogEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const generation = useRef(0);
  const ready = data !== undefined && data !== null;

  const first = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const page = await get<LogPage>(`/api/communities/${name}/modlog`);
      if (mine !== generation.current) return;
      setEntries(page.items);
      setCursor(page.nextCursor);
    } catch {
      if (mine === generation.current) setEntries([]);
    }
  }, [name]);

  // The viewer's role decides which columns the server fills in, so a role change starts the log over.
  useEffect(() => {
    if (!ready) return;
    setEntries(null);
    void first();
  }, [ready, isModerator, first]);

  useLive([`community:${name.toLowerCase()}`], (event) => {
    if (event === 'post-state' || event === 'resync') void first();
  });

  const loadMore = async (): Promise<void> => {
    setMore(true);
    try {
      const page = await get<LogPage>(`/api/communities/${name}/modlog${query({ cursor })}`);
      setEntries((all) => [...(all ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      announce("Couldn't load more entries", true);
    } finally {
      setMore(false);
    }
  };

  if (community.error?.status === 404) return <Empty title="Community not found">There is no community called c/{name}.</Empty>;
  if (!data) return <Skeleton rows={4} />;
    return (
    <div className="page-wide">
      <CommunityHead community={data} onChange={(next) => community.setData(next)} actions={<Link to={`/c/${data.name}`} className="btn">Back to community</Link>} />
      <h2>Mod log</h2>
      {entries === null ? <Skeleton rows={4} /> : (
        <div className="table-wrap">
          <table className="data" aria-label="Moderation log">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Reason</th>
                {showModerator && <th scope="col">Moderator</th>}
                {isModerator && <th scope="col">Private note</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="num">{timeText(entry)}</td>
                  <td>{actionText(entry.action)}</td>
                  <td><TargetCell community={data.name} entry={entry} /></td>
                  <td>{entry.publicReason ?? ''}</td>
                  {showModerator && <td>{entry.moderator ? <Link to={`/u/${entry.moderator.username}`}>{`u/${entry.moderator.username}`}</Link> : ''}</td>}
                  {isModerator && <td>{entry.privateNote ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries !== null && entries.length === 0 && <Empty title="No moderator actions yet">Removals, locks and pins appear here with their public reasons.</Empty>}
      {cursor !== null && <div className="load-more"><Button disabled={more} onClick={() => void loadMore()}>Load more entries</Button></div>}
    </div>
  );
}
