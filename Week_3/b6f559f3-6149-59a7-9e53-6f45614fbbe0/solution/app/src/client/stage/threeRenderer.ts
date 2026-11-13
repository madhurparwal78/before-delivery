/** The WebGL2 renderer: three.js drawing the solids with the shared camera math. */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshMatcapMaterial,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer,
  type Material,
} from 'three';
import { multiplyMatrices } from '../../shared/quaternion';
import { projectionMatrix, viewMatrix, type Artboard, type Camera, type Mat4 } from '../../shared/projection';
import { bool, num, str } from '../../shared/evaluator/resolve';
import { glassIor, isGlass } from '../../shared/evaluator/solids';
import { layerMatrix, type DrawItem, type Part } from './display';
import { environmentTexture, matcapTexture } from './textures';

interface Record_ {
  signature: string;
  objects: Object3D[];
  dynamic: { part: Part; geometry: BufferGeometry }[];
  material: Material;
  materialKey: string;
}

const staticGeometry = new Map<string, BufferGeometry>();

function geometryOf(part: Extract<Part, { kind: 'mesh' }>): BufferGeometry {
  const build = (): BufferGeometry => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(part.mesh.normals, 3));
    if (part.mesh.indices) geometry.setIndex(new BufferAttribute(part.mesh.indices, 1));
    return geometry;
  };
  if (part.key === null) return build();
  let geometry = staticGeometry.get(part.key);
  if (!geometry) {
    geometry = build();
    staticGeometry.set(part.key, geometry);
  }
  return geometry;
}

const partSignature = (part: Part): string =>
  part.kind === 'mesh' ? `m:${part.key ?? 'dyn'}:${part.mesh.positions.length}` : `${part.kind}:${part.positions.length}`;

export class ThreeStage {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly records = new Map<string, Record_>();
  private readonly matrix = new Matrix4();
  private environmentName = '';

  private constructor(private readonly renderer: WebGLRenderer) {
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
  }

