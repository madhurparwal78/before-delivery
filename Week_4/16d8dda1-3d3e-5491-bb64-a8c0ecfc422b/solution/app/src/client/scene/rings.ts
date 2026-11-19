import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { BRICK, SLATE } from './geometry';
import { Transition } from './tween';

const SEGMENTS = 96;
const INNER = 0.9;
const OUTER = 1.0;

/** The floor ring of a breakout table: full at the start, draining clockwise from 12 o'clock to empty. */
export class Ring {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** Eases the drawn fullness towards the true fullness after an extension (0 = still at the old value). */
  readonly refill = new Transition(1);
  drawn = 1;
  private from = 1;

  constructor(centre: Vector3) {
    const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      positions.set([Math.sin(angle) * INNER, 0, -Math.cos(angle) * INNER], i * 6);
      positions.set([Math.sin(angle) * OUTER, 0, -Math.cos(angle) * OUTER], i * 6 + 3);
      if (i < SEGMENTS) {
        const inner = i * 2;
        indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, new MeshBasicMaterial({ color: SLATE, side: DoubleSide }));
    this.mesh.position.set(centre.x, 0.02, centre.z);
  }

  startRefill(now: number, duration: number): void {
    this.from = this.drawn;
    this.refill.value = 0;
    this.refill.retarget(1, now, duration);
  }

  /** Draws `actual` (0 to 1) of the ring, blended from the old fullness while a refill runs. */
  draw(actual: number, urgent: boolean): void {
    this.drawn = this.from + (actual - this.from) * this.refill.value;
    const visible = Math.ceil(Math.max(0, Math.min(1, this.drawn)) * SEGMENTS);
    this.mesh.geometry.setDrawRange((SEGMENTS - visible) * 6, visible * 6);
    this.mesh.visible = visible > 0;
    this.mesh.material.color.set(urgent ? BRICK : SLATE);
  }
}
