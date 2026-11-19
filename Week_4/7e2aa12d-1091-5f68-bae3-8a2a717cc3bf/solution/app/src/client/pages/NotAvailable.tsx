import { NOT_AVAILABLE_HEADING } from '../../shared/messages.js';
import { Link } from '../lib/router.js';

/** Any layout, view or join page the visitor cannot open: a heading and one link out. */
export function NotAvailable({ signedIn }: { signedIn: boolean }) {
  return (
    <main className="card centered">
      <h1>{NOT_AVAILABLE_HEADING}</h1>
      <p>
        <Link to={signedIn ? '/' : '/signin'}>{signedIn ? 'Your layouts' : 'Sign in'}</Link>
      </p>
    </main>
  );
}
