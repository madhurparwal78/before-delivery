// The hue dial of every seeded piece: one hue per value of 0..1, kept off the violet and magenta arc.
const HUE = `vec3 hue(float u) {
  float h = fract(0.958 + fract(u) * 0.736);
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}`;

const TIDEWIRE_BLOOM = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime, uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;

${HUE}

vec3 film(float d, float h) {
  return mix(vec3(0.9), hue(d * 0.4 + h), 0.78);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = (p - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * uDrift;
  float s = uSeed * 6.28318;
  float r = length(q);
  float a = atan(q.y, q.x);
  float petals = 4.0 + floor(uSeed * 5.0);
  float bloom = r * (1.0 + 0.35 * sin(a * petals + s + t * 0.6));
  vec2 w = q * 3.0 + vec2(sin(t * 0.4 + s), cos(t * 0.3 - s));
  float swirl = sin(w.x + sin(w.y * 1.7 + t)) + cos(w.y * 1.3 - sin(w.x * 2.1 - t * 0.7));
  float thick = (0.6 + 1.6 * uFilm) * (1.0 + 0.2 * sin(t * 0.5)) * (bloom * 6.0 + swirl * 0.8) - t * 0.5;
  vec3 col = film(thick * 0.35, uHue);
  float bands = pow(0.5 + 0.5 * sin(thick * 3.14159), 3.0);
  float glow = exp(-bloom * 2.2) * (0.6 + 0.4 * sin(t * 0.8 + s));
  float edge = smoothstep(1.0, 0.1, bloom);
  vec3 c = col * (0.08 + 0.85 * bands * edge) + col * glow * 0.3;
  c *= 0.55 + 0.45 * smoothstep(0.0, 0.6, abs(swirl));
  gl_FragColor = vec4(c, 1.0);
}
`;

const SALT_HALO = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime, uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;

${HUE}

float hash(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = (p - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * uDrift;
  vec2 c1 = vec2(0.18 * sin(uSeed * 12.0), 0.12 * cos(uSeed * 9.0) - 0.12 * uSeed);
  vec2 c2 = -c1 * 1.6 + vec2(0.1 * sin(t * 0.2), 0.05 * cos(t * 0.17));
  float d1 = length(q - c1);
  float d2 = length(q - c2);
  float breathe = 1.0 + 0.12 * sin(t * 0.9);
  float ringsA = abs(sin(d1 * (18.0 + 10.0 * uSeed) / breathe - t * 1.3));
  float ringsB = abs(sin(d2 * (11.0 + 6.0 * uFilm) * breathe + t * 0.8 + uSeed * 20.0));
  float halo = pow(1.0 - ringsA, 6.0) + 0.6 * pow(1.0 - ringsB, 8.0);
  float grain = hash(floor(gl_FragCoord.xy / 3.0) + floor(t * 12.0) + uSeed * 91.0);
  float crystal = step(0.82 - 0.2 * uFilm, hash(floor(q * 60.0 * breathe) + uSeed * 17.0));
  float fade = exp(-min(d1, d2) * 2.4);
  vec3 hueCol = hue(uHue + d1 * 0.15);
  vec3 salt = mix(vec3(0.92, 0.9, 0.84), hueCol, 0.45);
  vec3 col = salt * halo * fade * (0.7 + 0.3 * grain);
  col += salt * crystal * halo * fade * 0.5;
  col += hueCol * 0.04 * grain + vec3(0.02, 0.02, 0.025);
  gl_FragColor = vec4(col, 1.0);
}
`;

const LANTERN_STATIC = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime, uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;

${HUE}

float hash(vec2 v) {
  return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = (p - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * uDrift;
  float frame = floor(t * 24.0);
  float noise = hash(floor(gl_FragCoord.xy / 2.0) + vec2(frame * 7.0, frame * 3.0 + uSeed * 50.0));
  float tear = smoothstep(0.04, 0.0, abs(fract(p.y + t * 0.13 + uSeed) - 0.5));
  q.x += tear * ((noise - 0.5) * 0.08 + 0.03 * sin(t * 11.0));
  vec2 lp = vec2(0.25 * sin(uSeed * 17.0 + t * 0.15), 0.18 * cos(uSeed * 11.0) + 0.03 * sin(t * 0.5));
  vec2 d = q - lp;
  float r = length(d);
  float rays = 0.75 + 0.25 * cos(atan(d.y, d.x) * (5.0 + floor(uSeed * 4.0)) + t * 0.2);
  float flick = 0.82 + 0.18 * sin(t * 6.0 + 3.0 * sin(t * 2.3 + uSeed * 9.0));
  float glow = flick * (exp(-r * (3.2 - 1.2 * uFilm)) * rays + 0.5 * exp(-r * 14.0));
  vec3 warm = mix(vec3(1.0, 0.56, 0.2), hue(uHue), 0.35);
  float scan = 0.7 + 0.3 * sin(gl_FragCoord.y * 1.7 + t * 9.0);
  float roll = 0.85 + 0.15 * smoothstep(0.0, 0.2, abs(fract(p.y * 0.5 - t * 0.25) - 0.5));
  vec3 col = warm * glow * scan * roll;
  col += (noise - 0.5) * (0.06 + 0.25 * tear) * (0.3 + glow);
  col += vec3(0.015, 0.01, 0.008);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const NIGHT_LOOM = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime, uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;

${HUE}

vec3 tint(float h) {
  return mix(vec3(1.0), hue(h), 0.82);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = p * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * uDrift;
  vec2 g = q * (12.0 + floor(uSeed * 10.0));
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float width = 0.1 + 0.1 * uFilm;
  float warpWave = 0.18 * sin(g.y * 0.35 + id.x * 1.7 + uSeed * 30.0 + t * 1.1);
  float weftWave = 0.18 * sin(g.x * 0.3 + id.y * 2.3 - uSeed * 20.0 - t * 1.3);
  float warp = smoothstep(width, 0.0, abs(f.x + warpWave));
  float weft = smoothstep(width, 0.0, abs(f.y + weftWave));
  float lw = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(id.x * 0.9 + uSeed * 13.0 - t * 2.4), 4.0);
  float shuttle = fract(q.x * 0.4 - t * 0.2 + uSeed) - 0.5;
  float lf = 0.2 + 0.6 * exp(-shuttle * shuttle * 40.0) + 0.2 * sin(id.y * 1.3 + t);
  vec3 cw = tint(uHue + id.x * 0.01) * warp * lw;
  vec3 cf = tint(uHue + 0.15 + 0.35 * uFilm) * weft * max(lf, 0.05);
  float top = step(1.0, mod(id.x + id.y, 2.0));
  vec3 c = mix(cw + cf * (1.0 - warp), cf + cw * (1.0 - weft), top);
  c *= 0.6 + 0.4 * cos(mix(f.y, f.x, top) * 3.14159);
  gl_FragColor = vec4(c * 0.85 + vec3(0.01, 0.01, 0.015), 1.0);
}
`;

export const SEED_SHADERS = {
  "tidewire-bloom": TIDEWIRE_BLOOM,
  "salt-halo": SALT_HALO,
  "lantern-static": LANTERN_STATIC,
  "night-loom": NIGHT_LOOM,
} as const;
