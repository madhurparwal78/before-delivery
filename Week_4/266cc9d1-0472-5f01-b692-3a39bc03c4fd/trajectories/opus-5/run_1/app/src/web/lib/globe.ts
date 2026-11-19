/**
 * The 3D scene: streamed terrain and reality mesh, the corridor centreline,
 * towers, conductors, finding markers with draped footprints, and the drone.
 */

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumTerrainProvider,
  CesiumWidget,
  Color,
  Entity,
  HeadingPitchRoll,
  HeightReference,
  LabelStyle,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Scene,
} from "cesium";
import type { CameraPose } from "./view.js";
import type { Finding, Tower } from "./types.js";

const INK = Color.fromCssColorString("#1b2430");
const SLATE = Color.fromCssColorString("#6b7f93");
const FOREST = Color.fromCssColorString("#1f5134");
const ACCENT = Color.fromCssColorString("#c2622a");
const PAPER = Color.fromCssColorString("#f6f1e7");

export interface TerrainSample {
  heightM: number;
  level: number;
}

export interface GlobeOptions {
  container: HTMLElement;
  assetBase: string;
  terrainAssetId: string | null;
  tilesetAssetId: string | null;
  onCameraChange: (pose: CameraPose, heightAboveGroundM: number) => void;
  onStreamingChange: (tiles: number) => void;
  onPick?: (lonDeg: number, latDeg: number, sample: TerrainSample | null) => void;
  reducedMotion: () => boolean;
}

interface SurfaceTile {
  level: number;
  rectangle: { west: number; south: number; east: number; north: number };
  data?: {
    renderedMesh?: unknown;
    terrainData?: { wasCreatedByUpsampling(): boolean };
  };
  _southwestChild?: SurfaceTile;
  _southeastChild?: SurfaceTile;
  _northwestChild?: SurfaceTile;
  _northeastChild?: SurfaceTile;
}

interface GlobeInternals {
  _surface?: {
    _levelZeroTiles?: SurfaceTile[];
    _tileLoadQueueHigh?: unknown[];
    _tileLoadQueueMedium?: unknown[];
    _tileLoadQueueLow?: unknown[];
  };
}

export class CorridorGlobe {
  private readonly widget: CesiumWidget;
  private readonly scene: Scene;
  private readonly options: GlobeOptions;
  private readonly handler: ScreenSpaceEventHandler;
  private findingEntities: Entity[] = [];
  private droneEntity: Entity | null = null;
  private streaming = -1;
  private tileset: Cesium3DTileset | null = null;

