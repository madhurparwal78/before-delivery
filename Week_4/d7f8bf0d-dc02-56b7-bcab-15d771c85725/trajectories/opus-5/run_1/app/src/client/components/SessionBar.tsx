import { useEffect, useRef, useState } from 'react';
import { writeView, type SheetName } from '../lib/viewState.js';
import { useStore } from '../store.js';
import { CameraGlyph, GearGlyph } from './Art.js';

const MENU_SHEETS: { label: string; sheet: SheetName }[] = [
  { label: 'Layouts', sheet: 'layouts' },
  { label: 'Versions', sheet: 'versions' },
  { label: 'Timetable', sheet: 'timetable' },
  { label: 'Members', sheet: 'members' },
  { label: 'Standards', sheet: 'standards' },
  { label: 'History', sheet: 'history' },
  { label: 'Trash', sheet: 'trash' },
];

function Counter({
  label,
  value,
  testId,
}: {
  label: string;
  value: number;
  testId: string;
}): JSX.Element {
  return (
    <div className="counter" data-testid={testId}>
      <span className="counter-label">{label}</span>
      <span className="counter-figure">{value}</span>
    </div>
  );
}

export function SessionBar(): JSX.Element {
  const { me, view, session, role, actions } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  const openSheet = (sheet: SheetName): void => {
    writeView({ sheet });
    void actions.refreshSheet(sheet);
    setMenuOpen(false);
  };

  return (
    <nav aria-label="Session bar" data-testid="session-bar" className="session-bar">
      <button
        ref={menuButton}
        className="sticker"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <GearGlyph />
        Sheets
      </button>
      {menuOpen ? (
        <div role="menu" aria-label="Sheets" className="floating-card" style={{ top: 64, bottom: 'auto', right: 'auto', left: 12 }}>
          {MENU_SHEETS.map((entry) => (
            <button
              key={entry.sheet}
              role="menuitem"
              className="mini"
              onClick={() => openSheet(entry.sheet)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}

      <button
        className="sticker"
        onClick={() => {
          writeView({ heading: 0 });
          window.dispatchEvent(new Event('gandyboard:reset-view'));
        }}
      >
        <CameraGlyph />
        Reset view
      </button>
      <button className="sticker" onClick={() => openSheet('sessions')}>
        Sessions
      </button>
      <button className="sticker" onClick={() => openSheet('crew-packets')}>
        Crew packets
      </button>

      <select
        className="bar-select"
        aria-label="Workspace"
        data-testid="workspace-switcher"
        value={view.workspace ?? ''}
        onChange={(event) => void actions.openWorkspace(event.target.value)}
      >
        {(me?.memberships ?? []).map((membership) => (
          <option key={membership.workspace_id} value={membership.workspace_id}>
            {membership.workspace_name}
          </option>
        ))}
      </select>

      {role === 'founder' ? (
        <button
          className="mini strong"
          data-testid="new-workspace"
          onClick={() => setNewWorkspace(true)}
        >
          New workspace
        </button>
      ) : null}
      {newWorkspace ? <NewWorkspaceDialog onClose={() => setNewWorkspace(false)} /> : null}

      <button className="mini" data-testid="sign-out" onClick={() => void actions.signOut()}>
        Sign out
      </button>

      {view.mode === 'operate' && session ? (
        <div className="readout">
          <div className="readout-line">
            <span className="fast-clock" data-testid="fast-clock">
              {session.fast_clock_label}
            </span>
            <span data-testid="session-status" style={{ fontWeight: 700 }}>
              {session.status}
            </span>
            <span data-testid="session-version">Session version {session.session_version}</span>
            <div className="counters" role="group" aria-label="Counters">
              <Counter label="Occupied" value={session.counters.occupied_blocks} testId="counter-occupied" />
              <Counter label="Reserved" value={session.counters.reserved_blocks} testId="counter-reserved" />
              <Counter label="Free" value={session.counters.free_blocks} testId="counter-free" />
              <Counter label="Trains" value={session.counters.trains} testId="counter-trains" />
              <Counter label="Conflicts" value={session.counters.open_conflicts} testId="counter-conflicts" />
            </div>
          </div>
          <SessionControls />
        </div>
      ) : null}
    </nav>
  );
}

export function SessionControls(): JSX.Element | null {
  const { session, actions } = useStore();
  const [addTrain, setAddTrain] = useState(false);
  if (!session) return null;
  return (
    <div className="session-controls" role="group" aria-label="Session controls">
      <button className="lipped" onClick={() => void actions.sessionCommand('start')}>
        Start
      </button>
      <button className="lipped" onClick={() => void actions.sessionCommand('hold')}>
        Hold
      </button>
      <button className="lipped" onClick={() => void actions.sessionCommand('resume')}>
        Resume
      </button>
      <button className="lipped" onClick={() => void actions.sessionCommand('end')}>
        End session
      </button>
      <button className="lipped quiet" onClick={() => setAddTrain(true)}>
        Add extra train
      </button>
      {addTrain ? <AddExtraTrainDialog onClose={() => setAddTrain(false)} /> : null}
    </div>
  );
}

function NewWorkspaceDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { actions } = useStore();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('reference');
  return (
    <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="New workspace"
        data-testid="new-workspace-dialog"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions
            .createWorkspace(name, template === 'empty' ? 'empty' : 'reference')
            .then(onClose);
        }}
      >
        <h2>New workspace</h2>
        <label className="field">
          <span>Workspace name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Template</span>
          <select value={template} onChange={(event) => setTemplate(event.target.value)}>
            <option value="reference">Reference layout</option>
            <option value="empty">Empty</option>
          </select>
        </label>
        <button className="lipped" type="submit">
          Create workspace
        </button>
        <button className="mini" type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </div>
  );
}

function AddExtraTrainDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { session, actions } = useStore();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [length, setLength] = useState('900');
  const [speed, setSpeed] = useState('30');
  const [direction, setDirection] = useState('east');
  const [startBlock, setStartBlock] = useState(
    session?.blocks.find((block) => block.state === 'free')?.id ?? '',
  );
  return (
    <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Add extra train"
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          void actions
            .addExtraTrain({
              number,
              name,
              length_mm: Number.parseInt(length, 10),
              speed_mph: Number.parseInt(speed, 10),
              direction,
              start_block_id: startBlock,
            })
            .then(onClose);
        }}
      >
        <h2>Add extra train</h2>
        <label className="field">
          <span>Train number</span>
          <input value={number} onChange={(event) => setNumber(event.target.value)} />
        </label>
        <label className="field">
          <span>Train name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Length</span>
          <input
            type="number"
            step={1}
            min={300}
            max={2400}
            value={length}
            onChange={(event) => setLength(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Speed</span>
          <input
            type="number"
            step={1}
            min={5}
            max={60}
            value={speed}
            onChange={(event) => setSpeed(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Direction</span>
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="east">East</option>
            <option value="west">West</option>
          </select>
        </label>
        <label className="field">
          <span>Start block</span>
          <select value={startBlock} onChange={(event) => setStartBlock(event.target.value)}>
            {(session?.blocks ?? []).map((block) => (
              <option key={block.id} value={block.id}>
                Block {block.number} {block.name}
              </option>
            ))}
          </select>
        </label>
        <button className="lipped" type="submit">
          Add train
        </button>
        <button className="mini" type="button" onClick={onClose}>
          Close
        </button>
      </form>
    </div>
  );
}
