import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { BoardMember, ListView, Role } from '../shared/types.ts';
import { ApiFailure, call } from './api.ts';
import { listById, locate, type BoardData } from './board-state.ts';
import { COPY, KEY_MAP, roleName } from './copy.ts';
import { ChevronIcon } from './icons.tsx';
import { Menu, Modal } from './overlay.tsx';
import { afterBoardCreated, moveFromDialog, reread, refreshDrawer, useStore } from './store.ts';

function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactElement }): ReactElement {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function NewBoardDialog({ onClose }: { onClose: () => void }): ReactElement {
  const workspaceId = useStore((s) => s.board?.workspaceId ?? s.workspace?.id ?? '');
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'workspace' | 'private'>('private');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const nameField = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    try {
      const { board } = await call<{ board: { id: string } }>(`/api/workspaces/${workspaceId}/boards`, { method: 'POST', body: { name, visibility } });
      onClose();
      afterBoardCreated(board.id);
      void refreshDrawer();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? (failure.fields['name'] ?? COPY.wentWrong) : COPY.wentWrong);
      setPending(false);
      nameField.current?.focus();
    }
  };

  return (
    <Modal label="New board" onClose={onClose}>
      <h2>New board</h2>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Board name" error={error}>
          <input ref={nameField} type="text" aria-label="Board name" aria-invalid={error !== undefined} data-autofocus value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div role="radiogroup" aria-label="Who can see this board" className="radios">
          <p className="group-title" aria-hidden="true">Who can see this board</p>
          <label>
            <input type="radio" name="visibility" checked={visibility === 'workspace'} onChange={() => setVisibility('workspace')} />
            <span>Everyone in this workspace</span>
          </label>
          <label>
            <input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
            <span>Only board members</span>
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={pending}>{pending ? 'Creating…' : 'Create board'}</button>
          <button type="button" className="outline" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose}>
      <h2>Keyboard shortcuts</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th scope="col">Key</th><th scope="col">When</th><th scope="col">Effect</th></tr>
          </thead>
          <tbody>
            {KEY_MAP.map(([key, when, effect], index) => (
              <tr key={index}><td>{key}</td><td>{when}</td><td>{effect}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions"><button type="button" className="outline" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export function PasswordDialog({ onClose }: { onClose: () => void }): ReactElement {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setPending(true);
    setDone(false);
    try {
      await call('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setErrors({});
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (failure) {
      setErrors(failure instanceof ApiFailure ? failure.fields : { newPassword: COPY.wentWrong });
    }
    setPending(false);
  };

  return (
    <Modal label="Change password" onClose={onClose}>
      <h2>Change password</h2>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label="Current password" error={errors['currentPassword']}>
          <input type="password" role="textbox" aria-label="Current password" aria-invalid={errors['currentPassword'] !== undefined} data-autofocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" error={errors['newPassword']}>
          <input type="password" role="textbox" aria-label="New password" aria-invalid={errors['newPassword'] !== undefined} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <div role="status" className="form-status">{done ? COPY.passwordChanged : ''}</div>
        <div className="actions">
          <button type="submit" className="primary" disabled={pending}>{pending ? 'Changing…' : 'Change password'}</button>
          <button type="button" className="outline" onClick={onClose}>Close</button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveDialog({ cardId, onClose }: { cardId: string; onClose: () => void }): ReactElement | null {
  const board = useStore((s) => s.board);
  const found = board ? locate(board, cardId) : null;
  return board && found ? <MoveForm board={board} cardId={cardId} start={{ list: found.list, index: found.index, title: found.card.title }} onClose={onClose} /> : null;
}

function MoveForm({ board, cardId, start, onClose }: { board: BoardData; cardId: string; start: { list: ListView; index: number; title: string }; onClose: () => void }): ReactElement {
  const [listId, setListId] = useState(start.list.id);
  const [position, setPosition] = useState(start.index + 1);
  const room = (id: string): number => (listById(board, id)?.cards.filter((c) => c.id !== cardId).length ?? 0) + 1;
  const choose = (id: string): void => {
    setListId(id);
    setPosition(room(id));
  };
  const submit = (): void => {
    onClose();
    if (listId !== start.list.id || position !== start.index + 1) moveFromDialog(cardId, listId, position);
  };
  return (
    <Modal label="Move card" onClose={onClose}>
      <h2>Move card</h2>
      <p className="muted">{start.title}</p>
      <label className="field">
        <span>List</span>
        <select aria-label="List" data-autofocus value={listId} onChange={(event) => choose(event.target.value)}>
          {board.lists.map((list) => (
            <option key={list.id} value={list.id}>{list.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Position</span>
        <select aria-label="Position" value={position} onChange={(event) => setPosition(Number(event.target.value))}>
          {Array.from({ length: room(listId) }, (_, i) => (
            <option key={i + 1} value={i + 1}>{i + 1}</option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button type="button" className="primary" onClick={submit}>Move</button>
        <button type="button" className="outline" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

const ROLES: Role[] = ['admin', 'member', 'observer'];

function RolePicker({ member, onChange }: { member: BoardMember; onChange: (role: Role | 'remove') => void }): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const name = member.displayName;
  const pick = (value: Role | 'remove') => (): void => {
    button.current?.focus();
    setAnchor(null);
    onChange(value);
  };
  return (
    <>
      <button ref={button} type="button" className="outline role-button" aria-label={`Role for ${name}`} aria-haspopup="menu" aria-expanded={anchor !== null} onClick={() => setAnchor(anchor ? null : button.current)}>
        {roleName(member.role ?? 'observer')}
        <ChevronIcon />
      </button>
      {anchor && (
        <Menu label={`Role for ${name}`} anchor={anchor} onClose={() => setAnchor(null)}>
          {ROLES.map((role) => (
            <button key={role} type="button" role="menuitemradio" aria-checked={member.role === role} onClick={pick(role)}>{roleName(role)}</button>
          ))}
          <button type="button" role="menuitem" className="danger-item" onClick={pick('remove')}>Remove from board</button>
        </Menu>
      )}
    </>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }): ReactElement | null {
  const board = useStore((s) => s.board);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [candidates, setCandidates] = useState<{ userId: string; displayName: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boardId = board?.id;

  const load = async (): Promise<void> => {
    if (!boardId) return;
    const [m, c] = await Promise.all([
      call<{ members: BoardMember[] }>(`/api/boards/${boardId}/members`),
      call<{ people: { userId: string; displayName: string }[] }>(`/api/boards/${boardId}/candidates`),
    ]);
    setMembers(m.members);
    setCandidates(c.people);
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, [boardId]);

  const run = async (request: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await request();
      await load();
      await reread();
    } catch (failure) {
      setProblem(failure instanceof ApiFailure && failure.body['error'] === 'last_admin' ? COPY.lastAdmin : COPY.wentWrong);
    }
    setBusy(false);
  };

  if (!board || board.role !== 'admin') return null;
  return (
    <Modal label="Board settings" className="wide" onClose={onClose}>
      <h2>Board settings</h2>
      <div role="radiogroup" aria-label="Who can see this board" className="radios">
        <p className="group-title" aria-hidden="true">Who can see this board</p>
        <label>
          <input type="radio" name="board-visibility" disabled={busy} checked={board.visibility === 'workspace'} data-autofocus
            onChange={() => void run(() => call(`/api/boards/${board.id}`, { method: 'PATCH', body: { visibility: 'workspace' } }))} />
          <span>Everyone in this workspace</span>
        </label>
        <label>
          <input type="radio" name="board-visibility" disabled={busy} checked={board.visibility === 'private'}
            onChange={() => void run(() => call(`/api/boards/${board.id}`, { method: 'PATCH', body: { visibility: 'private' } }))} />
          <span>Only board members</span>
        </label>
      </div>
      <div className="table-scroll">
        <table aria-label="Board members">
          <thead>
            <tr><th scope="col">Person</th><th scope="col">Role</th></tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId}>
                <th scope="row">{member.displayName}</th>
                <td>
                  <RolePicker
                    member={member}
                    onChange={(choice) =>
                      void run(() =>
                        choice === 'remove'
                          ? call(`/api/boards/${board.id}/members/${member.userId}`, { method: 'DELETE' })
                          : call(`/api/boards/${board.id}/members/${member.userId}`, { method: 'PATCH', body: { role: choice } }),
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problem && <p role="alert" className="field-error">{problem}</p>}
      <div className="add-person">
        <label className="field">
          <span>Add a person</span>
          <select aria-label="Add a person" value={chosen} onChange={(event) => setChosen(event.target.value)}>
            <option value="">Choose a person</option>
            {candidates.map((person) => (
              <option key={person.userId} value={person.userId}>{person.displayName}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy || chosen === ''}
          onClick={() => void run(async () => {
            await call(`/api/boards/${board.id}/members`, { method: 'POST', body: { userId: chosen, role: 'member' } });
            setChosen('');
          })}
        >
          Add to board
        </button>
      </div>
      <div className="actions"><button type="button" className="outline" onClick={onClose}>Close</button></div>
    </Modal>
  );
}
