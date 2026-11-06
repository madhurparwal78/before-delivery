import { type ReactNode, useEffect, useRef, useState } from 'react';
import { COPY, FIELD_COPY } from '../../shared/copy.js';
import { PLANS, PLAN_IDS, type PlanId } from '../../shared/domain.js';
import type { ServerObject, UserObject } from '../../shared/types.js';
import { ApiFailure, freshKey, get, post } from '../api.js';
import { Link, useRouter } from '../router.js';
import { useSession } from '../shell.js';
import { FieldError, Status } from '../ui.js';

/* Sign-in. */

export function SignInPage(): ReactNode {
  const { go, search } = useRouter();
  const { refresh } = useSession();
  const [handle, setHandle] = useState('');
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const next = new URLSearchParams(search).get('next');

  return (
    <div className="centred-card card">
      <h1>Sign in</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setFields({});
          setStatus('');
          void post<{ user: UserObject }>('/api/session', { handle, passcode })
            .then(async () => {
              await refresh();
              go(next !== null && next.startsWith('/') ? next : '/servers', { replace: true });
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) {
                setFields(error.fields);
                setStatus(
                  error.code === 'bad_credentials'
                    ? COPY.signInWrong
                    : Object.values(error.fields).join(' ') || error.message,
                );
              }
            })
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <label htmlFor="handle">Handle</label>
          <input
            id="handle"
            type="text"
            value={handle}
            aria-label="Handle"
            aria-describedby={fields.handle === undefined ? undefined : 'handle-error'}
            onChange={(event) => setHandle(event.target.value)}
          />
          <FieldError id="handle-error" message={fields.handle ?? ''} />
        </div>
        <div>
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            type="password"
            value={passcode}
            aria-label="Passcode"
            aria-describedby={fields.passcode === undefined ? undefined : 'passcode-error'}
            onChange={(event) => setPasscode(event.target.value)}
          />
          <FieldError id="passcode-error" message={fields.passcode ?? ''} />
        </div>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? COPY.signInPending : 'Sign in'}
        </button>
      </form>
      <Status name="Sign-in status" text={status} />
    </div>
  );
}

/* Join a server from an invite. */

interface InviteView {
  server_name: string;
  inviter: string;
  email: string;
}

export function JoinPage({ token }: { token: string }): ReactNode {
  const { go } = useRouter();
  const { refresh } = useSession();
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<InviteView>(`/api/invites/${token}`)
      .then(setInvite)
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) setStatus(joinCopy(error));
      });
  }, [token]);

  return (
    <div className="centred-card card">
      <h1>{`Join ${invite?.server_name ?? ''}`}</h1>
      {invite !== null ? <p>{`${invite.inviter} invited ${invite.email}.`}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setFields({});
          setStatus('');
          void post<{ user: UserObject; server: ServerObject }>(`/api/invites/${token}/accept`, {
            handle,
            display_name: displayName,
            passcode,
          })
            .then(async (answer) => {
              await refresh();
              go(`/s/${answer.server.slug}/roster`, { replace: true });
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) {
                setFields(error.fields);
                setStatus(joinCopy(error));
              }
            })
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <label htmlFor="join-handle">Handle</label>
          <input
            id="join-handle"
            type="text"
            aria-label="Handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <FieldError id="join-handle-error" message={fields.handle ?? ''} />
        </div>
        <div>
          <label htmlFor="join-name">Display name</label>
          <input
            id="join-name"
            type="text"
            aria-label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <FieldError id="join-name-error" message={fields.display_name ?? ''} />
        </div>
        <div>
          <label htmlFor="join-passcode">Passcode</label>
          <input
            id="join-passcode"
            type="password"
            aria-label="Passcode"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />
          <FieldError id="join-passcode-error" message={fields.passcode ?? ''} />
        </div>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? COPY.joinPending : 'Join server'}
        </button>
      </form>
      <Status name="Join status" text={status} />
    </div>
  );
}

const joinCopy = (error: ApiFailure): string => {
  switch (error.code) {
    case 'invite_used':
      return COPY.joinUsed;
    case 'invite_expired':
      return COPY.joinExpired;
    case 'invite_superseded':
      return COPY.joinSuperseded;
    case 'email_in_use':
      return COPY.joinEmailInUse;
    default:
      return Object.values(error.fields).join(' ') || error.message;
  }
};

/* Your servers. */

