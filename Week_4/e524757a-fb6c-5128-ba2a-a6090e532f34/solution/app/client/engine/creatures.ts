/** The twenty invented creatures: five archetypes dressed by a table, so each id has its own colour, build and marks.
 *  Local forward is -z; the body is about one unit long before it is scaled by the creature's size. */
import { Group } from 'three'
import { type CreatureDef } from '../../shared/island'
import { buildNewt } from './newt'
import { ball, limb, part, paint, pillar, spike, BOX, SPHERE } from './parts'

export interface CreatureRig { group: Group; legs: Group[]; hover: number }

type Build = (group: Group, legs: Group[]) => number

const quadruped = (c: { body: number; belly?: number; head?: number; leg?: number; ears?: number; earLength?: number; tail?: number; tailColor?: number; length?: number; height?: number; legLength?: number; snout?: number; spots?: number; antlers?: number; horns?: number; beard?: boolean; paws?: number; thick?: number }): Build => (group, legs) => {
  const length = c.length ?? 0.9
  const height = c.height ?? 0.3
  const legLength = c.legLength ?? 0.3
  const lift = legLength + height * 0.7
  group.add(ball(c.body, [height * (c.thick ?? 1), height, length / 2], [0, lift, 0]))
  if (c.belly) group.add(ball(c.belly, [height * 0.8, height * 0.6, length * 0.4], [0, lift - height * 0.45, 0]))
  if (c.spots) for (const z of [-0.25, 0, 0.25]) group.add(ball(c.spots, [0.07, 0.03, 0.07], [z * 0.3 * length, lift + height * 0.95, z * length]))
  const headY = lift + height * 0.55
  group.add(ball(c.head ?? c.body, [height * 0.55, height * 0.5, height * 0.65], [0, headY, -length / 2 - height * 0.25]))
  if (c.snout) group.add(ball(c.snout, [height * 0.25, height * 0.22, height * 0.35], [0, headY - height * 0.1, -length / 2 - height * 0.8]))
  group.add(ball(0x1a1a16, [0.035, 0.035, 0.035], [-height * 0.3, headY + height * 0.12, -length / 2 - height * 0.5]))
  group.add(ball(0x1a1a16, [0.035, 0.035, 0.035], [height * 0.3, headY + height * 0.12, -length / 2 - height * 0.5]))
  if (c.ears) {
    for (const side of [-1, 1]) group.add(part(SPHERE, paint(c.ears), { at: [side * height * 0.38, headY + height * (0.55 + (c.earLength ?? 0.3)), -length / 2 - height * 0.15], scale: [height * 0.14, height * (c.earLength ?? 0.3) * 1.3, height * 0.09], rotate: [0, 0, side * -0.25] }))
  }
  if (c.horns) {
    for (const side of [-1, 1]) group.add(spike(c.horns, height * 0.13, height * 1.1, [side * height * 0.3, headY + height * 0.8, -length / 2 - height * 0.1], [0.5, 0, side * -0.35]))
  }
  if (c.antlers) {
    for (const side of [-1, 1]) {
      group.add(pillar(c.antlers, height * 0.07, height * 1.5, [side * height * 0.32, headY + height * 1.05, -length / 2 - height * 0.15], [0.2, 0, side * -0.35]))
      for (const tine of [0.25, 0.6]) group.add(pillar(c.antlers, height * 0.05, height * 0.7, [side * (height * 0.52 + tine * 0.12), headY + height * (0.95 + tine * 0.9), -length / 2 - height * 0.15 - tine * 0.1], [0.5, 0, side * -1.0]))
    }
  }
  if (c.beard) group.add(spike(0xe9e5d8, height * 0.1, height * 0.5, [0, headY - height * 0.5, -length / 2 - height * 0.4], [Math.PI, 0, 0]))
  group.add(part(SPHERE, paint(c.tailColor ?? c.tail ?? c.body), { at: [0, lift + height * 0.15, length / 2 + height * 0.35], scale: [height * 0.22, height * 0.22, height * 0.5], rotate: [-0.5, 0, 0] }))
  for (const [x, z] of [[-1, -0.3], [1, -0.3], [-1, 0.32], [1, 0.32]] as const) {
    const leg = limb(c.leg ?? c.body, height * 0.17, legLength + height * 0.4, [x * height * 0.55, lift - height * 0.2, z * length])
    if (c.paws) leg.add(ball(c.paws, [height * 0.2, height * 0.12, height * 0.28], [0, -(legLength + height * 0.4), -0.02]))
    group.add(leg)
    legs.push(leg)
  }
  return 0
}

