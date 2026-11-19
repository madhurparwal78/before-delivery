/**
 * Original GLSL ES 1.0 fragment shaders for the seeded pieces. Each reads the
 * uniform contract: uResolution, uTime, uSeed and the piece's own uniforms.
 */

const PREAMBLE = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;
`;

/** Oily interference bands that drift and thicken toward one edge. */
export const TIDEWIRE_BLOOM = `${PREAMBLE}
vec3 film(float thickness, float hue) {
  return 0.5 + 0.5 * cos(6.28318 * (hue + thickness * vec3(1.0, 0.82, 0.66) + vec3(0.0, 0.28, 0.56)));
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  float t = uTime * 0.18 * uDrift + uSeed * 6.28318;
  float weave = sin(p.x * 7.0 + t) * 0.5
              + sin(p.y * 11.0 - t * 0.7) * 0.3
              + sin((p.x + p.y) * 5.0 + t * 1.3) * 0.2;
  float thickness = uFilm * (1.4 + weave) + (1.0 - p.y) * 0.9;
  vec3 colour = film(thickness, uHue);
  float bloom = smoothstep(1.1, -0.2, p.y + weave * 0.15);
  colour *= 0.3 + 0.85 * bloom;
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** A standing halo of brine rings with a drifting grain. */
export const SALT_HALO = `${PREAMBLE}
float grain(vec2 p) {
  return fract(sin(dot(p, vec2(41.17, 289.3))) * 24634.6345);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);
  float t = uTime * 0.22 * uDrift + uSeed * 6.28318;
  float radius = length(p) * (2.2 + uFilm * 1.6);
  float rings = sin(radius * 9.0 - t * 2.0) * 0.5 + 0.5;
  float halo = exp(-radius * radius * 1.4);
  float salt = grain(floor(gl_FragCoord.xy * 0.5) + floor(t * 3.0)) * 0.16;
  vec3 colour = 0.5 + 0.5 * cos(6.28318 * (uHue + rings * 0.35 + vec3(0.0, 0.2, 0.45)));
  colour *= halo * (0.55 + 0.75 * rings) + salt;
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** A hanging lantern whose light breaks into static as it swings. */
export const LANTERN_STATIC = `${PREAMBLE}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(93.73, 17.21))) * 43758.5453);
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  float t = uTime * 0.3 * uDrift + uSeed * 6.28318;
  float swing = sin(t * 0.8) * 0.12;
  vec2 lamp = vec2(0.5 + swing, 0.72);
  float fall = distance(p, lamp);
  float glow = exp(-fall * fall * (5.0 - uFilm * 3.0));
  float bars = sin((p.y + t * 0.1) * 160.0) * 0.5 + 0.5;
  float noise = hash(floor(gl_FragCoord.xy) + floor(t * 20.0));
  float lit = glow * (0.72 + 0.28 * bars) + noise * 0.1 * glow;
  vec3 colour = 0.5 + 0.5 * cos(6.28318 * (uHue + lit * 0.5 + vec3(0.0, 0.15, 0.35)));
  gl_FragColor = vec4(colour * lit * 1.5, 1.0);
}
`;

/** A slow loom of warp threads crossing in the dark. */
export const NIGHT_LOOM = `${PREAMBLE}
void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  float t = uTime * 0.14 * uDrift + uSeed * 6.28318;

  // Warp and weft are thin lit threads, not a filled weave.
  float warp = abs(sin(p.x * 70.0 + sin(p.y * 2.4 + t) * 1.8));
  float weft = abs(sin(p.y * 52.0 - sin(p.x * 1.8 - t * 0.7) * 1.8));
  float threads = pow(1.0 - warp, 7.0) + pow(1.0 - weft, 9.0) * 0.7;

  float sheen = 0.35 + 0.65 * sin(p.y * 2.0 + t * 0.5) * 0.5 + 0.5;
  float lit = threads * (0.4 + uFilm * 0.9) * sheen;

  vec3 colour = 0.5 + 0.5 * cos(6.28318 * (uHue + lit * 0.3 + vec3(0.0, 0.2, 0.42)));
  vec3 ground = vec3(0.016, 0.018, 0.024);
  gl_FragColor = vec4(ground + colour * lit, 1.0);
}
`;
