import type { JSX } from 'preact';
import { useId, useState } from 'preact/hooks';
import { raise } from '../lib/announce.js';
import { failureOf, request } from '../lib/api.js';
import { Link, navigate } from '../lib/router.js';
import { userStore } from '../lib/user.js';

const LINKS = [
  { href: '/matches', label: 'Matches' },
  { href: '/teams', label: 'Teams' },
  { href: '/tournaments', label: 'Tournaments' },
];

/** The top bar: the name, the Main navigation (behind Menu on a phone) and the account control. */
export const TopBar = ({ path, landing }: { path: string; landing: boolean }): JSX.Element => {
  const user = userStore.use();
  const [open, setOpen] = useState(false);
  const panel = useId();

  const signOut = async (): Promise<void> => {
    try {
      await request('POST', '/api/auth/signout');
      userStore.set(null);
      setOpen(false);
      navigate('/');
    } catch (error) {
      raise(failureOf(error).message);
    }
  };

  return (
    <header class={`topbar${landing ? ' topbar-landing' : ''}`}>
      <Link href="/" class="wordmark" onClick={() => setOpen(false)}>Overcall</Link>
      <button type="button" class="menu-button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>Menu</button>
      <div id={panel} class="menu-panel" data-open={open ? 'true' : 'false'}>
        <nav aria-label="Main">
          <ul>
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} aria-current={path === link.href || path.startsWith(`${link.href}/`) ? 'page' : undefined} onClick={() => setOpen(false)}>{link.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        {landing ? (
          <ul class="menu-extra">
            <li><Link href="/follow" onClick={() => setOpen(false)}>Follow a match</Link></li>
            <li><Link href="/players" onClick={() => setOpen(false)}>Careers</Link></li>
          </ul>
        ) : null}
        {user ? (
          <button type="button" class="account-button" onClick={signOut}>Sign out</button>
        ) : (
          <Link href="/signin" class="account-button" onClick={() => setOpen(false)}>Sign in</Link>
        )}
      </div>
    </header>
  );
};