const bird = (c: { body: number; belly?: number; wing?: number; beak: number; legColor: number; legLength: number; neck: number; size?: number; tail?: number; crest?: number; collar?: number; head?: number; beakLength?: number }): Build => (group, legs) => {
  const s = c.size ?? 0.3
  const lift = c.legLength + s * 0.8
  group.add(ball(c.body, [s * 0.8, s * 0.85, s * 1.5], [0, lift, 0.05]))
  if (c.belly) group.add(ball(c.belly, [s * 0.65, s * 0.55, s * 1.2], [0, lift - s * 0.3, -0.04]))
  if (c.wing) for (const side of [-1, 1]) group.add(ball(c.wing, [s * 0.18, s * 0.6, s * 1.2], [side * s * 0.72, lift + s * 0.1, 0.1]))
  group.add(part(SPHERE, paint(c.tail ?? c.wing ?? c.body), { at: [0, lift + s * 0.05, s * 1.7], scale: [s * 0.4, s * 0.12, s * 0.9], rotate: [-0.2, 0, 0] }))
  const neckTop = lift + s * 0.5 + c.neck
  if (c.neck > 0.05) group.add(pillar(c.belly ?? c.body, s * 0.2, c.neck + s * 0.4, [0, lift + s * 0.3 + c.neck / 2, -s * 1.0], [0.25, 0, 0]))
  group.add(ball(c.head ?? c.body, [s * 0.5, s * 0.5, s * 0.55], [0, neckTop, -s * 1.15 - c.neck * 0.2]))
  group.add(spike(c.beak, s * 0.16, s * (c.beakLength ?? 0.9), [0, neckTop - s * 0.05, -s * 1.7 - c.neck * 0.2 - (c.beakLength ?? 0.9) * s * 0.3], [-Math.PI / 2, 0, 0]))
  for (const side of [-1, 1]) group.add(ball(0x14140f, [0.03, 0.03, 0.03], [side * s * 0.38, neckTop + s * 0.12, -s * 1.45 - c.neck * 0.2]))
  if (c.crest) group.add(spike(c.crest, s * 0.1, s * 0.7, [0, neckTop + s * 0.55, -s * 1.0 - c.neck * 0.2], [0.5, 0, 0]))
  if (c.collar) group.add(part(SPHERE, paint(c.collar), { at: [0, neckTop - s * 0.4, -s * 1.1 - c.neck * 0.2], scale: [s * 0.45, s * 0.12, s * 0.45] }))
  for (const side of [-1, 1]) {
    const leg = limb(c.legColor, 0.025, c.legLength, [side * s * 0.4, c.legLength + s * 0.1, 0])
    group.add(leg)
    legs.push(leg)
  }
  return 0
}

