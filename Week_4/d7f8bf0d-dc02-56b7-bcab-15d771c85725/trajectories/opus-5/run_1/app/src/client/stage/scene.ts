import * as THREE from 'three';
import type {
  BlockState,
  LayoutContent,
  SessionSnapshot,
  SnapshotTrain,
} from '../../shared/protocol.js';
import {
  blockStateTexture,
  labelTexture,
  ribbonTexture,
  roofTexture,
  stagePalette,
} from './textures.js';
import {
  blockTracks,
  contentBounds,
  moduleBounds,
  pointOnBlock,
  type BlockTrack,
} from './track.js';

const MM = 0.001;
const TABLE_TOP = 1.0;
const RIBBON_MS_PER_BLOCK = 180;
const RIBBON_MAX_MS = 1440;
const FLAG_RISE_MS = 240;
const TRAIN_GLIDE_MS = 640;
const CAMERA_TURN_MS = 400;
const PIGEON_MS = 3000;

export interface CameraState {
  heading: number;
  zoom: number;
  pan: { x: number; y: number };
}

export interface SelectionState {
  pieceId: string | null;
  endId: string | null;
  trainId: string | null;
  blockId: string | null;
}

export interface StageReport {
  animating: boolean;
  ribbonBlocks: number[];
  previewBlocks: number[];
  limitFlagBlock: number | null;
  blockPoints: Record<number, [number, number]>;
}

interface TrainVisual {
  group: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
}

