// The corridor globe: streamed quantized-mesh terrain, the canopy reality mesh, the centreline,
// towers, one conductor per span, finding markers with draped footprints, near-playhead rings and
// the drone. Every position reaches Cesium as a float64 Cartesian3 and is drawn relative to the eye.
// Draco geometry, KTX2 textures and quantized-mesh tiles are decoded in Cesium's worker pool.
import "@cesium/engine/Source/Widget/CesiumWidget.css";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  EllipseGeometry,
  GeometryInstance,
  Math as CesiumMath,
  Rectangle,
} from "@cesium/core";
import {
  BillboardCollection,
  CameraEventType,
  Cesium3DTileset,
  CesiumTerrainProvider,
  CesiumWidget,
  ClassificationType,
  EllipsoidTerrainProvider,
  GridImageryProvider,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  HorizontalOrigin,
  ImageryLayer,
  KeyboardEventModifier,
  LabelCollection,
  LabelStyle,
  PerInstanceColorAppearance,
  PolylineCollection,
  PolylineColorAppearance,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Material,
  type Billboard,
  type TerrainData,
  type TerrainProvider,
} from "@cesium/engine";
import { pointAt, toEcef } from "../../../shared/geodesy";
import type { ActiveAssets, Finding } from "../api";
import type { CameraRig, Pose } from "../camera";
import type { CorridorShape } from "../corridorMath";
import { prefersReducedMotion } from "../motion";
import { FOREST, GROUND, INK, MUTED, PAPER, PAPER_SUNK, RULE, statusColour, VIOLATION } from "./palette";

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}
window.CESIUM_BASE_URL = "/cesium/";

const RING_FADE_MS = 160;

function colour(c: Color): Material {
  return Material.fromType("Color", { color: c });
}
const INERTIA = 0.6;

export interface TerrainTile {
  level: number;
  contains: (lonDeg: number, latDeg: number) => boolean;
  heightAt: (lonDeg: number, latDeg: number) => number;
}

export interface Pick {
  lonDeg: number;
  latDeg: number;
  heightM: number;
  level: number | null;
}

interface GlobeInput {
  container: HTMLElement;
  rig: CameraRig;
  shape: CorridorShape;
  assets: ActiveAssets;
  assetUrl: (assetId: string, path: string) => string;
  onStreaming: (pendingTiles: number) => void;
  onTerrainTile: (tile: TerrainTile) => void;
  onPick: (pick: Pick) => void;
}

interface SceneContent {
  findings: Finding[];
  nearIds: ReadonlySet<string>;
  selectedId: string | null;
  drone: { lonDeg: number; latDeg: number; heightM: number } | null;
  covered: Array<{ from_m: number; to_m: number }>;
}

export interface Globe {
  update: (content: SceneContent) => void;
  groundAt: (lonDeg: number, latDeg: number) => { heightM: number; level: number } | null;
  destroy: () => void;
}

/** A marker glyph drawn once to a canvas: a triangle for violations, a check disc for clear findings. */
function glyph(kind: "violation" | "clear" | "ring" | "drone", colour: Color, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = canvas.height = size * scale;
  const g = canvas.getContext("2d");
  if (g === null) return canvas;
  g.scale(scale, scale);
  const css = colour.toCssColorString();
  const paper = PAPER.toCssColorString();
  g.lineJoin = "round";
  if (kind === "violation") {
    g.beginPath();
    g.moveTo(size / 2, 2);
    g.lineTo(size - 2, size - 3);
    g.lineTo(2, size - 3);
    g.closePath();
    g.fillStyle = css;
    g.strokeStyle = paper;
    g.lineWidth = 2;
    g.fill();
    g.stroke();
    g.fillStyle = paper;
    g.fillRect(size / 2 - 1, size * 0.36, 2, size * 0.3);
    g.fillRect(size / 2 - 1, size * 0.72, 2, 2);
  } else if (kind === "clear") {
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.fillStyle = css;
    g.strokeStyle = paper;
    g.lineWidth = 2;
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(size * 0.3, size * 0.52);
    g.lineTo(size * 0.45, size * 0.66);
    g.lineTo(size * 0.72, size * 0.36);
    g.strokeStyle = paper;
    g.lineWidth = 2.2;
    g.stroke();
  } else if (kind === "ring") {
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    g.strokeStyle = paper;
    g.lineWidth = 5;
    g.stroke();
    g.strokeStyle = css;
    g.lineWidth = 2.5;
    g.stroke();
  } else {
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    g.fillStyle = paper;
    g.fill();
    g.strokeStyle = css;
    g.lineWidth = 2;
    g.stroke();
    g.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      g.moveTo(size / 2, size / 2);
      g.lineTo(size / 2 + dx * size * 0.22, size / 2 + dy * size * 0.22);
    }
    g.lineWidth = 1.6;
    g.stroke();
  }
  return canvas;
}