  constructor(options: GlobeOptions) {
    this.options = options;
    // The scene carries no third-party imagery, so the credit panel holds
    // nothing to show and must stay out of the Tab order.
    const credits = document.createElement("div");
    credits.style.display = "none";
    options.container.appendChild(credits);

    this.widget = new CesiumWidget(options.container, {
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,
      msaaSamples: 4,
      requestRenderMode: false,
      showRenderLoopErrors: false,
      blurActiveElementOnCanvasFocus: false,
      creditContainer: credits,
      creditViewport: credits,
    });
    this.scene = this.widget.scene;
    this.scene.globe.baseColor = Color.fromCssColorString("#e8e2d4");
    this.scene.globe.showGroundAtmosphere = false;
    this.scene.globe.depthTestAgainstTerrain = true;
    this.scene.backgroundColor = Color.fromCssColorString("#dcd6c7");
    this.scene.screenSpaceCameraController.enableCollisionDetection = true;
    this.scene.screenSpaceCameraController.minimumZoomDistance = 10;
    this.widget.canvas.setAttribute("tabindex", "-1");

    this.handler = new ScreenSpaceEventHandler(this.widget.canvas);
    const pick = (event: { position: Cartesian2 }): void => {
      if (!this.options.onPick) return;
      const cartesian = this.scene.pickPosition(event.position);
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      this.options.onPick(
        CesiumMath.toDegrees(carto.longitude),
        CesiumMath.toDegrees(carto.latitude),
        this.terrainSample(CesiumMath.toDegrees(carto.longitude), CesiumMath.toDegrees(carto.latitude)),
      );
    };
    this.handler.setInputAction(pick, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    this.scene.postRender.addEventListener(() => {
      this.reportCamera();
      this.reportStreaming();
    });

    void this.loadProviders();
  }

  private async loadProviders(): Promise<void> {
    const { terrainAssetId, tilesetAssetId, assetBase } = this.options;
    if (terrainAssetId) {
      try {
        this.widget.terrainProvider = await CesiumTerrainProvider.fromUrl(
          `${assetBase}/${terrainAssetId}/files`,
          { requestVertexNormals: false, requestWaterMask: false },
        );
      } catch {
        /* Tiles stream again once storage answers; the banner says so. */
      }
    }
    if (tilesetAssetId) {
      try {
        this.tileset = await Cesium3DTileset.fromUrl(
          `${assetBase}/${tilesetAssetId}/files/tileset.json`,
          { maximumScreenSpaceError: 8 },
        );
        this.scene.primitives.add(this.tileset);
      } catch {
        /* Same: the reality mesh appears when storage is back. */
      }
    }
  }

  private lastPose: CameraPose | null = null;

  private reportCamera(): void {
    const camera = this.scene.camera;
    const carto = Cartographic.fromCartesian(camera.positionWC);
    const pose: CameraPose = {
      lonDeg: CesiumMath.toDegrees(carto.longitude),
      latDeg: CesiumMath.toDegrees(carto.latitude),
      heightM: carto.height,
      headingDeg: (CesiumMath.toDegrees(camera.heading) + 360) % 360,
      pitchDeg: CesiumMath.toDegrees(camera.pitch),
    };
    const previous = this.lastPose;
    if (
      previous &&
      Math.abs(previous.lonDeg - pose.lonDeg) < 1e-7 &&
      Math.abs(previous.latDeg - pose.latDeg) < 1e-7 &&
      Math.abs(previous.heightM - pose.heightM) < 0.05 &&
      Math.abs(previous.headingDeg - pose.headingDeg) < 0.05 &&
      Math.abs(previous.pitchDeg - pose.pitchDeg) < 0.05
    ) {
      return;
    }
    this.lastPose = pose;
    const ground = this.scene.globe.getHeight(carto);
    this.options.onCameraChange(pose, carto.height - (ground ?? 0));
  }

  private reportStreaming(): void {
    const surface = (this.scene.globe as unknown as GlobeInternals)._surface;
    const terrainQueue =
      (surface?._tileLoadQueueHigh?.length ?? 0) +
      (surface?._tileLoadQueueMedium?.length ?? 0) +
      (surface?._tileLoadQueueLow?.length ?? 0);
    const meshStatistics = (
      this.tileset as unknown as {
        statistics?: { numberOfPendingRequests: number; numberOfTilesProcessing: number };
      } | null
    )?.statistics;
    const mesh = meshStatistics
      ? meshStatistics.numberOfPendingRequests + meshStatistics.numberOfTilesProcessing
      : 0;
    const total = terrainQueue + mesh;
    if (total !== this.streaming) {
      this.streaming = total;
      this.options.onStreamingChange(total);
    }
  }

  /** The finest loaded terrain tile under a point, mirroring Globe#getHeight. */
  terrainSample(lonDeg: number, latDeg: number): TerrainSample | null {
    const carto = Cartographic.fromDegrees(lonDeg, latDeg);
    const heightM = this.scene.globe.getHeight(carto);
    if (heightM === undefined) return null;
    const surface = (this.scene.globe as unknown as GlobeInternals)._surface;
    const roots = surface?._levelZeroTiles ?? [];
    let bestLevel = -1;
    const visit = (tile: SurfaceTile | undefined): void => {
      if (!tile) return;
      const { west, south, east, north } = tile.rectangle;
      if (
        carto.longitude < west ||
        carto.longitude > east ||
        carto.latitude < south ||
        carto.latitude > north
      ) {
        return;
      }
      // Only levels that actually load count; upsampled tiles carry no new data.
      const loaded =
        tile.data?.renderedMesh !== undefined &&
        tile.data.terrainData?.wasCreatedByUpsampling() === false;
      if (loaded && tile.level > bestLevel) bestLevel = tile.level;
      visit(tile._southwestChild);
      visit(tile._southeastChild);
      visit(tile._northwestChild);
      visit(tile._northeastChild);
    };
    for (const root of roots) visit(root);
    return bestLevel < 0 ? null : { heightM, level: bestLevel };
  }

  groundHeight(lonDeg: number, latDeg: number): number | null {
    return this.scene.globe.getHeight(Cartographic.fromDegrees(lonDeg, latDeg)) ?? null;
  }

  /** Draws the corridor once: centreline, towers, conductors and the flown track. */
  setCorridor(towers: Tower[], trackPositions: { lon: number; lat: number; height: number }[]): void {
    const entities = this.widget.entities;
    entities.add({
      id: "centreline",
      polyline: {
        positions: towers.map((tower) =>
          Cartesian3.fromDegrees(tower.lon_deg, tower.lat_deg, tower.base_height_m),
        ),
        width: 2,
        material: SLATE,
        clampToGround: false,
      },
    });
    for (let i = 0; i + 1 < towers.length; i += 1) {
      const a = towers[i];
      const b = towers[i + 1];
      entities.add({
        id: `conductor-${a.number}`,
        polyline: {
          positions: [
            Cartesian3.fromDegrees(a.lon_deg, a.lat_deg, a.base_height_m + a.attachment_height_m),
            Cartesian3.fromDegrees(b.lon_deg, b.lat_deg, b.base_height_m + b.attachment_height_m),
          ],
          width: 2,
          material: INK,
        },
      });
    }
    for (const tower of towers) {
      entities.add({
        id: `tower-${tower.number}`,
        position: Cartesian3.fromDegrees(
          tower.lon_deg,
          tower.lat_deg,
          tower.base_height_m + tower.attachment_height_m,
        ),
        point: { pixelSize: 7, color: INK, outlineColor: PAPER, outlineWidth: 1 },
        label: {
          text: tower.label,
          font: "600 12px 'IBM Plex Mono', monospace",
          fillColor: INK,
          style: LabelStyle.FILL,
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -10),
        },
        polyline: undefined,
      });
      entities.add({
        id: `tower-mast-${tower.number}`,
        polyline: {
          positions: [
            Cartesian3.fromDegrees(tower.lon_deg, tower.lat_deg, tower.base_height_m),
            Cartesian3.fromDegrees(
              tower.lon_deg,
              tower.lat_deg,
              tower.base_height_m + tower.attachment_height_m,
            ),
          ],
          width: 3,
          material: SLATE,
        },
      });
    }
    if (trackPositions.length > 1) {
      entities.add({
        id: "flight-track",
        polyline: {
          positions: trackPositions.map((sample) =>
            Cartesian3.fromDegrees(sample.lon, sample.lat, sample.height),
          ),
          width: 1,
          material: INK.withAlpha(0.7),
        },
      });
    }
  }

