/**
 * The print-ready derivative: binary STL, in millimetres, Z up.
 * STL x = GLB x × 1000, STL y = −GLB z × 1000, STL z = GLB y × 1000.
 */

const MM_PER_METRE = 1000;

function stlPoint(x: number, y: number, z: number): [number, number, number] {
  return [x * MM_PER_METRE, -z * MM_PER_METRE, y * MM_PER_METRE];
}

/** Takes triangles in GLB metres, nine numbers per triangle. */
export function writeBinaryStl(triangles: Float32Array): Buffer {
  const count = Math.floor(triangles.length / 9);
  const out = Buffer.alloc(84 + count * 50);
  out.write('Turnstone Studio binary STL in millimetres', 0, 'ascii');
  out.writeUInt32LE(count, 80);

  for (let t = 0; t < count; t += 1) {
    const base = t * 9;
    const a = stlPoint(
      triangles[base] ?? 0,
      triangles[base + 1] ?? 0,
      triangles[base + 2] ?? 0,
    );
    const b = stlPoint(
      triangles[base + 3] ?? 0,
      triangles[base + 4] ?? 0,
      triangles[base + 5] ?? 0,
    );
    const c = stlPoint(
      triangles[base + 6] ?? 0,
      triangles[base + 7] ?? 0,
      triangles[base + 8] ?? 0,
    );

    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
    }

    let offset = 84 + t * 50;
    for (const value of [nx, ny, nz, ...a, ...b, ...c]) {
      out.writeFloatLE(value, offset);
      offset += 4;
    }
    out.writeUInt16LE(0, offset);
  }
  return out;
}
