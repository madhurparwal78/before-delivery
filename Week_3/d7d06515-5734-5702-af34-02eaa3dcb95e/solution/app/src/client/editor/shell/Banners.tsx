// Banners between the Ribbon and the canvas: service outages, the ended trial, the active trace and a failed open.
import { COPY } from '../../../shared/copy.ts';
import { useEditorState } from '../store.ts';

export function Banners() {
  const { paused, storageDown, trial, activeTrace, openError } = useEditorState();
  return (
    <div className="banners">
      <div role="status" aria-label="Service status" className="banner-stack">
        {paused && <div className="banner">{COPY.bannerValkey}</div>}
        {storageDown && <div className="banner">{COPY.bannerMinio}</div>}
      </div>
      {trial?.ended && <div className="banner">{COPY.trialEnded}</div>}
      {activeTrace && <div role="status" aria-label="Trace" className="banner banner-trace">Tracing: {activeTrace.name}</div>}
      {openError && <div role="alert" className="banner">{openError}</div>}
    </div>
  );
}
