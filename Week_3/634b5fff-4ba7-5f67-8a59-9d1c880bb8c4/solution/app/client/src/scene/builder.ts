import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
  type ColorRepresentation,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const matrix = new Matrix4();
const rotation = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3();
const tint = new Color();

/**
 * Collects primitives, bakes a placement and a vertex colour into each, and merges them into one geometry
 * (one draw call). Colours are given as sRGB hex and stored in the linear working space; a primitive that already
 * carries a `color` attribute keeps it.
 */
export class GeoBuilder {
  private readonly parts: BufferGeometry[] = [];

  constructor(private readonly planarUv = false) {}

  add(source: BufferGeometry, color: ColorRepresentation, at: Placement = {}, shade = 1): this {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv" && name !== "color") geometry.deleteAttribute(name);
    }
    euler.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0);
    rotation.setFromEuler(euler);
    position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0);
    scale.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1);
    matrix.compose(position, rotation, scale);
    geometry.applyMatrix4(matrix);
    if (!geometry.hasAttribute("color")) {
      const count = geometry.getAttribute("position").count;
      tint.set(color).multiplyScalar(shade);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        colors[i * 3] = tint.r;
        colors[i * 3 + 1] = tint.g;
        colors[i * 3 + 2] = tint.b;
      }
      geometry.setAttribute("color", new BufferAttribute(colors, 3));
    }
    if (this.planarUv) this.projectUv(geometry);
    else geometry.deleteAttribute("uv");
    this.parts.push(geometry);
    return this;
  }

  box(w: number, h: number, d: number, color: ColorRepresentation, at: Placement = {}, shade = 1): this {
    return this.add(new BoxGeometry(w, h, d), color, at, shade);
  }

  cylinder(top: number, bottom: number, h: number, color: ColorRepresentation, at: Placement = {}, segments = 12, shade = 1): this {
    return this.add(new CylinderGeometry(top, bottom, h, segments), color, at, shade);
  }

  ball(radius: number, color: ColorRepresentation, at: Placement = {}, shade = 1, segments = 12): this {
    return this.add(new SphereGeometry(radius, segments, Math.max(6, segments >> 1)), color, at, shade);
  }

  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    return merged;
  }

  /** Planar texture coordinates from the dominant axis of each face, so one grain texture tiles in world space. */
  private projectUv(geometry: BufferGeometry): void {
    const positions = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const uv = new Float32Array(positions.count * 2);
    const step = 1 / 5;
    for (let i = 0; i < positions.count; i += 1) {
      const nx = Math.abs(normals.getX(i));
      const ny = Math.abs(normals.getY(i));
      const nz = Math.abs(normals.getZ(i));
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      if (ny >= nx && ny >= nz) {
        uv[i * 2] = x * step;
        uv[i * 2 + 1] = z * step;
      } else if (nx >= nz) {
        uv[i * 2] = z * step;
        uv[i * 2 + 1] = y * step;
      } else {
        uv[i * 2] = x * step;
        uv[i * 2 + 1] = y * step;
      }
    }
    geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  }
}
