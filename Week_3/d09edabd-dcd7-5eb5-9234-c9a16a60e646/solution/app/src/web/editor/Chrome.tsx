import { useState } from 'react';
import { Check, ChevronDown, Copy, Cuboid, FolderOpen, Layers, Move3d, Plus, Rotate3d, Scale3d, SkipForward, Square, Upload, Users, Workflow, Wrench } from '../ui/icons';
import { figureStrings } from '../../shared/format';
import { post } from '../api';
import { navigate } from '../nav';
import { Popover } from '../ui/Popover';
import { SessionClock } from './Clock';
import { addPrimitive, setMode } from './placements';
import { stepNode } from './nodes';
import { LIVE_PAUSED_COPY, inviteTester, playMode, pressPlay } from './play';
import { openPicker } from './rooms';
import { editor, openDialog, useEditor } from './state';
import { LogoMark, PlayGlyph } from './icons';
import type { Mode } from './model';
import type { Session } from '../../shared/types';

const STORAGE_COPY = "Prop storage is unavailable. Uploads and freezing resume when it's back.";

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('');

const roomCode = (id: string): string => id.slice(0, 6).toUpperCase();

function useInviteTarget(): Session | null {
  const sessions = useEditor((s) => s.sessions);
  const active = useEditor((s) => s.session);
  if (active) return active;
  return sessions.filter((x) => x.state === 'scheduled').sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
}

function PlayButton({ raised }: { raised: boolean }) {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.me);
  const mode = playMode();
  const stopping = mode === 'stop';
  return (
    <button type="button" className={`round-play${raised ? ' raised' : ''}`} aria-label={stopping ? 'Stop playtest' : 'Start playtest'} disabled={mode === 'blocked' && session !== null} onClick={pressPlay} data-play="">
      <PlayGlyph playing={stopping} size={raised ? 24 : 20} />
    </button>
  );
}

function ModeButtons() {
  const mode = useEditor((s) => s.mode);
  const modes: [Mode, string, typeof Move3d][] = [['move', 'Move', Move3d], ['rotate', 'Rotate', Rotate3d], ['scale', 'Scale', Scale3d]];
  return (
    <>
      {modes.map(([key, name, Icon]) => (
        <button key={key} type="button" className="chrome-btn" aria-label={name} aria-pressed={mode === key} onClick={() => setMode(key)}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ))}
    </>
  );
}

function SessionMenuItems({ choose }: { choose: (run: () => void) => () => void }) {
  const signOut = async (): Promise<void> => {
    await post('/api/auth/logout');
    editor.reset();
    navigate('/signin');
  };
  return (
    <>
      <button type="button" role="menuitem" onClick={choose(() => openDialog('versions'))}>Freeze version</button>
      <button type="button" role="menuitem" onClick={choose(() => openDialog('versions'))}>Versions</button>
      <button type="button" role="menuitem" onClick={choose(() => openDialog('props'))}>Prop library</button>
      <button type="button" role="menuitem" onClick={choose(() => openDialog('shortcuts'))}>Keyboard shortcuts</button>
      <button type="button" role="menuitem" onClick={choose(() => void signOut())}>Sign out</button>
    </>
  );
}

function InviteForm({ onSent }: { onSent?: () => void }) {
  const [email, setEmail] = useState('');
  const target = useInviteTarget();
  const send = async (): Promise<void> => {
    if (!target || !email.trim()) return;
    const sent = email;
    const errors = await inviteTester(target.id, sent.trim());
    if (Object.keys(errors).length === 0) {
      setEmail((current) => (current === sent ? '' : current));
      onSent?.();
    }
  };
  return (
    <>
      <input type="email" aria-label="Invite tester email" placeholder="Tester email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void send()} />
      <button type="button" className="primary-small" disabled={!email.trim() || !target} onClick={() => void send()}>Invite</button>
    </>
  );
}

function Banners() {
  const live = useEditor((s) => s.live);
  const storage = useEditor((s) => s.storageUp);
  return (
    <span role="status" aria-label="Service status" className="banner">
      {[live ? '' : LIVE_PAUSED_COPY, storage ? '' : STORAGE_COPY].filter(Boolean).join(' ')}
    </span>
  );
}

