import { useRegion } from '../regions.js';

/** The four named live regions, present on every screen that writes to them. */
export function LiveRegions(): JSX.Element {
  const save = useRegion('save');
  const collaboration = useRegion('collaboration');
  const notices = useRegion('notices');
  const upload = useRegion('upload');
  return (
    <div className="live-regions">
      <span role="status" aria-live="polite" aria-label="Save status">
        {save}
      </span>
      <span role="status" aria-live="polite" aria-label="Collaboration">
        {collaboration}
      </span>
      <span role="status" aria-live="polite" aria-label="Notices">
        {notices}
      </span>
      <span role="status" aria-live="polite" aria-label="Upload status">
        {upload}
      </span>
    </div>
  );
}
