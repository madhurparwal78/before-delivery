import type { Confirmed } from '../../shared/api';
import type { Mesh } from './kernel';

type Figures = Omit<Confirmed, 'build' | 'object_key'>;

/** Volume, surface area, centroid and mass computed from the stored triangles (signed tetrahedra against the origin). */
export function massProperties(mesh: Mesh, densityGPerCm3: number): Figures {
  let volume = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    const [ax, ay, az] = mesh.vertices[ia] as [number, number, number];
    const [bx, by, bz] = mesh.vertices[ib] as [number, number, number];
    const [qx, qy, qz] = mesh.vertices[ic] as [number, number, number];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = qx - ax, vy = qy - ay, vz = qz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const sixVolume = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    volume += sixVolume / 6;
    cx += (sixVolume * (ax + bx + qx)) / 24;
    cy += (sixVolume * (ay + by + qy)) / 24;
    cz += (sixVolume * (az + bz + qz)) / 24;
  }
  return {
    volume_mm3: volume,
    area_mm2: area,
    centroid_mm: { x: cx / volume, y: cy / volume, z: cz / volume },
    mass_g: (densityGPerCm3 * volume) / 1000,
  };
}
