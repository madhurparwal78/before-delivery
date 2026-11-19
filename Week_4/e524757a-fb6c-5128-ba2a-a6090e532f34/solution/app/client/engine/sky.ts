/** The sun, sky and light for a world hour and weather, and the sky dome that draws them. */
import { BackSide, Color, IcosahedronGeometry, Mesh, ShaderMaterial, Vector3 } from 'three'

export interface SkyState {
  top: Color
  horizon: Color
  sunColor: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  sunDir: Vector3
  /** 0 by day, 1 in the dark. */
  night: number
  /** 0..1 how much daylight there is (for flat water and ambient). */
  day: number
}

interface Key { t: number; top: number; horizon: number; sun: number; sunI: number; hemiSky: number; hemiGround: number; hemiI: number }

const KEYS: Key[] = [
  { t: 0, top: 0x050914, horizon: 0x101a33, sun: 0x000000, sunI: 0, hemiSky: 0x3a4d80, hemiGround: 0x10141f, hemiI: 0.9 },
  { t: 5, top: 0x070c1c, horizon: 0x14203d, sun: 0x000000, sunI: 0, hemiSky: 0x3a4d80, hemiGround: 0x10141f, hemiI: 0.9 },
  { t: 6, top: 0x3f5d9b, horizon: 0xf2a66a, sun: 0xffa860, sunI: 1.6, hemiSky: 0x93a4c8, hemiGround: 0x4a4034, hemiI: 1.3 },
  { t: 7.5, top: 0x4f8fd6, horizon: 0xdfe9e8, sun: 0xfff0d0, sunI: 2.6, hemiSky: 0xa8c8f0, hemiGround: 0x6b6a50, hemiI: 1.7 },
  { t: 9.5, top: 0x3d86d8, horizon: 0xbfe3f7, sun: 0xfffaf0, sunI: 3.1, hemiSky: 0xbcd8f5, hemiGround: 0x7a7a58, hemiI: 1.8 },
  { t: 15, top: 0x3d86d8, horizon: 0xbfe3f7, sun: 0xfffaf0, sunI: 3.1, hemiSky: 0xbcd8f5, hemiGround: 0x7a7a58, hemiI: 1.8 },
  { t: 17, top: 0x4a88d0, horizon: 0xd8e2e0, sun: 0xffe2b0, sunI: 2.6, hemiSky: 0xb4cbe8, hemiGround: 0x7a6e50, hemiI: 1.6 },
  { t: 18.3, top: 0x5a6aa8, horizon: 0xf08a4b, sun: 0xff8a3c, sunI: 2.0, hemiSky: 0x9aa0c8, hemiGround: 0x6a4a3a, hemiI: 1.25 },
  { t: 19.5, top: 0x2d3270, horizon: 0x9a4a5c, sun: 0xff6a3c, sunI: 0.7, hemiSky: 0x6a68a0, hemiGround: 0x3a2a34, hemiI: 1.0 },
  { t: 20.7, top: 0x070c1c, horizon: 0x14203d, sun: 0x000000, sunI: 0, hemiSky: 0x3a4d80, hemiGround: 0x10141f, hemiI: 0.9 },
  { t: 24, top: 0x050914, horizon: 0x101a33, sun: 0x000000, sunI: 0, hemiSky: 0x3a4d80, hemiGround: 0x10141f, hemiI: 0.9 },
]

const GREY_TOP = new Color(0x7d8894)
const GREY_HORIZON = new Color(0xaab2ba)
const MOON = new Color(0x9db4ff)

/** Daylight runs 5:30 to 19:30; the sun is low and warm at 18:20. */
function sunAngle(t: number): number {
  return ((t - 5.5) / 14) * Math.PI
}

export function skyState(hour: number, minute: number, weather: 'clear' | 'rain'): SkyState {
  const t = hour + minute / 60
  let at = 0
  while (at < KEYS.length - 2 && t >= (KEYS[at + 1] as Key).t) at++
  const a = KEYS[at] as Key
  const b = KEYS[at + 1] as Key
  const k = (t - a.t) / (b.t - a.t)
  const mix = (x: number, y: number): Color => new Color(x).lerp(new Color(y), k)
  const state: SkyState = {
    top: mix(a.top, b.top),
    horizon: mix(a.horizon, b.horizon),
    sunColor: mix(a.sun, b.sun),
    sunIntensity: a.sunI + (b.sunI - a.sunI) * k,
    hemiSky: mix(a.hemiSky, b.hemiSky),
    hemiGround: mix(a.hemiGround, b.hemiGround),
    hemiIntensity: a.hemiI + (b.hemiI - a.hemiI) * k,
    sunDir: new Vector3(),
    night: 0,
    day: 0,
  }
  const angle = sunAngle(t)
  const elevation = Math.sin(angle)
  const dir = new Vector3(Math.cos(angle), elevation, 0.4).normalize()
  state.night = Math.min(1, Math.max(0, (0.12 - elevation) / 0.3))
  state.day = Math.min(1, Math.max(0.12, elevation * 1.6))
  if (elevation < 0.04) {
    // the moon takes the sun's place, opposite and faint
    dir.set(-Math.cos(angle), Math.max(0.35, -elevation), 0.4).normalize()
    state.sunColor.copy(MOON)
    state.sunIntensity = 0.55
  } else {
    dir.y = Math.max(dir.y, 0.2)
    dir.normalize()
  }
  state.sunDir.copy(dir)
  if (weather === 'rain') {
    const grey = 0.75
    state.top.lerp(GREY_TOP.clone().multiplyScalar(0.4 + 0.6 * state.day), grey)
    state.horizon.lerp(GREY_HORIZON.clone().multiplyScalar(0.3 + 0.7 * state.day), grey)
    state.sunIntensity *= 0.35
    state.hemiSky.lerp(GREY_HORIZON, 0.5)
    state.hemiIntensity *= 1.05
  }
  return state
}

/** Shared by the sky dome and the water's mirrored sky. */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
float skyHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 skyColor(vec3 d) {
  float h = clamp(d.y, -0.3, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.5));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.3, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 10.0) * 0.22 + pow(s, 600.0) * 2.5);
  float star = step(0.9965, skyHash(floor(d * 240.0)));
  col += vec3(0.9) * star * uNight * smoothstep(0.05, 0.4, d.y);
  return col;
}
`

export interface SkyUniforms {
  uTop: { value: Color }
  uHorizon: { value: Color }
  uSunDir: { value: Vector3 }
  uSunColor: { value: Color }
  uNight: { value: number }
}

export function createSkyUniforms(): SkyUniforms {
  return {
    uTop: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color() },
    uNight: { value: 0 },
  }
}

export function applySkyState(uniforms: SkyUniforms, state: SkyState): void {
  uniforms.uTop.value.copy(state.top)
  uniforms.uHorizon.value.copy(state.horizon)
  uniforms.uSunDir.value.copy(state.sunDir)
  uniforms.uSunColor.value.copy(state.sunColor)
  uniforms.uNight.value = state.night
}

export function createSkyDome(uniforms: SkyUniforms): Mesh {
  const material = new ShaderMaterial({
    uniforms: { ...uniforms },
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const dome = new Mesh(new IcosahedronGeometry(450, 3), material)
  dome.renderOrder = -100
  dome.frustumCulled = false
  return dome
}
