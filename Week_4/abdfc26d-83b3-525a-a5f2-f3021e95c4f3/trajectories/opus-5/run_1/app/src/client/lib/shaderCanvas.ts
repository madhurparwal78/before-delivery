const VERTEX_SHADER = `attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export interface ShaderUniform {
  readonly name: string;
  readonly value: number;
}

export interface ShaderCanvasOptions {
  readonly fragmentSource: string;
  readonly uniforms: readonly ShaderUniform[];
  readonly seed: number;
  /** A still canvas draws one frame and stops: reduced motion, or the editor's playhead. */
  readonly still: boolean;
  /** The time to draw when still. */
  readonly time: number;
}

export interface CompileReport {
  readonly ok: boolean;
  readonly log: string;
}

export interface ShaderCanvasHandle {
  update(options: Partial<ShaderCanvasOptions>): void;
  /** Pauses when fully off-screen; resumes when it scrolls back in. */
  setVisible(visible: boolean): void;
  report(): CompileReport;
  destroy(): void;
}

export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(
      probe.getContext('webgl') ?? probe.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

/** The still fallback: a Canvas 2D frame of the piece's colour field. */
export function drawStillFallback(
  canvas: HTMLCanvasElement,
  seed: number,
  hue: number,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  const gradient = context.createLinearGradient(0, 0, width, height);
  const band = (offset: number): string => {
    const h = ((hue + offset + seed * 0.3) % 1) * 360;
    return `hsl(${h.toFixed(1)}, 58%, ${(18 + offset * 34).toFixed(1)}%)`;
  };
  gradient.addColorStop(0, band(0));
  gradient.addColorStop(0.45, band(0.22));
  gradient.addColorStop(1, band(0.52));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.16;
  for (let index = 0; index < 18; index += 1) {
    const y = ((index + 1) / 19) * height + Math.sin(index * 1.7 + seed * 6.28) * height * 0.02;
    context.fillStyle = index % 2 === 0 ? '#000000' : '#ffffff';
    context.fillRect(0, y, width, Math.max(1, height * 0.006));
  }
  context.globalAlpha = 1;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): { shader: WebGLShader | null; log: string } {
  const shader = gl.createShader(type);
  if (!shader) return { shader: null, log: 'Could not create a shader object.' };
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Shader failed to compile.';
    gl.deleteShader(shader);
    return { shader: null, log };
  }
  return { shader, log: '' };
}

/**
 * Runs a piece's shader on a canvas in real time, keeping the uniform contract:
 * uResolution, uTime, uSeed and the piece's own faders.
 */
export function createShaderCanvas(
  canvas: HTMLCanvasElement,
  initial: ShaderCanvasOptions,
): ShaderCanvasHandle {
  let options: ShaderCanvasOptions = initial;
  let visible = true;
  let frame = 0;
  let destroyed = false;
  let compileReport: CompileReport = { ok: true, log: '' };

  const gl =
    (canvas.getContext('webgl', { antialias: false, alpha: false, depth: false }) as
      | WebGLRenderingContext
      | null) ??
    (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

  if (!gl) {
    compileReport = { ok: false, log: 'WebGL is not available in this browser.' };
    return {
      update: () => undefined,
      setVisible: () => undefined,
      report: () => compileReport,
      destroy: () => undefined,
    };
  }

  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, options.fragmentSource);

  if (!program || !vertex.shader || !fragment.shader) {
    compileReport = {
      ok: false,
      log: [vertex.log, fragment.log].filter(Boolean).join('\n') || 'Shader failed to compile.',
    };
    return {
      update: () => undefined,
      setVisible: () => undefined,
      report: () => compileReport,
      destroy: () => undefined,
    };
  }

  gl.attachShader(program, vertex.shader);
  gl.attachShader(program, fragment.shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    compileReport = { ok: false, log: gl.getProgramInfoLog(program) ?? 'Shader failed to link.' };
    return {
      update: () => undefined,
      setVisible: () => undefined,
      report: () => compileReport,
      destroy: () => undefined,
    };
  }
  compileReport = { ok: true, log: 'Shader compiled. 0 errors.' };

  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
  const timeLocation = gl.getUniformLocation(program, 'uTime');
  const seedLocation = gl.getUniformLocation(program, 'uSeed');
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();

  const start = performance.now();

  const resize = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const draw = (time: number): void => {
    resize();
    gl.useProgram(program);
    if (resolutionLocation) gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    if (timeLocation) gl.uniform1f(timeLocation, time);
    if (seedLocation) gl.uniform1f(seedLocation, options.seed);
    for (const uniform of options.uniforms) {
      if (!uniformLocations.has(uniform.name)) {
        uniformLocations.set(uniform.name, gl.getUniformLocation(program, uniform.name));
      }
      const location = uniformLocations.get(uniform.name);
      if (location) gl.uniform1f(location, uniform.value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loop = (): void => {
    if (destroyed) return;
    if (!visible || options.still) {
      frame = 0;
      return;
    }
    draw((performance.now() - start) / 1000);
    frame = requestAnimationFrame(loop);
  };

  const schedule = (): void => {
    if (destroyed) return;
    if (options.still || !visible) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (visible) draw(options.time);
      return;
    }
    if (!frame) frame = requestAnimationFrame(loop);
  };

  schedule();
  if (options.still) draw(options.time);

  return {
    update: (next) => {
      options = { ...options, ...next };
      if (options.still) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (visible) draw(options.time);
      } else {
        schedule();
      }
    },
    setVisible: (next) => {
      if (visible === next) return;
      visible = next;
      schedule();
    },
    report: () => compileReport,
    destroy: () => {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    },
  };
}
