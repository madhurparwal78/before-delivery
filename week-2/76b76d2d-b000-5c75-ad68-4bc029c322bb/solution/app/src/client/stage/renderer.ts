import { BLADES, bladePolygon, type IrisFrame } from "./iris.ts";

export type RendererState = { renderer: "webgl" | "svg"; context: "ok" | "lost" | "none" };

const VERTEX = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Nine metal blades around a nonagon aperture; the opening stays transparent so the tinted ground shows through. */
const FRAGMENT = `
precision highp float;
uniform vec2 uSize;
uniform float uRadius;
uniform float uRot;
uniform float uScale;
const float STEP = 0.6981317;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uSize;
  p.y = -p.y;
  float r = length(p);
  float edge = -1e9;
  for (int i = 0; i < 9; i++) {
    float a = uRot + float(i) * STEP;
    edge = max(edge, dot(p, vec2(cos(a), sin(a))) - uRadius);
  }
  if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float s = (atan(p.y, p.x) - uRot + 0.3490659) / STEP - 1.35 * log(max(r, 1.0) / max(uRadius, 1.0));
  float blade = mod(floor(s), 9.0);
  float across = fract(s);
  float tone = 0.25 + 0.45 * across + 0.12 * mod(blade, 2.0) + 0.05 * sin(blade * 2.3);
  vec3 col = mix(vec3(0.071, 0.063, 0.055), vec3(0.176, 0.161, 0.145), clamp(tone, 0.0, 1.0));
  float seam = min(across, 1.0 - across) * STEP * r;
  col *= mix(0.45, 1.0, smoothstep(0.0, 2.5 * uScale, seam));
  col += vec3(0.10, 0.095, 0.085) * (1.0 - smoothstep(0.0, 1.5 * uScale, abs(1.0 - across) * STEP * r));
  col += vec3(0.24, 0.23, 0.21) * (1.0 - smoothstep(0.0, 2.0 * uScale, edge));
  col *= 1.0 - 0.4 * smoothstep(uRadius, uRadius + 0.9 * length(uSize), r);
  gl_FragColor = vec4(col, 1.0);
}`;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Draws the iris with WebGL on a main-thread canvas, or with the SVG twin when WebGL is missing or its
 * context is lost (brief: Without WebGL). Drawing is synchronous so every frame follows the scroll event.
 */
export class IrisRenderer {
  state: RendererState;
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private last: IrisFrame | null = null;
  private readonly blades: SVGPolygonElement[] = [];
  private readonly rims: SVGLineElement[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly svg: SVGSVGElement, private readonly onState: (state: RendererState) => void) {
    this.buildSvg();
    this.gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    this.state = this.gl && this.setup() ? { renderer: "webgl", context: "ok" } : { renderer: "svg", context: "none" };
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.program = null;
      this.switchTo({ renderer: "svg", context: "lost" });
    });
    canvas.addEventListener("webglcontextrestored", () => {
      if (this.setup()) this.switchTo({ renderer: "webgl", context: "ok" });
    });
    this.applyVisibility();
  }

  draw(frame: IrisFrame): void {
    this.last = frame;
    if (this.state.renderer === "webgl") this.drawGl(frame);
    else this.drawSvg(frame);
  }

  private switchTo(state: RendererState): void {
    this.state = state;
    this.applyVisibility();
    if (this.last) this.draw(this.last);
    this.onState(state);
  }

  private applyVisibility(): void {
    this.canvas.hidden = this.state.renderer !== "webgl";
    this.svg.style.display = this.state.renderer === "svg" ? "block" : "none";
  }

  private setup(): boolean {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return false;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.program = program;
    return true;
  }

  private drawGl(frame: IrisFrame): void {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(gl.getUniformLocation(program, "uSize"), width, height);
    gl.uniform1f(gl.getUniformLocation(program, "uRadius"), frame.radius * scale);
    gl.uniform1f(gl.getUniformLocation(program, "uRot"), (frame.rotation * Math.PI) / 180);
    gl.uniform1f(gl.getUniformLocation(program, "uScale"), scale);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private buildSvg(): void {
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.innerHTML = `<linearGradient id="blade-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2D2A25"/><stop offset="1" stop-color="#121110"/></linearGradient>
<linearGradient id="blade-b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26231F"/><stop offset="1" stop-color="#0F0E0C"/></linearGradient>`;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "iris-blades");
    const rims = document.createElementNS(SVG_NS, "g");
    for (let i = 0; i < BLADES; i++) {
      const blade = document.createElementNS(SVG_NS, "polygon");
      blade.setAttribute("fill", `url(#${i % 2 ? "blade-b" : "blade-a"})`);
      blade.setAttribute("stroke", "#0B0A09");
      blade.setAttribute("stroke-width", "1.5");
      const rim = document.createElementNS(SVG_NS, "line");
      rim.setAttribute("stroke", "#8C857A");
      rim.setAttribute("stroke-width", "1.5");
      group.append(blade);
      rims.append(rim);
      this.blades.push(blade);
      this.rims.push(rim);
    }
    this.svg.append(defs, group, rims);
  }

  private drawSvg(frame: IrisFrame): void {
    const width = this.svg.clientWidth || window.innerWidth;
    const height = this.svg.clientHeight || window.innerHeight;
    this.svg.setAttribute("viewBox", `${-width / 2} ${-height / 2} ${width} ${height}`);
    const far = Math.hypot(width, height) * 2;
    this.blades.forEach((blade, i) => {
      const points = bladePolygon(i, frame.rotation, frame.radius, far);
      blade.setAttribute("points", points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
      const rim = this.rims[i];
      const [start, end] = points;
      if (rim && start && end) {
        // The lit rim is only the blade's side of the aperture, as in the WebGL drawing.
        const half = frame.radius * Math.tan(Math.PI / BLADES);
        const side = (2 * half) / (far + half);
        rim.setAttribute("x1", start[0].toFixed(1));
        rim.setAttribute("y1", start[1].toFixed(1));
        rim.setAttribute("x2", (start[0] + (end[0] - start[0]) * side).toFixed(1));
        rim.setAttribute("y2", (start[1] + (end[1] - start[1]) * side).toFixed(1));
      }
    });
  }
}
