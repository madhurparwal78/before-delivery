/**
 * The deep board: the same position drawn in perspective with the browser's
 * hardware graphics, lit so the pieces cast shadows onto the squares, seen
 * from the side the viewing player is playing.
 */

import {
  perspective, orthographic, lookAt, multiply, translation, scaling, rotationY, normalMatrix,
  normalise, cross, subtract, identity,
} from './deep-math.js';
import {
  buildPieceGeometries, buildBoardGeometry, buildMarkGeometry, buildDiscGeometry,
} from './deep-shapes.js';

const VERTEX = `#version 300 es
precision highp float;
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_viewProj;
uniform mat3 u_normalMatrix;
uniform mat4 u_lightViewProj;
out vec3 v_world;
out vec3 v_normal;
out vec4 v_shadow;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_world = world.xyz;
  v_normal = normalize(u_normalMatrix * a_normal);
  v_shadow = u_lightViewProj * world;
  gl_Position = u_viewProj * world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_world;
in vec3 v_normal;
in vec4 v_shadow;
uniform vec3 u_colour;
uniform vec3 u_colour2;
uniform float u_grain;
uniform float u_specular;
uniform float u_alpha;
uniform float u_receiveShadow;
uniform vec3 u_lightDir;
uniform vec3 u_eye;
uniform sampler2D u_shadowMap;
out vec4 outColour;

float shadowFactor() {
  if (u_receiveShadow < 0.5) return 1.0;
  vec3 coord = v_shadow.xyz / v_shadow.w;
  coord = coord * 0.5 + 0.5;
  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) return 1.0;
  float bias = 0.0035;
  float lit = 0.0;
  vec2 texel = 1.0 / vec2(textureSize(u_shadowMap, 0));
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float depth = texture(u_shadowMap, coord.xy + vec2(float(x), float(y)) * texel).r;
      lit += coord.z - bias > depth ? 0.0 : 1.0;
    }
  }
  return mix(0.45, 1.0, lit / 9.0);
}

void main() {
  vec3 base = u_colour;
  if (u_grain > 0.5) {
    float grain = sin(v_world.y * 38.0 + sin(v_world.x * 7.0 + v_world.z * 5.0) * 2.4) * 0.5 + 0.5;
    base = mix(u_colour2, u_colour, smoothstep(0.25, 0.75, grain));
  }
  vec3 normal = normalize(v_normal);
  vec3 view = normalize(u_eye - v_world);
  // Two-sided lighting: a turned shape is lit by the face that meets the eye.
  if (dot(normal, view) < 0.0) normal = -normal;
  vec3 light = normalize(u_lightDir);
  float diffuse = max(dot(normal, light), 0.0);
  vec3 halfVector = normalize(light + view);
  float specular = pow(max(dot(normal, halfVector), 0.0), 46.0) * u_specular;
  float ambient = 0.3;
  float shade = shadowFactor();
  vec3 colour = base * (ambient + diffuse * 0.62 * shade) + vec3(1.0, 0.97, 0.92) * specular * shade;
  float alpha = u_alpha;
  if (alpha < 0.99) {
    float rim = pow(1.0 - max(dot(normal, view), 0.0), 2.0);
    colour += vec3(0.28) * rim;
    alpha = clamp(alpha + rim * 0.4, 0.0, 1.0);
  }
  outColour = vec4(colour, alpha);
}`;

const DEPTH_VERTEX = `#version 300 es
precision highp float;
in vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_lightViewProj;
void main() { gl_Position = u_lightViewProj * u_model * vec4(a_position, 1.0); }`;

const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
void main() {}`;

const SETS = {
  Marble: {
    white: { colour: [0.9, 0.88, 0.84], colour2: [0.78, 0.76, 0.72], grain: 0, specular: 0.5, alpha: 1 },
    black: { colour: [0.23, 0.21, 0.2], colour2: [0.15, 0.14, 0.13], grain: 0, specular: 0.45, alpha: 1 },
  },
  Wood: {
    white: { colour: [0.85, 0.66, 0.42], colour2: [0.70, 0.51, 0.29], grain: 1, specular: 0.26, alpha: 1 },
    black: { colour: [0.42, 0.27, 0.15], colour2: [0.29, 0.18, 0.09], grain: 1, specular: 0.24, alpha: 1 },
  },
  Glass: {
    white: { colour: [0.88, 0.94, 0.96], colour2: [0.8, 0.9, 0.95], grain: 0, specular: 0.95, alpha: 0.42 },
    black: { colour: [0.16, 0.19, 0.24], colour2: [0.1, 0.12, 0.16], grain: 0, specular: 0.9, alpha: 0.5 },
  },
};

function readThemeColours() {
  const style = getComputedStyle(document.documentElement);
  const parse = (name, fallback) => {
    const text = style.getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(text);
    if (!hex) return fallback;
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  return {
    light: parse('--sq-light', [0.91, 0.94, 0.89]),
    dark: parse('--sq-dark', [0.14, 0.25, 0.16]),
    frame: [0.16, 0.12, 0.1],
  };
}

const FILES = 'abcdefgh';

function squareToWorld(name) {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  return { x: file - 3.5, z: (8 - rank) - 3.5 };
}

function worldToSquare(x, z) {
  const file = Math.floor(x + 4);
  const rank = 8 - Math.floor(z + 4);
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${FILES[file]}${rank}`;
}

