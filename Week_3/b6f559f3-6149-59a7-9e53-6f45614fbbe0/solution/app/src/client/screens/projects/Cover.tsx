import { useEffect, useState } from 'react';
import type { SceneDocument } from '../../../shared/types';
import { SceneCanvas } from '../../stage/SceneCanvas';

type Loaded = { state: 'loading' } | { state: 'ready'; document: SceneDocument } | { state: 'failed' };

/** The cover panel of a project: its latest published scene, or a dim still frame while nothing plays. */
export function Cover({ projectId, name, liveVersion }: { projectId: string; name: string; liveVersion: number | null }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: liveVersion === null ? 'failed' : 'loading' });

  useEffect(() => {
    if (liveVersion === null) {
      setLoaded({ state: 'failed' });
      return;
    }
    let live = true;
    setLoaded({ state: 'loading' });
    fetch(`/api/embed/${projectId}/scene`)
      .then((response) => (response.ok ? (response.json() as Promise<SceneDocument>) : Promise.reject(new Error('unavailable'))))
      .then((document) => live && setLoaded({ state: 'ready', document }))
      .catch(() => live && setLoaded({ state: 'failed' }));
    return () => {
      live = false;
    };
  }, [projectId, liveVersion]);

  if (loaded.state === 'ready') {
    return (
      <SceneCanvas
        document={loaded.document}
        playOnce
        className="cover-canvas"
        aria-label={`${name} cover`}
        assetUrl={(assetId) => `/api/embed/${projectId}/assets/${assetId}`}
      />
    );
  }
  return (
    <div className={`cover-still ${loaded.state === 'loading' ? 'is-loading' : ''}`} role="img" aria-label={`${name} cover`}>
      <svg viewBox="0 0 160 90" aria-hidden="true">
        <rect x="0.5" y="0.5" width="159" height="89" rx="6" fill="none" stroke="currentColor" opacity="0.5" />
        <circle cx="80" cy="45" r="14" fill="none" stroke="currentColor" opacity="0.6" />
        <path d="M66 45h28M80 31v28" stroke="currentColor" opacity="0.3" />
      </svg>
    </div>
  );
}
