/** The explorer: a field photographer in a wide-brimmed hat with a pack and a camera, about a tile and a third tall. Forward is -z. */
import { Group } from 'three'
import type { Gait } from './api'
import { ball, limb, paint, part, BOX, CYLINDER } from './parts'

interface ExplorerRig { group: Group; legs: [Group, Group]; arms: [Group, Group]; torso: Group }

export const EYE_HEIGHT = 1.2

export function buildExplorer(coat: number): ExplorerRig {
  const group = new Group()
  const torso = new Group()
  torso.position.y = 0.58
  group.add(torso)
  torso.add(part(BOX, paint(coat), { at: [0, 0.22, 0], scale: [0.36, 0.46, 0.22] }))
  torso.add(part(BOX, paint(0x3f6f78), { at: [0, 0.22, 0.17], scale: [0.28, 0.4, 0.14] }))
  torso.add(part(BOX, paint(0x24272a), { at: [0, 0.2, -0.14], scale: [0.16, 0.1, 0.08] }))
  torso.add(ball(0xf0c9a0, [0.15, 0.16, 0.15], [0, 0.63, 0]))
  torso.add(ball(0x2a2118, [0.03, 0.03, 0.03], [-0.055, 0.65, -0.13]))
  torso.add(ball(0x2a2118, [0.03, 0.03, 0.03], [0.055, 0.65, -0.13]))
  torso.add(part(CYLINDER, paint(0xb4883f), { at: [0, 0.76, 0], scale: [0.28, 0.025, 0.28] }))
  torso.add(part(CYLINDER, paint(0x8e6a2c), { at: [0, 0.83, 0], scale: [0.14, 0.1, 0.14] }))
  const legs: [Group, Group] = [limb(0x3b4252, 0.07, 0.58, [-0.1, 0.58, 0]), limb(0x3b4252, 0.07, 0.58, [0.1, 0.58, 0])]
  const arms: [Group, Group] = [limb(coat, 0.055, 0.4, [-0.23, 0.4, 0]), limb(coat, 0.055, 0.4, [0.23, 0.4, 0])]
  group.add(...legs)
  torso.add(...arms)
  group.traverse((object) => { object.castShadow = true })
  return { group, legs, arms, torso }
}

/** One frame of the figure's pose for a gait; `phase` is the stride in radians. */
export function poseExplorer(rig: ExplorerRig, gait: Gait, phase: number): void {
  const swing = gait === 'walk' ? 0.6 : gait === 'run' ? 1.0 : 0
  const s = Math.sin(phase) * swing
  if (gait === 'jump') {
    rig.legs[0].rotation.x = -0.7
    rig.legs[1].rotation.x = -0.4
    rig.arms[0].rotation.x = -2.4
    rig.arms[1].rotation.x = -2.4
  } else {
    rig.legs[0].rotation.x = s
    rig.legs[1].rotation.x = -s
    rig.arms[0].rotation.x = -s * 0.8
    rig.arms[1].rotation.x = s * 0.8
  }
  rig.torso.rotation.x = gait === 'run' ? -0.18 : 0
}
