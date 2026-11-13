import { EmptySketch } from '../../art/EmptySketch.tsx';
import '../../styles/panels.css';

/** A thin-line sketch above one line of copy; `heading` makes that line the panel's heading. */
export function EmptyState({ children, heading = false }: { children: string; heading?: boolean }) {
  return (
    <div className="panel-empty">
      <EmptySketch />
      {heading ? <h3 className="panel-heading">{children}</h3> : <p>{children}</p>}
    </div>
  );
}
