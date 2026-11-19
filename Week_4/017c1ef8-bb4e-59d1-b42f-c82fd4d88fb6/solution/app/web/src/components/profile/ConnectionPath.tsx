import { Link } from 'react-router-dom';

export type PathItem = { id: string; name: string; handle: string } | { private: true };

/** How the viewer is connected to a 2nd or 3rd degree member: one item per member in between, from the viewer. */
export function ConnectionPath({ path }: { path: PathItem[] }) {
  if (path.length === 0) return null;
  return (
    <section className="pf-path" role="region" aria-label="How you're connected">
      <h2 className="pf-section-title">How you're connected</h2>
      <ol className="plain-list pf-path-list" aria-label="Connection path">
        {path.map((item, index) => (
          <li key={'private' in item ? `private-${index}` : item.id} className="t-heading">
            {'private' in item ? 'Private member' : <Link to={`/in/${item.handle}`}>{item.name}</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export const pathKey = (path: PathItem[]): string => path.map((item) => ('private' in item ? 'private' : item.id)).join(',');