  /** A WebGL2 stage on `canvas`, or null when the browser cannot give one. */
  static create(canvas: HTMLCanvasElement): ThreeStage | null {
    try {
      const attributes: WebGLContextAttributes = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'default' };
      // Asking for the context first keeps three.js from logging a console error when WebGL2 is unavailable.
      const context = canvas.getContext('webgl2', attributes);
      if (!context) return null;
      const renderer = new WebGLRenderer({ canvas, context, ...attributes });
      renderer.setClearColor(0x000000, 0);
      return new ThreeStage(renderer);
    } catch {
      return null;
    }
  }

  resize(width: number, height: number, dpr: number): void {
    this.renderer.setPixelRatio(Math.min(dpr, 2));
    this.renderer.setSize(width, height, false);
  }

  private materialFor(item: DrawItem): { material: Material; key: string } {
    const { values } = item.solid;
    const glass = isGlass(values);
    const key = glass ? 'glass' : `matcap:${str(values, 'material.matcap', 'Clay')}`;
    return { key, material: glass ? new MeshPhysicalMaterial({ roughness: 0.05, metalness: 0, transparent: true }) : new MeshMatcapMaterial({ transparent: true }) };
  }

  private updateMaterial(material: Material, item: DrawItem, environment: string): void {
    const { values } = item.solid;
    const opacity = num(values, 'material.opacity', 1);
    const side = item.pass === 'back' ? BackSide : item.pass === 'front' ? FrontSide : FrontSide;
    const base = material as MeshMatcapMaterial & MeshPhysicalMaterial & PointsMaterial;
    base.color = new Color(str(values, 'material.color', '#FFFFFF'));
    base.opacity = opacity;
    base.transparent = true;
    base.depthTest = item.depthTest;
    base.depthWrite = item.depthTest && opacity >= 0.999;
    base.side = item.pass === 'single' && str(values, 'faces', 'front') === 'both' ? DoubleSide : side;
    if (material instanceof MeshPhysicalMaterial) {
      material.ior = Math.min(glassIor(values), 2.333);
      material.envMap = environmentTexture(environment);
      material.envMapIntensity = 1.3;
    } else if (material instanceof MeshMatcapMaterial) {
      material.matcap = matcapTexture(str(values, 'material.matcap', 'Clay'));
    }
  }

  private build(item: DrawItem, parts: Part[], environment: string): Record_ {
    const { material, key } = this.materialFor(item);
    this.updateMaterial(material, item, environment);
    const objects: Object3D[] = [];
    const dynamic: Record_['dynamic'] = [];
    for (const part of parts) {
      let object: Object3D;
      if (part.kind === 'mesh') {
        const geometry = geometryOf(part);
        if (part.key === null) dynamic.push({ part, geometry });
        object = new Mesh(geometry, material);
      } else {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(part.positions, 3));
        dynamic.push({ part, geometry });
        object =
          part.kind === 'points'
            ? new Points(geometry, new PointsMaterial({ size: 0.06, sizeAttenuation: true, transparent: true }))
            : new LineSegments(geometry, new LineBasicMaterial({ transparent: true, opacity: 0.55 }));
      }
      object.matrixAutoUpdate = false;
      object.frustumCulled = false;
      this.scene.add(object);
      objects.push(object);
    }
    return { signature: '', objects, dynamic, material, materialKey: key };
  }

  private dispose(record: Record_): void {
    for (const object of record.objects) {
      this.scene.remove(object);
      if (object instanceof Points || object instanceof LineSegments) {
        object.geometry.dispose();
        (object.material as Material).dispose();
      } else if (record.dynamic.some((d) => d.geometry === (object as Mesh).geometry)) (object as Mesh).geometry.dispose();
    }
    record.material.dispose();
  }

  render(items: readonly DrawItem[], partsOf: (item: DrawItem) => Part[], camera: Camera, artboard: Artboard, environment: string): void {
    if (environment !== this.environmentName) {
      this.environmentName = environment;
      this.scene.environment = environmentTexture(environment);
    }
    const seen = new Set<string>();
    items.forEach((item, order) => {
      const id = `${item.solid.rl.layer.id}:${item.pass}`;
      seen.add(id);
      const parts = partsOf(item);
      const { key } = this.materialFor(item);
      const signature = `${key}|${parts.map(partSignature).join(',')}`;
      let record = this.records.get(id);
      if (!record || record.signature !== signature) {
        if (record) this.dispose(record);
        record = this.build(item, parts, environment);
        record.signature = signature;
        this.records.set(id, record);
      }
      this.updateMaterial(record.material, item, environment);
      const layer = layerMatrix(item.solid);
      parts.forEach((part, i) => {
        const object = record.objects[i] as Object3D;
        const world: Mat4 = part.kind === 'mesh' ? multiplyMatrices(layer, part.local) : layer;
        this.matrix.fromArray(world);
        object.matrix.copy(this.matrix);
        object.matrixWorld.copy(this.matrix);
        object.matrixWorldNeedsUpdate = false;
        object.renderOrder = order;
        const material = (object as Mesh).material as Material;
        if (part.kind !== 'mesh') {
          const colour = new Color(str(item.solid.values, 'material.color', '#FFFFFF'));
          (material as PointsMaterial).color = colour;
          (material as PointsMaterial).depthTest = item.depthTest;
          if (part.kind === 'points') (material as PointsMaterial).opacity = bool(item.solid.values, 'visible', true) ? num(item.solid.values, 'material.opacity', 1) : 0;
        }
      });
      for (const { part, geometry } of record.dynamic) {
        if (part.kind === 'mesh' && part.key === null) {
          geometry.getAttribute('position').array.set(part.mesh.positions);
          geometry.getAttribute('normal').array.set(part.mesh.normals);
          geometry.getAttribute('position').needsUpdate = true;
          geometry.getAttribute('normal').needsUpdate = true;
        } else if (part.kind !== 'mesh') {
          geometry.getAttribute('position').array.set(part.positions);
          geometry.getAttribute('position').needsUpdate = true;
        }
      }
    });
    for (const [id, record] of this.records) {
      if (seen.has(id)) continue;
      this.dispose(record);
      this.records.delete(id);
    }
    this.camera.projectionMatrix.fromArray(projectionMatrix(camera, artboard));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.matrixWorldInverse.fromArray(viewMatrix(camera));
    this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
    this.renderer.render(this.scene, this.camera);
  }

  clear(): void {
    this.renderer.clear();
  }

  destroy(): void {
    for (const record of this.records.values()) this.dispose(record);
    this.records.clear();
    this.renderer.dispose();
  }
}
