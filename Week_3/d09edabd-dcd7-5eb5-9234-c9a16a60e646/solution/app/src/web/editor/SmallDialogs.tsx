import { useState } from 'react';
import { X } from '../ui/icons';
import { ApiFailure } from '../api';
import { parseMetres } from '../../shared/units';
import { Dialog } from '../ui/Dialog';
import { METRES_ONLY } from './copy';
import { createRoom, openRoom } from './rooms';
import { takeOver } from './placements';
import { closeDialog, editor, useEditor } from './state';

const SHORTCUTS: [string, string][] = [
  ['G / R / S', 'Move / Rotate / Scale mode'],
  [']  /  [', 'Select the next / previous placement'],
  ['Arrow keys', 'Nudge the selection (Shift: 100 mm); turn the camera with nothing selected'],
  ['D', 'Drop the selected placement to the floor'],
  ['Delete', 'Delete the selected placement'],
  ['N / Shift+N', 'Next / previous trigger node'],
  ['T', 'Open the Trigger graph (inside it, close it)'],
  ['L', 'Open the Prop library'],
  ['P', 'Start or stop a playtest'],
  ['Ctrl+Z', 'Undo your own latest change'],
  ['Ctrl+K', 'Open the Command palette'],
  ['?', 'Open Keyboard shortcuts'],
  ['Escape', 'Close the topmost dialog, or clear the selection'],
];

function CloseButton({ name }: { name: Parameters<typeof closeDialog>[0] }) {
  return (
    <button type="button" className="icon-btn" aria-label="Close" onClick={() => closeDialog(name)}>
      <X size={16} aria-hidden="true" />
    </button>
  );
}

export function Shortcuts() {
  const open = useEditor((s) => s.dialogs.shortcuts === true);
  return (
    <Dialog name="Keyboard shortcuts" open={open} onClose={() => closeDialog('shortcuts')} className="centered">
      <div className="dialog-head">
        <h2>Keyboard shortcuts</h2>
        <CloseButton name="shortcuts" />
      </div>
      <div className="dialog-body">
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt className="mono">{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}

export function NewRoom() {
  const open = useEditor((s) => s.dialogs.newRoom === true);
  const [fields, setFields] = useState({ name: '', width: '', depth: '', height: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (): Promise<void> => {
    const [widthMm, depthMm, heightMm] = [fields.width, fields.depth, fields.height].map(parseMetres);
    const next: Record<string, string> = {};
    if (!fields.name.trim()) next.name = 'Give the room a name.';
    if (widthMm === null) next.widthMm = METRES_ONLY;
    if (depthMm === null) next.depthMm = METRES_ONLY;
    if (heightMm === null) next.heightMm = METRES_ONLY;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const room = await createRoom({ name: fields.name.trim(), widthMm: widthMm!, depthMm: depthMm!, heightMm: heightMm! });
      closeDialog('newRoom');
      setFields({ name: '', width: '', depth: '', height: '' });
      await openRoom(room.id, false);
    } catch (error) {
      if (error instanceof ApiFailure) setErrors(error.status === 409 ? { name: 'That name is already used in this venue.' } : error.fieldErrors);
      else throw error;
    }
  };

  const field = (key: keyof typeof fields, label: string, error?: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="text" inputMode={key === 'name' ? 'text' : 'decimal'} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );

  return (
    <Dialog name="New room" open={open} onClose={() => closeDialog('newRoom')} className="centered small">
      <div className="dialog-head">
        <h2>New room</h2>
        <CloseButton name="newRoom" />
      </div>
      <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {field('name', 'Room name', errors.name)}
        {field('width', 'Width (m)', errors.widthMm)}
        {field('depth', 'Depth (m)', errors.depthMm)}
        {field('height', 'Height (m)', errors.heightMm)}
        <button type="submit" className="btn primary">
          Create room
        </button>
      </form>
    </Dialog>
  );
}

export function PropLocked() {
  const open = useEditor((s) => s.dialogs.locked === true);
  const prompt = useEditor((s) => s.lockedPrompt);
  const close = (): void => {
    closeDialog('locked');
    editor.set({ lockedPrompt: null });
  };
  return (
    <Dialog name="Prop locked" open={open} onClose={close} className="centered small" returnFocus={() => document.querySelector<HTMLElement>('[data-rotation]')}>
      <div className="dialog-head">
        <h2>Prop locked</h2>
      </div>
      <div className="dialog-body">
        <p>{prompt ? `${prompt.holder.displayName} is editing ${prompt.label}.` : ''}</p>
        <div className="row">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              close();
              if (prompt) await takeOver(prompt);
            }}
          >
            Take over
          </button>
        </div>
      </div>
    </Dialog>
  );
}