const wings = (c: { body: number; wing: number; edge: number; hover: number; span: number; glow?: number; eyes?: number; bat?: boolean }): Build => (group) => {
  group.add(ball(c.body, [0.09, 0.09, 0.3], [0, 0, 0]))
  group.add(ball(c.body, [0.1, 0.1, 0.1], [0, 0.02, -0.3]))
  if (c.eyes) for (const side of [-1, 1]) group.add(ball(c.eyes, [0.025, 0.025, 0.025], [side * 0.06, 0.05, -0.37], c.eyes))
  for (const side of [-1, 1]) {
    group.add(part(c.bat ? BOX : SPHERE, paint(c.wing, c.glow ?? 0), { at: [side * c.span * 0.5, 0.05, 0.02], scale: c.bat ? [c.span, 0.015, 0.32] : [c.span * 0.55, 0.012, 0.38], rotate: [0, 0, side * 0.35] }))
    group.add(part(SPHERE, paint(c.edge, c.glow ?? 0), { at: [side * c.span * 0.82, 0.08, 0.05], scale: [c.span * 0.2, 0.014, 0.2], rotate: [0, 0, side * 0.35] }))
  }
  return c.hover
}

const crawler = (c: { body: number; belly?: number; length: number; height: number; legs: number; leg: number; claws?: number; eyes?: number; marks?: number; shell?: number; shellMarks?: number; lamp?: number; beads?: number; tail?: number; stalk?: boolean; wide?: number }): Build => (group, legs) => {
  const { length, height } = c
  group.add(ball(c.body, [height * (c.wide ?? 1), height, length / 2], [0, height + 0.05, 0]))
  if (c.belly) group.add(ball(c.belly, [height * 0.8, height * 0.55, length * 0.4], [0, height * 0.5 + 0.05, 0]))
  if (c.shell) {
    group.add(ball(c.shell, [height * 1.7, height * 1.7, height * 1.7], [0, height * 2.2, length * 0.1]))
    group.add(ball(c.shellMarks ?? c.shell, [height * 0.9, height * 0.9, height * 0.9], [0, height * 2.7, length * 0.1]))
  }
  group.add(ball(c.body, [height * 0.8, height * 0.7, height * 0.9], [0, height + 0.08, -length / 2 - height * 0.4]))
  for (const side of [-1, 1]) {
    if (c.stalk) {
      group.add(pillar(c.body, 0.015, 0.16, [side * height * 0.5, height * 2.1, -length / 2], [0, 0, side * 0.2]))
      group.add(ball(c.eyes ?? 0x14140f, [0.04, 0.04, 0.04], [side * height * 0.55, height * 2.35, -length / 2]))
    } else {
      group.add(ball(c.eyes ?? 0x14140f, [height * 0.28, height * 0.28, height * 0.28], [side * height * 0.55, height * 1.4, -length / 2 - height * 0.5]))
    }
    if (c.claws) group.add(ball(c.claws, [height * 0.6, height * 0.4, height * 0.7], [side * (height * 1.8), height + 0.05, -length / 2 - height * 0.4]))
  }
  if (c.lamp) group.add(ball(c.lamp, [height * 0.5, height * 0.5, height * 0.5], [0, height * 2.6, -length * 0.1], c.lamp))
  if (c.beads) for (const z of [-0.3, 0, 0.3]) for (const side of [-1, 1]) group.add(ball(c.beads, [0.035, 0.035, 0.035], [side * height * 0.75, height * 1.3, z * length]))
  if (c.marks) for (const z of [-0.3, 0.05, 0.35]) group.add(ball(c.marks, [height * 0.5, height * 0.2, height * 0.3], [0, height * 2, z * length]))
  if (c.tail) group.add(part(SPHERE, paint(c.tail), { at: [0, height + 0.02, length / 2 + length * 0.4], scale: [height * 0.3, height * 0.25, length * 0.5] }))
  for (let i = 0; i < c.legs; i++) {
    const side = i % 2 ? 1 : -1
    const z = (Math.floor(i / 2) / Math.max(1, c.legs / 2 - 1) - 0.5) * length * 0.8
    const leg = limb(c.leg, 0.02 + height * 0.05, height * 1.0 + 0.06, [side * height * 0.9, height * 0.8 + 0.06, z])
    leg.rotation.z = side * 0.9
    group.add(leg)
    legs.push(leg)
  }
  return 0
}