function circle(lonDeg: number, latDeg: number, radiusM: number): Cartesian3[] {
  const centre = Cartesian3.fromDegrees(lonDeg, latDeg, 0);
  const east = new Cartesian3(-Math.sin(CesiumMath.toRadians(lonDeg)), Math.cos(CesiumMath.toRadians(lonDeg)), 0);
  const up = Cartesian3.normalize(centre, new Cartesian3());
  const north = Cartesian3.cross(up, east, new Cartesian3());
  const points: Cartesian3[] = [];
  for (let i = 0; i <= 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    const offset = Cartesian3.add(
      Cartesian3.multiplyByScalar(east, Math.cos(a) * radiusM, new Cartesian3()),
      Cartesian3.multiplyByScalar(north, Math.sin(a) * radiusM, new Cartesian3()),
      new Cartesian3(),
    );
    points.push(Cartesian3.add(centre, offset, new Cartesian3()));
  }
  return points;
}

function readPose(widget: CesiumWidget): Pose {
  const camera = widget.camera;
  const at = camera.positionCartographic;
  return {
    lonDeg: CesiumMath.toDegrees(at.longitude),
    latDeg: CesiumMath.toDegrees(at.latitude),
    heightM: at.height,
    headingDeg: CesiumMath.toDegrees(camera.heading),
    pitchDeg: CesiumMath.toDegrees(camera.pitch),
  };
}

function samePose(a: Pose, b: Pose): boolean {
  const turn = Math.abs(((a.headingDeg - b.headingDeg + 540) % 360) - 180);
  return (
    Math.abs(a.lonDeg - b.lonDeg) < 1e-8 &&
    Math.abs(a.latDeg - b.latDeg) < 1e-8 &&
    Math.abs(a.heightM - b.heightM) < 0.01 &&
    turn < 0.001 &&
    Math.abs(a.pitchDeg - b.pitchDeg) < 0.001
  );
}

/** Terrain whose tile arrivals are recorded, so the page can sample the finest loaded level under a point. */
async function streamedTerrain(input: GlobeInput): Promise<{ provider: TerrainProvider; tiles: Map<string, { rectangle: Rectangle; data: TerrainData }> }> {
  const tiles = new Map<string, { rectangle: Rectangle; data: TerrainData }>();
  const terrain = input.assets.terrain;
  if (terrain === null) return { provider: new EllipsoidTerrainProvider(), tiles };
  let provider: CesiumTerrainProvider;
  try {
    provider = await CesiumTerrainProvider.fromUrl(input.assetUrl(terrain, ""));
  } catch {
    return { provider: new EllipsoidTerrainProvider(), tiles };
  }
  const request = provider.requestTileGeometry.bind(provider);
  provider.requestTileGeometry = (x, y, level, tileRequest) =>
    request(x, y, level, tileRequest)?.then((data) => {
      const rectangle = provider.tilingScheme.tileXYToRectangle(x, y, level);
      tiles.set(`${level}/${x}/${y}`, { rectangle, data });
      input.onTerrainTile({
        level,
        contains: (lon, lat) => Rectangle.contains(rectangle, Cartographic.fromDegrees(lon, lat)),
        heightAt: (lon, lat) => data.interpolateHeight(rectangle, CesiumMath.toRadians(lon), CesiumMath.toRadians(lat)) ?? 0,
      });
      return data;
    });
  return { provider, tiles };
}

