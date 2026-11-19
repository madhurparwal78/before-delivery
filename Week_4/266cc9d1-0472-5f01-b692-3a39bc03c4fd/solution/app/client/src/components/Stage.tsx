// The corridor stage shared by the workspace and the review page: the camera rig, the view
// controller, the globe (Cesium, loaded only when WebGL exists) and its fallbacks.
import { baseHeightAt } from "../../../shared/corridorLine";
import { pointAt } from "../../../shared/geodesy";
import { CloudOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ActiveAssets, ApiFailure, CorridorDetail, Finding } from "../api";
import { CameraRig, CHASE_UP_GROUND_M, lookingAt } from "../camera";
import { isNear, shapeOf, type CorridorShape } from "../corridorMath";
import type { Globe, Pick, TerrainTile } from "../globe/scene";
import { webglAvailable } from "../globe/webgl";
import { CorridorView, readUrl } from "../view";
import { CorridorPlan } from "./bits";

const NO_WEBGL = "3D view needs WebGL. The span ribbon and findings rail still work.";
const STORAGE_BANNER = "Tile storage is unreachable. Findings stay editable, and tiles will reload when storage is back.";
const EMPTY_VIEWPORT = "No tiles can be shown right now. Use the span ribbon and the findings rail to keep working.";
const NO_ASSETS = "No survey assets stored for this corridor yet.";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const change = () => setMatches(list.matches);
    list.addEventListener("change", change);
    change();
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

interface StageOptions {
  detail: CorridorDetail;
  findings: Finding[];
  flightPath: string;
  onAnnounce: (text: string) => void;
  onFailure: (failure: ApiFailure) => void;
}

export function useCorridorStage({ detail, findings, flightPath, onAnnounce, onFailure }: StageOptions) {
  const shape = useMemo(() => shapeOf(detail.towers, detail.corridor.length_m), [detail.towers, detail.corridor.length_m]);
  const rig = useMemo(() => {
    const foot = pointAt(shape.line, 0, 0);
    return new CameraRig(lookingAt(shape, 0, { ...foot, heightM: baseHeightAt(shape.marks, 0) }, CHASE_UP_GROUND_M), shape);
  }, [shape]);
  const latest = useRef({ findings, onAnnounce, onFailure });
  latest.current = { findings, onAnnounce, onFailure };
  const view = useMemo(
    () =>
      new CorridorView({
        shape,
        rig,
        flightPath,
        findings: () => latest.current.findings,
        onAnnounce: (text) => latest.current.onAnnounce(text),
        onFailure: (failure) => latest.current.onFailure(failure),
      }),
    [shape, rig, flightPath],
  );
  useEffect(() => {
    view.open(readUrl());
    const restore = () => view.open(readUrl());
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      view.dispose();
    };
  }, [view]);
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot);
  const nearIds = useMemo(
    () => new Set(findings.filter((f) => isNear(f.chainage_m, snapshot.chainageM)).map((f) => f.id)),
    [findings, snapshot.chainageM],
  );
  return { shape, rig, view, snapshot, nearIds };
}

interface GlobeAreaProps {
  shape: CorridorShape;
  rig: CameraRig;
  assets: ActiveAssets;
  assetUrl: (assetId: string, path: string) => string;
  storageOk: boolean;
  findings: Finding[];
  nearIds: ReadonlySet<string>;
  selectedId: string | null;
  drone: { lonDeg: number; latDeg: number; heightM: number } | null;
  coverage: Array<{ from_m: number; to_m: number }>;
  onStreaming: (pending: number) => void;
  onTerrainTile: (tile: TerrainTile) => void;
  onPick: (pick: Pick) => void;
  overlays: ReactNode;
}

export function GlobeArea(props: GlobeAreaProps) {
  const { shape, rig, assets, storageOk, findings, nearIds, selectedId, drone, coverage } = props;
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<Globe | null>(null);
  const [webgl] = useState(webglAvailable);
  const handlers = useRef(props);
  handlers.current = props;
  const content = useRef({ findings, nearIds, selectedId, drone, covered: coverage });
  content.current = { findings, nearIds, selectedId, drone, covered: coverage };
  const live = webgl && storageOk;
  const assetKey = `${assets.terrain ?? ""}|${assets.tileset ?? ""}`;

  useEffect(() => {
    const element = host.current;
    if (!live || element === null) return;
    let cancelled = false;
    void import("../globe/scene").then(async ({ createGlobe }) => {
      if (cancelled) return;
      const created = await createGlobe({
        container: element,
        rig,
        shape,
        assets: handlers.current.assets,
        assetUrl: handlers.current.assetUrl,
        onStreaming: (pending) => handlers.current.onStreaming(pending),
        onTerrainTile: (tile) => handlers.current.onTerrainTile(tile),
        onPick: (pick) => handlers.current.onPick(pick),
      });
      if (cancelled) {
        created.destroy();
        return;
      }
      globe.current = created;
      created.update(content.current);
    });
    return () => {
      cancelled = true;
      globe.current?.destroy();
      globe.current = null;
      handlers.current.onStreaming(0);
    };
  }, [live, rig, shape, assetKey]);

  useEffect(() => {
    globe.current?.update({ findings, nearIds, selectedId, drone, covered: coverage });
  }, [findings, nearIds, selectedId, drone, coverage]);

  const empty = assets.terrain === null && assets.tileset === null;
  return (
    <div className="globe-area">
      <div role="application" aria-label="Corridor globe" className="globe-canvas">
        {live ? (
          <div ref={host} className="globe-canvas" />
        ) : (
          <div className="globe-message">
            <div className="plate">
              <CorridorPlan towers={shape.towers} findings={findings} />
              <p>{webgl ? EMPTY_VIEWPORT : NO_WEBGL}</p>
            </div>
          </div>
        )}
        {live && empty && (
          <div className="globe-overlay-note">
            <CorridorPlan towers={shape.towers} findings={findings} />
            <p>{NO_ASSETS}</p>
          </div>
        )}
      </div>
      {!storageOk && (
        <div role="alert" className="banner">
          <CloudOff size={18} aria-hidden="true" />
          {STORAGE_BANNER}
        </div>
      )}
      {props.overlays}
    </div>
  );
}
