const SEGMENT_DEPTH = 12;
const CORRIDOR_HALF_WIDTH = 3.2;
const CORRIDOR_HEIGHT = 4.2;

const GROUND: [number, number, number] = [0.051, 0.059, 0.039];
const PANEL: [number, number, number] = [0.149, 0.161, 0.118];
const RIM: [number, number, number] = [0.231, 0.247, 0.188];

export type CorridorState = {
  focusStation: number;
  /** 0 is the wide shot, 1 is close on the station's panel. */
  cameraProgress: number;
  /** 0 to 1, from the count of active layers. */
  glow: number;
};

export type CorridorView = {
  resize: () => void;
  render: (state: CorridorState) => void;
};

type Mesh = {
  positions: number[];
  normals: number[];
  stations: number[];
  tints: number[];
};

function hashOf(text: string): number {
  let value = 0x811c9dc5;
  for (const character of text) {
    value ^= character.codePointAt(0) as number;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

function pushQuad(
  mesh: Mesh,
  corners: [number[], number[], number[], number[]],
  normal: number[],
  station: number,
  tint: number,
): void {
  const order = [0, 1, 2, 0, 2, 3];
  for (const index of order) {
    const corner = corners[index] as number[];
    mesh.positions.push(corner[0] as number, corner[1] as number, corner[2] as number);
    mesh.normals.push(normal[0] as number, normal[1] as number, normal[2] as number);
    mesh.stations.push(station);
    mesh.tints.push(tint);
  }
}

function pushBox(
  mesh: Mesh,
  min: [number, number, number],
  max: [number, number, number],
  station: number,
  tint: number,
): void {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  pushQuad(mesh, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], station, tint);
  pushQuad(mesh, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], station, tint);
  pushQuad(mesh, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], station, tint);
  pushQuad(mesh, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], station, tint);
  pushQuad(mesh, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], station, tint);
  pushQuad(mesh, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], station, tint);
}

/** Wedge foam, slatted diffusers and bass traps, chosen by the station's own slug. */
function buildStationPanels(mesh: Mesh, station: number, seed: number): void {
  const centre = -station * SEGMENT_DEPTH;
  const kind = seed % 3;
  const rows = 7;
  for (let side = 0; side < 2; side += 1) {
    const sign = side === 0 ? -1 : 1;
    const wall = sign * CORRIDOR_HALF_WIDTH;
    for (let row = 0; row < rows; row += 1) {
      const z = centre + SEGMENT_DEPTH / 2 - ((row + 0.5) * SEGMENT_DEPTH) / rows;
      const depth = SEGMENT_DEPTH / rows / 2.6;
      if (kind === 0) {
        for (let step = 0; step < 5; step += 1) {
          const y = 0.5 + step * 0.72;
          const out = 0.1 + ((step + row) % 3) * 0.08;
          pushBox(
            mesh,
            [Math.min(wall, wall - sign * out), y, z - depth],
            [Math.max(wall, wall - sign * out), y + 0.5, z + depth],
            station,
            0.45 + ((step + row) % 3) * 0.12,
          );
        }
      } else if (kind === 1) {
        const out = 0.12 + (((row * 7 + seed) % 5) / 5) * 0.4;
        pushBox(
          mesh,
          [Math.min(wall, wall - sign * out), 0.3, z - depth],
          [Math.max(wall, wall - sign * out), CORRIDOR_HEIGHT - 0.4, z + depth],
          station,
          0.4 + (((row * 3 + seed) % 4) / 4) * 0.3,
        );
      } else {
        const facets = 5;
        for (let facet = 0; facet < facets; facet += 1) {
          const angle = (facet / facets) * (Math.PI / 2);
          const radius = 0.62;
          const out = radius * Math.cos(angle);
          const up = radius * Math.sin(angle);
          pushBox(
            mesh,
            [Math.min(wall, wall - sign * out), up, z - depth],
            [Math.max(wall, wall - sign * out), up + 0.16, z + depth],
            station,
            0.5 + facet * 0.07,
          );
          pushBox(
            mesh,
            [Math.min(wall, wall - sign * out), CORRIDOR_HEIGHT - up - 0.16, z - depth],
            [Math.max(wall, wall - sign * out), CORRIDOR_HEIGHT - up, z + depth],
            station,
            0.5 + facet * 0.07,
          );
        }
      }
    }
    pushQuad(
      mesh,
      [
        [wall, 0, centre + SEGMENT_DEPTH / 2],
        [wall, 0, centre - SEGMENT_DEPTH / 2],
        [wall, CORRIDOR_HEIGHT, centre - SEGMENT_DEPTH / 2],
        [wall, CORRIDOR_HEIGHT, centre + SEGMENT_DEPTH / 2],
      ],
      [-sign, 0, 0],
      station,
      0.2,
    );
  }
  pushQuad(
    mesh,
    [
      [-CORRIDOR_HALF_WIDTH, 0, centre + SEGMENT_DEPTH / 2],
      [CORRIDOR_HALF_WIDTH, 0, centre + SEGMENT_DEPTH / 2],
      [CORRIDOR_HALF_WIDTH, 0, centre - SEGMENT_DEPTH / 2],
      [-CORRIDOR_HALF_WIDTH, 0, centre - SEGMENT_DEPTH / 2],
    ],
    [0, 1, 0],
    station,
    0.28,
  );
  pushQuad(
    mesh,
    [
      [-CORRIDOR_HALF_WIDTH, CORRIDOR_HEIGHT, centre - SEGMENT_DEPTH / 2],
      [CORRIDOR_HALF_WIDTH, CORRIDOR_HEIGHT, centre - SEGMENT_DEPTH / 2],
      [CORRIDOR_HALF_WIDTH, CORRIDOR_HEIGHT, centre + SEGMENT_DEPTH / 2],
      [-CORRIDOR_HALF_WIDTH, CORRIDOR_HEIGHT, centre + SEGMENT_DEPTH / 2],
    ],
    [0, -1, 0],
    station,
    0.18,
  );
}