export function ServersPage(): ReactNode {
  const { servers } = useSession();
  return (
    <div className="page">
      <h1>Your servers</h1>
      <ul className="server-list" aria-label="Servers">
        {servers.map((server) => (
          <li key={server.id} className="card">
            <Link to={`/s/${server.slug}/${server.role === 'owner' ? 'billing' : 'roster'}`}>
              {server.name}
            </Link>
            <p>
              {server.role === 'owner' ? 'Owner' : 'Member'}{' '}
              <span className="status-word">{server.status_word}</span>
            </p>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/servers/new">Rent a server</Link>
      </p>
    </div>
  );
}

/* Rent a server: a three-step checkout. */

const STEP_NAMES = ['Name', 'Plan', 'Review'] as const;

export function NewServerPage(): ReactNode {
  const { go } = useRouter();
  const { refresh } = useSession();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<PlanId | ''>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = useRef(freshKey());

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const chosen = plan === '' ? null : PLANS[plan];

  const next = (): void => {
    if (step === 1) {
      const trimmed = name.trim();
      if (trimmed === '') {
        setFields({ server_name: FIELD_COPY.serverNameRequired });
        setStatus(FIELD_COPY.serverNameRequired);
        return;
      }
      if ([...trimmed].length > 40) {
        setFields({ server_name: FIELD_COPY.serverNameTooLong });
        setStatus(FIELD_COPY.serverNameTooLong);
        return;
      }
      if (!/^[\p{L}\p{N} -]{3,40}$/u.test(trimmed)) {
        setFields({ server_name: FIELD_COPY.serverNameFormat });
        setStatus(FIELD_COPY.serverNameFormat);
        return;
      }
    }
    if (step === 2 && plan === '') {
      setFields({ plan: FIELD_COPY.planRequired });
      setStatus(FIELD_COPY.planRequired);
      return;
    }
    setFields({});
    setStatus('');
    setStep(step + 1);
  };

  return (
    <div className="page split">
      <div className="card">
        <h1 tabIndex={-1} ref={heading}>
          {`Step ${step} of 3: ${STEP_NAMES[step - 1]}`}
        </h1>
        {step === 1 ? (
          <div>
            <label htmlFor="server-name">Server name</label>
            <input
              id="server-name"
              type="text"
              aria-label="Server name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError id="server-name-error" message={fields.server_name ?? ''} />
          </div>
        ) : null}
        {step === 2 ? (
          <fieldset role="radiogroup" aria-label="Plan">
            <legend>Plan</legend>
            {PLAN_IDS.map((id) => (
              <label className="radio-row" key={id}>
                <input
                  type="radio"
                  name="plan"
                  checked={plan === id}
                  aria-label={`${PLANS[id].name}, ${PLANS[id].price} USD a month`}
                  onChange={() => setPlan(id)}
                />
                <span>{`${PLANS[id].name}, ${PLANS[id].price} USD a month`}</span>
              </label>
            ))}
            <FieldError id="plan-error" message={fields.plan ?? ''} />
          </fieldset>
        ) : null}
        {step === 3 ? (
          <ul aria-label="Review">
            <li>{`Server name: ${name.trim()}`}</li>
            <li>{`Plan: ${chosen?.name ?? ''}`}</li>
            <li className="amount">{`${chosen?.price ?? ''} USD a month`}</li>
          </ul>
        ) : null}
        <div className="steps">
          {step > 1 ? (
            <button type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button type="button" className="primary" onClick={next}>
              Next
            </button>
          ) : null}
          {step === 3 ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                if (busy) return;
                setBusy(true);
                setStatus('');
                void post<{ server: ServerObject; billing_url: string }>(
                  '/api/checkout',
                  { server_name: name.trim(), plan },
                  { idempotencyKey: key.current },
                )
                  .then(async (answer) => {
                    await refresh();
                    go(answer.billing_url, { replace: true });
                  })
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) {
                      setFields(error.fields);
                      setStatus(
                        error.code === 'billing_unavailable'
                          ? COPY.checkoutOutage
                          : Object.values(error.fields).join(' ') || error.message,
                      );
                      if (error.fields.server_name !== undefined) setStep(1);
                    }
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? COPY.checkoutPending : 'Rent server'}
            </button>
          ) : null}
        </div>
        <Status name="Checkout status" text={status} />
      </div>
      {chosen !== null ? (
        <aside className="card">
          <h2 className="card-title">{chosen.name}</h2>
          <p className="amount">{`${chosen.price} USD a month`}</p>
          <p>{`Characters per server: ${chosen.characters}`}</p>
          <p>{`Members per server: ${chosen.members}`}</p>
        </aside>
      ) : null}
    </div>
  );
}

