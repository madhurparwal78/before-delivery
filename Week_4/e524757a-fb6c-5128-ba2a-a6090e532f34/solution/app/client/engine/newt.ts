/** Wump, the moss-backed tide-newt. The same body is the Mossback newt in the world. Length runs along -z (head at -z). */
import { Group } from 'three'
import { ball, limb, paint, part, SPHERE, spike } from './parts'

interface NewtRig { group: Group; body: Group; legs: Group[] }

const MOSS = 0x6f8a3a
const MOSS_LIGHT = 0x9bb04c
const FLANK = 0x7e8f48
const BELLY = 0xefe6bd
const POOL = 0x4aa3a0
const SPOT = 0xf2c14e

export function buildNewt(): NewtRig {
  const group = new Group()
  const body = new Group()
  group.add(body)
  // spine: a chain of tapering spheres from head to tail
  const spine: [number, number, number, number][] = [
    [-0.62, 0.2, 0.2, 0.2], [-0.35, 0.21, 0.22, 0.24], [-0.05, 0.21, 0.24, 0.26], [0.25, 0.2, 0.2, 0.22],
    [0.5, 0.17, 0.15, 0.17], [0.72, 0.14, 0.11, 0.12], [0.92, 0.11, 0.08, 0.09], [1.08, 0.09, 0.05, 0.06],
  ]
  for (const [z, y, r, length] of spine) body.add(part(SPHERE, paint(FLANK), { at: [0, y, z], scale: [r, r * 0.8, length] }))
  // pale belly
  body.add(part(SPHERE, paint(BELLY), { at: [0, 0.1, -0.1], scale: [0.2, 0.09, 0.62] }))
  // head with eyes
  body.add(part(SPHERE, paint(MOSS), { at: [0, 0.22, -0.78], scale: [0.2, 0.14, 0.22] }))
  for (const side of [-1, 1]) {
    body.add(ball(0x1b1b14, [0.045, 0.045, 0.045], [side * 0.12, 0.31, -0.78]))
    body.add(ball(0xffffff, [0.014, 0.014, 0.014], [side * 0.13, 0.33, -0.815]))
  }
  // moss across the back: lumpy olive clumps
  const clumps: [number, number, number, number][] = [
    [-0.12, 0.34, -0.5, 0.09], [0.1, 0.38, -0.3, 0.11], [-0.09, 0.4, -0.08, 0.12], [0.11, 0.39, 0.1, 0.11], [-0.07, 0.36, 0.3, 0.09],
    [0.06, 0.3, 0.5, 0.07], [0, 0.42, -0.2, 0.1], [0, 0.4, 0.2, 0.09],
  ]
  clumps.forEach(([x, y, z, r], i) => body.add(ball(i % 2 ? MOSS : MOSS_LIGHT, [r, r * 0.7, r], [x, y - 0.06, z])))
  // tide-pool markings: teal rings with a gold centre along the flanks
  for (const side of [-1, 1]) {
    for (const z of [-0.4, -0.05, 0.3, 0.6]) {
      body.add(part(SPHERE, paint(POOL), { at: [side * 0.185, 0.2, z], scale: [0.02, 0.07, 0.07] }))
      body.add(part(SPHERE, paint(SPOT), { at: [side * 0.2, 0.2, z], scale: [0.015, 0.035, 0.035] }))
    }
  }
  // tail fin
  body.add(part(SPHERE, paint(POOL), { at: [0, 0.2, 0.95], scale: [0.015, 0.1, 0.28] }))
  const legs: Group[] = []
  for (const [side, z] of [[-1, -0.4], [1, -0.4], [-1, 0.25], [1, 0.25]] as const) {
    const leg = limb(FLANK, 0.045, 0.2, [side * 0.2, 0.17, z])
    leg.rotation.z = side * 0.9
    leg.add(spike(MOSS_LIGHT, 0.06, 0.08, [0, -0.2, -0.03], [Math.PI / 2, 0, 0]))
    body.add(leg)
    legs.push(leg)
  }
  group.traverse((object) => { object.castShadow = true })
  return { group, body, legs }
}