export async function createGlobe(input: GlobeInput): Promise<Globe> {
  const { rig, shape } = input;
  await GroundPrimitive.initializeTerrainHeights();
  const { provider, tiles } = await streamedTerrain(input);
  const credits = document.createElement("div");
  credits.hidden = true;

  const grid = new GridImageryProvider({
    cells: 4,
    color: RULE.withAlpha(0.55),
    glowColor: Color.TRANSPARENT,
    glowWidth: 0,
    backgroundColor: GROUND,
  });
  const widget = new CesiumWidget(input.container, {
    baseLayer: new ImageryLayer(grid),
    terrainProvider: provider,
    skyBox: false,
    skyAtmosphere: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    shouldAnimate: false,
    msaaSamples: 1,
    creditContainer: credits,
  });
  widget.canvas.tabIndex = -1;
  widget.canvas.setAttribute("aria-hidden", "true");
  const scene = widget.scene;
  scene.backgroundColor = PAPER_SUNK;
  scene.globe.baseColor = GROUND;
  scene.globe.showGroundAtmosphere = false;
  scene.globe.depthTestAgainstTerrain = true;
  scene.fog.enabled = true;
  if (scene.sun !== undefined) scene.sun.show = false;
  if (scene.moon !== undefined) scene.moon.show = false;

  const controller = scene.screenSpaceCameraController;
  controller.minimumZoomDistance = 10;
  const inertia = prefersReducedMotion() ? 0 : INERTIA;
  controller.inertiaSpin = inertia;
  controller.inertiaTranslate = inertia;
  controller.inertiaZoom = inertia;
  controller.zoomEventTypes = [CameraEventType.WHEEL, CameraEventType.PINCH];
  controller.tiltEventTypes = [
    CameraEventType.RIGHT_DRAG,
    CameraEventType.MIDDLE_DRAG,
    CameraEventType.PINCH,
    { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
  ];

  let tilesetPending = 0;
  let terrainPending = 0;
  const report = () => input.onStreaming(tilesetPending + terrainPending);
  scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
    terrainPending = queued;
    report();
  });

  if (input.assets.tileset !== null) {
    // No dynamic environment map: the scene has no sky or sun to light from, and its update reads pixels back.
    Cesium3DTileset.fromUrl(input.assetUrl(input.assets.tileset, "tileset.json"), {
      maximumScreenSpaceError: 8,
      environmentMapOptions: { enabled: false },
    })
      .then((tileset) => {
        if (widget.isDestroyed()) return;
        tileset.loadProgress.addEventListener((pending: number, processing: number) => {
          tilesetPending = pending + processing;
          report();
        });
        tileset.allTilesLoaded.addEventListener(() => {
          tilesetPending = 0;
          report();
        });
        scene.primitives.add(tileset);
        scene.requestRender();
      })
      .catch(() => undefined);
  }

  // Corridor furniture: towers, cross-arms and labels, one conductor per span, the centreline on the ground.
  const lines = new PolylineCollection();
  const labels = new LabelCollection();
  scene.primitives.add(lines);
  scene.primitives.add(labels);
  const attachment = (t: (typeof shape.towers)[number]) => Cartesian3.fromDegrees(t.lon_deg, t.lat_deg, t.base_height_m + t.attachment_height_m);
  shape.towers.forEach((tower, i) => {
    const top = attachment(tower);
    lines.add({ positions: [Cartesian3.fromDegrees(tower.lon_deg, tower.lat_deg, tower.base_height_m), top], width: 3, material: colour(INK) });
    const along = pointAt(shape.line, tower.chainage_m + 1, 0);
    const ax = Cartesian3.fromDegrees(along.lonDeg, along.latDeg, tower.base_height_m + tower.attachment_height_m);
    const dir = Cartesian3.normalize(Cartesian3.subtract(ax, top, new Cartesian3()), new Cartesian3());
    const up = Cartesian3.normalize(top, new Cartesian3());
    const side = Cartesian3.multiplyByScalar(Cartesian3.normalize(Cartesian3.cross(dir, up, new Cartesian3()), new Cartesian3()), 6, new Cartesian3());
    lines.add({ positions: [Cartesian3.subtract(top, side, new Cartesian3()), Cartesian3.add(top, side, new Cartesian3())], width: 2.5, material: colour(INK) });
    labels.add({
      position: Cartesian3.fromDegrees(tower.lon_deg, tower.lat_deg, tower.base_height_m + tower.attachment_height_m + 4),
      text: tower.label,
      font: "500 13px 'IBM Plex Mono', monospace",
      fillColor: INK,
      outlineColor: PAPER,
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      horizontalOrigin: HorizontalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const next = shape.towers[i + 1];
    if (next !== undefined) lines.add({ positions: [top, attachment(next)], width: 1.5, material: colour(MUTED) });
  });
  const centreline: Cartesian3[] = [];
  for (let c = 0; c <= shape.lengthM; c += Math.max(10, shape.lengthM / 120)) {
    const p = pointAt(shape.line, c, 0);
    centreline.push(Cartesian3.fromDegrees(p.lonDeg, p.latDeg));
  }
  const end = pointAt(shape.line, shape.lengthM, 0);
  centreline.push(Cartesian3.fromDegrees(end.lonDeg, end.latDeg));
  scene.groundPrimitives.add(
    new GroundPolylinePrimitive({
      geometryInstances: new GeometryInstance({ geometry: new GroundPolylineGeometry({ positions: centreline, width: 2 }), attributes: { color: ColorGeometryInstanceAttribute.fromColor(INK.withAlpha(0.8)) } }),
      appearance: new PolylineColorAppearance(),
      classificationType: ClassificationType.TERRAIN,
    }),
  );

  // Findings, rings and the drone.
  const billboards = new BillboardCollection({ scene });
  const stems = new PolylineCollection();
  const track = new PolylineCollection();
  for (const collection of [stems, track, billboards]) scene.primitives.add(collection);
  const images = {
    violation: glyph("violation", VIOLATION, 26),
    clear: glyph("clear", FOREST, 24),
    ringViolation: glyph("ring", VIOLATION, 46),
    ringClear: glyph("ring", FOREST, 46),
    drone: glyph("drone", INK, 26),
  };
  const drone = billboards.add({ position: Cartesian3.ZERO, image: images.drone, show: false, disableDepthTestDistance: Number.POSITIVE_INFINITY });
  let footprints: GroundPrimitive | null = null;
  let edges: GroundPolylinePrimitive | null = null;
  let markers: Array<{ id: string; marker: Billboard; ring: Billboard; shown: number; target: number }> = [];
  let footprintKey = "";
  let trackKey = "";
  let fadeFrame = 0;

  const fade = () => {
    cancelAnimationFrame(fadeFrame);
    const reduce = prefersReducedMotion();
    let last = performance.now();
    const step = (now: number) => {
      const delta = reduce ? Infinity : (now - last) / RING_FADE_MS;
      last = now;
      let moving = false;
      for (const m of markers) {
        if (m.shown === m.target) continue;
        m.shown = m.target > m.shown ? Math.min(m.target, m.shown + delta) : Math.max(m.target, m.shown - delta);
        m.ring.show = m.shown > 0;
        m.ring.color = Color.WHITE.withAlpha(m.shown);
        moving ||= m.shown !== m.target;
      }
      scene.requestRender();
      if (moving) fadeFrame = requestAnimationFrame(step);
    };
    if (reduce) step(performance.now());
    else fadeFrame = requestAnimationFrame(step);
  };

  const update = (content: SceneContent) => {
    const key = content.findings.map((f) => `${f.id}:${f.lon_deg}:${f.lat_deg}:${f.canopy_top_height_m}:${f.canopy_radius_m}:${f.status}`).join("|");
    if (key !== footprintKey) {
      footprintKey = key;
      if (footprints !== null) scene.groundPrimitives.remove(footprints);
      if (edges !== null) scene.groundPrimitives.remove(edges);
      footprints = null;
      edges = null;
      for (const m of markers) {
        billboards.remove(m.marker);
        billboards.remove(m.ring);
      }
      stems.removeAll();
      markers = [];
      if (content.findings.length > 0) {
        footprints = new GroundPrimitive({
            geometryInstances: content.findings.map(
              (f) =>
                new GeometryInstance({
                  id: f.id,
                  geometry: new EllipseGeometry({
                    center: Cartesian3.fromDegrees(f.lon_deg, f.lat_deg),
                    semiMajorAxis: f.canopy_radius_m,
                    semiMinorAxis: f.canopy_radius_m,
                  }),
                  attributes: { color: ColorGeometryInstanceAttribute.fromColor(statusColour(f.status).withAlpha(0.42)) },
                }),
            ),
            appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
            classificationType: ClassificationType.TERRAIN,
          });
        edges = new GroundPolylinePrimitive({
            geometryInstances: content.findings.map(
              (f) =>
                new GeometryInstance({
                  geometry: new GroundPolylineGeometry({ positions: circle(f.lon_deg, f.lat_deg, f.canopy_radius_m), width: 2.5 }),
                  attributes: { color: ColorGeometryInstanceAttribute.fromColor(statusColour(f.status)) },
                }),
            ),
            appearance: new PolylineColorAppearance(),
            classificationType: ClassificationType.TERRAIN,
          });
        scene.groundPrimitives.add(footprints);
        scene.groundPrimitives.add(edges);
      }
      markers = content.findings.map((f) => {
        const [x, y, z] = toEcef(f.lon_deg, f.lat_deg, f.canopy_top_height_m);
        const top = new Cartesian3(x, y, z);
        const [gx, gy, gz] = f.ecef_m;
        stems.add({ positions: [new Cartesian3(gx, gy, gz), top], width: 1.5, material: colour(statusColour(f.status)) });
        const marker = billboards.add({
          position: top,
          image: f.status === "violation" ? images.violation : images.clear,
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          id: f.id,
        });
        const ring = billboards.add({
          position: new Cartesian3(gx, gy, gz),
          image: f.status === "violation" ? images.ringViolation : images.ringClear,
          show: false,
          color: Color.WHITE.withAlpha(0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        return { id: f.id, marker, ring, shown: 0, target: 0 };
      });
    }
    for (const m of markers) {
      m.target = content.nearIds.has(m.id) ? 1 : 0;
      m.marker.scale = m.id === content.selectedId ? 1.35 : 1;
    }
    fade();

    drone.show = content.drone !== null;
    if (content.drone !== null) drone.position = Cartesian3.fromDegrees(content.drone.lonDeg, content.drone.latDeg, content.drone.heightM);
    const height = content.drone?.heightM;
    const nextTrack = height === undefined ? trackKey : `${height}:${content.covered.map((r) => `${r.from_m}-${r.to_m}`).join(",")}`;
    if (nextTrack !== trackKey) {
      trackKey = nextTrack;
      track.removeAll();
      for (const range of content.covered) {
        const positions: Cartesian3[] = [];
        for (let c = range.from_m; c < range.to_m; c += 20) {
          const p = pointAt(shape.line, c, 0);
          positions.push(Cartesian3.fromDegrees(p.lonDeg, p.latDeg, height));
        }
        const last = pointAt(shape.line, range.to_m, 0);
        positions.push(Cartesian3.fromDegrees(last.lonDeg, last.latDeg, height));
        track.add({ positions, width: 1.5, material: colour(INK.withAlpha(0.85)) });
      }
    }
    scene.requestRender();
  };

  // Camera: the rig owns the pose; gestures feed it back.
  const apply = (pose: Pose) => {
    widget.camera.setView({
      destination: Cartesian3.fromDegrees(pose.lonDeg, pose.latDeg, pose.heightM),
      orientation: { heading: CesiumMath.toRadians(pose.headingDeg), pitch: CesiumMath.toRadians(pose.pitchDeg), roll: 0 },
    });
    scene.requestRender();
  };
  apply(rig.pose);
  const unsubscribe = rig.subscribe((pose, source) => {
    if (source === "rig") apply(pose);
  });
  const removePostRender = scene.postRender.addEventListener(() => {
    const seen = readPose(widget);
    if (!samePose(seen, rig.pose)) rig.takeFromUser(seen);
  });

  const groundAt = (lonDeg: number, latDeg: number) => {
    const at = Cartographic.fromDegrees(lonDeg, latDeg);
    for (let level = 24; level >= 0; level -= 1) {
      const xy = provider.tilingScheme.positionToTileXY(at, level);
      if (xy === undefined) continue;
      const tile = tiles.get(`${level}/${xy.x}/${xy.y}`);
      if (tile === undefined) continue;
      const heightM = tile.data.interpolateHeight(tile.rectangle, at.longitude, at.latitude);
      if (heightM !== undefined) return { heightM, level };
    }
    return null;
  };
  rig.ground = groundAt;

  const handler = new ScreenSpaceEventHandler(widget.canvas);
  handler.setInputAction((event: { position: Cartesian2 }) => {
    const ray = widget.camera.getPickRay(event.position);
    const hit = ray === undefined ? undefined : scene.globe.pick(ray, scene);
    if (hit === undefined) return;
    const at = Cartographic.fromCartesian(hit);
    const lonDeg = CesiumMath.toDegrees(at.longitude);
    const latDeg = CesiumMath.toDegrees(at.latitude);
    const ground = groundAt(lonDeg, latDeg);
    input.onPick({ lonDeg, latDeg, heightM: ground?.heightM ?? at.height, level: ground?.level ?? null });
  }, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  return {
    update,
    groundAt,
    destroy: () => {
      cancelAnimationFrame(fadeFrame);
      unsubscribe();
      removePostRender();
      rig.ground = () => null;
      handler.destroy();
      widget.destroy();
    },
  };
}
