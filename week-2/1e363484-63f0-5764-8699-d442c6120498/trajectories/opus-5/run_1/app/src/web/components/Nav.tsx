import { LandPlot } from 'lucide-react';
import type { Person } from '../api';
import { Link } from '../router';

export interface NavProps {
  readonly person: Person;
  readonly onSignOut: () => void;
}

export function Nav({ person, onSignOut }: NavProps): React.ReactElement {
  return (
    <nav className="main" aria-label="Main">
      <span className="wordmark">
        <LandPlot size={20} aria-hidden="true" /> Fluxseal
      </span>
      <Link to="/projects">Projects</Link>
      {person.org_role === 'admin' ? <Link to="/admin/access">Access</Link> : null}
      <span style={{ flex: '1 1 auto' }} />
      <span style={{ fontSize: '0.875rem' }}>{person.name}</span>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </nav>
  );
}
