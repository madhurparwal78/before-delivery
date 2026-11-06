import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HOUSE_NAME } from '../../shared/roles';
import type { Role, ServiceStatus } from '../../shared/types';
import {
  DISTANCE_UNITS,
  FILM_UNITS,
  FILM_UNIT_LABEL,
  PRESSURE_UNITS,
  type DistanceUnit,
  type FilmUnit,
  type PressureUnit,
  type UnitSettings,
} from '../../shared/units';
import { SERVICE_NOTICE } from '../copy';
import { api } from '../lib/api';
import { useIsNarrow, useReread, useStatus } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import { useSession } from '../lib/session';
import { Dialog } from './Dialog';
import { AlertMark, StatusRegion } from './Status';

interface NavItem {
  readonly label: string;
  readonly to: string;
}

const NAV: Record<Role, NavItem[]> = {
  concierge: [
    { label: 'Bays', to: '/bays' },
    { label: 'Releases', to: '/releases' },
  ],
  care_technician: [{ label: 'Care round', to: '/round' }],
  workshop_lead: [{ label: 'Jobs', to: '/jobs' }],
  house_manager: [
    { label: 'Board', to: '/board' },
    { label: 'Bays', to: '/bays' },
    { label: 'Care round', to: '/round' },
    { label: 'Jobs', to: '/jobs' },
    { label: 'Releases', to: '/releases' },
    { label: 'Staff access', to: '/staff' },
  ],
  owner: [{ label: 'My cars', to: '/portal' }],
};

export function Shell({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();
  const narrow = useIsNarrow();
  const [menuOpen, setMenuOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!narrow) setMenuOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (menuOpen) navRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [menuOpen]);

  if (user === null) return <>{children}</>;
  const items = NAV[user.role];
  const showNav = !narrow || menuOpen;

  return (
    <>
      <header className="top-bar">
        <div className="top-bar-identity">
          <span className="house-name">{HOUSE_NAME}</span>
          <span className="product-name">Lacquer</span>
        </div>
        {narrow ? (
          <button
            type="button"
            ref={menuButton}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
        ) : null}
        {showNav ? (
          <nav
            aria-label="Main"
            ref={navRef}
            className={narrow ? 'main-nav main-nav-open' : 'main-nav'}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && menuOpen) {
                setMenuOpen(false);
                menuButton.current?.focus();
              }
            }}
          >
            {items.map((item) => (
              <Link key={item.to} to={item.to} onNavigate={() => setMenuOpen(false)}>
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="top-bar-actions">
          <button type="button" onClick={() => setUnitsOpen(true)}>
            Units
          </button>
          <button
            type="button"
            onClick={() => {
              void api('/api/session', { method: 'DELETE' }).then(() => {
                navigate('/sign-in', { replace: true });
                window.location.reload();
              });
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {user.role === 'owner' ? null : <ServiceNotice />}
      {unitsOpen ? <UnitsDialog onDone={() => setUnitsOpen(false)} /> : null}
      <main>{children}</main>
    </>
  );
}

function ServiceNotice(): ReactNode {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const load = async (): Promise<void> => {
    const outcome = await api<ServiceStatus>('/api/status');
    if (outcome.kind === 'ok') setStatus(outcome.body);
  };
  useEffect(() => {
    void load();
  }, []);
  useReread(load, 5000);

  const notices: string[] = [];
  if (status !== null) {
    if (status.storage === 'down') notices.push(SERVICE_NOTICE.storage);
    if (status.billing === 'down') notices.push(SERVICE_NOTICE.billing);
    if (status.mail === 'down') notices.push(SERVICE_NOTICE.mail);
  }
  return (
    <div
      role="status"
      aria-label="Service notice"
      aria-live="polite"
      className={notices.length === 0 ? 'service-notice empty' : 'service-notice'}
    >
      {notices.map((notice) => (
        <p key={notice}>
          <AlertMark />
          {notice}
        </p>
      ))}
    </div>
  );
}

function UnitsDialog({ onDone }: { onDone: () => void }): ReactNode {
  const { units, setUnits } = useSession();
  const status = useStatus();
  const [draft, setDraft] = useState<UnitSettings>(units);

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    status.pending('Saving units...');
    const outcome = await api<{ units: UnitSettings }>('/api/me/units', {
      method: 'PUT',
      body: draft,
    });
    if (outcome.kind === 'ok') {
      setUnits(outcome.body.units);
      status.success('Units updated.');
      onDone();
    }
  };

  return (
    <>
      <Dialog name="Units" onClose={onDone}>
        <form onSubmit={save} className="stack">
          <fieldset role="radiogroup" aria-label="Film build">
            <legend>Film build</legend>
            {FILM_UNITS.map((unit: FilmUnit) => (
              <label key={unit}>
                <input
                  type="radio"
                  name="film"
                  checked={draft.film === unit}
                  onChange={() => setDraft({ ...draft, film: unit })}
                />
                {FILM_UNIT_LABEL[unit]}
              </label>
            ))}
          </fieldset>
          <fieldset role="radiogroup" aria-label="Tyre pressure">
            <legend>Tyre pressure</legend>
            {PRESSURE_UNITS.map((unit: PressureUnit) => (
              <label key={unit}>
                <input
                  type="radio"
                  name="pressure"
                  checked={draft.pressure === unit}
                  onChange={() => setDraft({ ...draft, pressure: unit })}
                />
                {unit}
              </label>
            ))}
          </fieldset>
          <fieldset role="radiogroup" aria-label="Distance">
            <legend>Distance</legend>
            {DISTANCE_UNITS.map((unit: DistanceUnit) => (
              <label key={unit}>
                <input
                  type="radio"
                  name="distance"
                  checked={draft.distance === unit}
                  onChange={() => setDraft({ ...draft, distance: unit })}
                />
                {unit}
              </label>
            ))}
          </fieldset>
          <button type="submit" className="primary">
            Save units
          </button>
        </form>
      </Dialog>
      <StatusRegion name="Settings updates" status={status} />
    </>
  );
}
