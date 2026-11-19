/** The sea. Full: the scene mirrored (sky, shore, explorer) with a shore-distance tint. Balanced: the sky mirrored by formula.
 *  Light: one flat colour. */
import { Color, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Texture } from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { SKY_GLSL, type SkyUniforms } from './sky'
import { WATER_Y } from './terrain'

type WaterMode = 'reflect' | 'sky' | 'flat'

interface WaterUniforms {
  uDeep: { value: Color }
  uShallow: { value: Color }
  uFogColor: { value: Color }
  uFogDensity: { value: number }
  uShore: { value: Texture | null }
  uLight: { value: number }
  uFoam: { value: number }
}

export function createWaterUniforms(): WaterUniforms {
  return {
    uDeep: { value: new Color() },
    uShallow: { value: new Color() },
    uFogColor: { value: new Color() },
    uFogDensity: { value: 0.006 },
    uShore: { value: null },
    uLight: { value: 1 },
    uFoam: { value: 1 },
  }
}

const VERTEX = /* glsl */ `
uniform mat4 textureMatrix;
varying vec3 vWorld;
varying vec4 vUv;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`

const fragment = (mode: WaterMode): string => /* glsl */ `
${mode === 'reflect' ? '#define REFLECT' : mode === 'sky' ? '#define MIRROR_SKY' : ''}
${SKY_GLSL}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uShore;
uniform float uLight;
uniform float uFoam;
varying vec3 vWorld;
varying vec4 vUv;
#ifdef REFLECT
uniform sampler2D tDiffuse;
#endif
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float dist = texture2D(uShore, (vWorld.xz + vec2(12.0)) / 48.0).r * 3.0;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 2.4, dist)) * uLight;
#if defined(REFLECT) || defined(MIRROR_SKY)
  float fresnel = 0.3 + 0.62 * pow(1.0 - clamp(view.y, 0.0, 1.0), 2.0);
  fresnel *= 0.55 + 0.45 * smoothstep(0.1, 1.2, dist);
#ifdef REFLECT
  vec2 wobble = (vec2(vnoise(vWorld.xz * 1.3), vnoise(vWorld.xz * 1.3 + 17.0)) - 0.5) * 0.03;
  vec3 mirrored = texture2DProj(tDiffuse, vec4(vUv.xy + wobble * vUv.w, vUv.zw)).rgb;
#else
  vec3 mirrored = skyColor(reflect(-view, vec3(0.0, 1.0, 0.0)));
#endif
  col = mix(col, mirrored, fresnel);
  col = mix(col, vec3(1.0) * uLight, uFoam * smoothstep(0.3, 0.04, dist) * 0.65);
#endif
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dot(vWorld - cameraPosition, vWorld - cameraPosition));
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

export class Water {
  readonly reflect: Reflector
  readonly sky: Mesh
  readonly flat: Mesh
  private readonly geometry = new PlaneGeometry(420, 420)
  private mode: WaterMode = 'flat'

  constructor(private readonly sharedSky: SkyUniforms, private readonly shared: WaterUniforms) {
    const uniforms = (): Record<string, { value: unknown }> => ({ ...this.sharedSky, ...this.shared })
    const flatMaterial = new ShaderMaterial({ uniforms: { ...uniforms(), textureMatrix: { value: new Matrix4() }, tDiffuse: { value: null } }, vertexShader: VERTEX, fragmentShader: fragment('flat') })
    const skyMaterial = new ShaderMaterial({ uniforms: { ...uniforms(), textureMatrix: { value: new Matrix4() }, tDiffuse: { value: null } }, vertexShader: VERTEX, fragmentShader: fragment('sky') })
    this.flat = new Mesh(this.geometry, flatMaterial)
    this.sky = new Mesh(this.geometry, skyMaterial)
    for (const mesh of [this.flat, this.sky]) {
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = WATER_Y
      mesh.frustumCulled = false
    }
    this.reflect = new Reflector(this.geometry, {
      textureWidth: 640,
      textureHeight: 400,
      clipBias: 0.003,
      shader: {
        name: 'HushfootWater',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, ...uniforms() },
        vertexShader: VERTEX,
        fragmentShader: fragment('reflect'),
      },
    })
    const material = this.reflect.material as ShaderMaterial
    for (const [name, uniform] of Object.entries(uniforms())) material.uniforms[name] = uniform
    this.reflect.rotation.x = -Math.PI / 2
    this.reflect.position.y = WATER_Y
    this.reflect.frustumCulled = false
  }

  get meshes(): Mesh[] {
    return [this.flat, this.sky, this.reflect]
  }

  setMode(mode: WaterMode): void {
    this.mode = mode
    this.flat.visible = mode === 'flat'
    this.sky.visible = mode === 'sky'
    this.reflect.visible = mode === 'reflect'
  }

  get current(): WaterMode {
    return this.mode
  }

  dispose(): void {
    this.geometry.dispose()
    ;(this.flat.material as ShaderMaterial).dispose()
    ;(this.sky.material as ShaderMaterial).dispose()
    this.reflect.dispose()
  }
}
