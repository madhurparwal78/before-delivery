/** An island drawn as an island: sloping beaches, a sunk water border, a pond, rocks, and a shore-distance field for the water. */
import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, Group, LinearFilter, Mesh, MeshLambertMaterial, RedFormat,
  UnsignedByteType,
} from 'three'
import { GRID, type Island, tileKind } from '../../shared/island'
import { hash2 } from './common'

export interface Palette {
  grass: [number, number]
  sand: number
  stone: number
  water: number
  shallow: number
  bush: number
  flowers: number[]
  trunk: number
  leaf: [number, number]
  /** Share of edge-ring tiles that carry a tree. */
  trees: number
}

export const PALETTES: Record<number, Palette> = {
  1: { grass: [0x6f9a52, 0x86a95a], sand: 0xd9c690, stone: 0x8f918c, water: 0x245f86, shallow: 0x4cb0b8, bush: 0x4f7d45, flowers: [0xf4f1e6, 0xf2c14e], trunk: 0x6b5236, leaf: [0x4d8a4a, 0x6aa04e], trees: 0.3 },
  2: { grass: [0x3f7d3c, 0x58914a], sand: 0xb7a577, stone: 0x6d7266, water: 0x1f5c60, shallow: 0x3fa39a, bush: 0x2f6a38, flowers: [0xb98ad8, 0xf0d96a], trunk: 0x5b4630, leaf: [0x2f7438, 0x4a8d3f], trees: 0.62 },
  3: { grass: [0x92b56c, 0xa9c47a], sand: 0xe8dba6, stone: 0xb7b9b0, water: 0x23829a, shallow: 0x62d0c8, bush: 0x6f9a62, flowers: [0xff9f80, 0xfff1c9], trunk: 0x8a7655, leaf: [0x7fae6a, 0x9fc47a], trees: 0.18 },
  4: { grass: [0x7d8f6b, 0x93a37c], sand: 0xbdb394, stone: 0x777a78, water: 0x2b5875, shallow: 0x5c9eb0, bush: 0x66765a, flowers: [0xe8e4ff, 0xd6a8e8], trunk: 0x59493a, leaf: [0x4f6f56, 0x688565], trees: 0.4 },
  5: { grass: [0x9aa05a, 0xb2b266], sand: 0xe0c98a, stone: 0x8d8a7e, water: 0x1f507f, shallow: 0x4aa0b8, bush: 0x7f8a48, flowers: [0xffd37a, 0xf28b5c], trunk: 0x6f5238, leaf: [0x6f9a46, 0x8aae54], trees: 0.28 },
}

export const LAND_TOP = 0.3
export const WATER_Y = 0.05
const SHORE_ORIGIN = -12
const SHORE_SPAN = 48
const SHORE_TEXELS = 4

export interface Terrain {
  group: Group
  /** Ground height at a world point (bilinear over tile corners). */
  heightAt(x: number, z: number): number
  shore: DataTexture
  isShoreTile(x: number, y: number): boolean
  dispose(): void
}

