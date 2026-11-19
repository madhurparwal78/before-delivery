/**
 * The public live canvas: an original procedural thin-film field of oily
 * interference bands that drift and thicken, coloured by the piece itself
 * through its public uniforms and its edition seed. A piece's own
 * `fragment_source` is owner-only, so only the editor compiles that.
 */
export const PUBLIC_PIECE_SHADER = `precision mediump float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed;
uniform float uHue;
uniform float uFilm;
uniform float uDrift;

/** Thin-film interference: each extra wavelength of thickness turns the hue. */
vec3 interference(float thickness, float hue) {
  return 0.5 + 0.5 * cos(6.28318 * (thickness * vec3(1.0, 0.82, 0.66) + hue + vec3(0.0, 0.12, 0.26)));
}

float ripple(vec2 p, float t, float seed) {
  float a = sin(p.x * 3.1 + sin(p.y * 2.2 - t * 0.7) * 1.6 + t);
  float b = sin(p.y * 4.3 - sin(p.x * 1.7 + t * 0.5) * 1.9 - t * 0.8 + seed);
  float c = sin((p.x + p.y) * 2.6 + t * 1.3 + seed * 2.0);
  return a * 0.45 + b * 0.35 + c * 0.2;
}

void main() {
  vec2 p = gl_FragCoord.xy / uResolution;
  vec2 q = vec2(p.x * (uResolution.x / max(uResolution.y, 1.0)), p.y);
  float t = uTime * 0.17 * (0.35 + uDrift) + uSeed * 6.28318;

  float slick = ripple(q * 2.4, t, uSeed * 6.0);

  // The film thickens toward the bottom edge, so the bands crowd together there.
  float thickness = (1.0 - p.y) * (3.4 + uFilm * 7.0) + slick * (1.2 + uFilm * 2.6) + uSeed * 2.0;

  vec3 colour = interference(thickness, uHue);

  // Nocturnal: the slick keeps its iridescence but sits deep in the dark, so
  // ink text laid over the stage keeps its contrast.
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  colour = mix(vec3(luma), colour, 0.72);

  float sheen = smoothstep(-1.1, 1.0, slick) * 0.42 + 0.12;
  float fade = smoothstep(1.25, 0.0, p.y);
  colour *= sheen * (0.26 + 0.74 * fade);

  // A faint oily rim light along the band edges.
  float edge = abs(fract(thickness) - 0.5);
  colour += (1.0 - smoothstep(0.0, 0.07, edge)) * 0.05 * fade;

  gl_FragColor = vec4(colour, 1.0);
}
`;

export interface PublicUniforms {
  readonly uHue: number;
  readonly uFilm: number;
  readonly uDrift: number;
}

const DEFAULTS: PublicUniforms = { uHue: 0.55, uFilm: 0.42, uDrift: 0.8 };

/** Maps a piece's faders onto the public shader's uniform contract. */
export function publicUniformsFrom(
  uniforms: readonly { name: string; value: number }[],
): { name: string; value: number }[] {
  const read = (name: keyof PublicUniforms): number =>
    uniforms.find((uniform) => uniform.name === name)?.value ?? DEFAULTS[name];
  return [
    { name: 'uHue', value: read('uHue') },
    { name: 'uFilm', value: read('uFilm') },
    { name: 'uDrift', value: read('uDrift') },
  ];
}
