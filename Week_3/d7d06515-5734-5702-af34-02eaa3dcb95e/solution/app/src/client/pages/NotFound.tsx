import { Link } from '../router.tsx';
import { PublicShell } from './PublicShell.tsx';

export function NotFound() {
  return (
    <PublicShell>
      <h1>Page not found</h1>
      <p className="lead">There is nothing at this address.</p>
      <div className="form-actions"><Link to="/" className="btn btn-outline">Back to Corbel Draft</Link></div>
    </PublicShell>
  );
}
