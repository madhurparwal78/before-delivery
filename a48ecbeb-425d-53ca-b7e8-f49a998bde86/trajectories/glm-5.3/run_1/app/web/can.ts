import { FLAVOUR_COLOURS, reducedMotion, el } from './api.js';

const SCENE_FLAVOURS = ['guava-lime', 'yuzu-ginger', 'passionfruit-basil', 'cacao-orange'];

export interface TurntableOptions {
  startFlavour: string;
  startAngle: number;
  onAngle?: (angle: number) => void;
}

interface CanState {
  angle: number;
  flavour: string;
  lastInput: number;
  targetAngle: number | null;
}

export class CanTurntable {
  private container: HTMLElement;
  private img: HTMLElement;
  private state: CanState;
  private gl: WebGLRenderingContext | null = null;
  private fallback: SVGSVGElement | null = null;
  private fallbackLabel: SVGRectElement | null = null;
  private raf = 0;
  private options: TurntableOptions;
  private cylinder?: { buffer: WebGLBuffer; count: number; uv: WebGLBuffer };
  private texture?: WebGLTexture;
  private program?: WebGLProgram;

  constructor(container: HTMLElement, options: TurntableOptions) {
    this.container = container;
    this.options = options;
    this.state = { angle: options.startAngle, flavour: options.startFlavour, lastInput: 0, targetAngle: null };
    const img = el('img', {
      alt: `${this.flavourName(options.startFlavour)} can, turned ${Math.round(((options.startAngle % 360) + 360) % 360)} degrees`,
      class: 'can-canvas',
    });
    img.setAttribute('role', 'img');
    this.img = img;
    container.append(img);
    this.build();
    this.attachInput();
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  private flavourName(slug: string): string {
    const names: Record<string, string> = {
      'guava-lime': 'Guava & Lime',
      'yuzu-ginger': 'Yuzu Ginger',
      'passionfruit-basil': 'Passionfruit Basil',
      'cacao-orange': 'Cacao Orange',
    };
    return names[slug] ?? slug;
  }

  setFlavour(flavour: string): void {
    this.state.flavour = flavour;
    this.paintTexture();
    this.updateFallback();
    this.reportName();
  }

  setScrollAngle(angle: number): void {
    if (reducedMotion()) return;
    this.state.angle = angle;
    this.state.targetAngle = null;
    this.render();
    this.reportName();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private build(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'can-canvas';
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    if (gl) {
      this.gl = gl;
      canvas.width = 300;
      canvas.height = 400;
      this.img.before(canvas);
      canvas.setAttribute('aria-hidden', 'true');
      if (this.setupGl(gl)) {
        this.buildCylinder(gl);
        this.paintTexture();
        this.render();
        return;
      }
      this.gl = null;
      canvas.remove();
    }
    this.buildFallback();
  }

  private setupGl(gl: WebGLRenderingContext): boolean {
    const vs = `
      attribute vec3 pos; attribute vec2 uv;
      uniform float angle;
      varying vec2 vUv; varying float vLight;
      void main() {
        float s = sin(angle); float c = cos(angle);
        mat3 rot = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
        vec3 p = rot * pos;
        gl_Position = vec4(p.x / 1.15, p.y / 1.3, p.z * 0.5, 1.0);
        vUv = uv;
        vLight = 0.55 + 0.45 * max(0.0, dot(normalize(vec3(p.x, 0.0, p.z)), vec3(0.4, 0.0, 0.9)));
      }`;
    const fs = `
      precision mediump float;
      varying vec2 vUv; varying float vLight;
      uniform sampler2D tex;
      void main() { gl_FragColor = vec4(texture2D(tex, vUv).rgb * vLight, 1.0); }`;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    this.program = program;
    gl.enable(gl.DEPTH_TEST);
    return true;
  }

  private buildCylinder(gl: WebGLRenderingContext): void {
    const segments = 40;
    const positions: number[] = [];
    const uvs: number[] = [];
    const r = 0.52;
    const top = 0.85;
    const bottom = -0.85;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      positions.push(x0, top, z0, x1, top, z1, x1, bottom, z1);
      positions.push(x0, top, z0, x1, bottom, z1, x0, bottom, z0);
      const u0 = i / segments, u1 = (i + 1) / segments;
      uvs.push(u0, 0, u1, 0, u1, 1);
      uvs.push(u0, 0, u1, 1, u0, 1);
    }
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const uv = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    this.cylinder = { buffer, uv, count: positions.length / 3 };
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    this.texture = tex;
  }

  private paintTexture(): void {
    const gl = this.gl;
    if (!gl || !this.texture) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const colours = FLAVOUR_COLOURS[this.state.flavour] ?? { label: '#e88fa2' };
    ctx.fillStyle = colours.label;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = colours.band ?? colours.label;
    ctx.fillRect(0, 400, 512, 40);
    ctx.fillStyle = 'rgba(245,239,223,0.92)';
    ctx.font = '600 44px serif';
    ctx.textAlign = 'center';
    ctx.fillText('CEIBO', 256, 150);
    ctx.font = '26px sans-serif';
    ctx.fillText(this.flavourName(this.state.flavour), 256, 210);
    ctx.strokeStyle = 'rgba(143,191,127,0.9)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(60 + i * 80, 300, 26, 12, i, 0, Math.PI * 1.5);
      ctx.stroke();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  private buildFallback(): void {
    const colours = FLAVOUR_COLOURS[this.state.flavour] ?? { label: '#e88fa2' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 140');
    svg.setAttribute('class', 'can-canvas');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    body.setAttribute('x', '30');
    body.setAttribute('y', '12');
    body.setAttribute('width', '40');
    body.setAttribute('height', '116');
    body.setAttribute('rx', '16');
    body.setAttribute('fill', colours.label);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    label.setAttribute('x', '30');
    label.setAttribute('y', '48');
    label.setAttribute('width', '40');
    label.setAttribute('height', '34');
    label.setAttribute('fill', 'rgba(245,239,223,0.92)');
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '50');
    text.setAttribute('y', '68');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '9');
    text.textContent = 'CEIBO';
    const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    band.setAttribute('x', '30');
    band.setAttribute('y', '104');
    band.setAttribute('width', '40');
    band.setAttribute('height', '12');
    band.setAttribute('fill', colours.band ?? colours.label);
    svg.append(body, label, text, band);
    this.img.before(svg);
    this.fallback = svg;
    this.fallbackLabel = label;
  }

  private updateFallback(): void {
    if (!this.fallback || !this.fallbackLabel) return;
    const colours = FLAVOUR_COLOURS[this.state.flavour] ?? { label: '#e88fa2' };
    this.fallback.querySelector('rect')?.setAttribute('fill', colours.label);
    this.fallback.querySelectorAll('rect')[3]?.setAttribute('fill', colours.band ?? colours.label);
  }

  private attachInput(): void {
    const target = this.gl ? (this.gl.canvas as HTMLCanvasElement) : (this.fallback ?? this.container);
    let dragging = false;
    let startX = 0;
    let startAngle = 0;
    const width = () => target.getBoundingClientRect().width || 200;
    target.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startAngle = this.state.angle;
      this.container.classList.add('dragging');
      target.setPointerCapture((e as PointerEvent).pointerId);
      this.state.lastInput = Date.now();
    });
    target.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      this.state.angle = startAngle + (dx / width()) * 180;
      this.state.targetAngle = null;
      this.render();
      this.reportName();
    });
    const end = (): void => {
      dragging = false;
      this.container.classList.remove('dragging');
      this.state.lastInput = Date.now();
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'ArrowLeft') {
        this.turn(-45);
      } else if ((e as KeyboardEvent).key === 'ArrowRight') {
        this.turn(45);
      }
    });
  }

  turn(degrees: number): void {
    this.state.lastInput = Date.now();
    if (reducedMotion()) {
      this.state.angle += degrees;
      this.state.targetAngle = null;
      this.render();
      this.reportName();
      return;
    }
    this.state.targetAngle = (this.state.targetAngle ?? this.state.angle) + degrees;
  }

  private tick(): void {
    const now = Date.now();
    if (this.state.targetAngle !== null) {
      const diff = this.state.targetAngle - this.state.angle;
      if (Math.abs(diff) < 0.4) {
        this.state.angle = this.state.targetAngle;
        this.state.targetAngle = null;
        this.render();
        this.reportName();
      } else {
        this.state.angle += diff * 0.18;
        this.render();
      }
    } else if (!reducedMotion() && now - this.state.lastInput > 5000) {
      this.state.angle += 0.03;
      this.render();
      if (now % 60 === 0) this.reportName();
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  private render(): void {
    if (this.gl && this.program && this.cylinder) {
      const gl = this.gl;
      const canvas = gl.canvas as HTMLCanvasElement;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const angleLoc = gl.getUniformLocation(this.program, 'angle');
      gl.uniform1f(angleLoc, (this.state.angle * Math.PI) / 180);
      const posLoc = gl.getAttribLocation(this.program, 'pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cylinder.buffer);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
      const uvLoc = gl.getAttribLocation(this.program, 'uv');
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cylinder.uv);
      gl.enableVertexAttribArray(uvLoc);
      gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.cylinder.count);
    } else if (this.fallbackLabel) {
      const shift = ((this.state.angle % 40) + 40) % 40 - 20;
      this.fallbackLabel.setAttribute('x', String(50 - shift));
    }
  }

  private reportName(): void {
    const whole = Math.round(((this.state.angle % 360) + 360) % 360) % 360;
    this.img.setAttribute('alt', `${this.flavourName(this.state.flavour)} can, turned ${whole} degrees`);
  }
}

export function createTurntable(container: HTMLElement, options: TurntableOptions): CanTurntable {
  return new CanTurntable(container, options);
}

export { SCENE_FLAVOURS };