/* Help, with every keyboard shortcut. */

export function HelpPage(): ReactNode {
  return (
    <div className="page">
      <h1>Help</h1>
      <h2>Keyboard shortcuts</h2>
      <table>
        <caption className="visually-hidden">Keyboard shortcuts</caption>
        <thead>
          <tr>
            <th scope="col">Where focus is</th>
            <th scope="col">Key</th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((row) => (
            <tr key={`${row.where}-${row.key}`}>
              <td>{row.where}</td>
              <td className="mono">{row.key}</td>
              <td>{row.effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SHORTCUTS: readonly { where: string; key: string; effect: string }[] = [
  { where: 'Any grid', key: 'Arrow keys', effect: 'Move one cell, stopping at the edge' },
  { where: 'Any grid', key: 'Home, End', effect: 'First or last cell of the current row' },
  {
    where: 'Any grid',
    key: 'Ctrl+Home, Ctrl+End',
    effect: 'First cell of the first row, or last cell of the last row',
  },
  {
    where: 'Any grid',
    key: 'PageUp, PageDown',
    effect: 'Up or down 8 rows, stopping at the first or last row',
  },
  {
    where: 'World map or Tile inspector',
    key: 'Shift+Arrow',
    effect: 'Walk the active character one tile',
  },
  {
    where: 'World map or Tile inspector',
    key: 'B',
    effect: 'Place a block of the selected material on the cursor tile',
  },
  { where: 'World map or Tile inspector', key: 'X', effect: 'Break the block on the cursor tile' },
  {
    where: 'World map',
    key: 'Enter',
    effect:
      'In parking mode, park on the cursor tile. On a tile holding one of your vehicles, open its vehicle menu. Otherwise, move focus to the Tile inspector\u2019s first button',
  },
  { where: 'World view', key: 'Escape', effect: 'In parking mode, cancel parking mode' },
  { where: 'World view', key: 'F', effect: 'Enter or leave full screen' },
  { where: 'World view', key: 'I', effect: 'Open Inventory' },
  { where: 'World view in full screen', key: 'R', effect: 'Show or hide the rail overlay' },
  { where: 'World view in full screen', key: 'C', effect: 'Show or hide chat' },
  {
    where: 'Vehicle menu',
    key: 'Up, Down, Enter, Escape',
    effect: 'Move, choose, or close the menu back to the tile',
  },
  { where: 'Table panel', key: 'T', effect: 'Announce the turn clock copy in Game announcements' },
  { where: 'Table panel', key: 'F', effect: 'Enter or leave full screen for the panel' },
  {
    where: 'Table panel',
    key: 'Escape',
    effect: 'Close the innermost open dialog, or the panel itself',
  },
  {
    where: 'Chess board',
    key: 'Enter or Space',
    effect: 'Select your piece, or send a move to the focused square',
  },
  { where: 'Chess board', key: 'Escape', effect: 'Clear the selection' },
  {
    where: 'Four in a row board',
    key: 'Enter or Space',
    effect: 'Drop in the focused cell\u2019s column',
  },
  { where: 'Your hand', key: 'Up, Down, Left, Right, Home, End', effect: 'Move the active card' },
  { where: 'Your hand', key: 'Enter', effect: 'Play the active card' },
  {
    where: 'Inventory grid',
    key: 'Space',
    effect: 'Pick up the item in the focused cell, or drop the carried item into it',
  },
  {
    where: 'Inventory grid',
    key: 'Escape',
    effect: 'Cancel a carried item and leave it where it was. Otherwise, close Inventory',
  },
  {
    where: 'Replay board',
    key: 'Left, Right, Home, End',
    effect: 'Previous move, next move, first move, last move',
  },
  {
    where: 'Character combobox',
    key: 'typing, Down, Up, Enter, Escape',
    effect: 'Filter, move the active option, pick it, clear the text',
  },
  { where: 'Appearance radio group', key: 'Arrow keys', effect: 'Choose an appearance' },
  { where: 'Loadout listbox', key: 'Up, Down, Space', effect: 'Move, and toggle the focused item' },
];

/* Not found. */

export function NotFoundPage(): ReactNode {
  return (
    <div className="page">
      <h1>{COPY.notFound}</h1>
      <p>
        <Link to="/servers">Your servers</Link>
      </p>
    </div>
  );
}
