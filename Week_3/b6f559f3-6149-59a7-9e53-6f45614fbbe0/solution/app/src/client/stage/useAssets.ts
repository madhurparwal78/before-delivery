import { useEffect, useRef, useState } from 'react';
import type { AssetInfo, SceneDocument } from '../../shared/types';
import { AssetLoader } from './assets';

/** The asset ids a document uses, with the kind each one is read as. */
function referencedAssets(document: SceneDocument): Map<string, AssetInfo['kind']> {
  const ids = new Map<string, AssetInfo['kind']>();
  for (const scene of document.scenes) {
    for (const layer of scene.layers) {
      const props = layer.props;
      if (layer.kind === 'Image' && typeof props['assetId'] === 'string') ids.set(props['assetId'], 'image');
      if (layer.kind === 'Model' && typeof props['modelAssetId'] === 'string') ids.set(props['modelAssetId'], 'model');
      if (layer.kind === 'Extrusion' && typeof props['svgAssetId'] === 'string') ids.set(props['svgAssetId'], 'svg');
    }
  }
  return ids;
}

/**
 * Describes the assets a bare scene document uses by fetching them through `urlOf`, for pages (the embed, the
 * covers) that have the document but not the editor's asset list. Assets that cannot be fetched stay out of the
 * map and the loader marks them unavailable.
 */
export function useDescribedAssets(document: SceneDocument | null, loader: AssetLoader, enabled = true): ReadonlyMap<string, AssetInfo> {
  const [assets, setAssets] = useState<ReadonlyMap<string, AssetInfo>>(new Map());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!document || !enabled) return;
    let alive = true;
    for (const [id, kind] of referencedAssets(document)) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      void loader.describe(id, kind).then((info) => {
        if (alive && info) setAssets((current) => new Map(current).set(id, info));
      });
    }
    return () => {
      alive = false;
      requested.current.clear();
    };
  }, [document, loader, enabled]);
  return assets;
}
