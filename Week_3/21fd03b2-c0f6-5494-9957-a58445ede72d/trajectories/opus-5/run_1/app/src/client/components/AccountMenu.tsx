import { useEffect, useRef, useState } from 'react';
import type { MeResponse } from '../../shared/api.js';
import { api } from '../api.js';
import { navigate } from '../nav.js';
import { initials } from '../session.js';

export interface AccountMenuProps {
  me: MeResponse;
  workspaceId: string | null;
}

export function AccountMenu({ me, workspaceId }: AccountMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement | null>(null);
  const workspace = me.workspaces.find((candidate) => candidate.id === workspaceId);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={holder} style={{ display: 'contents' }}>
      <button
        type="button"
        className="account-pill"
        data-chip
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(me.user.displayName)}
        </span>
        <span className="name">{me.user.displayName}</span>
        <span className="muted">{workspace ? workspace.name : 'No workspace'}</span>
        <span aria-hidden="true">v</span>
      </button>
      {open ? (
        <div className="menu" role="menu" aria-label="Account">
          {me.workspaces.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="menuitemradio"
              aria-checked={candidate.id === workspaceId}
              onClick={() => {
                setOpen(false);
                navigate(`/w/${candidate.id}`);
              }}
            >
              {candidate.name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/workspaces/new');
            }}
          >
            New workspace
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void api('/api/auth/sign-out', { method: 'POST', allowUnauthenticated: true }).then(
                () => {
                  window.location.assign('/');
                },
              );
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