export class StageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly trackGroup = new THREE.Group();
  private readonly trainGroup = new THREE.Group();
  private readonly ribbonGroup = new THREE.Group();
  private readonly previewGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly hall = new THREE.Group();

  private content: LayoutContent | null = null;
  private tracks = new Map<string, BlockTrack>();
  private blockMeshes = new Map<string, THREE.Mesh>();
  private blockNumbers = new Map<string, number>();
  private signals = new Map<string, THREE.Mesh>();
  private trains = new Map<string, TrainVisual>();
  private readonly stateTextures = new Map<BlockState, THREE.Texture>();
  private readonly ribbonMaterial: THREE.MeshBasicMaterial;

  private centre = new THREE.Vector3();
  private fitDistance = 20;
  private cameraTarget: CameraState = { heading: 0, zoom: 1, pan: { x: 0, y: 0 } };
  private cameraShown: CameraState = { heading: 0, zoom: 1, pan: { x: 0, y: 0 } };
  private cameraFrom: CameraState = { heading: 0, zoom: 1, pan: { x: 0, y: 0 } };
  private cameraStartedAt = 0;

  private ribbonRoute: string[] = [];
  private ribbonStartedAt = 0;
  private ribbonRevision = -1;
  private limitFlag: THREE.Mesh | null = null;
  private previewRoute: string[] = [];
  private pigeon: THREE.Mesh | null = null;
  private pigeonStartedAt = 0;
  private running = true;
  private reducedMotion = false;
  private frame = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly report: (state: StageReport) => void,
    private readonly onPick: (kind: 'train' | 'block' | 'piece' | 'end', id: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(new THREE.Color('#eef2fb'));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.scene.add(this.trackGroup, this.trainGroup, this.ribbonGroup, this.previewGroup, this.markerGroup);
    this.ribbonMaterial = new THREE.MeshBasicMaterial({
      map: ribbonTexture(),
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    for (const state of ['free', 'reserved', 'occupied', 'out_of_service'] as BlockState[]) {
      this.stateTextures.set(state, blockStateTexture(state));
    }
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.buildHall();
    this.resize();
    this.canvas.addEventListener('pointerdown', this.handlePick);
    this.loop();
  }

  private buildHall(): void {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x9fb0d6, 1.05);
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(12, 22, 9);
    this.scene.add(ambient, sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshLambertMaterial({ color: stagePalette.field }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(34, 34, 14, 32, 1, true),
      new THREE.MeshBasicMaterial({ map: roofTexture(), side: THREE.BackSide }),
    );
    roof.position.y = 7;
    this.hall.add(roof);

    const ceiling = new THREE.Mesh(
      new THREE.ConeGeometry(34, 7, 32),
      new THREE.MeshBasicMaterial({ color: '#eef3ff' }),
    );
    ceiling.position.y = 17.5;
    this.hall.add(ceiling);
    this.scene.add(this.hall);

    this.pigeon = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.6, 5),
      new THREE.MeshLambertMaterial({ color: '#8d93ad' }),
    );
    this.pigeon.rotation.z = Math.PI / 2;
    this.pigeon.visible = false;
    this.scene.add(this.pigeon);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Rebuilds the club hall's modules, track and boards from one layout content. */
  setContent(content: LayoutContent): void {
    this.content = content;
    this.trackGroup.clear();
    this.blockMeshes.clear();
    this.signals.clear();
    this.blockNumbers = new Map(content.blocks.map((block) => [block.id, block.number]));
    this.tracks = blockTracks(content);

    for (const module of content.modules) {
      const bounds = moduleBounds(module);
      const width = (bounds.maxX - bounds.minX) * MM;
      const depth = (bounds.maxY - bounds.minY) * MM;
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.09, depth),
        new THREE.MeshLambertMaterial({ color: '#cbbb96' }),
      );
      top.position.set(
        ((bounds.minX + bounds.maxX) / 2) * MM,
        TABLE_TOP,
        ((bounds.minY + bounds.maxY) / 2) * MM,
      );
      this.trackGroup.add(top);

      for (const cornerX of [bounds.minX + 300, bounds.maxX - 300]) {
        for (const cornerY of [bounds.minY + 300, bounds.maxY - 300]) {
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.045, TABLE_TOP, 7),
            new THREE.MeshLambertMaterial({ color: '#8b6f47' }),
          );
          leg.position.set(cornerX * MM, TABLE_TOP / 2, cornerY * MM);
          this.trackGroup.add(leg);
        }
      }
    }

    for (const block of content.blocks) {
      const track = this.tracks.get(block.id);
      if (!track || track.points.length < 2) continue;
      const ballast = new THREE.Mesh(
        this.ribbonGeometry(track, 0.16, 1, -0.01),
        new THREE.MeshLambertMaterial({ color: '#9a9484', side: THREE.DoubleSide }),
      );
      this.trackGroup.add(ballast);

      const mesh = new THREE.Mesh(
        this.ribbonGeometry(track, 0.115, 1),
        new THREE.MeshBasicMaterial({ map: this.stateTextures.get('free'), side: THREE.DoubleSide }),
      );
      mesh.userData = { kind: 'block', id: block.id };
      this.blockMeshes.set(block.id, mesh);
      this.trackGroup.add(mesh);

      for (const side of [-0.033, 0.033]) {
        const rail = new THREE.Mesh(
          this.ribbonGeometry(track, 0.008, 1, 0.012, side),
          new THREE.MeshLambertMaterial({ color: '#8c7a5f', side: THREE.DoubleSide }),
        );
        this.trackGroup.add(rail);
      }

      const tail = track.points[track.points.length - 1];
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5),
        new THREE.MeshLambertMaterial({ color: '#3b4160' }),
      );
      post.position.set(tail.x * MM, TABLE_TOP + 0.19, tail.y * MM);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 8, 8),
        new THREE.MeshBasicMaterial({ color: stagePalette.field }),
      );
      lamp.position.set(tail.x * MM, TABLE_TOP + 0.36, tail.y * MM);
      this.signals.set(block.id, lamp);
      this.trackGroup.add(post, lamp);
    }

    for (const station of content.stations) {
      const first = station.block_ids
        .map((blockId) => this.tracks.get(blockId))
        .find((entry) => entry !== undefined);
      if (!first) continue;
      const anchor = pointOnBlock(first, first.lengthMm / 2);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.28),
        new THREE.MeshBasicMaterial({ map: labelTexture(station.name), transparent: false }),
      );
      board.position.set(anchor.x * MM, TABLE_TOP + 0.42, anchor.y * MM - 0.45);
      board.userData = { kind: 'station', id: station.id };
      this.trackGroup.add(board);
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.3, 0.03),
        new THREE.MeshLambertMaterial({ color: '#3b4160' }),
      );
      stand.position.set(anchor.x * MM, TABLE_TOP + 0.15, anchor.y * MM - 0.45);
      this.trackGroup.add(stand);
    }

    const bounds = contentBounds(content);
    this.centre = new THREE.Vector3(bounds.centreX * MM, TABLE_TOP, bounds.centreY * MM);
    this.fitDistance = Math.max(4, Math.hypot(bounds.spanX, bounds.spanY) * MM * 0.58);
    this.hall.position.set(this.centre.x, 0, this.centre.z);
    this.pigeonStartedAt = performance.now();
    if (this.pigeon) this.pigeon.visible = !this.reducedMotion;
    this.frame = 0;
  }

  private ribbonGeometry(
    track: BlockTrack,
    halfWidth: number,
    portion: number,
    lift = 0,
    offset = 0,
  ): THREE.BufferGeometry {
    const points = track.points;
    const count = Math.max(2, Math.ceil(points.length * portion));
    const positions: number[] = [];
    const uvs: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const point = points[Math.min(index, points.length - 1)];
      const next = points[Math.min(index + 1, points.length - 1)];
      const previous = points[Math.max(index - 1, 0)];
      const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
      const nx = -Math.sin(angle) * halfWidth;
      const ny = Math.cos(angle) * halfWidth;
      const cx = point.x * MM - Math.sin(angle) * offset;
      const cy = point.y * MM + Math.cos(angle) * offset;
      const height = TABLE_TOP + 0.06 + point.elevation * MM + lift;
      positions.push(cx + nx, height, cy + ny);
      positions.push(cx - nx, height, cy - ny);
      const u = index / Math.max(1, count - 1);
      uvs.push(u, 0, u, 1);
    }
    const indices: number[] = [];
    for (let index = 0; index + 1 < count; index += 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private buildStock(train: SnapshotTrain): THREE.Group {
    const group = new THREE.Group();
    const length = Math.max(0.3, train.length_mm * MM);
    const hue = (Number.parseInt(train.number, 10) * 47) % 360;
    const colour = new THREE.Color().setHSL(hue / 360, 0.55, 0.45);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.9, 0.11, 0.1),
      new THREE.MeshLambertMaterial({ color: colour }),
    );
    body.position.y = 0.085;
    const roofPlate = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.88, 0.02, 0.095),
      new THREE.MeshLambertMaterial({ color: '#30364f' }),
    );
    roofPlate.position.y = 0.15;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.22, 0.07, 0.09),
      new THREE.MeshLambertMaterial({ color: '#f5b81f' }),
    );
    cab.position.set(length * 0.32, 0.19, 0);
    group.add(body, roofPlate, cab);
    for (const offset of [-length * 0.3, 0, length * 0.3]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.105, 8),
        new THREE.MeshLambertMaterial({ color: '#23283c' }),
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(offset, 0.028, 0);
      group.add(wheel);
    }
    group.userData = { kind: 'train', id: train.id };
    return group;
  }

  private trainPlace(train: SnapshotTrain): { position: THREE.Vector3; heading: number } | null {
    const track = this.tracks.get(train.head_block_id);
    if (!track) return null;
    const point = pointOnBlock(track, train.head_offset_mm);
    return {
      position: new THREE.Vector3(
        point.x * MM,
        TABLE_TOP + 0.055 + point.elevation * MM,
        point.y * MM,
      ),
      heading: point.heading,
    };
  }

  setSession(snapshot: SessionSnapshot | null): void {
    if (!snapshot) {
      this.trainGroup.clear();
      this.trains.clear();
      this.ribbonGroup.clear();
      this.ribbonRoute = [];
      return;
    }

    for (const block of snapshot.blocks) {
      const mesh = this.blockMeshes.get(block.id);
      if (mesh) {
        const material = mesh.material as THREE.MeshBasicMaterial;
        const texture = this.stateTextures.get(block.state);
        if (material.map !== texture) {
          material.map = texture ?? null;
          material.needsUpdate = true;
        }
      }
      const lamp = this.signals.get(block.id);
      if (lamp) {
        const colour =
          block.state === 'free'
            ? stagePalette.field
            : block.state === 'reserved'
              ? stagePalette.accent
              : block.state === 'occupied'
                ? stagePalette.action
                : stagePalette.ink;
        (lamp.material as THREE.MeshBasicMaterial).color.set(colour);
      }
    }

    const seen = new Set<string>();
    for (const train of snapshot.trains) {
      seen.add(train.id);
      const place = this.trainPlace(train);
      if (!place) continue;
      let visual = this.trains.get(train.id);
      if (!visual) {
        const group = this.buildStock(train);
        group.position.copy(place.position);
        this.trainGroup.add(group);
        visual = { group, from: place.position.clone(), to: place.position.clone(), startedAt: 0 };
        this.trains.set(train.id, visual);
      }
      if (!visual.to.equals(place.position)) {
        visual.from = visual.group.position.clone();
        visual.to = place.position.clone();
        visual.startedAt = performance.now();
      }
      visual.group.rotation.y = -(place.heading * Math.PI) / 180;
      if (this.reducedMotion) {
        visual.group.position.copy(place.position);
        visual.startedAt = 0;
      }
    }
    for (const [trainId, visual] of this.trains) {
      if (seen.has(trainId)) continue;
      this.trainGroup.remove(visual.group);
      this.trains.delete(trainId);
    }

    const granted = snapshot.authorities.find((authority) => authority.state === 'Granted');
    const route = granted ? granted.block_ids : [];
    const refused =
      !granted && snapshot.authorities.length > 0
        ? snapshot.authorities[snapshot.authorities.length - 1]
        : null;
    const shownRoute =
      route.length > 0
        ? route
        : refused && refused.state === 'Refused'
          ? refused.block_ids.slice(
              0,
              Math.max(0, refused.block_ids.indexOf(refused.limit_block_id)),
            )
          : [];

    if (snapshot.revision !== this.ribbonRevision) {
      this.ribbonRevision = snapshot.revision;
      if (this.ribbonRoute.join(',') !== shownRoute.join(',')) {
        this.ribbonRoute = shownRoute;
        this.ribbonStartedAt = performance.now();
        this.rebuildRibbon(1);
      }
    }
    this.limitFlagBlockId = granted ? granted.limit_block_id : null;
  }

  private limitFlagBlockId: string | null = null;

  private rebuildRibbon(progress: number): void {
    this.ribbonGroup.clear();
    this.limitFlag = null;
    const shown = this.ribbonRoute.length * progress;
    for (let index = 0; index < this.ribbonRoute.length; index += 1) {
      const portion = Math.max(0, Math.min(1, shown - index));
      if (portion <= 0) continue;
      const track = this.tracks.get(this.ribbonRoute[index]);
      if (!track || track.points.length < 2) continue;
      const mesh = new THREE.Mesh(
        this.ribbonGeometry(track, 0.055, portion, 0.012),
        this.ribbonMaterial,
      );
      this.ribbonGroup.add(mesh);
    }
    if (progress >= 1 && this.limitFlagBlockId) {
      const track = this.tracks.get(this.limitFlagBlockId);
      if (track) {
        const point = pointOnBlock(track, track.lengthMm);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.22, 0.14),
          new THREE.MeshBasicMaterial({ color: stagePalette.action }),
        );
        flag.position.set(point.x * MM, TABLE_TOP + 0.3, point.y * MM);
        this.limitFlag = flag;
        this.ribbonGroup.add(flag);
      }
    }
  }

  setPreview(blockIds: string[]): void {
    if (this.previewRoute.join(',') === blockIds.join(',')) return;
    this.previewRoute = blockIds;
    this.previewGroup.clear();
    for (const blockId of blockIds) {
      const track = this.tracks.get(blockId);
      if (!track || track.points.length < 2) continue;
      const mesh = new THREE.Mesh(
        this.ribbonGeometry(track, 0.035, 1, 0.02),
        new THREE.MeshBasicMaterial({
          color: stagePalette.accentDeep,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      this.previewGroup.add(mesh);
    }
  }

  setSelection(selection: SelectionState): void {
    this.markerGroup.clear();
    if (!this.content) return;
    for (const module of this.content.modules) {
      for (const end of module.open_ends) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(end.id === selection.endId ? 0.075 : 0.05, 10, 10),
          new THREE.MeshBasicMaterial({
            color: end.id === selection.endId ? stagePalette.action : stagePalette.accentDeep,
          }),
        );
        marker.position.set(end.x_mm * MM, TABLE_TOP + 0.09 + end.elevation_mm * MM, end.y_mm * MM);
        marker.userData = { kind: 'end', id: end.id };
        this.markerGroup.add(marker);
      }
      if (!selection.pieceId) continue;
      const piece = module.pieces.find((entry) => entry.id === selection.pieceId);
      if (!piece) continue;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.1, 0.018, 8, 18),
        new THREE.MeshBasicMaterial({ color: stagePalette.action }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(
        piece.end.x_mm * MM,
        TABLE_TOP + 0.07 + piece.end.elevation_mm * MM,
        piece.end.y_mm * MM,
      );
      this.markerGroup.add(ring);
    }
  }

  setCamera(state: CameraState): void {
    if (
      state.heading === this.cameraTarget.heading &&
      state.zoom === this.cameraTarget.zoom &&
      state.pan.x === this.cameraTarget.pan.x &&
      state.pan.y === this.cameraTarget.pan.y
    ) {
      return;
    }
    this.cameraFrom = { ...this.cameraShown, pan: { ...this.cameraShown.pan } };
    this.cameraTarget = { ...state, pan: { ...state.pan } };
    this.cameraStartedAt = performance.now();
    if (this.reducedMotion) {
      this.cameraShown = { ...state, pan: { ...state.pan } };
      this.cameraStartedAt = 0;
    }
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private handlePick = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects(
      [...this.markerGroup.children, ...this.trainGroup.children, ...this.trackGroup.children],
      true,
    );
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const data = node.userData as { kind?: string; id?: string };
        if (data.kind === 'end' && data.id) {
          this.onPick('end', data.id);
          return;
        }
        if (data.kind === 'train' && data.id) {
          this.onPick('train', data.id);
          return;
        }
        if (data.kind === 'block' && data.id) {
          this.onPick('block', data.id);
          return;
        }
        node = node.parent;
      }
    }
  };

  private project(point: THREE.Vector3): [number, number] {
    const projected = point.clone().project(this.camera);
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    return [
      Math.round(((projected.x + 1) / 2) * width),
      Math.round(((1 - projected.y) / 2) * height),
    ];
  }

  private ease(t: number): number {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped < 0.5
      ? 2 * clamped * clamped
      : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    let animating = false;

    if (this.cameraStartedAt > 0) {
      const t = this.ease((now - this.cameraStartedAt) / CAMERA_TURN_MS);
      const shortest = (from: number, to: number): number => {
        const delta = ((to - from + 540) % 360) - 180;
        return from + delta * t;
      };
      this.cameraShown = {
        heading: shortest(this.cameraFrom.heading, this.cameraTarget.heading),
        zoom: this.cameraFrom.zoom + (this.cameraTarget.zoom - this.cameraFrom.zoom) * t,
        pan: {
          x: this.cameraFrom.pan.x + (this.cameraTarget.pan.x - this.cameraFrom.pan.x) * t,
          y: this.cameraFrom.pan.y + (this.cameraTarget.pan.y - this.cameraFrom.pan.y) * t,
        },
      };
      if (t >= 1) {
        this.cameraStartedAt = 0;
        this.cameraShown = { ...this.cameraTarget, pan: { ...this.cameraTarget.pan } };
      } else {
        animating = true;
      }
    }

    const radians = (this.cameraShown.heading * Math.PI) / 180;
    const distance = this.fitDistance / Math.max(0.2, this.cameraShown.zoom);
    const target = this.centre
      .clone()
      .add(new THREE.Vector3(this.cameraShown.pan.x, 0, this.cameraShown.pan.y));
    this.camera.position.set(
      target.x + Math.sin(radians) * distance,
      target.y + distance * 0.5,
      target.z + Math.cos(radians) * distance,
    );
    this.camera.lookAt(target);

    for (const visual of this.trains.values()) {
      if (visual.startedAt === 0) continue;
      const t = this.ease((now - visual.startedAt) / TRAIN_GLIDE_MS);
      visual.group.position.lerpVectors(visual.from, visual.to, t);
      if (t >= 1) visual.startedAt = 0;
      else animating = true;
    }

    if (this.ribbonStartedAt > 0 && this.ribbonRoute.length > 0) {
      const span = Math.min(this.ribbonRoute.length * RIBBON_MS_PER_BLOCK, RIBBON_MAX_MS);
      const t = this.reducedMotion ? 1 : this.ease((now - this.ribbonStartedAt) / span);
      this.rebuildRibbon(t);
      if (t >= 1) this.ribbonStartedAt = 0;
      else animating = true;
    }

    if (this.limitFlag && this.ribbonStartedAt === 0 && !this.reducedMotion) {
      const since = now - (this.ribbonStartedAt || now);
      this.limitFlag.scale.y = Math.min(1, Math.max(0.1, since / FLAG_RISE_MS) || 1);
    }

    if (this.pigeon && this.pigeon.visible) {
      const t = (now - this.pigeonStartedAt) / PIGEON_MS;
      if (t >= 1) this.pigeon.visible = false;
      else {
        this.pigeon.position.set(
          this.centre.x - 24 + t * 48,
          8 + Math.sin(t * Math.PI) * 1.6,
          this.centre.z - 7,
        );
        animating = true;
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.frame += 1;

    if (this.frame % 4 === 1 || animating) {
      const blockPoints: Record<number, [number, number]> = {};
      for (const [blockId, track] of this.tracks) {
        const number = this.blockNumbers.get(blockId);
        if (number === undefined) continue;
        const middle = pointOnBlock(track, track.lengthMm / 2);
        blockPoints[number] = this.project(
          new THREE.Vector3(middle.x * MM, TABLE_TOP + 0.05, middle.y * MM),
        );
      }
      this.report({
        animating,
        ribbonBlocks: this.ribbonRoute
          .map((blockId) => this.blockNumbers.get(blockId) ?? 0)
          .filter((number) => number > 0),
        previewBlocks: this.previewRoute
          .map((blockId) => this.blockNumbers.get(blockId) ?? 0)
          .filter((number) => number > 0),
        limitFlagBlock: this.limitFlagBlockId
          ? this.blockNumbers.get(this.limitFlagBlockId) ?? null
          : null,
        blockPoints,
      });
    }

    requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.running = false;
    this.canvas.removeEventListener('pointerdown', this.handlePick);
    this.renderer.dispose();
  }
}