export function createDeepBoard(canvas, { onPick } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return { available: false };

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader did not compile');
    }
    return shader;
  };
  const link = (vertexSource, fragmentSource) => {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    // Both programs share one attribute layout, so one vertex array serves both.
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_normal');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program did not link');
    }
    return program;
  };

  let main;
  let depth;
  try {
    main = link(VERTEX, FRAGMENT);
    depth = link(DEPTH_VERTEX, DEPTH_FRAGMENT);
  } catch (error) {
    return { available: false, error };
  }

  const uniform = (program, names) => {
    const out = {};
    for (const name of names) out[name] = gl.getUniformLocation(program, name);
    return out;
  };
  const mainUniforms = uniform(main, [
    'u_model', 'u_viewProj', 'u_normalMatrix', 'u_lightViewProj', 'u_colour', 'u_colour2',
    'u_grain', 'u_specular', 'u_alpha', 'u_receiveShadow', 'u_lightDir', 'u_eye', 'u_shadowMap',
  ]);
  const depthUniforms = uniform(depth, ['u_model', 'u_lightViewProj']);

  function makeMesh(geometry) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const normals = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normals);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: geometry.count };
  }

  const pieceMeshes = {};
  const geometries = buildPieceGeometries();
  for (const [type, geometry] of Object.entries(geometries)) pieceMeshes[type] = makeMesh(geometry);
  const board = buildBoardGeometry();
  const frameMesh = makeMesh(board.frame);
  const markMesh = makeMesh(buildMarkGeometry());
  const discMesh = makeMesh(buildDiscGeometry());

  // The shadow map.
  const SHADOW_SIZE = 1024;
  const shadowTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const shadowBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const lightDirection = normalise([0.55, 1.0, 0.45]);
  const lightView = lookAt(
    [lightDirection[0] * 12, lightDirection[1] * 12, lightDirection[2] * 12],
    [0, 0, 0],
    [0, 1, 0],
  );
  const lightProjection = orthographic(-7.2, 7.2, -7.2, 7.2, 0.5, 30);
  const lightViewProj = multiply(lightProjection, lightView);

  const state = {
    squares: [],
    flip: false,
    set3d: 'Marble',
    lastMove: null,
    selected: null,
    hints: [],
    check: null,
    azimuth: 0,
    elevation: 0.82,
    distance: 16.4,
    animations: [],
  };

  let themeColours = readThemeColours();

  // The camera looks a little above the board's middle, so the near edge and
  // the far corners both stay inside the canvas.
  const TARGET = [0, 0.45, 0];

  function cameraEye() {
    const { azimuth, elevation, distance } = state;
    const base = state.flip ? Math.PI : 0;
    const a = base + azimuth;
    return [
      TARGET[0] + Math.sin(a) * Math.cos(elevation) * distance,
      TARGET[1] + Math.sin(elevation) * distance,
      TARGET[2] + Math.cos(a) * Math.cos(elevation) * distance,
    ];
  }

  function drawMesh(meshObject, model, material, receiveShadow, programUniforms, program) {
    gl.uniformMatrix4fv(programUniforms.u_model, false, model);
    if (program === main) {
      gl.uniformMatrix3fv(mainUniforms.u_normalMatrix, false, normalMatrix(model));
      gl.uniform3fv(mainUniforms.u_colour, material.colour);
      gl.uniform3fv(mainUniforms.u_colour2, material.colour2 || material.colour);
      gl.uniform1f(mainUniforms.u_grain, material.grain || 0);
      gl.uniform1f(mainUniforms.u_specular, material.specular ?? 0.3);
      gl.uniform1f(mainUniforms.u_alpha, material.alpha ?? 1);
      gl.uniform1f(mainUniforms.u_receiveShadow, receiveShadow ? 1 : 0);
    }
    gl.bindVertexArray(meshObject.vao);
    gl.drawArrays(gl.TRIANGLES, 0, meshObject.count);
    gl.bindVertexArray(null);
  }

  function pieceTransforms(now) {
    const list = [];
    const moving = new Map();
    const extra = [];
    for (const animation of state.animations) {
      const t = Math.min(1, (now - animation.start) / animation.duration);
      if (animation.kind === 'move') {
        const from = squareToWorld(animation.from);
        const to = squareToWorld(animation.to);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const lift = animation.arc ? Math.sin(Math.PI * t) * 0.85 : Math.sin(Math.PI * t) * 0.12;
        moving.set(animation.to, {
          x: from.x + (to.x - from.x) * eased,
          z: from.z + (to.z - from.z) * eased,
          y: lift,
        });
      }
      if (animation.kind === 'capture') {
        const at = squareToWorld(animation.square);
        extra.push({
          piece: animation.piece,
          x: at.x, z: at.z, y: t * 0.5,
          scale: 1 + t * 0.6,
          alphaScale: 1 - t,
        });
      }
    }
    for (const square of state.squares) {
      if (!square.piece) continue;
      const at = moving.get(square.name) || { ...squareToWorld(square.name), y: 0 };
      list.push({ piece: square.piece, x: at.x, y: at.y, z: at.z, scale: 1, alphaScale: 1 });
    }
    return list.concat(extra);
  }

  function materialFor(piece, set, alphaScale = 1) {
    const sets = SETS[set] || SETS.Marble;
    const base = piece === piece.toUpperCase() ? sets.white : sets.black;
    if (alphaScale >= 1) return base;
    return { ...base, alpha: (base.alpha ?? 1) * alphaScale };
  }

  function render(now) {
    const pieces = pieceTransforms(now);
    const eye = cameraEye();
    const view = lookAt(eye, TARGET, [0, 1, 0]);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = perspective((38 * Math.PI) / 180, aspect, 0.5, 60);
    const viewProj = multiply(projection, view);

    // The pieces cast shadows onto the squares.
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(depth);
    gl.uniformMatrix4fv(depthUniforms.u_lightViewProj, false, lightViewProj);
    for (const item of pieces) {
      const mesh = pieceMeshes[item.piece.toLowerCase()];
      if (!mesh) continue;
      const model = multiply(
        translation(item.x, item.y, item.z),
        multiply(rotationY(item.piece === item.piece.toUpperCase() ? 0 : Math.PI), scaling(item.scale, item.scale, item.scale)),
      );
      drawMesh(mesh, model, null, false, depthUniforms, depth);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.106, 0.082, 0.071, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(main);
    gl.uniformMatrix4fv(mainUniforms.u_viewProj, false, viewProj);
    gl.uniformMatrix4fv(mainUniforms.u_lightViewProj, false, lightViewProj);
    gl.uniform3fv(mainUniforms.u_lightDir, new Float32Array(lightDirection));
    gl.uniform3fv(mainUniforms.u_eye, new Float32Array(eye));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.uniform1i(mainUniforms.u_shadowMap, 0);

    drawMesh(frameMesh, identity(), { colour: themeColours.frame, specular: 0.12 }, false, mainUniforms, main);

    // Each tile's geometry carries its own corner, so the model is the identity.
    for (const tile of board.tiles) {
      const light = (tile.file + tile.rank) % 2 === 1;
      const material = { colour: light ? themeColours.light : themeColours.dark, specular: 0.14 };
      gl.uniformMatrix4fv(mainUniforms.u_model, false, identity());
      gl.uniformMatrix3fv(mainUniforms.u_normalMatrix, false, normalMatrix(identity()));
      gl.uniform3fv(mainUniforms.u_colour, material.colour);
      gl.uniform3fv(mainUniforms.u_colour2, material.colour);
      gl.uniform1f(mainUniforms.u_grain, 0);
      gl.uniform1f(mainUniforms.u_specular, material.specular);
      gl.uniform1f(mainUniforms.u_alpha, 1);
      gl.uniform1f(mainUniforms.u_receiveShadow, 1);
      const mesh = tileMeshes[tile.rank * 8 + tile.file];
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      gl.bindVertexArray(null);
    }

    // The marks: the last move's two squares, the selection and its legal destinations.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const marks = [];
    if (state.lastMove) {
      marks.push({ square: state.lastMove.from, mesh: markMesh, colour: [0.88, 0.66, 0.42], alpha: 0.5 });
      marks.push({ square: state.lastMove.to, mesh: markMesh, colour: [0.88, 0.66, 0.42], alpha: 0.6 });
    }
    if (state.check) {
      marks.push({ square: state.check, mesh: markMesh, colour: [0.95, 0.4, 0.31], alpha: 0.72 });
    }
    if (state.selected) {
      marks.push({ square: state.selected, mesh: markMesh, colour: [0.96, 0.78, 0.38], alpha: 0.72 });
    }
    for (const hint of state.hints) {
      marks.push({ square: hint, mesh: discMesh, colour: [0.38, 0.81, 0.75], alpha: 0.8 });
    }
    for (const mark of marks) {
      const at = squareToWorld(mark.square);
      const model = translation(at.x, 0, at.z);
      gl.uniformMatrix4fv(mainUniforms.u_model, false, model);
      gl.uniformMatrix3fv(mainUniforms.u_normalMatrix, false, normalMatrix(model));
      gl.uniform3fv(mainUniforms.u_colour, mark.colour);
      gl.uniform3fv(mainUniforms.u_colour2, mark.colour);
      gl.uniform1f(mainUniforms.u_grain, 0);
      gl.uniform1f(mainUniforms.u_specular, 0);
      gl.uniform1f(mainUniforms.u_alpha, mark.alpha);
      gl.uniform1f(mainUniforms.u_receiveShadow, 0);
      gl.bindVertexArray(mark.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mark.mesh.count);
      gl.bindVertexArray(null);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const opaque = [];
    const translucent = [];
    for (const item of pieces) {
      const material = materialFor(item.piece, state.set3d, item.alphaScale);
      ((material.alpha ?? 1) < 0.99 ? translucent : opaque).push({ item, material });
    }
    const drawPiece = ({ item, material }) => {
      const mesh = pieceMeshes[item.piece.toLowerCase()];
      if (!mesh) return;
      const model = multiply(
        translation(item.x, item.y, item.z),
        multiply(
          rotationY(item.piece === item.piece.toUpperCase() ? 0 : Math.PI),
          scaling(item.scale, item.scale, item.scale),
        ),
      );
      drawMesh(mesh, model, material, false, mainUniforms, main);
    };
    for (const entry of opaque) drawPiece(entry);
    if (translucent.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      translucent.sort((a, b) => {
        const da = (a.item.x - eye[0]) ** 2 + (a.item.z - eye[2]) ** 2;
        const db = (b.item.x - eye[0]) ** 2 + (b.item.z - eye[2]) ** 2;
        return db - da;
      });
      for (const entry of translucent) drawPiece(entry);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    state.animations = state.animations.filter((animation) => now - animation.start < animation.duration);
  }

  // One mesh per tile, since each tile's geometry carries its own corner.
  const tileMeshes = board.tiles.map((tile) => makeMesh(tile));

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  let running = true;
  function frame(now) {
    if (!running) return;
    if (canvas.clientWidth > 0 && canvas.offsetParent !== null) {
      resize();
      try {
        render(now);
      } catch (error) {
        running = false;
        console.warn('deep board stopped', error);
        return;
      }
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  // Dragging turns the view; the wheel and a pinch zoom it. Neither moves a piece.
  const pointers = new Map();
  let dragged = false;
  let pinchDistance = 0;

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDistance) {
        state.distance = Math.min(24, Math.max(7.5, state.distance * (pinchDistance / distance)));
      }
      pinchDistance = distance;
      dragged = true;
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    state.azimuth -= dx * 0.008;
    state.elevation = Math.min(1.45, Math.max(0.16, state.elevation + dy * 0.006));
  });

  const release = (event) => {
    const had = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (!had || dragged || !onPick) return;
    const square = pick(event.clientX, event.clientY);
    if (square) onPick(square);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.distance = Math.min(24, Math.max(7.5, state.distance + Math.sign(event.deltaY) * 0.7));
  }, { passive: false });

  /** Which square is under a point on the canvas? */
  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const eye = cameraEye();
    const forward = normalise(subtract(TARGET, eye));
    const right = normalise(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const tanHalf = Math.tan((38 * Math.PI) / 180 / 2);
    const aspect = rect.width / Math.max(1, rect.height);
    const direction = normalise([
      forward[0] + right[0] * ndcX * tanHalf * aspect + up[0] * ndcY * tanHalf,
      forward[1] + right[1] * ndcX * tanHalf * aspect + up[1] * ndcY * tanHalf,
      forward[2] + right[2] * ndcX * tanHalf * aspect + up[2] * ndcY * tanHalf,
    ]);
    if (Math.abs(direction[1]) < 1e-6) return null;
    const t = -eye[1] / direction[1];
    if (t <= 0) return null;
    return worldToSquare(eye[0] + direction[0] * t, eye[2] + direction[2] * t);
  }

  return {
    available: true,
    setState(next) {
      Object.assign(state, next);
      themeColours = readThemeColours();
    },
    refreshTheme() { themeColours = readThemeColours(); },
    /** The piece travels through the squares between its start and its end. */
    travel({ from, to, piece, duration = 320, captured = null }) {
      const now = performance.now();
      if (captured) {
        state.animations.push({ kind: 'capture', square: captured.square, piece: captured.piece, start: now, duration: 300 });
      }
      state.animations.push({
        kind: 'move', from, to, piece, start: now, duration,
        arc: String(piece).toLowerCase() === 'n',
      });
    },
    resize,
    stop() { running = false; },
  };
}
