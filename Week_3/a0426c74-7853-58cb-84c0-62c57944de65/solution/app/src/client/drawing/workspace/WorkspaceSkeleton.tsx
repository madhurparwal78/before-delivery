import { useMediaLayout } from '../../ui/index.ts';
import type { MediaLayout } from '../../ui/index.ts';
import '../../styles/drawing/workspace.css';

/** Panels shown on the desk, per column, in the order of the loaded screen. */
const COLUMN_PANELS = { left: 2, right: 6 } as const;

function Boxes({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => <div key={index} className="panel" />);
}

function Centre() {
  return (
    <div className="ws-centre">
      <div className="pane" />
      <div className="footer footer--skeleton" />
    </div>
  );
}

/**
 * The static skeleton of the Drawing and Review screens while their fetch is in flight: the panel and pane boxes at
 * their final sizes for the layout in use, no text, no shimmer. `panels` is false on the view link, which has the pane only.
 */
export function WorkspaceSkeleton({ panels = true }: { panels?: boolean }) {
  const layout: MediaLayout = useMediaLayout();
  if (!panels || layout === 'phone') {
    return <div className="ws ws--phone" aria-busy="true"><Centre /></div>;
  }
  if (layout === 'tablet') {
    return (
      <div className="ws ws--tablet" aria-busy="true">
        <Centre />
        <div className="ws-tabs ws-tabs--skeleton" />
        <div className="ws-tabpanel" />
      </div>
    );
  }
  return (
    <div className="ws ws--desk" aria-busy="true">
      <div className="ws-column ws-column--left ws-column--skeleton"><Boxes count={COLUMN_PANELS.left} /></div>
      <Centre />
      <div className="ws-column ws-column--right ws-column--skeleton"><Boxes count={COLUMN_PANELS.right} /></div>
    </div>
  );
}