function perspective(fieldOfView: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
}

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const subtract = (a: number[], b: number[]): number[] => [
    (a[0] as number) - (b[0] as number),
    (a[1] as number) - (b[1] as number),
    (a[2] as number) - (b[2] as number),
  ];
  const normalise = (v: number[]): number[] => {
    const length = Math.hypot(v[0] as number, v[1] as number, v[2] as number) || 1;
    return [(v[0] as number) / length, (v[1] as number) / length, (v[2] as number) / length];
  };
  const cross = (a: number[], b: number[]): number[] => [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
  const dot = (a: number[], b: number[]): number =>
    (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);

  const zAxis = normalise(subtract(eye, target));
  const xAxis = normalise(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  return new Float32Array([
    xAxis[0] as number, yAxis[0] as number, zAxis[0] as number, 0,
    xAxis[1] as number, yAxis[1] as number, zAxis[1] as number, 0,
    xAxis[2] as number, yAxis[2] as number, zAxis[2] as number, 0,
    -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1,
  ]);
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aStation;
attribute float aTint;
uniform mat4 uProjection;
uniform mat4 uView;
varying vec3 vNormal;
varying float vStation;
varying float vTint;
varying float vDepth;
void main() {
  vec4 viewPosition = uView * vec4(aPosition, 1.0);
  vNormal = aNormal;
  vStation = aStation;
  vTint = aTint;
  vDepth = -viewPosition.z;
  gl_Position = uProjection * viewPosition;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying float vStation;
varying float vTint;
varying float vDepth;
uniform float uCurrentStation;
uniform float uGlow;
uniform vec3 uGround;
uniform vec3 uPanel;
uniform vec3 uRim;
void main() {
  vec3 lightDirection = normalize(vec3(0.3, 0.8, 0.5));
  float lambert = max(dot(normalize(vNormal), lightDirection), 0.0);
  vec3 base = mix(uGround, uPanel, vTint);
  float current = step(abs(vStation - uCurrentStation), 0.5);
  float glow = uGlow * current;
  vec3 colour = base * (0.35 + 0.65 * lambert) + uRim * glow * (0.25 + 0.45 * lambert);
  float fog = clamp(1.0 - vDepth / 46.0, 0.0, 1.0);
  gl_FragColor = vec4(mix(uGround * 0.6, colour, fog), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/** Drawn by the app where WebGL is unavailable, so every control and state still works. */
function stillImage(canvas: HTMLCanvasElement): CorridorView {
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const draw = (): void => {
    const width = canvas.width;
    const height = canvas.height;
    context.fillStyle = `rgb(${GROUND.map((channel) => Math.round(channel * 255)).join(',')})`;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = `rgb(${PANEL.map((channel) => Math.round(channel * 255)).join(',')})`;
    context.lineWidth = Math.max(1, width / 900);
    const centreX = width * 0.5;
    const centreY = height * 0.52;
    for (let step = 1; step <= 14; step += 1) {
      const scale = 1 / step;
      const panelWidth = width * 0.78 * scale;
      const panelHeight = height * 0.7 * scale;
      context.strokeRect(centreX - panelWidth / 2, centreY - panelHeight / 2, panelWidth, panelHeight);
    }
    for (let row = 0; row < 18; row += 1) {
      const y = centreY - height * 0.35 + (row * height * 0.7) / 18;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(centreX, centreY);
      context.moveTo(width, y);
      context.lineTo(centreX, centreY);
      context.stroke();
    }
  };
  return {
    resize: () => {
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * window.devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * window.devicePixelRatio));
      draw();
    },
    render: () => undefined,
  };
}

export function createCorridor(canvas: HTMLCanvasElement, slugs: readonly string[]): CorridorView {
  const gl = (canvas.getContext('webgl', { antialias: true, alpha: false }) ??
    canvas.getContext('experimental-webgl', { antialias: true, alpha: false })) as WebGLRenderingContext | null;
  const stationCount = Math.max(1, slugs.length);
  if (gl === null) return stillImage(canvas);

  const mesh: Mesh = { positions: [], normals: [], stations: [], tints: [] };
  for (let index = 0; index < stationCount; index += 1) {
    buildStationPanels(mesh, index, hashOf(slugs[index] ?? `station-${index}`) % 997);
  }

  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);

  const bind = (name: string, data: number[], size: number): void => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  bind('aPosition', mesh.positions, 3);
  bind('aNormal', mesh.normals, 3);
  bind('aStation', mesh.stations, 1);
  bind('aTint', mesh.tints, 1);

  const uProjection = gl.getUniformLocation(program, 'uProjection');
  const uView = gl.getUniformLocation(program, 'uView');
  const uCurrentStation = gl.getUniformLocation(program, 'uCurrentStation');
  const uGlow = gl.getUniformLocation(program, 'uGlow');
  gl.uniform3fv(gl.getUniformLocation(program, 'uGround'), GROUND);
  gl.uniform3fv(gl.getUniformLocation(program, 'uPanel'), PANEL);
  gl.uniform3fv(gl.getUniformLocation(program, 'uRim'), RIM);

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);

  const vertexCount = mesh.positions.length / 3;

  const resize = (): void => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * window.devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * window.devicePixelRatio));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  return {
    resize,
    render: (state) => {
      const centre = -state.focusStation * SEGMENT_DEPTH;
      const progress = Math.min(1, Math.max(0, state.cameraProgress));
      const eyeZ = centre + (16 - 11.6 * progress);
      const eyeY = 2.6 - 1.05 * progress;
      const view = lookAt([0, eyeY, eyeZ], [0, 1.7, centre - 1.5], [0, 1, 0]);
      const aspect = canvas.width / Math.max(1, canvas.height);
      gl.uniformMatrix4fv(uProjection, false, perspective(Math.PI / 3.3, aspect, 0.1, 80));
      gl.uniformMatrix4fv(uView, false, view);
      gl.uniform1f(uCurrentStation, state.focusStation);
      gl.uniform1f(uGlow, state.glow);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    },
  };
}