const owl = (c: { body: number; face: number; eye: number; tuft: number }): Build => (group) => {
  group.add(ball(c.body, [0.28, 0.36, 0.28], [0, 0.45, 0]))
  group.add(ball(c.face, [0.2, 0.17, 0.05], [0, 0.66, -0.2]))
  for (const side of [-1, 1]) {
    group.add(ball(c.eye, [0.07, 0.07, 0.04], [side * 0.09, 0.67, -0.25], c.eye))
    group.add(ball(0x14140f, [0.03, 0.03, 0.03], [side * 0.09, 0.67, -0.29]))
    group.add(spike(c.tuft, 0.06, 0.2, [side * 0.16, 0.9, -0.05], [0, 0, side * -0.3]))
    group.add(ball(c.face, [0.07, 0.3, 0.2], [side * 0.28, 0.4, 0.05]))
  }
  group.add(spike(0xd0a24a, 0.04, 0.1, [0, 0.6, -0.27], [-Math.PI / 2, 0, 0]))
  group.add(part(SPHERE, paint(0xe7e2d6), { at: [0, 0.34, 0.5], scale: [0.5, 0.05, 0.5] }))
  return 0
}

const vole = (c: { body: number; ear: number }): Build => (group) => {
  group.add(ball(c.body, [0.34, 0.32, 0.36], [0, 0.34, 0]))
  group.add(ball(c.body, [0.2, 0.18, 0.2], [0, 0.4, -0.34]))
  for (const side of [-1, 1]) {
    group.add(ball(c.ear, [0.07, 0.07, 0.04], [side * 0.14, 0.56, -0.28]))
    group.add(ball(0x14140f, [0.025, 0.025, 0.025], [side * 0.09, 0.45, -0.5]))
    group.add(ball(c.body, [0.12, 0.12, 0.12], [side * 0.2, 0.3, 0.2]))
  }
  group.add(ball(0xc9788a, [0.03, 0.03, 0.03], [0, 0.4, -0.54]))
  return 0
}

