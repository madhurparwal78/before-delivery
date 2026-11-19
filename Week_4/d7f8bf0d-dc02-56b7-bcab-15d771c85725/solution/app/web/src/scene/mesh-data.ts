import { BufferAttribute, BufferGeometry } from 'three'

export interface Pt { x: number; y: number; z: number }

// Left and right offsets of a polyline in the ground plane, averaging the tangents at joints.
export function offsetEdges(points: Pt[], halfWidth: number): { left: Pt[]; right: Pt[]; distance: number[] } {
  const left: Pt[] = []
  const right: Pt[] = []
  const distance: number[] = [0]
  for (let i = 0; i < points.length; i += 1) {
    const a = points[Math.max(i - 1, 0)]
    const b = points[Math.min(i + 1, points.length - 1)]
    const tx = b.x - a.x
    const tz = b.z - a.z
    const length = Math.hypot(tx, tz) || 1
    const nx = tz / length
    const nz = -tx / length
    left.push({ x: points[i].x + nx * halfWidth, y: points[i].y, z: points[i].z + nz * halfWidth })
    right.push({ x: points[i].x - nx * halfWidth, y: points[i].y, z: points[i].z - nz * halfWidth })
    if (i > 0) distance.push(distance[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z))
  }
  return { left, right, distance }
}

// Growable indexed geometry: strips along polylines and vertical skirts.
export class MeshData {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly uvs: number[] = []
  readonly indices: number[] = []

  get empty(): boolean {
    return this.indices.length === 0
  }

  private vertex(p: Pt, n: [number, number, number], u: number, v: number): number {
    this.positions.push(p.x, p.y, p.z)
    this.normals.push(n[0], n[1], n[2])
    this.uvs.push(u, v)
    return this.positions.length / 3 - 1
  }

  addStrip(points: Pt[], halfWidth: number, period: number): void {
    if (points.length < 2) return
    const { left, right, distance } = offsetEdges(points, halfWidth)
    let previous = -1
    for (let i = 0; i < points.length; i += 1) {
      const a = this.vertex(left[i], [0, 1, 0], 0, distance[i] / period)
      const b = this.vertex(right[i], [0, 1, 0], 1, distance[i] / period)
      if (previous >= 0) this.indices.push(previous, previous + 1, a, previous + 1, b, a)
      previous = a
    }
  }

  // Vertical wall hanging `depth` below the edge of a strip.
  addSkirt(points: Pt[], halfWidth: number, depth: number): void {
    if (points.length < 2) return
    const { left, right } = offsetEdges(points, halfWidth)
    for (const [edge, sign] of [[left, 1], [right, -1]] as const) {
      let previous = -1
      for (let i = 0; i < edge.length; i += 1) {
        const a = this.positions.length / 3
        const nx = (edge[i].x - points[i].x) / halfWidth
        const nz = (edge[i].z - points[i].z) / halfWidth
        this.vertex(edge[i], [nx, 0, nz], 0, 0)
        this.vertex({ ...edge[i], y: edge[i].y - depth }, [nx, 0, nz], 1, 0)
        if (previous >= 0) {
          if (sign > 0) this.indices.push(previous, previous + 1, a, previous + 1, a + 1, a)
          else this.indices.push(previous, a, previous + 1, previous + 1, a, a + 1)
        }
        previous = a
      }
    }
  }

  toGeometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2))
    geometry.setIndex(this.indices)
    return geometry
  }
}
