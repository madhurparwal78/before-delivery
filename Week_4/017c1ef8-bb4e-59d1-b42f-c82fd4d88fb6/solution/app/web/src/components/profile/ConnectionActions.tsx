import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { announce } from '../../announce';
import { useConfig } from '../../clock';
import type { Profile } from '../../types';
import { Alert, Button, Dialog, Menu } from '../../ui';
import { connectionAnnouncement, connectionButtons, connectionFailure, sendConnectionAction, type ConnectionAction } from '../connection';

interface Props {
  profile: Profile;
  /** Message waits for the Degree Roll to finish. */
  messageReady: boolean;
  /** The profile changed on the server: read it again so the numeral can roll. */
  onChanged: () => Promise<void>;
  /** The member blocked this profile: the page takes over (roll to a dash, then the blocked sentence). */
  onBlocked: () => void;
}

/** Connect, Withdraw, Accept, Ignore, Message, Remove connection, Follow and More actions for another member's profile. */
export function ConnectionActions({ profile, messageReady, onChanged, onBlocked }: Props) {
  const config = useConfig();
  const state = profile.connection_state ?? 'none';
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [removing, setRemoving] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);

  // A button that changed into another (Connect into Withdraw) keeps focus; one that vanished hands focus to the row's first control.
  useEffect(() => {
    if (!hadFocus.current) return;
    hadFocus.current = false;
    if (document.activeElement === document.body || !row.current?.contains(document.activeElement)) {
      row.current?.querySelector<HTMLElement>('[data-primary-action], .button')?.focus();
    }
  }, [state]);

  const act = async (action: ConnectionAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    hadFocus.current = Boolean(row.current?.contains(document.activeElement));
    try {
      const next = await sendConnectionAction(action, profile.id);
      announce('Network announcements', connectionAnnouncement(action, profile.name, next, true));
      await onChanged();
    } catch (error) {
      if (action === 'connect') announce('Network announcements', 'Invitation not sent.');
      setProblem(connectionFailure(error, profile.name, config.time_zone));
      if (error instanceof ApiError && error.status === 409) await onChanged().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const toggleFollow = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      if (profile.following) await api.delete(`/api/follows/${profile.id}`);
      else await api.post('/api/follows', { target_id: profile.id });
      await onChanged();
    } catch {
      setProblem('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const block = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/api/blocks', { member_id: profile.id });
      setBlocking(false);
      announce('Network announcements', `You blocked ${profile.name}.`);
      onBlocked();
    } catch {
      setBlocking(false);
      setProblem('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pf-actions-block">
      <div ref={row} className="pf-actions" role="group" aria-label="Connection">
        {connectionButtons(state, { remove: true, messageReady }).map((button) =>
          button.action ? (
            <Button
              key={button.id}
              data-primary-action={button.id === 'primary' ? '' : undefined}
              disabled={busy}
              className={button.id === 'secondary' ? 'pf-quiet' : undefined}
              onClick={() => (button.action === 'remove' ? setRemoving(true) : void act(button.action as ConnectionAction))}
            >
              {button.label}
            </Button>
          ) : (
            <Link key={button.id} to={`/messaging/with/${profile.handle}`} className="button pf-fade-in">
              {button.label}
            </Link>
          ),
        )}
        <Button className="pf-quiet" aria-pressed={profile.following === true} disabled={busy} onClick={() => void toggleFollow()}>
          {profile.following ? 'Following' : 'Follow'}
        </Button>
        <Menu label="More actions" triggerClassName="button pf-quiet" items={[{ label: `Block ${profile.name}`, onSelect: () => setBlocking(true) }]} />
      </div>
      <Alert>{problem}</Alert>
      <Dialog name="Remove connection?" open={removing} onClose={() => setRemoving(false)} returnFocus={() => row.current?.querySelector<HTMLElement>('.button') ?? null}>
        <h2 className="pf-dialog-title">Remove connection?</h2>
        <p>{`You and ${profile.name} will no longer be connected.`}</p>
        <div className="dialog-actions">
          <Button
            disabled={busy}
            onClick={() => {
              setRemoving(false);
              void act('remove');
            }}
          >
            Remove
          </Button>
          <Button className="pf-quiet" onClick={() => setRemoving(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
      <Dialog name={`Block ${profile.name}?`} open={blocking} onClose={() => setBlocking(false)}>
        <h2 className="pf-dialog-title">{`Block ${profile.name}?`}</h2>
        <p>You will disappear from each other everywhere. Blocking ends any connection.</p>
        <div className="dialog-actions">
          <Button disabled={busy} onClick={() => void block()}>
            Block
          </Button>
          <Button className="pf-quiet" onClick={() => setBlocking(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
