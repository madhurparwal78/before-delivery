import '../styles/drawing/chrome.css';
import { useEffect, useMemo, useState } from 'react';
import { LINK_ENDED, NOT_FOUND_PAGE, VERSION_STATE_LABEL } from '../../shared/copy.ts';
import type { VersionDocument } from '../../shared/types.ts';
import { Pane } from '../drawing/chrome/Pane.tsx';
import { ZoomChip } from '../drawing/chrome/ZoomChip.tsx';
import { CanvasPane } from '../drawing/canvas/index.ts';
import { useJson } from '../pages/useJson.ts';
import { LiveChannel, ReviewStore, SceneStoreProvider, browserSceneEnv, openSocket } from '../store/index.ts';
import { WorkspaceSkeleton } from '../drawing/workspace/WorkspaceSkeleton.tsx';
import { Chip, NotAvailable } from '../ui/index.ts';
import '../styles/drawing/workspace.css';

type Ended = keyof typeof LINK_ENDED;

/** The linked version, read-only; the page swaps to the Not available sentence the moment the link expires or is turned off. */
function LinkedVersion({ token, version }: { token: string; version: VersionDocument }) {
  const [ended, setEnded] = useState<Ended | null>(null);
  const store = useMemo(() => new ReviewStore(version.snapshot.model, version.snapshot.sheet, browserSceneEnv()), [version]);

  useEffect(() => {
    const channel: LiveChannel = new LiveChannel(`/api/links/${token}/live`, openSocket, {
      message: (message) => {
        if (message.type === 'link' && message.data.state !== 'active') setEnded(`link_${message.data.state}`);
      },
      resync: () => channel.resynced(0),
    });
    channel.connect(0);
    return () => channel.disconnect();
  }, [token]);

  if (ended !== null) return <NotAvailable sentences={[LINK_ENDED[ended]]} />;
  const sheet = version.snapshot.sheet;
  return (
    <SceneStoreProvider store={store}>
      <div className="ws">
        <div className="ws-centre">
          <Pane
            paneRef={null}
            canvas={<CanvasPane store={store} />}
            top={
              <Chip>
                <span className="chip-title">{`${sheet.name} v${version.number}`}</span>
                <span className="chip-text">{VERSION_STATE_LABEL[version.state]}</span>
              </Chip>
            }
            middle={null}
            bottom={<ZoomChip />}
          />
        </div>
      </div>
    </SceneStoreProvider>
  );
}

/** `/v/<token>`: the Review screen without account controls, issues or markups. */
export function ViewLinkPage({ token }: { token: string }) {
  const version = useJson<VersionDocument>(`/api/links/${token}`);
  if (version.status === 'loading') return <WorkspaceSkeleton panels={false} />;
  if (version.status === 'failed') {
    const { code } = version.failure;
    return <NotAvailable sentences={[code === 'link_expired' || code === 'link_revoked' ? LINK_ENDED[code] : NOT_FOUND_PAGE]} />;
  }
  return <LinkedVersion token={token} version={version.data} />;
}
