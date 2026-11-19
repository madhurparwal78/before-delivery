/** Small helpers for building low-poly bodies from a handful of shared primitives. Local forward is -z. */
import {
  BoxGeometry, ConeGeometry, CylinderGeometry, type BufferGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry,
  type Material,
} from 'three'

export const SPHERE = new SphereGeometry(1, 10, 8)
export const CYLINDER = new CylinderGeometry(1, 1, 1, 8)
const CONE = new ConeGeometry(1, 1, 8)
export const BOX = new BoxGeometry(1, 1, 1)

const materials = new Map<string, MeshLambertMaterial>()

export function paint(color: number, emissive = 0, flat = true): MeshLambertMaterial {
  const key = `${color}:${emissive}:${flat}`
  let material = materials.get(key)
  if (!material) {
    material = new MeshLambertMaterial({ color, flatShading: flat })
    if (emissive) material.emissive.setHex(emissive)
    materials.set(key, material)
  }
  return material
}

interface Placement { at?: [number, number, number]; scale?: [number, number, number]; rotate?: [number, number, number] }

export function part(geometry: BufferGeometry, material: Material, { at = [0, 0, 0], scale = [1, 1, 1], rotate = [0, 0, 0] }: Placement = {}): Mesh {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(...at)
  mesh.scale.set(...scale)
  mesh.rotation.set(...rotate)
  mesh.castShadow = true
  return mesh
}

export const ball = (color: number, scale: [number, number, number], at: [number, number, number], emissive = 0): Mesh =>
  part(SPHERE, paint(color, emissive), { at, scale })

export const pillar = (color: number, radius: number, length: number, at: [number, number, number], rotate: [number, number, number] = [0, 0, 0]): Mesh =>
  part(CYLINDER, paint(color), { at, scale: [radius, length, radius], rotate })

export const spike = (color: number, radius: number, length: number, at: [number, number, number], rotate: [number, number, number] = [0, 0, 0]): Mesh =>
  part(CONE, paint(color), { at, scale: [radius, length, radius], rotate })

/** A group that hangs from a joint: children are offset down by half `length` so rotating the joint swings the limb. */
export function limb(color: number, radius: number, length: number, joint: [number, number, number]): Group {
  const group = new Group()
  group.position.set(...joint)
  group.add(pillar(color, radius, length, [0, -length / 2, 0]))
  return group
}
