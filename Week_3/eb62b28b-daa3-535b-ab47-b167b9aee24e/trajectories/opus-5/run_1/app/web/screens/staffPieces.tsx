import { useRef, useState } from 'react';
import { api } from '../app/api';
import { Link, useAnnounce, useFieldErrors, useRouter, useSession } from '../app/shell';
import { Overlay } from '../components/overlays';
import { Glyph, TextField } from '../components/pieces';
import { Role, copy } from '../app/types';

export function ChangePasswordDialog(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const { announce } = useAnnounce();
  const button = useRef<HTMLButtonElement | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    announce(copy.working);
    const result = await api('/api/me/password', {
      method: 'POST',
      json: { currentPassword: current, newPassword: next },
    });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      return;
    }
    errors.clear();
    setCurrent('');
    setNext('');
    announce(copy.passwordChanged);
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="quiet" ref={button} onClick={() => setOpen(true)}>
        Change password
      </button>
      <Overlay
        name="Change password"
        open={open}
        onClose={() => setOpen(false)}
        opener={button}
      >
        <h2>Change password</h2>
        <TextField
          label="Current password"
          name="currentPassword"
          type="password"
          value={current}
          error={errors.fields.currentPassword}
          onChange={setCurrent}
        />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          value={next}
          error={errors.fields.newPassword}
          onChange={setNext}
        />
        <button type="button" disabled={busy} onClick={() => void save()}>
          Save password
        </button>
      </Overlay>
    </>
  );
}

const DESK_LINKS: { to: string; label: string; roles: Role[] }[] = [
  { to: '/staff/members', label: 'Members', roles: ['owner', 'specialist', 'coordinator', 'billingLead'] },
  { to: '/staff/calendar', label: 'Draw calendar', roles: ['owner', 'coordinator'] },
  { to: '/staff/results', label: 'Results to release', roles: ['owner', 'specialist'] },
  { to: '/staff/messages', label: 'Care messages', roles: ['owner', 'specialist', 'coordinator'] },
  { to: '/staff/ranges', label: 'Range table', roles: ['owner'] },
  { to: '/staff/receipts', label: 'Receipts', roles: ['owner', 'billingLead'] },
  { to: '/staff/team', label: 'Team', roles: ['owner'] },
];

export function DeskNav(): JSX.Element {
  const { user, signOut } = useSession();
  const { navigate } = useRouter();
  const role = user?.role ?? 'owner';
  const signOutNow = async (): Promise<void> => {
    await signOut();
    navigate('/signin');
  };
  return (
    <header className="site-header" data-state="solid">
      <div className="bar">
        <Link to="/staff/members" className="brand">
          <Glyph kind="marker" />
          Ocotillo desk
        </Link>
        <div className="header-spacer" />
        <nav aria-label="Desk" className="desk-nav">
          <ul>
            {DESK_LINKS.filter((link) => link.roles.includes(role)).map((link) => (
              <li key={link.to}>
                <Link to={link.to}>{link.label}</Link>
              </li>
            ))}
            <li>
              <ChangePasswordDialog />
            </li>
            <li>
              <button type="button" className="quiet" onClick={() => void signOutNow()}>
                Sign out
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
