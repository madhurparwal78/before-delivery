export interface PieceLike {
  slug: string;
  fragment_source?: string;
  uniforms?: { name: string; label: string; min: number; max: number; value: number }[];
}

export interface CanvasHandle {
  stop(): void;
  setUniform(name: string, value: number): void;
  setSeed(seed: number): void;
  renderStill(): void;
  isFallback(): boolean;
}

const OFFSCREEN_OBSERVER = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const handle = (entry.target as HTMLElement).dataset.canvasHandle;
    if (handle) {
      const map = (window as unknown as { __pyCanvases?: Map<string, CanvasHandle> }).__pyCanvases;
      const inst = map?.get(handle);
      if (inst) {
        if (entry.isIntersecting) inst.renderStill();
        else inst.stop();
      }
    }
  }
}, { rootMargin: '80px' });

function parseSeedFromHash(hash: string | undefined): number {
  if (!hash) return 0;
  const head = Number.parseInt(hash.slice(0, 8), 16);
  return head / 4294967295;
}

/**
 * Runs a piece's shader live with WebGL, or draws a still Canvas 2D frame when
 * WebGL is unavailable. Pauses entirely while off-screen.
 */
export function startPieceCanvas(
  host: HTMLElement,
  piece: PieceLike,
  opts: { seedHash?: string; stillOnly?: boolean; small?: boolean } = {}
): CanvasHandle {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stillOnly = opts.stillOnly === true || reduced;
  const seed = opts.seedHash ? parseSeedFromHash(opts.seedHash) : 0;
  let stopped = true;
  let raf = 0;
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let uniforms: Record<string, number> = {};
  const start = performance.now();

  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  host.appendChild(canvas);
  host.style.position = host.style.position || 'relative';
  host.style.overflow = 'hidden';

  const fallbackText = document.createElement('div');
  fallbackText.textContent = 'This piece plays live with WebGL. Showing a still frame.';
  fallbackText.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:8px 12px;color:#a09a8e;font-size:12px;background:rgba(10,10,12,0.55)';

  let isFallback = false;

  const init = (): boolean => {
    gl = canvas.getContext('webgl');
    if (!gl) return false;
    const vsSource = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, piece.fragment_source ?? FALLBACK_FRAGMENT);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return false;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    program = prog;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    for (const uniform of piece.uniforms ?? []) uniforms[uniform.name] = uniform.value;
    return true;
  };

  const drawStill2D = (): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    const seedShift = Math.floor(seed * 360);
    grad.addColorStop(0, `hsl(${(28 + seedShift) % 360}, 42%, 16%)`);
    grad.addColorStop(0.55, `hsl(${(48 + seedShift) % 360}, 48%, 22%)`);
    grad.addColorStop(1, `hsl(${(12 + seedShift) % 360}, 30%, 9%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      const y = h * (0.25 + i * 0.13) + Math.sin(seed * 10 + i) * 20;
      ctx.fillStyle = `rgba(232, 255, 42, ${0.05 + i * 0.02})`;
      ctx.fillRect(0, y, w, 2 + i);
    }
  };

  const drawFrame = (): void => {
    if (!gl || !program) return;
    const w = host.clientWidth || canvas.width;
    const h = host.clientHeight || canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cw = Math.max(2, Math.floor(w * dpr));
    const ch = Math.max(2, Math.floor(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), cw, ch);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), stillOnly ? 0 : (performance.now() - start) / 1000);
    gl.uniform1f(gl.getUniformLocation(program, 'uSeed'), seed);
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform1f(loc, value);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const loop = (): void => {
    if (stopped) return;
    drawFrame();
    if (!stillOnly) raf = requestAnimationFrame(loop);
  };

  const renderStill = (): void => {
    if (!isFallback) drawFrame();
    else drawStill2D();
  };

  const startLoop = (): void => {
    if (!stopped) return;
    stopped = false;
    if (stillOnly) {
      renderStill();
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  if (!init()) {
    isFallback = true;
    canvas.getContext('webgl')?.getExtension('');
    host.appendChild(fallbackText);
    drawStill2D();
  }

  let drawWithSeed = seed;
  host.dataset.canvasHandle = `c${Math.random().toString(36).slice(2, 10)}`;
  const map = ((window as unknown as { __pyCanvases?: Map<string, CanvasHandle> }).__pyCanvases ??= new Map<string, CanvasHandle>());
  const handle: CanvasHandle = {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
    setUniform(name, value) {
      uniforms[name] = value;
      if (stopped && stillOnly) renderStill();
    },
    setSeed(newSeed) {
      drawWithSeed = newSeed;
    },
    renderStill,
    isFallback: () => isFallback
  };
  map.set(host.dataset.canvasHandle, handle);
  OFFSCREEN_OBSERVER.observe(host);
  startLoop();

  // Patch drawFrame to use drawWithSeed for the lens variations.
  const originalDrawFrame = drawFrame;
  const drawFrameWithSeed = (): void => {
    if (!gl || !program) return;
    const w = host.clientWidth || canvas.width;
    const h = host.clientHeight || canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cw = Math.max(2, Math.floor(w * dpr));
    const ch = Math.max(2, Math.floor(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), cw, ch);
    gl.uniform1f(gl.getUniformLocation(program, 'uTime'), stillOnly ? 0 : (performance.now() - start) / 1000);
    gl.uniform1f(gl.getUniformLocation(program, 'uSeed'), drawWithSeed);
    for (const [name, value] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(program, name);
      if (loc) gl.uniform1f(loc, value);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  void originalDrawFrame;
  // Replace the internal loop with the seed-aware one.
  const loopWithSeed = (): void => {
    if (stopped) return;
    drawFrameWithSeed();
    if (!stillOnly) raf = requestAnimationFrame(loopWithSeed);
  };
  const restartLoop = (): void => {
    stopped = false;
    if (stillOnly) {
      renderStill();
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loopWithSeed);
  };
  handle.stop = () => { stopped = true; cancelAnimationFrame(raf); };
  handle.renderStill = (): void => {
    if (isFallback) drawStill2D();
    else drawFrameWithSeed();
  };
  handle.setSeed = (value: number): void => {
    drawWithSeed = value;
    if (stopped || stillOnly) handle.renderStill();
  };
  restartLoop();
  return handle;
}

const FALLBACK_FRAGMENT = `
uniform vec2 uResolution;
uniform float uTime;
uniform float uSeed;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float band = sin(uv.y * 18.0 + uTime * 0.4 + uSeed * 6.28);
  vec3 col = mix(vec3(0.05, 0.05, 0.07), vec3(0.85, 0.72, 0.28), pow(0.5 + 0.5 * band, 3.0));
  gl_FragColor = vec4(col, 1.0);
}`;
