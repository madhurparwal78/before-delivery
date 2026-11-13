// GLSL for the Helix scene. One program draws every surface: the drum cells, the lifted strips, the page,
// the playhead ribbon and the drum's top cap. The same source builds for WebGL 2 and WebGL 1.

const VERTEX_BODY = `
precision mediump int;
ATTRIBUTE vec2 aUV;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform int uMode;
uniform vec2 uSize;
uniform float uCurv;
uniform vec3 uOffset;
uniform float uYaw;
uniform vec2 uCap;
VARYING vec2 vUV;
VARYING vec3 vNormal;
VARYING vec3 vWorld;

void main() {
  vec3 p;
  vec3 n;
  if (uMode == 3) {
    float th = aUV.x * 6.2831853;
    p = vec3(sin(th), 0.0, cos(th)) * (aUV.y * uCap.x);
    p.y = uCap.y;
    n = vec3(0.0, 1.0, 0.0);
  } else {
    float s = (aUV.x - 0.5) * uSize.x;
    float ph = s * uCurv;
    float cx = s;
    float cz = 0.0;
    if (abs(uCurv) > 0.00001) {
      cx = sin(ph) / uCurv;
      cz = (cos(ph) - 1.0) / uCurv;
    }
    p = vec3(cx, (0.5 - aUV.y) * uSize.y, cz) + uOffset;
    n = vec3(sin(ph), 0.0, cos(ph));
    float c = cos(uYaw);
    float sn = sin(uYaw);
    p = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
    n = vec3(c * n.x + sn * n.z, n.y, -sn * n.x + c * n.z);
  }
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = (uModel * vec4(n, 0.0)).xyz;
  vUV = aUV;
  gl_Position = uProj * uView * world;
}
`

const PRECISION = `#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nprecision mediump int;\n`

const FRAGMENT_BODY = `
uniform sampler2D uTex;
uniform vec4 uRect;
uniform vec2 uTexel;
uniform float uBlur;
uniform float uOpacity;
uniform float uLit;
uniform vec3 uEye;
uniform vec3 uTint;
uniform int uMode;
VARYING vec2 vUV;
VARYING vec3 vNormal;
VARYING vec3 vWorld;

vec3 fetch(vec2 uv, float bias) {
#ifdef GL2
  return texture(uTex, uv, bias).rgb;
#else
  return texture2D(uTex, uv).rgb;
#endif
}

vec3 sampleSoft(vec2 uv) {
  if (uBlur < 0.002) return fetch(uv, 0.0);
  float radius = uBlur * 7.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 5.0);
    float a = fi * 2.39996323;
    vec2 off = vec2(cos(a), sin(a)) * r * radius * uTexel;
    sum += fetch(uv + off, uBlur * 3.0);
  }
  return sum / 5.0;
}

const vec3 LIGHT = vec3(-0.78, 0.5, 0.5);

float shadeFor(vec3 n) {
  vec3 toEye = normalize(uEye - vWorld);
  float lambert = max(dot(n, normalize(LIGHT)), 0.0);
  float rim = pow(max(dot(n, toEye), 0.0), 0.45);
  return min(1.0, (0.3 + 0.78 * lambert * lambert + 0.1 * lambert) * (0.6 + 0.4 * rim));
}

float sheenFor(vec3 n) {
  vec3 toEye = normalize(uEye - vWorld);
  vec3 bounce = reflect(-normalize(LIGHT), n);
  return pow(max(dot(bounce, toEye), 0.0), 10.0) * 0.1;
}

void main() {
  vec3 n = normalize(vNormal);
  vec4 color;
  if (uMode == 0) {
    vec2 uv = mix(uRect.xy, uRect.zw, vUV);
    vec3 paper = sampleSoft(uv);
    vec3 lit = paper * mix(1.0, shadeFor(n), uLit) + vec3(sheenFor(n) * uLit);
    color = vec4(lit * uOpacity, uOpacity);
  } else if (uMode == 1) {
    float x = (vUV.x - 0.5) * 2.0;
    float core = exp(-x * x * 26.0);
    float halo = exp(-x * x * 3.2);
    float ends = smoothstep(0.0, 0.07, vUV.y) * smoothstep(1.0, 0.93, vUV.y);
    float a = clamp(0.55 * halo + 0.75 * core, 0.0, 1.0) * ends * uOpacity;
    vec3 hot = mix(uTint, vec3(1.0, 0.8, 0.66), core * 0.6);
    color = vec4(hot * a, a);
  } else if (uMode == 2) {
    float ex = min(vUV.x, 1.0 - vUV.x);
    float ey = min(vUV.y, 1.0 - vUV.y);
    float a = smoothstep(0.0, 0.3, ex) * smoothstep(0.0, 0.3, ey) * uOpacity;
    color = vec4(uTint * a, a);
  } else {
    float rimBand = smoothstep(0.93, 1.0, vUV.y);
    float well = 1.0 - 0.1 * smoothstep(0.0, 0.9, vUV.y);
    vec3 top = uTint * 0.86 * well * (1.0 - 0.22 * rimBand);
    color = vec4(top * uOpacity, uOpacity);
  }
  OUT(color);
}
`

interface ShaderSources {
  vertex: string
  fragment: string
}

export function shaderSources(webgl2: boolean): ShaderSources {
  if (webgl2) {
    return {
      vertex: `#version 300 es\n#define GL2 1\n#define ATTRIBUTE in\n#define VARYING out\n${VERTEX_BODY}`,
      fragment:
        `#version 300 es\n#define GL2 1\n${PRECISION}#define VARYING in\nout vec4 outColor;\n#define OUT(c) outColor = (c)\n${FRAGMENT_BODY}`,
    }
  }
  return {
    vertex: `#define ATTRIBUTE attribute\n#define VARYING varying\n${VERTEX_BODY}`,
    fragment: `${PRECISION}#define VARYING varying\n#define OUT(c) gl_FragColor = (c)\n${FRAGMENT_BODY}`,
  }
}

export const UNIFORM_NAMES = [
  'uProj', 'uView', 'uModel', 'uMode', 'uSize', 'uCurv', 'uOffset', 'uYaw', 'uCap',
  'uTex', 'uRect', 'uTexel', 'uBlur', 'uOpacity', 'uLit', 'uEye', 'uTint',
] as const

export type UniformName = (typeof UNIFORM_NAMES)[number]
