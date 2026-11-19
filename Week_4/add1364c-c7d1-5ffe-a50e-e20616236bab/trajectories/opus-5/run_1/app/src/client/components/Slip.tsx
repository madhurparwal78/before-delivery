import { useEffect, useRef, useState } from 'react';
import { ApiFailure, type Credential, type Person, type Vault } from '../api.js';
import { call } from '../guard.js';
import { HEALTH_LABEL, displayName, officeStamp } from '../format.js';
import { refuse, say } from '../live.js';
import { Dialog, FieldRow } from './Dialog.js';

const HIDE_AFTER_MS = 30_000;

export type RevealAnswer = { credential_id: string; secret: string; rule_id: string | null; audit_id: string };

export function mayTurn(me: Person, _vault: Vault): boolean {
  return me.role === 'office_manager' || me.role === 'staff_accountant';
}

/**
 * One login slip. Its secret hides 30 seconds after that slip's own latest
 * reveal, and the timer never touches another slip, a dialog or typed text.
 */
export function Slip(props: {
  credential: Credential;
  vault: Vault;
  me: Person;
  narrow: boolean;
  turnOpen: boolean;
  onTurnOpen: (open: boolean) => void;
  onTurned: () => void;
  revealRef?: (node: HTMLButtonElement | null) => void;
}): React.ReactElement {
  const { credential } = props;
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, setPending] = useState<'reveal' | 'copy' | null>(null);
  const timer = useRef<number | null>(null);
  const revealButton = useRef<HTMLButtonElement | null>(null);
  const hideButton = useRef<HTMLButtonElement | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clearTimer, []);

  const armTimer = (): void => {
    clearTimer();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setSecret(null);
      say(`${credential.label} hidden.`);
      if (document.activeElement === hideButton.current) revealButton.current?.focus();
    }, HIDE_AFTER_MS);
  };

  const reveal = async (): Promise<void> => {
    if (pending !== null) return;
    setPending('reveal');
    try {
      const answer = await call<RevealAnswer>(`/api/credentials/${credential.id}/reveal`, {
        method: 'POST',
        body: {},
      });
      setSecret(answer.secret);
      armTimer();
      say(`${credential.label} revealed.`);
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    } finally {
      setPending(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (pending !== null) return;
    setPending('copy');
    try {
      const answer = await call<RevealAnswer>(`/api/credentials/${credential.id}/copy`, {
        method: 'POST',
        body: {},
      });
      await navigator.clipboard?.writeText(answer.secret).catch(() => undefined);
      say(`${credential.label} copied.`);
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    } finally {
      setPending(null);
    }
  };

  const hide = (): void => {
    clearTimer();
    setSecret(null);
  };

  const vendorName = credential.vendor === null ? '' : displayName(credential.vendor);
  const nextTurn =
    credential.next_turn === null
      ? 'No turn due'
      : officeStamp(credential.next_turn.office_date, credential.next_turn.office_time, credential.next_turn.offset);

  const name = (
    <span>
      <strong>{credential.label}</strong>
      {vendorName === '' ? null : <span> — {vendorName}</span>}
      <br />
      <span className="figures">{credential.username}</span>
    </span>
  );
  const heldBy = (
    <span>
      {credential.held_by.length === 0
        ? 'Held by nobody'
        : credential.held_by.map((holder) => `${holder.name}${holder.left ? ' (left)' : ''}`).join(', ')}
    </span>
  );
  const turn = <span className="figures">{nextTurn}</span>;
  const health = <span>{HEALTH_LABEL[credential.health]}</span>;

  return (
    <li className="slip">
      {props.narrow ? (
        <>
          <div className="slip-line-two">
            {name}
            {health}
          </div>
          <div className="slip-line-two">
            {heldBy}
            {turn}
          </div>
        </>
      ) : (
        <div className="slip-grid">
          {name}
          {heldBy}
          {turn}
          {health}
        </div>
      )}

      {secret === null ? null : (
        <p className="slip-secret">
          <span className="secret">{secret}</span>
        </p>
      )}

      <div className="slip-actions">
        {secret === null ? (
          <button
            type="button"
            ref={(node) => {
              revealButton.current = node;
              props.revealRef?.(node);
            }}
            onClick={() => void reveal()}
          >
            {pending === 'reveal' ? 'Revealing' : `Reveal ${credential.label}`}
          </button>
        ) : (
          <button type="button" ref={hideButton} onClick={hide}>
            {`Hide ${credential.label}`}
          </button>
        )}
        <button type="button" onClick={() => void copy()}>
          {`Copy ${credential.label}`}
        </button>
        {mayTurn(props.me, props.vault) ? (
          <button type="button" onClick={() => props.onTurnOpen(true)}>
            {`Turn ${credential.label}`}
          </button>
        ) : null}
        {props.me.role === 'office_manager' && credential.vendor !== null ? (
          <RenameVendor vendor={credential.vendor} onDone={props.onTurned} />
        ) : null}
      </div>

      {props.turnOpen ? (
        <TurnDialog
          credential={credential}
          onClose={() => props.onTurnOpen(false)}
          onSaved={() => {
            props.onTurnOpen(false);
            props.onTurned();
          }}
        />
      ) : null}
    </li>
  );
}

function TurnDialog(props: {
  credential: Credential;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call(`/api/credentials/${props.credential.id}/secret`, { method: 'PUT', body: { secret: value } });
      say(`${props.credential.label} turned.`);
      props.onSaved();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(error.fields.secret ?? error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog title={`Turn ${props.credential.label}`} onClose={props.onClose}>
      <form onSubmit={save} noValidate>
        <FieldRow label="New password" id="turn-secret" message={message}>
          <input
            id="turn-secret"
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </FieldRow>
        <div className="dialog-actions">
          <button type="submit" className="solid">
            {pending ? 'Saving' : 'Save new password'}
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameVendor(props: {
  vendor: NonNullable<Credential['vendor']>;
  onDone: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await call(`/api/vendors/${props.vendor.id}`, { method: 'PATCH', body: { name: value } });
      say(`Renamed to ${value}.`);
      setOpen(false);
      props.onDone();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(error.fields.name);
        refuse(error.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {`Rename vendor ${props.vendor.name}`}
      </button>
      {open ? (
        <Dialog title="Rename vendor" onClose={() => setOpen(false)}>
          <form onSubmit={save} noValidate>
            <FieldRow label="New name" id="vendor-name" message={message}>
              <input
                id="vendor-name"
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </FieldRow>
            <div className="dialog-actions">
              <button type="submit" className="solid">
                {pending ? 'Saving' : 'Save name'}
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
