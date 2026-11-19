/** Depth of field for photo mode: the scene is drawn with its depth, then blurred by how far each pixel is from the focus.
 *  Focus is in tiles in front of the camera, so the Mossback newt four tiles away is sharp at focus 4 and soft at focus 16. */
import {
  DepthTexture, HalfFloatType, Mesh, NearestFilter, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial,
  UnsignedIntType, WebGLRenderTarget, type WebGLRenderer, type Object3D,
} from 'three'

const FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uFocus;
uniform float uStrength;
uniform float uNear;
uniform float uFar;
uniform float uUnits;
varying vec2 vUv;
float tilesAt(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  float viewZ = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  return viewZ * uUnits;
}
float blurAt(float tiles) {
  return min(1.0, abs(1.0 / uFocus - 1.0 / max(tiles, 0.3)) * uStrength);
}
void main() {
  float centre = blurAt(tilesAt(vUv));
  vec3 sum = texture2D(tColor, vUv).rgb;
  float weight = 1.0;
  const int TAPS = 20;
  for (int i = 0; i < TAPS; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / float(TAPS));
    float a = f * 2.39996323;
    vec2 offset = vec2(cos(a), sin(a)) * r * centre;
    vec2 uv = vUv + offset * uTexel * 14.0;
    float other = blurAt(tilesAt(uv));
    float w = other >= r * centre * 0.9 ? 1.0 : 0.12;
    sum += texture2D(tColor, uv).rgb * w;
    weight += w;
  }
  gl_FragColor = vec4(sum / weight, 1.0);
  #include <colorspace_fragment>
}`

export class DepthOfField {
  private target: WebGLRenderTarget
  private readonly material: ShaderMaterial
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: Mesh

  constructor(width: number, height: number) {
    this.target = this.makeTarget(width, height)
    this.material = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture }, uTexel: { value: [1 / width, 1 / height] },
        uFocus: { value: 4 }, uStrength: { value: 2.2 }, uNear: { value: 0.1 }, uFar: { value: 600 }, uUnits: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  private makeTarget(width: number, height: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, magFilter: NearestFilter, minFilter: NearestFilter })
    target.depthTexture = new DepthTexture(width, height, UnsignedIntType)
    return target
  }

  resize(width: number, height: number): void {
    this.target.dispose()
    this.target = this.makeTarget(width, height)
    this.material.uniforms.tColor!.value = this.target.texture
    this.material.uniforms.tDepth!.value = this.target.depthTexture
    this.material.uniforms.uTexel!.value = [1 / width, 1 / height]
  }

  /** Draw `scene` with depth of field onto the screen. `unitsPerTile`: scene units in one tile. */
  render(renderer: WebGLRenderer, scene: Object3D, camera: PerspectiveCamera, focusTiles: number, unitsPerTile = 1): void {
    const uniforms = this.material.uniforms
    uniforms.uFocus!.value = focusTiles
    uniforms.uNear!.value = camera.near
    uniforms.uFar!.value = camera.far
    uniforms.uUnits!.value = 1 / unitsPerTile
    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    this.target.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}

