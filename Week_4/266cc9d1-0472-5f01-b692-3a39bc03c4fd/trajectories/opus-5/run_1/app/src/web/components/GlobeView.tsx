import { useEffect, useRef, useState, type ReactNode } from "react";
import { webGlSupported } from "../lib/motion.js";
import type { CorridorGlobe, TerrainSample } from "../lib/globe.js";
import { EMPTY_VIEWPORT, NO_ASSETS, NO_WEBGL } from "../../shared/copy.js";
import type { CameraPose } from "../lib/view.js";
import type { ActiveAssets, Finding, Tower } from "../lib/types.js";

export interface GlobeViewProps {
  assetBase: string;
  activeAssets: ActiveAssets;
  towers: Tower[];
  trackPositions: { lon: number; lat: number; height: number }[];
  findings: Finding[];
  nearIds: Set<string>;
  selectedId: string | null;
  dronePosition: { lon_deg: number; lat_deg: number; height_m: number } | null;
  storageReachable: boolean;
  reducedMotion: boolean;
  onReady: (globe: CorridorGlobe) => void;
  onCameraChange: (pose: CameraPose, heightAboveGroundM: number) => void;
  onStreamingChange: (tiles: number) => void;
  onPick?: (lonDeg: number, latDeg: number, sample: TerrainSample | null) => void;
}

export function GlobeView(props: GlobeViewProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const globe = useRef<CorridorGlobe | null>(null);
  const supported = useRef(webGlSupported());
  const [ready, setReady] = useState(0);
  const callbacks = useRef(props);
  callbacks.current = props;

  const hasTiles = props.activeAssets.terrain !== null || props.activeAssets.tileset !== null;

  useEffect(() => {
    if (!supported.current || !host.current) return undefined;
    if (!props.storageReachable || !hasTiles) return undefined;
    const container = host.current;
    let instance: CorridorGlobe | null = null;
    let cancelled = false;
    // The scene loads on demand so the ribbon, readout and rail are usable first.
    void import("../lib/globe.js").then(({ CorridorGlobe }) => {
      if (cancelled) return;
      instance = new CorridorGlobe({
        container,
        assetBase: callbacks.current.assetBase,
        terrainAssetId: callbacks.current.activeAssets.terrain,
        tilesetAssetId: callbacks.current.activeAssets.tileset,
        onCameraChange: (pose, height) => callbacks.current.onCameraChange(pose, height),
        onStreamingChange: (tiles) => callbacks.current.onStreamingChange(tiles),
        onPick: (lon, lat, sample) => callbacks.current.onPick?.(lon, lat, sample),
        reducedMotion: () => callbacks.current.reducedMotion,
      });
      globe.current = instance;
      instance.setCorridor(callbacks.current.towers, callbacks.current.trackPositions);
      callbacks.current.onReady(instance);
      setReady((count) => count + 1);
    });
    return () => {
      cancelled = true;
      globe.current = null;
      instance?.destroy();
    };
    // The scene is built once per storage recovery and per active asset set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storageReachable, hasTiles, props.activeAssets.terrain, props.activeAssets.tileset]);

  useEffect(() => {
    globe.current?.setFindings(props.findings, props.nearIds, props.selectedId);
  }, [props.findings, props.nearIds, props.selectedId, ready]);

  useEffect(() => {
    globe.current?.setDrone(props.dronePosition);
  }, [props.dronePosition, ready]);

  if (!supported.current) {
    return (
      <div className="globe globe--message">
        <p>{NO_WEBGL}</p>
      </div>
    );
  }
  if (!props.storageReachable) {
    return (
      <div className="globe globe--message">
        <p>{EMPTY_VIEWPORT}</p>
      </div>
    );
  }
  if (!hasTiles) {
    return (
      <div className="globe globe--message">
        <p>{NO_ASSETS}</p>
      </div>
    );
  }
  return <div className="globe" role="application" aria-label="Corridor globe" ref={host} />;
}
