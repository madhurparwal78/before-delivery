/** What grows and stands on an island: grass tufts that sway and part, bushes, ring-forest trees, flowers, rocks, the dock,
 *  the notice board and the lighthouse. Everything is built from code. */
import {
  Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh,
  MeshLambertMaterial, BufferGeometry, Float32BufferAttribute, type Material, Quaternion, Vector3,
} from 'three'
import { CREATURES, GRID, SPOTS, type Island, tileKind } from '../../shared/island'
import { hash2 } from './common'
import { ball, paint, part, pillar, spike, BOX, CYLINDER } from './parts'
import type { Palette, Terrain } from './terrain'

interface GrassUniforms {
  uTime: { value: number }
  uWind: { value: number }
  uPart: { value: number }
  uExplorer: { value: [number, number] }
}

export function createGrassUniforms(): GrassUniforms {
  return { uTime: { value: 0 }, uWind: { value: 0 }, uPart: { value: 0 }, uExplorer: { value: [-99, -99] } }
}

function tuftGeometry(): BufferGeometry {
  const positions: number[] = []
  for (let blade = 0; blade < 3; blade++) {
    const angle = (blade / 3) * Math.PI
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    const lean = (blade - 1) * 0.06
    positions.push(-dx * 0.05, 0, -dz * 0.05, dx * 0.05, 0, dz * 0.05, lean, 0.42, lean * 0.7)
    positions.push(dx * 0.05, 0, dz * 0.05, -dx * 0.05, 0, -dz * 0.05, lean, 0.42, lean * 0.7)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function swayMaterial(uniforms: GrassUniforms): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ side: DoubleSide })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform float uPart;\nuniform vec2 uExplorer;')
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 transformed = vec3(position);
        vec2 root = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float bend = position.y * position.y * 5.5;
        float sway = sin(uTime * 2.1 + root.x * 0.8 + root.y * 0.6) + 0.5 * sin(uTime * 1.6 + root.y * 1.3);
        transformed.x += sway * 0.09 * bend * uWind;
        transformed.z += cos(uTime * 1.7 + root.x) * 0.06 * bend * uWind;
        vec2 away = root - uExplorer;
        float gap = length(away);
        float push = smoothstep(1.3, 0.1, gap) * uPart;
        transformed.xz += (away / max(gap, 0.001)) * push * 0.42 * bend;
        transformed.y *= 1.0 - 0.5 * push * bend;
      `)
  }
  return material
}

export interface Decor {
  group: Group
  /** The lighthouse's glowing parts, lit while its door is open. */
  setLighthouse(open: boolean): void
  dispose(): void
}

interface Spread { x: number; z: number; scale: number; color: Color; turn: number }

function instances(geometry: BufferGeometry, material: Material, spread: Spread[], shadows: boolean): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, spread.length))
  mesh.count = spread.length
  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  spread.forEach((item, index) => {
    quaternion.setFromAxisAngle(new Vector3(0, 1, 0), item.turn)
    matrix.compose(new Vector3(item.x, 0, item.z), quaternion, new Vector3(item.scale, item.scale, item.scale))
    mesh.setMatrixAt(index, matrix)
    mesh.setColorAt(index, item.color)
  })
  mesh.castShadow = shadows
  mesh.frustumCulled = false
  return mesh
}

export function buildDecor(island: Island, palette: Palette, terrain: Terrain, grass: GrassUniforms): Decor {
  const group = new Group()
  const disposables: { dispose(): void }[] = []
  const reserved = new Set<string>()
  for (const spot of SPOTS) reserved.add(`${spot.tile[0]},${spot.tile[1]}`)
  for (const creature of CREATURES.filter((c) => c.island === island.id)) {
    const route = creature.route
    const [a, b] = 'stay' in route ? [route.stay.at, route.stay.at] : [route.patrol.from, route.patrol.to]
    for (let x = Math.min(a[0], b[0]) - 1; x <= Math.max(a[0], b[0]) + 1; x++) for (let y = Math.min(a[1], b[1]) - 1; y <= Math.max(a[1], b[1]) + 1; y++) reserved.add(`${x},${y}`)
  }

  const tufts: Spread[] = []
  const bushes: Spread[] = []
  const trees: Spread[] = []
  const flowers: Spread[] = []
  const flowerColors = palette.flowers.map((hex) => new Color(hex))
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      if (tileKind(island, x, y) !== 'land' || terrain.isShoreTile(x, y)) continue
      const near = reserved.has(`${x},${y}`)
      const count = near ? 1 : 2 + Math.floor(hash2(x, y, 9) * 3)
      for (let i = 0; i < count; i++) {
        const px = x + 0.1 + hash2(x, y, 10 + i) * 0.8
        const pz = y + 0.1 + hash2(x, y, 20 + i) * 0.8
        const tone = hash2(x, y, 30 + i)
        tufts.push({ x: px, z: pz, scale: 0.8 + tone * 0.7, turn: 0, color: new Color(palette.grass[0]).lerp(new Color(palette.grass[1]), tone).multiplyScalar(0.85 + hash2(x, y, 40 + i) * 0.35) })
      }
      if (near) continue
      const edgeRing = x <= 2 || y <= 2 || x >= GRID - 3 || y >= GRID - 3
      const roll = hash2(x, y, 50)
      if (edgeRing && roll < palette.trees) trees.push({ x: x + 0.5, z: y + 0.5, scale: 0.8 + hash2(x, y, 51) * 0.7, turn: hash2(x, y, 52) * 6, color: new Color(palette.leaf[hash2(x, y, 53) > 0.5 ? 1 : 0]) })
      else if (roll > 0.945) bushes.push({ x: x + 0.3 + hash2(x, y, 54) * 0.4, z: y + 0.3 + hash2(x, y, 55) * 0.4, scale: 0.5 + hash2(x, y, 56) * 0.4, turn: hash2(x, y, 57) * 6, color: new Color(palette.bush).multiplyScalar(0.8 + hash2(x, y, 58) * 0.4) })
      else if (roll < 0.14) flowers.push({ x: x + 0.2 + hash2(x, y, 59) * 0.6, z: y + 0.2 + hash2(x, y, 60) * 0.6, scale: 0.065, turn: 0, color: flowerColors[Math.floor(hash2(x, y, 61) * flowerColors.length)] as Color })
    }
  }
  const place = (mesh: InstancedMesh, items: Spread[], base: number): void => {
    const matrix = new Matrix4()
    const quaternion = new Quaternion()
    items.forEach((item, index) => {
      quaternion.setFromAxisAngle(new Vector3(0, 1, 0), item.turn)
      matrix.compose(new Vector3(item.x, terrain.heightAt(item.x, item.z) + base * item.scale, item.z), quaternion, new Vector3(item.scale, item.scale, item.scale))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }

  const tuftGeo = tuftGeometry()
  const tuftMaterial = swayMaterial(grass)
  const tuftMesh = instances(tuftGeo, tuftMaterial, tufts, false)
  place(tuftMesh, tufts, 0)
  group.add(tuftMesh)
  disposables.push(tuftGeo, tuftMaterial)

  const bushGeo = new IcosahedronGeometry(0.5, 1)
  const bushMaterial = new MeshLambertMaterial({ flatShading: true })
  const bushMesh = instances(bushGeo, bushMaterial, bushes, true)
  place(bushMesh, bushes, 0.2)
  group.add(bushMesh)
  disposables.push(bushGeo, bushMaterial)

  const crownGeo = new ConeGeometry(0.62, 1.7, 7)
  const crownMaterial = new MeshLambertMaterial({ flatShading: true })
  const crownMesh = instances(crownGeo, crownMaterial, trees, true)
  place(crownMesh, trees, 1.55)
  group.add(crownMesh)
  const trunkGeo = new CylinderGeometry(0.08, 0.11, 0.8, 6)
  const trunkMaterial = new MeshLambertMaterial({ color: palette.trunk, flatShading: true })
  const trunkMesh = instances(trunkGeo, trunkMaterial, trees.map((tree) => ({ ...tree, color: new Color(0xffffff) })), true)
  place(trunkMesh, trees, 0.4)
  group.add(trunkMesh)
  disposables.push(crownGeo, crownMaterial, trunkGeo, trunkMaterial)

  const flowerGeo = new IcosahedronGeometry(1, 0)
  const flowerMaterial = new MeshLambertMaterial({ flatShading: true })
  const flowerMesh = instances(flowerGeo, flowerMaterial, flowers, false)
  place(flowerMesh, flowers, 1.4)
  group.add(flowerMesh)
  disposables.push(flowerGeo, flowerMaterial)

  // rocks: heaped boulders on every rock tile
  const rockGeo = new IcosahedronGeometry(0.5, 1)
  const rockMaterial = new MeshLambertMaterial({ color: palette.stone, flatShading: true })
  disposables.push(rockGeo, rockMaterial)
  for (const [rx, ry] of island.rocks) {
    const stone = new Mesh(rockGeo, rockMaterial)
    stone.scale.set(0.95, 0.6 + hash2(rx, ry, 1) * 0.3, 0.9)
    stone.rotation.y = hash2(rx, ry, 2) * 6
    stone.position.set(rx + 0.5, terrain.heightAt(rx + 0.5, ry + 0.5) + 0.22, ry + 0.5)
    const small = new Mesh(rockGeo, rockMaterial)
    small.scale.set(0.45, 0.35, 0.4)
    small.position.set(rx + 0.8, terrain.heightAt(rx + 0.8, ry + 0.3) + 0.12, ry + 0.3)
    for (const piece of [stone, small]) { piece.castShadow = true; piece.receiveShadow = true; group.add(piece) }
  }

  // the dock: planks running out over the water from spot 1
  const dock = new Group()
  const plank = paint(0x8a6a44)
  for (let x = 0; x <= 3; x++) {
    dock.add(part(BOX, plank, { at: [x + 0.5, terrain.heightAt(x + 0.5, 12.5) + 0.07, 12.5], scale: [0.96, 0.08, 1.15] }))
    dock.add(part(BOX, paint(0x74573a), { at: [x + 0.5, terrain.heightAt(x + 0.5, 12.5) + 0.11, 12.5], scale: [0.02, 0.02, 1.15] }))
  }
  for (const z of [11.95, 13.05]) for (const x of [0.4, 2.0]) dock.add(pillar(0x5b4630, 0.06, 0.8, [x, 0.2, z]))
  group.add(dock)

  if (island.id === 1) {
    const board = new Group()
    board.add(pillar(0x5b4630, 0.05, 1.0, [4.0, 0.7, 13.6]), pillar(0x5b4630, 0.05, 1.0, [4.9, 0.7, 13.6]))
    board.add(part(BOX, paint(0x8a6a44), { at: [4.45, 1.0, 13.6], scale: [1.1, 0.7, 0.06] }))
    for (const [x, y, c] of [[4.15, 1.12, 0xf5efdc], [4.45, 0.95, 0xe9f0f5], [4.75, 1.1, 0xf5efdc]] as const) board.add(part(BOX, paint(c), { at: [x, y, 13.56], scale: [0.22, 0.28, 0.01] }))
    group.add(board)
  }

  const lampParts: Mesh[] = []
  if (island.lighthouse) {
    const [lx, ly] = island.lighthouse
    const tower = new Group()
    tower.position.set(lx + 0.5, terrain.heightAt(lx + 0.5, ly + 0.5), ly + 0.5)
    tower.add(part(CYLINDER, paint(0x8f8d86), { at: [0, 0.15, 0], scale: [0.62, 0.3, 0.62] }))
    for (let i = 0; i < 4; i++) {
      const band = new CylinderGeometry(0.42 - i * 0.03, 0.46 - i * 0.03, 0.85, 12)
      disposables.push(band)
      tower.add(part(band, paint(i % 2 ? 0xb23b2e : 0xf1ede2), { at: [0, 0.7 + i * 0.85, 0] }))
    }
    tower.add(part(CYLINDER, paint(0x2b2d33), { at: [0, 4.15, 0], scale: [0.55, 0.08, 0.55] }))
    const lamp = part(CYLINDER, paint(0x445055), { at: [0, 4.5, 0], scale: [0.3, 0.62, 0.3] })
    lampParts.push(lamp)
    tower.add(lamp, spike(0xb23b2e, 0.42, 0.55, [0, 5.1, 0]), ball(0xf1ede2, [0.08, 0.08, 0.08], [0, 5.45, 0]))
    const door = part(BOX, paint(0x4a3524), { at: [0, 0.75, 0.43], scale: [0.26, 0.5, 0.04] })
    lampParts.push(door)
    tower.add(door)
    group.add(tower)
  }

  const lit = new Map<Mesh, { off: MeshLambertMaterial; on: MeshLambertMaterial }>()
  for (const [index, mesh] of lampParts.entries()) {
    lit.set(mesh, { off: mesh.material as MeshLambertMaterial, on: paint(index === 0 ? 0xffe9a0 : 0xffd27a, index === 0 ? 0xffd860 : 0xffb347) })
  }

  return {
    group,
    setLighthouse(open) {
      for (const [mesh, pair] of lit) mesh.material = open ? pair.on : pair.off
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
