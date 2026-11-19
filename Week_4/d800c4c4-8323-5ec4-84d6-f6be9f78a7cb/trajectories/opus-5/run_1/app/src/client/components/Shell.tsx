import type { ReactNode } from 'react';
import { BILLING_BANNER, STORAGE_BANNER } from '../../shared/copy';
import { signInPathFor } from '../../shared/screens';
import { useApp } from '../lib/app-context';

export type RegionKind = 'desk' | 'account' | 'none';

const REGION_LABELS: Record<Exclude<RegionKind, 'none'>, string> = {
  desk: 'Desk announcements',
  account: 'Account updates',
};

function BoardCounts(): JSX.Element {
  const { board } = useApp();
  const counts = board?.counts ?? { on_wall: 0, out: 0, missing: 0 };
  return (
    <div role="group" aria-label="Board counts" className="board-counts">
      <span>
        On the wall <b className="numerals">{counts.on_wall}</b>
      </span>
      <span>
        Out on loan <b className="numerals">{counts.out}</b>
      </span>
      <span>
        Missing <b className="numerals">{counts.missing}</b>
      </span>
    </div>
  );
}

function TopBar(): JSX.Element {
  const { viewer, navigate } = useApp();
  const role = viewer?.user.role ?? null;
  const links: { label: string; href: string }[] = [{ label: 'Pegboard', href: '/' }];
  if (role === 'member') links.push({ label: 'Account', href: '/account' });
  if (role === 'volunteer' || role === 'coordinator') links.push({ label: 'Desk', href: '/desk' });
  if (role === 'coordinator') links.push({ label: 'Office', href: '/office' });

  return (
    <header className="top-bar">
      <a className="wordmark" href="/" onClick={(event) => {
        event.preventDefault();
        navigate('/');
      }}>
        Pegworth
      </a>
      <BoardCounts />
      <nav className="top-links">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(event) => {
              event.preventDefault();
              navigate(link.href);
            }}
          >
            {link.label}
          </a>
        ))}
        {viewer ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              void fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).then(
                () => {
                  window.location.assign('/');
                },
              );
            }}
          >
            Sign out
          </button>
        ) : (
          <a
            href="/signin"
            onClick={(event) => {
              event.preventDefault();
              navigate('/signin');
            }}
          >
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}

function ServiceBanner(): JSX.Element {
  const { status } = useApp();
  const lines: string[] = [];
  if (status.storage === 'down') lines.push(STORAGE_BANNER);
  if (status.billing === 'down') lines.push(BILLING_BANNER);
  return (
    <div role="status" aria-label="Service status" className="service-status">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export const SIGN_IN_AGAIN_ID = 'sign-in-again';

export function Announcements({ kind }: { readonly kind: RegionKind }): JSX.Element | null {
  const { announcement, sessionEnded, path, navigate } = useApp();
  if (kind === 'none') return null;
  return (
    <>
      <div role="status" aria-label={REGION_LABELS[kind]} className="announcements">
        {announcement}
      </div>
      {sessionEnded ? (
        <a
          id={SIGN_IN_AGAIN_ID}
          className="sign-in-again"
          href={signInPathFor(path)}
          onClick={(event) => {
            event.preventDefault();
            navigate(signInPathFor(path));
          }}
        >
          Sign in again
        </a>
      ) : null}
    </>
  );
}

export function Shell({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <>
      <TopBar />
      <ServiceBanner />
      <main className="screen">{children}</main>
    </>
  );
}