const BUILDS: Record<string, Build> = {
  'mossback-newt': () => 0,
  'reedpipe-heron': bird({ body: 0x7f94a6, belly: 0xe4e9ee, wing: 0x5d7387, beak: 0xe0a53a, legColor: 0xb89a5a, legLength: 0.7, neck: 0.5, size: 0.25, crest: 0x2f3b48, tail: 0x4f6275 }),
  'gloamfin-moth': wings({ body: 0x6a5a8a, wing: 0xb39ddb, edge: 0x8f7fc0, hover: 0.9, span: 0.4, glow: 0x4a3a7a, eyes: 0xfff0a0 }),
  'puddle-lark': bird({ body: 0x9c7b52, belly: 0xf1e3c4, beak: 0x6d5a3a, legColor: 0xc9a77a, legLength: 0.14, neck: 0, size: 0.17, wing: 0x7a5c3a, crest: 0x7a5c3a }),
  'bracken-hare': quadruped({ body: 0xb88a5a, belly: 0xf1e4cc, ears: 0xb88a5a, earLength: 0.9, tail: 0xffffff, legLength: 0.25, height: 0.24, length: 0.85, paws: 0x8a6240 }),
  'mossfern-stag': quadruped({ body: 0x6b5a3c, belly: 0xc8b890, antlers: 0x4a3e2a, spots: 0x5f8a4a, legLength: 0.55, height: 0.3, length: 1.0, tail: 0xe9e0c8, snout: 0x3a3022, paws: 0x2e271c }),
  'lantern-toad': crawler({ body: 0x7f8f3c, belly: 0xe2dca6, length: 0.55, height: 0.2, legs: 4, leg: 0x6a7a30, lamp: 0xffd45c, beads: 0x4a5a22, wide: 1.25, eyes: 0xf0c040 }),
  'drizzle-snail': crawler({ body: 0xd9d2b8, length: 0.6, height: 0.1, legs: 0, leg: 0xd9d2b8, shell: 0x4a9aa0, shellMarks: 0x9fd6d0, stalk: true }),
  'glasswing-crab': crawler({ body: 0x9ed9e0, belly: 0xe6f6f8, length: 0.45, height: 0.1, legs: 6, leg: 0x7cc0cc, claws: 0xf0a0a0, stalk: true, marks: 0xffffff, wide: 1.6 }),
  'tidewhistle-otter': quadruped({ body: 0x6b4a32, belly: 0xd9c4a0, head: 0x7a5740, snout: 0xe6d3b0, legLength: 0.08, height: 0.2, length: 1.15, tail: 0x5a3d2a, paws: 0x4a3322 }),
  'duskshell-snipe': bird({ body: 0x8e8a9a, belly: 0xdcd8e4, wing: 0x6a6678, beak: 0x4a4658, legColor: 0x8a7f90, legLength: 0.3, neck: 0.12, size: 0.2, beakLength: 2.4, crest: 0x5a566a }),
  'rainbead-gecko': crawler({ body: 0x62b07a, belly: 0xd7f0c8, length: 0.6, height: 0.07, legs: 4, leg: 0x4f9a68, beads: 0xe8f7ff, tail: 0x56a470, eyes: 0xffe28a, wide: 1.4 }),
  'cragtail-goat': quadruped({ body: 0xd8d4c8, belly: 0xefece2, horns: 0x6a5a48, beard: true, legLength: 0.4, height: 0.28, length: 0.95, tail: 0xd8d4c8, paws: 0x3a342c, snout: 0xc7c2b4 }),
  'fell-mouse': quadruped({ body: 0x8a8274, belly: 0xd9d4c6, ears: 0xc9788a, earLength: 0.45, tail: 0xc9a2a0, legLength: 0.04, height: 0.16, length: 0.6, snout: 0x8a8274 }),
  'mistcrown-owl': owl({ body: 0x7a6248, face: 0xe6dccb, eye: 0xffd04a, tuft: 0x5a4632 }),
  'cloudpuff-vole': vole({ body: 0xdcdcdc, ear: 0xe6b8c0 }),
  'beacon-gull': bird({ body: 0xf4f4f0, belly: 0xffffff, wing: 0x9aa4ad, beak: 0xe08a2a, legColor: 0xe08a2a, legLength: 0.35, neck: 0.08, size: 0.25, tail: 0xf4f4f0 }),
  'shingle-plover': bird({ body: 0xc9b58a, belly: 0xfaf5e6, beak: 0x2a2a24, legColor: 0xe0a860, legLength: 0.16, neck: 0, size: 0.17, collar: 0x2a2a24, wing: 0xa98f64 }),
  'wickwing-bat': wings({ body: 0x3b3347, wing: 0x4a4258, edge: 0x2a2436, hover: 1.1, span: 0.55, eyes: 0xff9a5a, bat: true }),
  'sleetfoot-fox': quadruped({ body: 0xc2703a, belly: 0xf3e6d2, ears: 0xc2703a, earLength: 0.5, tail: 0xc2703a, tailColor: 0xe9e4dc, legLength: 0.3, height: 0.22, length: 0.95, snout: 0xf3e6d2, paws: 0x8fb8d8, leg: 0x4a3a30 }),
}

const SCALE = [0, 0.9, 1.5, 2.2]

export function buildCreature(def: CreatureDef): CreatureRig {
  const group = new Group()
  const legs: Group[] = []
  let hover = 0
  if (def.id === 'mossback-newt') {
    const newt = buildNewt()
    group.add(newt.group)
    legs.push(...newt.legs)
  } else {
    hover = (BUILDS[def.id] as Build)(group, legs)
  }
  const inner = new Group()
  inner.add(...group.children)
  group.add(inner)
  inner.scale.setScalar(def.id === 'mossback-newt' ? 0.9 : SCALE[def.size] as number)
  group.traverse((object) => { object.castShadow = true })
  return { group, legs, hover: hover * (def.id === 'mossback-newt' ? 1 : (SCALE[def.size] as number)) }
}