export function buildTerrain(island: Island, palette: Palette): Terrain {
  const land = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < GRID && y < GRID && tileKind(island, x, y) !== 'water'
  const edges = GRID + 1
  const heights = new Float32Array(edges * edges)
  const colours = new Float32Array(edges * edges * 3)

  const tileColour = (x: number, y: number): Color => {
    const kind = tileKind(island, x, y)
    if (kind === 'rock' || kind === 'lighthouse') return new Color(palette.stone).lerp(new Color(palette.grass[0]), 0.25)
    if (!land(x - 1, y) || !land(x + 1, y) || !land(x, y - 1) || !land(x, y + 1)) return new Color(palette.sand)
    return new Color(palette.grass[0]).lerp(new Color(palette.grass[1]), hash2(x, y, island.id))
  }

  for (let j = 0; j < edges; j++) {
    for (let i = 0; i < edges; i++) {
      let landTiles = 0
      let wet = false
      const sum = new Color(0, 0, 0)
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
        if (land(i + dx, j + dy)) {
          landTiles++
          const c = tileColour(i + dx, j + dy)
          sum.r += c.r; sum.g += c.g; sum.b += c.b
        } else wet = true
      }
      const at = j * edges + i
      heights[at] = wet ? WATER_Y + 0.07 : LAND_TOP + (hash2(i, j, 5) - 0.5) * 0.07
      if (landTiles) {
        colours[at * 3] = sum.r / landTiles; colours[at * 3 + 1] = sum.g / landTiles; colours[at * 3 + 2] = sum.b / landTiles
      }
    }
  }

  const positions: number[] = []
  for (let j = 0; j < edges; j++) for (let i = 0; i < edges; i++) positions.push(i, heights[j * edges + i] as number, j)
  const index: number[] = []
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!land(x, y)) continue
      const a = y * edges + x
      const c = a + edges
      index.push(a, c, a + 1, a + 1, c, c + 1)
    }
  }
  const top = new BufferGeometry()
  top.setAttribute('position', new Float32BufferAttribute(positions, 3))
  top.setAttribute('color', new Float32BufferAttribute(colours, 3))
  top.setIndex(index)
  top.computeVertexNormals()

  const skirtPos: number[] = []
  const skirtCol: number[] = []
  const skirtNormal: number[] = []
  const cliff = new Color(palette.sand).multiplyScalar(0.72)
  const deep = new Color(palette.sand).multiplyScalar(0.38)
  const wall = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
    const ha = heights[az * edges + ax] as number
    const hb = heights[bz * edges + bx] as number
    const quad: [number, number, number, Color][] = [
      [ax, ha, az, cliff], [bx, hb, bz, cliff], [ax, -0.45, az, deep], [bx, hb, bz, cliff], [bx, -0.45, bz, deep], [ax, -0.45, az, deep],
    ]
    for (const [x, y, z, c] of quad) {
      skirtPos.push(x, y, z); skirtCol.push(c.r, c.g, c.b); skirtNormal.push(nx, 0, nz)
    }
  }
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!land(x, y)) continue
      if (!land(x, y - 1)) wall(x, y, x + 1, y, 0, -1)
      if (!land(x + 1, y)) wall(x + 1, y, x + 1, y + 1, 1, 0)
      if (!land(x, y + 1)) wall(x + 1, y + 1, x, y + 1, 0, 1)
      if (!land(x - 1, y)) wall(x, y + 1, x, y, -1, 0)
    }
  }
  const skirts = new BufferGeometry()
  skirts.setAttribute('position', new Float32BufferAttribute(skirtPos, 3))
  skirts.setAttribute('color', new Float32BufferAttribute(skirtCol, 3))
  skirts.setAttribute('normal', new Float32BufferAttribute(skirtNormal, 3))

  const material = new MeshLambertMaterial({ vertexColors: true })
  const topMesh = new Mesh(top, material)
  topMesh.receiveShadow = true
  const skirtMesh = new Mesh(skirts, material)
  skirtMesh.receiveShadow = true
  const group = new Group()
  group.add(topMesh, skirtMesh)

  const size = SHORE_SPAN * SHORE_TEXELS
  const field = new Uint8Array(size * size)
  for (let row = 0; row < size; row++) {
    const pz = SHORE_ORIGIN + (row + 0.5) / SHORE_TEXELS
    for (let col = 0; col < size; col++) {
      const px = SHORE_ORIGIN + (col + 0.5) / SHORE_TEXELS
      let best = 3
      for (let ty = Math.floor(pz) - 3; ty <= Math.floor(pz) + 3; ty++) {
        for (let tx = Math.floor(px) - 3; tx <= Math.floor(px) + 3; tx++) {
          if (!land(tx, ty)) continue
          const dx = Math.max(tx - px, 0, px - (tx + 1))
          const dz = Math.max(ty - pz, 0, pz - (ty + 1))
          best = Math.min(best, Math.hypot(dx, dz))
        }
      }
      field[row * size + col] = Math.round((best / 3) * 255)
    }
  }
  const shore = new DataTexture(field, size, size, RedFormat, UnsignedByteType)
  shore.magFilter = LinearFilter
  shore.minFilter = LinearFilter
  shore.needsUpdate = true

  return {
    group,
    shore,
    heightAt(x, z) {
      if (x < 0 || z < 0 || x > GRID || z > GRID) return WATER_Y
      const i = Math.min(GRID - 1, Math.floor(x))
      const j = Math.min(GRID - 1, Math.floor(z))
      const fx = x - i
      const fz = z - j
      const h = (a: number, b: number): number => heights[b * edges + a] as number
      return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fz) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fz
    },
    isShoreTile: (x, y) => land(x, y) && (!land(x - 1, y) || !land(x + 1, y) || !land(x, y - 1) || !land(x, y + 1)),
    dispose() {
      top.dispose(); skirts.dispose(); material.dispose(); shore.dispose()
    },
  }
}
