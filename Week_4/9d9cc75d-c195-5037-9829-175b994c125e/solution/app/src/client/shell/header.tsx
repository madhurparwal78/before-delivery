import { Button } from '../ui/button.tsx';
import { Link } from '../ui/link.tsx';
import { signInPath, useLocation } from '../router.ts';
import { useUnread } from './events.ts';
import { useSession } from './session.tsx';

export function Header() {
  const { me, signOut } = useSession();
  const location = useLocation();
  const unread = useUnread();
  const current = (path: string) => (location.path === path ? ('page' as const) : undefined);
  return (
    <header className="site-header">
      <Link to="/" className="brand" aria-current={current('/')}>
        Lozenge
      </Link>
      <Link to="/workbooks" className="nav-link nav-workbooks" aria-current={current('/workbooks')}>
        Workbooks
      </Link>
      {me ? (
        <>
          <Link to="/inbox" className="nav-link nav-inbox" aria-current={current('/inbox')} aria-label={`Inbox, ${unread} unread`}>
            Inbox
            <span className={unread > 0 ? 'count count-live' : 'count'} data-count={unread} aria-hidden="true" />
          </Link>
          <span className="nav-out">
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </span>
        </>
      ) : (
        <Link to={location.path === '/signin' ? '/signin' : signInPath(location.href)} className="nav-link nav-out">
          Sign in
        </Link>
      )}
    </header>
  );
}