function Connection() {
  const queue = useEditor((s) => s.queue);
  const offline = useEditor((s) => s.offline);
  const text = queue.length === 0 ? 'All changes saved.' : offline ? `Offline. ${queue.length === 1 ? '1 change' : `${queue.length} changes`} waiting to save.` : 'Saving...';
  return (
    <span role="status" aria-label="Connection" className="connection">
      {text}
    </span>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="chrome-btn"
      aria-label="Copy room code"
      onClick={() => {
        void navigator.clipboard.writeText(code).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

function Figures({ only }: { only?: 'first' }) {
  const room = useEditor((s) => s.room);
  const [solved, run, props] = figureStrings(room?.stats ?? { solved: 0, total: 0, longestRun: 0, props: 0 });
  return (
    <div className="figures" role="group" aria-label="Chain figures">
      <span>{solved}</span>
      {only ? null : <span>{run}</span>}
      {only ? null : <span>{props}</span>}
    </div>
  );
}

function PresenceButton() {
  const members = useEditor((s) => s.members);
  const live = useEditor((s) => s.live);
  const count = live ? Math.max(1, members.length) : 1;
  return (
    <Popover label="Presence" nameFromContent buttonClass="chrome-btn wide" icon={<Users size={16} aria-hidden="true" />} text={`${count} here`} panel="group">
      {() => (
        <ul className="member-list">
          {(live && members.length ? members : [{ userId: 'me', displayName: editor.get().me?.displayName ?? '' }]).map((m) => (
            <li key={m.userId}>{m.displayName}</li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

function AccountButton() {
  const me = useEditor((s) => s.me);
  const workspace = useEditor((s) => s.workspaceName);
  return (
    <Popover label="Account" nameFromContent buttonClass="avatar" icon={<span aria-hidden="true">{initials(me?.displayName ?? '')}</span>} panel="group">
      {() => (
        <div className="account-card">
          <strong>{me?.displayName}</strong>
          <span>{me?.email}</span>
          <span>{workspace}</span>
        </div>
      )}
    </Popover>
  );
}

export function DesktopChrome() {
  const room = useEditor((s) => s.room);
  const live = useEditor((s) => s.live);
  const storage = useEditor((s) => s.storageUp);
  const session = useEditor((s) => s.session);
  const units = useEditor((s) => s.units);
  const cuesOpen = useEditor((s) => s.cuesOpen);
  const banner = !live || !storage;
  const code = room ? roomCode(room.id) : '——————';
  return (
    <>
      <div className="cluster top-left">
        <button type="button" className="chrome-btn square" aria-label="Rooms" onClick={openPicker}>
          <LogoMark />
        </button>
      </div>
      <div className="pill" role="toolbar" aria-label="Live session" data-live={live}>
        <span className="status-dot" aria-hidden="true" />
        <span className="status-word">{live ? 'Live' : 'Paused'}</span>
        <Connection />
        {banner ? null : (
          <span className="middle">
            <span className="room-code">{code}</span>
            <CopyCode code={code} />
            <InviteForm />
          </span>
        )}
        <Banners />
        <button type="button" className="chrome-btn" aria-label="Playtests" onClick={() => openDialog('playtests')}>
          <Workflow size={16} aria-hidden="true" />
        </button>
        <Popover label="Session menu" icon={<ChevronDown size={16} aria-hidden="true" />}>{({ choose }) => <SessionMenuItems choose={choose} />}</Popover>
      </div>
      <div className="cluster top-right">
        <Figures />
        <PresenceButton />
        <AccountButton />
      </div>
      <div className="cluster column bottom-left">
        <Popover label="Add primitive" buttonClass="chrome-btn square" icon={<Plus size={18} aria-hidden="true" />} above menuLabel="Add primitive" panelClass="compact">
          {({ choose }) => (
            <>
              <button type="button" role="menuitem" onClick={choose(() => void addPrimitive('door'))}>Door</button>
              <button type="button" role="menuitem" onClick={choose(() => void addPrimitive('box'))}>Box</button>
              <button type="button" role="menuitem" onClick={choose(() => void addPrimitive('cylinder'))}>Cylinder</button>
            </>
          )}
        </Popover>
        <button type="button" className="chrome-btn square" aria-label="Upload prop" onClick={() => openDialog('props')} data-upload="">
          <Upload size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="cluster column bottom-right">
        <button type="button" className="chrome-btn square" aria-label="Cue timeline" aria-pressed={cuesOpen} onClick={() => editor.set({ cuesOpen: !cuesOpen })}>
          <Layers size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="chrome-btn square"
          aria-pressed={units === 'ft'}
          onClick={() => {
            const next = units === 'ft' ? 'm' : 'ft';
            localStorage.setItem('kb-units', next);
            editor.set({ units: next });
          }}
        >
          <span aria-hidden="true">{units}</span>
          <span className="visually-hidden">Units</span>
        </button>
      </div>
      <div className="transport" role="toolbar" aria-label="Transport">
        <ModeButtons />
        <PlayButton raised={false} />
        <button type="button" className="chrome-btn" aria-label="Trigger graph" onClick={() => openDialog('graph')}>
          <Cuboid size={18} aria-hidden="true" />
        </button>
        <button type="button" className="chrome-btn" aria-label="Prop library" onClick={() => openDialog('props')}>
          <FolderOpen size={18} aria-hidden="true" />
        </button>
        <button type="button" className="chrome-btn" aria-label="Next node" onClick={() => stepNode(1)}>
          <SkipForward size={18} aria-hidden="true" />
        </button>
        {session?.state === 'running' ? <SessionClock session={session} /> : null}
      </div>
    </>
  );
}

export function PhoneChrome() {
  const room = useEditor((s) => s.room);
  const live = useEditor((s) => s.live);
  const session = useEditor((s) => s.session);
  const code = room ? roomCode(room.id) : '——————';
  return (
    <>
      <div className="phone-top">
        <LogoMark />
        <div className="pill compact" role="toolbar" aria-label="Live session" data-live={live}>
          <span className="status-dot" aria-hidden="true" />
          <span className="visually-hidden">{live ? 'Live' : 'Paused'}</span>
          <span className="room-code">{code}</span>
          <Popover label="Session menu" icon={<ChevronDown size={16} aria-hidden="true" />} panel="group" panelClass="spans-screen">
            {({ choose, close }) => (
              <div className="phone-session">
                <Connection />
                <Banners />
                <div className="menu-row">
                  <InviteForm onSent={close} />
                </div>
                <button type="button" className="menu-link" onClick={choose(() => openDialog('playtests'))}>Playtests</button>
                <Figures />
                <div role="menu" aria-label="Session menu actions">
                  <SessionMenuItems choose={choose} />
                </div>
              </div>
            )}
          </Popover>
        </div>
        <PresenceButton />
        <Figures only="first" />
      </div>
      <div className="transport-phone tabbar" role="toolbar" aria-label="Transport">
        <Popover label="Tools" buttonClass="tab" icon={<Wrench size={20} aria-hidden="true" />} text="Tools" above panelClass="compact">
          {({ choose }) => (
            <>
              <button type="button" role="menuitem" onClick={choose(() => setMode('move'))}>Move</button>
              <button type="button" role="menuitem" onClick={choose(() => setMode('rotate'))}>Rotate</button>
              <button type="button" role="menuitem" onClick={choose(() => setMode('scale'))}>Scale</button>
              <button type="button" role="menuitem" onClick={choose(() => openDialog('scene'))}>Scene</button>
            </>
          )}
        </Popover>
        <button type="button" className="tab" aria-label="Graph" onClick={() => openDialog('graph')}>
          <Cuboid size={20} aria-hidden="true" />
          <span>Graph</span>
        </button>
        <div className="slot-play">
          <PlayButton raised />
          {session?.state === 'running' ? <SessionClock session={session} /> : null}
        </div>
        <button type="button" className="tab" aria-label="Props" onClick={() => openDialog('props')}>
          <FolderOpen size={20} aria-hidden="true" />
          <span>Props</span>
        </button>
        <button type="button" className="tab" aria-label="Rooms" onClick={openPicker}>
          <Square size={20} aria-hidden="true" />
          <span>Rooms</span>
        </button>
      </div>
    </>
  );
}
