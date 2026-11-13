import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { formatNumber } from '../../shared/domain';
import { api, ApiFailure, type Friends } from '../api';
import { openSheet } from '../auth-sheet';
import { subscribe } from '../live';
import { navigate } from '../router';
import { refreshMe, type Store } from '../store';
import { Chips, Link, ModeGlyph, RackGlyph, restoreFocus } from '../ui';

const CUE_NAMES: Record<string, string> = {
  'cue-starter': 'Starter Cue',
  'cue-ash-break': 'Ash Break',
  'cue-copper-ferrule': 'Copper Ferrule',
  'cue-night-maple': 'Night Maple',
  'cue-velvet-taper': 'Velvet Taper',
  'cue-long-rail-master': 'Long Rail Master',
  'cue-brass-inlay': 'Brass Inlay',
  'cue-lamp-black': 'Lamp Black',
};

const PRESENCE = { online: 'Online', in_match: 'In a match', offline: 'Offline' };

function FriendsPanel({ open, onClose, panel }: { open: boolean; onClose: () => void; panel: RefObject<HTMLElement | null> }): ReactNode {
  const [friends, setFriends] = useState<Friends | null>(null);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const load = (): void => void api<Friends>('GET', '/api/friends').then(setFriends).catch(() => undefined);

  useEffect(() => {
    if (!open) return undefined;
    load();
    return subscribe('friends', load);
  }, [open]);

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const { requestId } = await api<{ requestId: string }>('POST', '/api/friends/requests', { code });
      const latest = await api<Friends>('GET', '/api/friends');
      setFriends(latest);
      setNotice(`Request sent to ${latest.outgoing.find((item) => item.requestId === requestId)?.displayName}.`);
      setCode('');
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  const accept = async (requestId: string, name: string): Promise<void> => {
    await api('POST', `/api/friends/requests/${requestId}/accept`);
    setNotice(`${name} is now your friend.`);
    load();
  };
  const decline = async (requestId: string): Promise<void> => {
    await api('POST', `/api/friends/requests/${requestId}/decline`);
    load();
  };
  const block = async (id: string): Promise<void> => {
    await api('POST', `/api/friends/${id}/block`);
    load();
  };
  const createTable = async (): Promise<void> => {
    try {
      const { tableUrl } = await api<{ tableUrl: string }>('POST', '/api/private-tables');
      navigate(tableUrl);
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };

  return (
    <section ref={panel} className={`friends-panel${open ? ' open' : ''}`} role="region" aria-label="Friends" inert={!open} tabIndex={-1}>
      <div className="friends-head">
        <h2>Friends</h2>
        <button type="button" onClick={onClose}>Close friends</button>
      </div>
      <p className="note">Your code <strong>{friends?.friendCode}</strong></p>
      <form className="friend-form" onSubmit={(event) => void send(event)}>
        <div className="field">
          <label htmlFor="friend-code">Friend code</label>
          <input id="friend-code" type="text" autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        <button type="submit">Send request</button>
      </form>
      <p role="status" aria-label="Friends notice" className="notice">{notice}</p>
      <button type="button" className="primary" onClick={() => void createTable()}>Create private table</button>
      {friends?.incoming.map((item) => (
        <div className="friend-row" key={item.requestId}>
          <span>{item.displayName}</span>
          <span className="home-actions">
            <button type="button" onClick={() => void accept(item.requestId, item.displayName)}>Accept {item.displayName}</button>
            <button type="button" onClick={() => void decline(item.requestId)}>Decline {item.displayName}</button>
          </span>
        </div>
      ))}
      <ul aria-label="Friends list">
        {friends?.friends.map((friend) => (
          <li className="friend-row" key={friend.id}>
            <span>{friend.displayName} <span className="note">{PRESENCE[friend.presence]}</span></span>
            <button type="button" onClick={() => void block(friend.id)}>Block {friend.displayName}</button>
          </li>
        ))}
      </ul>
      {friends?.friends.length === 0 && <div className="empty"><RackGlyph /><p>Share your code to fill this rail.</p></div>}
    </section>
  );
}

interface Card {
  name: string;
  open: boolean;
  run: () => void;
}

export function Home({ store }: { store: Store }): ReactNode {
  const { me, online, outage, auth } = store;
  // The cached player holds the page's shape while /api/me is in flight, so the lobby does not jump when it answers.
  const player = auth === 'player' || (auth === 'loading' && me !== null);
  const modes = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const openPanel = (from: HTMLElement): void => {
    opener.current = from;
    setPanelOpen(true);
  };
  const closePanel = (): void => {
    setPanelOpen(false);
    restoreFocus(opener.current);
  };
  useLayoutEffect(() => {
    if (panelOpen) panel.current?.focus({ preventScroll: true });
  }, [panelOpen]);
  useEffect(() => {
    if (!panelOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  const onlineAction = (from: HTMLElement, action: () => void): void => {
    if (player) action();
    else openSheet({ opener: from, then: action });
  };
  const toCards = (name: string, path: string): Card => ({ name, open: false, run: () => navigate(path) });
  const cards: Card[] = [
    toCards('Play 1-on-1', '/play'),
    toCards('Play Special', '/play/special'),
    { name: 'Play with Friends', open: false, run: () => setPanelOpen(true) },
    { name: 'Practice Offline', open: true, run: () => navigate('/practice') },
    toCards('Shop', '/shop'),
    { name: 'Settings', open: true, run: () => navigate('/settings') },
    toCards('Tournaments', '/tournaments'),
    toCards('Clubs', '/clubs'),
    toCards('Leaderboards', '/leaderboards'),
  ];
  const name = player ? me?.displayName ?? '–' : 'Guest';
  const firstMatch = me !== null && player && me.wins + me.losses === 0;
  const act = async (path: string, success: string): Promise<void> => {
    try {
      await api('POST', path);
      setNotice(success);
      await refreshMe();
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  const retry = async (): Promise<void> => {
    setRetrying(true);
    await refreshMe();
    setRetrying(false);
  };

  return (
    <>
      <a className="skip" href="#modes" onClick={(event) => {
        event.preventDefault();
        modes.current?.focus();
      }}>Skip to modes</a>
      <header className="topbar"><span className="brand">Headstring</span></header>
      <main className="page">
        <h1 tabIndex={-1} className="visually-hidden">Home</h1>
        <div className="identity">
          <div className="identity-main">
            <Link href={player ? '/profile' : '/home'} className="profile-link" aria-description={name} onClick={(event) => {
              if (player) return;
              event.preventDefault();
              openSheet({ opener: event.currentTarget, then: () => navigate('/profile') });
            }}>
              <span className="avatar" aria-hidden="true">{name[0].toUpperCase()}</span>
              <span className="profile-text">
                <span className="caption">Profile</span>
                <span className="identity-name" aria-hidden="true">{name}</span>
              </span>
            </Link>
            {player && me !== null && (
              <div className="identity-side">
                <span className="caption">Level {formatNumber(me.level)}</span>
                <div role="progressbar" aria-label="XP" aria-valuemin={0} aria-valuemax={me.xpToNext} aria-valuenow={me.xp} className="xp-track">
                  <div className="xp-fill" style={{ width: `${(me.xp / me.xpToNext) * 100}%` }} />
                </div>
                <span className="note">{formatNumber(me.xp)} / {formatNumber(me.xpToNext)} XP</span>
                <span className="note"><span className="caption">Equipped </span><span role="status" aria-label="Equipped cue">{CUE_NAMES[me.equippedCueId]}</span></span>
              </div>
            )}
            <button type="button" aria-expanded={panelOpen} disabled={!online} onClick={(event) => {
              const from = event.currentTarget;
              onlineAction(from, () => openPanel(from));
            }}>Friends</button>
          </div>
          {player && <Chips store={store} className="home-chips" />}
        </div>
        {player && me !== null && (
          <div className="home-actions">
            <button type="button" disabled={me.dailyRewardClaimed} onClick={() => void act('/api/wallet/daily-reward', 'Daily reward claimed.')}>Claim daily reward</button>
            {me.coins < 100 && (
              <>
                <button type="button" onClick={() => void act('/api/wallet/refill', 'Refill added.')}>Refill</button>
                <span className="note">{me.refillsLeft} left today</span>
              </>
            )}
          </div>
        )}
        <div className="notices">
          <p role="status" aria-label="Home notice" className="notice">{notice}</p>
          <div className={outage ? 'outage' : undefined}>
            <span role="status" aria-label="Connection">{outage ? 'Could not reach the table' : ''}</span>
            {outage && <button type="button" disabled={retrying} onClick={() => void retry()}>Retry</button>}
          </div>
          <p role="status" aria-label="Mail notice" className="notice">{me?.mailDelayed ? 'Verification mail is delayed. Play on; we will retry.' : ''}</p>
          {me?.activeTableUrl && <Link href={me.activeTableUrl} className="button">Back to table</Link>}
        </div>
        <section ref={modes} id="modes" className="modes" role="region" aria-label="Modes" tabIndex={-1}>
          {cards.map((card, index) => {
            const offline = !online && !card.open;
            const mark = offline ? 'Offline' : index === 0 && firstMatch ? 'First match' : undefined;
            return (
              <button
                key={card.name}
                type="button"
                aria-description={mark}
                className={`mode-card${index > 5 ? ' minor' : ''}`}
                disabled={offline}
                onClick={(event) => {
                  if (card.open) card.run();
                  else onlineAction(event.currentTarget, card.run);
                }}
              >
                <ModeGlyph name={card.name} />
                <span className="mode-title">{card.name}</span>
                {mark !== undefined && <span className="mode-mark" aria-hidden="true">{mark}</span>}
              </button>
            );
          })}
        </section>
      </main>
      <FriendsPanel open={panelOpen} onClose={closePanel} panel={panel} />
    </>
  );
}
