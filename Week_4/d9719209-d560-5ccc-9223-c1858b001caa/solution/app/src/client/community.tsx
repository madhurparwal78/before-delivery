import { useState } from 'react';
import type { CommunityView, ModLogEntry } from '../shared/types.js';
import { countLabel } from '../shared/format.js';
import { ApiError, api, get } from './api.js';
import { announce } from './announce.js';
import { useLoad, type Loaded } from './data.js';
import { useLive } from './live.js';
import { actionText, TargetCell, timeText } from './modlog-cells.js';
import { Link, navigate } from './router.js';
import { useSession } from './session.js';
import { Button } from './ui.js';

/**
 * Loads one community and keeps it current: the member count follows live `membership` events, and the viewer's own
 * role follows `account` events (moderator removed, approved, unapproved), announced once. Call it once per page and
 * pass the result down.
 */
export function useCommunity(name: string): Loaded<CommunityView> {
  const loaded = useLoad(() => get<CommunityView>(`/api/communities/${encodeURIComponent(name)}`), name.toLowerCase());
  const { setData, reload } = loaded;
  useLive([`community:${name.toLowerCase()}`], (event, data) => {
    if (event === 'membership') {
      const payload = data as { communityName: string; memberCount: number };
      if (payload.communityName.toLowerCase() === name.toLowerCase()) setData((c) => (c ? { ...c, memberCount: payload.memberCount } : c));
    } else if (event === 'account') {
      const payload = data as { kind: string; communityName: string | null };
      if (payload.communityName?.toLowerCase() !== name.toLowerCase()) return;
      if (payload.kind === 'moderator-removed') announce('Moderator tools removed');
      if (payload.kind === 'approved') announce(`You can now post in c/${loaded.data?.name ?? name}`);
      void reload();
    } else if (event === 'resync') {
      void reload();
    }
  });
  return loaded;
}

export const membersLabel = (count: number): string => countLabel(count, 'member', 'members');

export function JoinButton({ community, onChange, quiet = false }: { community: CommunityView; onChange: (next: CommunityView) => void; quiet?: boolean }): React.JSX.Element {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const joined = community.viewer.joined;
  const toggle = async (): Promise<void> => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ joined: boolean; memberCount: number }>(joined ? 'DELETE' : 'PUT', `/api/communities/${community.name}/membership`);
      onChange({ ...community, memberCount: result.memberCount, viewer: { ...community.viewer, joined: result.joined } });
    } catch (error) {
      announce(error instanceof ApiError && error.code === 'CONFLICT' ? 'Owners cannot leave their community' : "Couldn't update your membership", true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={joined || quiet ? 'plain' : 'primary'} aria-pressed={joined} disabled={busy} onClick={() => void toggle()}>
      {joined ? 'Joined' : 'Join'}
    </Button>
  );
}

export function CommunityHead({ community, onChange, actions }: {
  community: CommunityView;
  onChange: (next: CommunityView) => void;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="community-head">
      <div>
        <h1>{community.title}</h1>
        <p className="slug"><Link to={`/c/${community.name}`}>{`c/${community.name}`}</Link>{' · '}<span id={`members-${community.name}`} className="num">{membersLabel(community.memberCount)}</span></p>
      </div>
      <div className="head-actions">
        <JoinButton community={community} onChange={onChange} />
        {actions}
      </div>
    </header>
  );
}

/** Description, numbered rules and the five newest mod log entries. */
export function CommunitySidebar({ community }: { community: CommunityView }): React.JSX.Element {
  const log = useLoad(() => get<{ items: ModLogEntry[] }>(`/api/communities/${community.name}/modlog`), `${community.name}:${community.viewer.isModerator}`);
  const { reload } = log;
  useLive([`community:${community.name.toLowerCase()}`], (event) => {
    if (event === 'post-state' || event === 'resync') void reload();
  });
  const entries = log.data?.items.slice(0, 5) ?? [];
  return (
    <aside className="sidebar" aria-label="About this community">
      {community.description !== '' && <p>{community.description}</p>}
      <h2>Rules</h2>
      {community.rules.length > 0
        ? <ol>{community.rules.map((r) => <li key={r.id}><strong>{r.title}</strong>{r.description !== '' && <><br />{r.description}</>}</li>)}</ol>
        : <p className="muted">This community has no rules yet.</p>}
      <h2>Mod log</h2>
      {entries.length > 0 && (
        <ul className="sidebar-log">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span>{actionText(entry.action)}</span>
              <span><TargetCell community={community.name} entry={entry} /></span>
              <span className="num muted">{timeText(entry)}</span>
            </li>
          ))}
        </ul>
      )}
      {log.data && entries.length === 0 && <p className="muted">No moderator actions yet.</p>}
      <p><Link to={`/c/${community.name}/about/log`}>View the full mod log</Link></p>
    </aside>
  );
}
