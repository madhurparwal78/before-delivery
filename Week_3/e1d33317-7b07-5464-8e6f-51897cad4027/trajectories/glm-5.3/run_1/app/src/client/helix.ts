import { VNode } from './jsx/jsx-runtime.js';
import { EngravedSystem } from './api.js';

export interface HelixProps {
  systems: EngravedSystem[];
  reducedMotion: boolean;
  title: string;
  onExtract(): void;
}

const IDLE_RATE = 0.05; // radians per second, one full turn about every 2 minutes 6 seconds

/**
 * The Helix: a real WebGL scene with the server-engraved systems wrapped
 * around a slowly turning cylinder, draggable by hand.
 */
export class HelixView {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private pendingCanvas: { ref: { current: HTMLCanvasElement | null }; canvas: HTMLCanvasElement } | null = null;
  private angle = 0;
  private dragging = false;
  private lastX = 0;
  private textures: WebGLTexture[] = [];
  private raf = 0;
  private lastFrame = 0;

  constructor(private props: HelixProps) {}

  node(): VNode {
    const canvas = document.createElement('canvas');
    const ref: { current: HTMLCanvasElement | null } = { current: null };
    this.pendingCanvas = { ref, canvas };
    return {
      type: 'div',
      props: { class: 'helix-canvas-holder', ref, 'aria-label': `Helix view of ${this.props.title}`, role: 'img' },
      children: [],
    };
  }

  attach(): void {
    if (this.pendingCanvas) {
      const holder = this.pendingCanvas.ref.current;
      if (holder) {
        this.canvas = this.pendingCanvas.canvas;
        holder.appendChild(this.pendingCanvas.canvas);
        this.pendingCanvas = null;
        this.init();
      }
    }
  }

  private init(): void {
    if (!this.canvas) return;
    const gl = this.canvas.getContext('webgl', { antialias: true });
    if (!gl) return;
    this.gl = gl;
    this.buildTextures();
    this.buildProgram();
    this.bindPointer();
    const frame = (now: number) => {
      this.draw(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private program: WebGLProgram | null = null;
  private quadBuf: WebGLBuffer | null = null;

  private buildProgram(): void {
    const gl = this.gl!;
    const vsSource = `
      attribute vec2 aPos;
      varying vec2 vPos;
      void main() {
        vPos = aPos;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 vPos;
      uniform sampler2D uTex;
      uniform float uAngle;
      void main() {
        // cylinder projection: sample the strip by wrapping around the drum
        float strip = (vPos.x + 1.0) * 0.5;
        float wrapped = fract(strip + uAngle / 6.28318530718);
        vec2 uv = vec2(wrapped, (vPos.y + 1.0) * 0.5);
        vec4 tex = texture2D(uTex, uv);
        // soft side lighting: shade by depth on the cylinder
        float x = cos((wrapped - strip) * 0.0 + (fract(strip + uAngle / 6.28318530718) - 0.5) * 6.28318530718);
        float light = 0.72 + 0.28 * clamp(x, 0.0, 1.0);
        gl_FragColor = vec4(tex.rgb * light, tex.a);
      }
    `;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    this.program = program;
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    this.quadBuf = buf;
  }

  private buildTextures(): void {
    const gl = this.gl!;
    this.textures = this.props.systems.map((sys) => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const pixels = svgToPixels(sys.svg, 1024);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
  }

  private bindPointer(): void {
    const canvas = this.canvas!;
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      this.lastX = event.clientX;
      this.angle += dx / (canvas.clientWidth / 6.28318530718);
    });
    const end = (): void => {
      this.dragging = false;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);
  }

  private draw(now: number): void {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas || !this.program) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
    }
    if (this.lastFrame === 0) this.lastFrame = now;
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!this.props.reducedMotion && !this.dragging) {
      this.angle = (this.angle + IDLE_RATE * dt) % (Math.PI * 2);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.05, 0.063, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    const loc = gl.getAttribLocation(this.program, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const angleLoc = gl.getUniformLocation(this.program, 'uAngle');
    gl.uniform1f(angleLoc, -this.angle);
    const bandCount = Math.min(this.textures.length, 4);
    const bandHeight = 2 / Math.max(1, bandCount);
    for (let i = 0; i < bandCount; i++) {
      const texture = this.textures[this.textures.length - 1 - i];
      if (!texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const y0 = 1 - (i + 1) * bandHeight;
      const y1 = 1 - i * bandHeight;
      const positions = new Float32Array([-1, y0, 1, y0, -1, y1, 1, y1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Rasterises an SVG system to an ImageData ready for a WebGL texture. */
function svgToPixels(svg: string, width: number): ImageData {
  const height = Math.max(2, Math.round((width / 1120) * 220));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#faf6ec';
  ctx.fillRect(0, 0, width, height);
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const image = new Image();
  image.src = url;
  try {
    ctx.drawImage(image, 0, 0, width, height);
  } catch {
    // the SVG may still be decoding; the base paper fill remains
  }
  return ctx.getImageData(0, 0, width, height);
}