  /** Finding markers with canopy footprints draped on the finest loaded terrain. */
  setFindings(findings: Finding[], nearIds: Set<string>, selectedId: string | null): void {
    for (const entity of this.findingEntities) this.widget.entities.remove(entity);
    this.findingEntities = [];
    for (const finding of findings) {
      const colour = finding.status === "violation" ? ACCENT : FOREST;
      this.findingEntities.push(
        this.widget.entities.add({
          position: Cartesian3.fromDegrees(finding.lon_deg, finding.lat_deg, 0),
          ellipse: {
            semiMajorAxis: finding.canopy_radius_m,
            semiMinorAxis: finding.canopy_radius_m,
            material: colour.withAlpha(0.55),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            classificationType: undefined,
          },
        }),
      );
      this.findingEntities.push(
        this.widget.entities.add({
          position: Cartesian3.fromDegrees(
            finding.lon_deg,
            finding.lat_deg,
            finding.canopy_top_height_m,
          ),
          point: {
            pixelSize: selectedId === finding.id ? 13 : 10,
            color: colour,
            outlineColor: selectedId === finding.id ? INK : PAPER,
            outlineWidth: 2,
          },
          label: {
            text: finding.label,
            font: "600 12px 'IBM Plex Mono', monospace",
            fillColor: INK,
            style: LabelStyle.FILL,
            verticalOrigin: VerticalOrigin.BOTTOM,
            pixelOffset: new Cartesian2(0, -12),
          },
        }),
      );
      this.findingEntities.push(
        this.widget.entities.add({
          polyline: {
            positions: [
              Cartesian3.fromDegrees(finding.lon_deg, finding.lat_deg, finding.ground_height_m),
              Cartesian3.fromDegrees(finding.lon_deg, finding.lat_deg, finding.canopy_top_height_m),
            ],
            width: 2,
            material: colour,
          },
        }),
      );
      if (nearIds.has(finding.id)) {
        this.findingEntities.push(
          this.widget.entities.add({
            polyline: {
              positions: ringPositions(
                finding.lon_deg,
                finding.lat_deg,
                finding.canopy_radius_m + 4,
              ),
              width: 3,
              material: ACCENT,
              clampToGround: true,
            },
          }),
        );
      }
    }
  }

