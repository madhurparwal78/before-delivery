import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CLUB_CAPACITY, PRESET_MESSAGES, formatNumber } from '../../shared/domain';
import { api, ApiFailure, type Club, type ClubSummary } from '../api';
import { subscribe } from '../live';
import { navigate } from '../router';
import { refreshMe, type Store } from '../store';
import { Link, RackGlyph, Screen } from '../ui';

const ROLE_ITEMS = [['Make owner', 'owner'], ['Make officer', 'officer'], ['Make member', 'member']] as const;

export function Clubs({ store }: { store: Store }): ReactNode {
  const [clubs, setClubs] = useState<ClubSummary[] | null>(null);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<'open' | 'request'>('open');
  const load = (): void => void api<{ clubs: ClubSummary[] }>('GET', '/api/clubs').then((body) => setClubs(body.clubs)).catch(() => setClubs((held) => held ?? []));
  useEffect(load, []);

  const join = async (club: ClubSummary): Promise<void> => {
    try {
      const { status } = await api<{ status: string }>('POST', `/api/clubs/${club.id}/join`);
      setNotice(status === 'member' ? `Joined ${club.name}.` : `Request sent to ${club.name}.`);
      load();
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const club = await api<Club>('POST', '/api/clubs', { name, joinPolicy: policy });
      await refreshMe();
      navigate(`/clubs/${club.id}`);
    } catch (error) {
      const failure = error as ApiFailure;
      setNotice(failure.errors.name ?? failure.message);
    }
  };

  return (
    <Screen store={store} title="Clubs">
      <p role="status" aria-label="Club notice" className="notice">{notice}</p>
      <ul className="row-list">
        {clubs?.map((club) => (
          <li key={club.id}>
            <span>
              <Link href={`/clubs/${club.id}`}><strong>{club.name}</strong></Link>
              <span className="note"> {club.memberCount} / {CLUB_CAPACITY} · Weekly score {formatNumber(club.weeklyScore)}</span>
            </span>
            <button type="button" onClick={() => void join(club)}>Join {club.name}</button>
          </li>
        ))}
      </ul>
      {clubs !== null && (
        <form className="tournament-card" onSubmit={(event) => void create(event)}>
          <h2>New club</h2>
          <div className="field">
            <label htmlFor="club-name">Club name</label>
            <input id="club-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="radio-row" role="radiogroup" aria-label="Join policy">
            <label className="radio"><input type="radio" name="join-policy" checked={policy === 'open'} onChange={() => setPolicy('open')} />Open</label>
            <label className="radio"><input type="radio" name="join-policy" checked={policy === 'request'} onChange={() => setPolicy('request')} />Request to join</label>
          </div>
          <button type="submit" className="primary">Create club</button>
        </form>
      )}
    </Screen>
  );
}

function RoleMenu({ name, onPick, onClose }: { name: string; onPick: (role: string) => void; onClose: () => void }): ReactNode {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const [index, setIndex] = useState(0);
  useLayoutEffect(() => {
    items.current[index]?.focus();
  }, [index]);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : ROLE_ITEMS.length - 1)) % ROLE_ITEMS.length);
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="role-menu" role="menu" aria-label={`Change role for ${name}`} onKeyDown={onKey}>
      {ROLE_ITEMS.map(([label, role], position) => (
        <button
          key={role}
          ref={(element) => {
            items.current[position] = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={position === index ? 0 : -1}
          onClick={() => onPick(role)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RosterRow({ member, showMenu, clubId, onChanged }: {
  member: Club['members'][number]; showMenu: boolean; clubId: string; onChanged: (notice: string) => void;
}): ReactNode {
  const [menu, setMenu] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setMenu(false);
    opener.current?.focus();
  };
  const pick = async (role: string): Promise<void> => {
    close();
    try {
      await api('PATCH', `/api/clubs/${clubId}/members/${member.playerId}`, { role });
      onChanged(`${member.displayName} is now ${role}.`);
    } catch (error) {
      onChanged((error as ApiFailure).message);
    }
  };
  return (
    <li>
      <span>{member.displayName} <span className="note">{member.role}</span></span>
      {showMenu && (
        <span className="role-cell">
          <button ref={opener} type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>Change role for {member.displayName}</button>
          {menu && <RoleMenu name={member.displayName} onPick={(role) => void pick(role)} onClose={close} />}
        </span>
      )}
    </li>
  );
}

export function ClubScreen({ store, id }: { store: Store; id: string }): ReactNode {
  const [club, setClub] = useState<Club | null>(null);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const load = (): void => void api<Club>('GET', `/api/clubs/${id}`).then(setClub).catch(() => setMissing(true));
  useEffect(() => {
    load();
    return subscribe(`club:${id}`, load);
  }, [id]);

  if (missing) return <Screen store={store} title="Nothing on this table"><></></Screen>;
  if (club === null) return <Screen store={store} title="Club"><p className="note">–</p></Screen>;

  const me = club.members.find((member) => member.playerId === store.me?.id);
  const canDecide = me?.role === 'owner' || me?.role === 'officer';
  const leave = async (): Promise<void> => {
    try {
      await api('POST', `/api/clubs/${id}/leave`);
      setNotice(`Left ${club.name}.`);
      load();
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  const decide = async (playerId: string, decision: string): Promise<void> => {
    try {
      await api('POST', `/api/clubs/${id}/requests/${playerId}`, { decision });
      load();
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };
  const sendPreset = async (preset: string): Promise<void> => {
    await api('POST', `/api/clubs/${id}/messages`, { preset });
  };

  return (
    <Screen store={store} title={club.name}>
      <div className="queue-row">
        <p role="status" aria-label="Weekly score" className="turn-text">Weekly score {formatNumber(club.weeklyScore)}</p>
        <p role="status" aria-label="Members" className="turn-text">{club.memberCount} / {CLUB_CAPACITY}</p>
      </div>
      <p role="status" aria-label="Club notice" className="notice">{notice}</p>
      <div className="club-layout">
        <div className="page-head">
          <h2>Roster</h2>
          <ul className="row-list" aria-label="Roster">
            {club.members.map((member) => (
              <RosterRow
                key={member.playerId}
                member={member}
                showMenu={me?.role === 'owner' && member.playerId !== me.playerId}
                clubId={id}
                onChanged={(sentence) => {
                  setNotice(sentence);
                  load();
                }}
              />
            ))}
          </ul>
          {canDecide && club.requests.map((request) => (
            <div className="friend-row" key={request.playerId}>
              <span>{request.displayName}</span>
              <span className="home-actions">
                <button type="button" onClick={() => void decide(request.playerId, 'approve')}>Approve {request.displayName}</button>
                <button type="button" onClick={() => void decide(request.playerId, 'reject')}>Reject {request.displayName}</button>
              </span>
            </div>
          ))}
          {me !== undefined && <div><button type="button" onClick={() => void leave()}>Leave club</button></div>}
        </div>
        <div className="page-head">
          <h2>Messages</h2>
          <div role="log" aria-label="Club messages" aria-live="polite" className="message-log">
            {club.messages.map((message) => <p key={message.id}>{message.displayName}: {message.preset}</p>)}
          </div>
          {club.messages.length === 0 && <div className="empty"><RackGlyph /></div>}
          {me !== undefined && (
            <div className="preset-row" role="group" aria-label="Preset messages">
              {PRESET_MESSAGES.map((preset) => <button key={preset} type="button" onClick={() => void sendPreset(preset)}>{preset}</button>)}
            </div>
          )}
        </div>
      </div>
    </Screen>
  );
}
