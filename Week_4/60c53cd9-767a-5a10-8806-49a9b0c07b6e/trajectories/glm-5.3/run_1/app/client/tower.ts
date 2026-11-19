// The finder tower renderer: an octagonal prism, one face per stack, drawn with
// a two-tone shader and a hard edge between light and shade (Visual design). The
// pointer hits a cell through face math, not pixel picking, so every cell is
// hoverable and pinnable. Without WebGL the floor grid takes over with the same
// cells.

const STACKS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const RADIUS = 7.5;
const FLOOR_HEIGHT = 1;
const BASE_Y = 2;
const GROUND_RGB = [0.141, 0.11, 0.471];
const LIGHT_RGB = [1, 1, 1];

export interface CellHit {
  floor: number;
  stack: string;
}

export class TowerView {
  faceIndex = 2; // stack C faces the viewer first
  targetFace = 2;
  faceAngle = (2 * Math.PI) / 8;
  private dragging = false;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartAngle = 0;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffers: { position: WebGLBuffer; uv: WebGLBuffer; index: WebGLBuffer } | null = null;
  onCellHover: ((hit: CellHit | null) => void) | null = null;
  onCellClick: ((hit: CellHit) => void) | null = null;
  onTurn: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) return;
    this.gl = gl;
    if (!this.init(gl)) {
      this.gl = null;
      return;
    }
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerleave', () => this.onCellHover?.(null));
  }

  get hasGl(): boolean {
    return this.gl !== null;
  }

  private init(gl: WebGLRenderingContext): boolean {
    const vsSource = `
      attribute vec3 aPosition;
      uniform mat4 uModel;
      uniform mat4 uView;
      uniform mat4 uProjection;
      varying float vDepth;
      void main() {
        vec4 world = uModel * vec4(aPosition, 1.0);
        vec4 viewPos = uView * world;
        gl_Position = uProjection * viewPos;
        vDepth = viewPos.z;
      }
    `;
    const fsSource = `
      precision mediump float;
      varying float vDepth;
      void main() {
        float shade = vDepth < -30.0 ? 1.0 : 0.25;
        vec3 colour = shade > 0.5
          ? vec3(${LIGHT_RGB[0]}, ${LIGHT_RGB[1]}, ${LIGHT_RGB[2]})
          : vec3(${GROUND_RGB[0]}, ${GROUND_RGB[1]}, ${GROUND_RGB[2]});
        gl_FragColor = vec4(colour, 1.0);
      }
    `;
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    this.program = program;

    const positions: number[] = [];
    const indices: number[] = [];
    for (let side = 0; side < 8; side++) {
      const a0 = (side / 8) * Math.PI * 2;
      const a1 = ((side + 1) / 8) * Math.PI * 2;
      const x0 = Math.sin(a0) * RADIUS;
      const z0 = -Math.cos(a0) * RADIUS;
      const x1 = Math.sin(a1) * RADIUS;
      const z1 = -Math.cos(a1) * RADIUS;
      for (let floor = 3; floor <= 38; floor++) {
        const y0 = BASE_Y + (floor - 3) * FLOOR_HEIGHT;
        const y1 = y0 + FLOOR_HEIGHT;
        const base = positions.length / 3;
        positions.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    this.buffers = { position: positionBuffer, uv: positionBuffer, index: indexBuffer };
    return true;
  }

  private pointerDown(event: PointerEvent): void {
    this.dragMoved = false;
    this.dragStartX = event.clientX;
    this.dragStartAngle = this.faceAngle;
    const move = (moveEvent: PointerEvent): void => {
      if (Math.abs(moveEvent.clientX - this.dragStartX) > 6) this.dragMoved = true;
      if (this.dragMoved) {
        this.faceAngle = this.dragStartAngle + (moveEvent.clientX - this.dragStartX) * 0.012;
        this.render();
      }
    };
    const up = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (this.dragMoved) {
        this.targetFace = Math.round(this.faceAngle / ((Math.PI * 2) / 8));
        this.faceAngle = this.targetFace * ((Math.PI * 2) / 8);
        this.faceIndex = ((this.targetFace % 8) + 8) % 8;
        this.onTurn?.();
      } else {
        const hit = this.hitTest(upEvent);
        if (hit) this.onCellClick?.(hit);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private pointerMove(event: PointerEvent): void {
    if (this.dragMoved) return;
    const hit = this.hitTest(event);
    this.onCellHover?.(hit);
  }

  faceStack(): string {
    return STACKS[this.faceIndex];
  }

  turnToStack(stack: string): void {
    const index = STACKS.indexOf(stack);
    if (index >= 0) {
      const turns = (index - this.faceIndex + 8) % 8;
      this.targetFace += turns <= 4 ? turns : turns - 8;
      this.faceIndex = index;
      this.faceAngle = this.targetFace * ((Math.PI * 2) / 8);
      this.onTurn?.();
    }
  }

  turnLeft(): void {
    this.targetFace -= 1;
    this.faceIndex = ((this.targetFace % 8) + 8) % 8;
    this.faceAngle = this.targetFace * ((Math.PI * 2) / 8);
    this.onTurn?.();
  }

  turnRight(): void {
    this.targetFace += 1;
    this.faceIndex = ((this.targetFace % 8) + 8) % 8;
    this.faceAngle = this.targetFace * ((Math.PI * 2) / 8);
    this.onTurn?.();
  }

  // Maps a pointer position to a unit cell: horizontal position picks the stack
  // face, vertical position picks the storey.
  private hitTest(event: PointerEvent): CellHit | null {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const px = (event.clientX - rect.left) / width;
    const py = (event.clientY - rect.top) / height;
    const centreX = 0.5;
    const halfSpan = 0.34;
    const topY = 0.12;
    const bottomY = 0.9;
    if (px < centreX - halfSpan || px > centreX + halfSpan) return null;
    if (py < topY || py > bottomY) return null;
    const across = (px - centreX) / halfSpan;
    const faceFloat = this.faceIndex + across * 0.95;
    const face = Math.round(faceFloat);
    if (Math.abs(faceFloat - face) > 0.5) return null;
    const side = ((face % 8) + 8) % 8;
    const down = (py - topY) / (bottomY - topY);
    const floor = Math.min(38, Math.max(3, 3 + Math.round(down * 35)));
    return { floor, stack: STACKS[side] };
  }

  render(): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.buffers) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(GROUND_RGB[0], GROUND_RGB[1], GROUND_RGB[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    const model = rotationY(-this.faceAngle);
    const view = translate(0, -16, 34);
    const projection = perspective(Math.PI / 5, width / height, 0.5, 120);
    setMat4(gl, this.program, 'uModel', model);
    setMat4(gl, this.program, 'uView', view);
    setMat4(gl, this.program, 'uProjection', projection);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    const aPosition = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    gl.drawElements(gl.TRIANGLES, 8 * 36 * 6, gl.UNSIGNED_SHORT, 0);
  }
}

function rotationY(angle: number): Float32Array {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([
    c, 0, s, 0,
    0, 1, 0, 0,
    -s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

function translate(x: number, y: number, z: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function setMat4(gl: WebGLRenderingContext, program: WebGLProgram, name: string, value: Float32Array): void {
  const location = gl.getUniformLocation(program, name);
  gl.uniformMatrix4fv(location, false, value);
}