  setDrone(position: { lon_deg: number; lat_deg: number; height_m: number } | null): void {
    if (this.droneEntity) {
      this.widget.entities.remove(this.droneEntity);
      this.droneEntity = null;
    }
    if (!position) return;
    this.droneEntity = this.widget.entities.add({
      position: Cartesian3.fromDegrees(position.lon_deg, position.lat_deg, position.height_m),
      point: { pixelSize: 12, color: INK, outlineColor: PAPER, outlineWidth: 2 },
    });
  }

  moveCamera(pose: CameraPose, seconds: number): void {
    const destination = Cartesian3.fromDegrees(pose.lonDeg, pose.latDeg, pose.heightM);
    const orientation = {
      heading: CesiumMath.toRadians(pose.headingDeg),
      pitch: CesiumMath.toRadians(pose.pitchDeg),
      roll: 0,
    };
    if (this.options.reducedMotion() || seconds <= 0) {
      this.scene.camera.setView({ destination, orientation });
      this.reportCamera();
      return;
    }
    this.scene.camera.flyTo({ destination, orientation, duration: seconds, easingFunction: undefined });
  }

  setCameraExactly(pose: CameraPose): void {
    this.scene.camera.setView({
      destination: Cartesian3.fromDegrees(pose.lonDeg, pose.latDeg, pose.heightM),
      orientation: new HeadingPitchRoll(
        CesiumMath.toRadians(pose.headingDeg),
        CesiumMath.toRadians(pose.pitchDeg),
        0,
      ),
    });
    this.reportCamera();
  }

  destroy(): void {
    this.handler.destroy();
    this.widget.destroy();
  }
}

function ringPositions(lonDeg: number, latDeg: number, radiusM: number): Cartesian3[] {
  const positions: Cartesian3[] = [];
  const metresPerDegreeLat = 110_574;
  const metresPerDegreeLon = 111_320 * Math.cos((latDeg * Math.PI) / 180);
  for (let i = 0; i <= 48; i += 1) {
    const theta = (2 * Math.PI * i) / 48;
    positions.push(
      Cartesian3.fromDegrees(
        lonDeg + (radiusM * Math.cos(theta)) / metresPerDegreeLon,
        latDeg + (radiusM * Math.sin(theta)) / metresPerDegreeLat,
      ),
    );
  }
  return positions;
}
