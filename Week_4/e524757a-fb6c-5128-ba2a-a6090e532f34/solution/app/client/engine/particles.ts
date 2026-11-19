/** Weather and dusk: rain rings on the water, rain streaks, fireflies. Each moves on a time uniform that the scene freezes under reduced motion. */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, InstancedMesh, LineSegments, Matrix4, MeshBasicMaterial,
  Points, RingGeometry, ShaderMaterial, Vector3, Group,
} from 'three'
import { GRID, type Island, tileKind } from '../../shared/island'
import { hash2 } from './common'
import { WATER_Y } from './terrain'

export interface Particles {
  group: Group
  /** Rain rings and streaks show while it rains; fireflies at dusk. `time` is seconds on the page clock (0 when frozen). */
  update(time: number, state: { rain: boolean; dusk: boolean; centre: Vector3 }): void
  dispose(): void
}

function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,248,180,1)')
  gradient.addColorStop(0.35, 'rgba(255,230,120,0.55)')
  gradient.addColorStop(1, 'rgba(255,220,100,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new CanvasTexture(canvas)
}

export function createParticles(island: Island): Particles {
  const group = new Group()

  // rain rings on water tiles around the island
  const spots: [number, number, number][] = []
  for (let y = -6; y < GRID + 6; y++) {
    for (let x = -6; x < GRID + 6; x++) {
      const inside = x >= 0 && y >= 0 && x < GRID && y < GRID
      if (inside && tileKind(island, x, y) !== 'water') continue
      const roll = hash2(x, y, 77)
      if (roll < (inside ? 0.7 : 0.22)) spots.push([x + hash2(x, y, 78), y + hash2(x, y, 79), roll])
    }
  }
  const ringGeo = new RingGeometry(0.8, 1, 24)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false })
  const rings = new InstancedMesh(ringGeo, ringMaterial, spots.length)
  rings.frustumCulled = false
  rings.renderOrder = 2
  spots.forEach((_, index) => rings.setColorAt(index, new Color(0, 0, 0)))
  group.add(rings)

  // rain streaks falling in a box around the camera target
  const streaks = 520
  const streakPositions: number[] = []
  const streakSeed: number[] = []
  for (let i = 0; i < streaks; i++) {
    const x = (hash2(i, 1, 3) - 0.5) * 30
    const z = (hash2(i, 2, 3) - 0.5) * 30
    const y = hash2(i, 3, 3) * 16
    streakPositions.push(x, y, z, x, y, z)
    streakSeed.push(0, 1)
  }
  const rainGeo = new BufferGeometry()
  rainGeo.setAttribute('position', new Float32BufferAttribute(streakPositions, 3))
  rainGeo.setAttribute('tail', new Float32BufferAttribute(streakSeed, 1))
  const rainMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCentre: { value: new Vector3() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCentre;
      attribute float tail;
      varying float vTail;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 14.0, 16.0);
        p.y += tail * 0.55;
        p.x += tail * 0.06;
        vTail = tail;
        vec4 mv = viewMatrix * vec4(p + vec3(uCentre.x, 0.0, uCentre.z), 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vTail;
      void main() { gl_FragColor = vec4(0.82, 0.88, 0.95, 0.5 * (1.0 - vTail * 0.6)); }`,
  })
  const rain = new LineSegments(rainGeo, rainMaterial)
  rain.frustumCulled = false
  group.add(rain)

  // fireflies drifting over the grass at dusk
  const flies = 70
  const flyPositions: number[] = []
  const flySeed: number[] = []
  for (let i = 0; i < flies; i++) {
    flyPositions.push(2 + hash2(i, 4, 5) * (GRID - 4), 0.5 + hash2(i, 5, 5) * 1.6, 2 + hash2(i, 6, 5) * (GRID - 4))
    flySeed.push(hash2(i, 7, 5) * 6.28)
  }
  const flyGeo = new BufferGeometry()
  flyGeo.setAttribute('position', new Float32BufferAttribute(flyPositions, 3))
  flyGeo.setAttribute('seed', new Float32BufferAttribute(flySeed, 1))
  const texture = glowTexture()
  const flyMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: texture } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float seed;
      varying float vGlow;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.6 + seed) * 0.7;
        p.z += cos(uTime * 0.5 + seed * 1.7) * 0.7;
        p.y += sin(uTime * 0.9 + seed * 2.3) * 0.25;
        vGlow = 0.55 + 0.45 * sin(uTime * 2.4 + seed * 5.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(220.0 / -mv.z, 3.0, 24.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vGlow;
      void main() {
        vec4 c = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(c.rgb * vGlow, c.a * vGlow);
      }`,
  })
  const fireflies = new Points(flyGeo, flyMaterial)
  fireflies.frustumCulled = false
  group.add(fireflies)

  const matrix = new Matrix4()
  const colour = new Color()
  return {
    group,
    update(time, { rain: raining, dusk, centre }) {
      rain.visible = raining
      rings.visible = raining
      fireflies.visible = dusk
      if (raining) {
        rainMaterial.uniforms.uTime!.value = time
        ;(rainMaterial.uniforms.uCentre!.value as Vector3).copy(centre)
        spots.forEach(([x, z, seed], index) => {
          const p = (time * 0.75 + seed * 7) % 1
          const radius = 0.08 + p * 0.55
          matrix.makeScale(radius, 1, radius).setPosition(x, WATER_Y + 0.02, z)
          rings.setMatrixAt(index, matrix)
          colour.setScalar(0.85 * (1 - p) * (1 - p))
          rings.setColorAt(index, colour)
        })
        rings.instanceMatrix.needsUpdate = true
        if (rings.instanceColor) rings.instanceColor.needsUpdate = true
      }
      if (dusk) flyMaterial.uniforms.uTime!.value = time
    },
    dispose() {
      ringGeo.dispose(); ringMaterial.dispose(); rainGeo.dispose(); rainMaterial.dispose(); flyGeo.dispose(); flyMaterial.dispose(); texture.dispose()
    },
  }
}
