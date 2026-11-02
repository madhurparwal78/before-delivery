import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type FlavourSlug, flavourName } from '../../../shared/catalogue.js';
import { useReducedMotion } from '../state/useReducedMotion.js';
import { canPalette, drawCanLabel, drawLayeredCan } from './canArt.js';

const EIGHTH_TURN = 45;
const EIGHTH_TURN_MS = 330;
const IDLE_PAUSE_MS = 5_000;
const IDLE_TURN_MS = 24_000;

interface CanTurntableProps {
  flavour: FlavourSlug;
  /** Rotation contributed by scroll, in degrees: a quarter turn per scene. */
  scrollDegrees: number;
  label: string;
}

interface Mesh {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  index: WebGLBuffer;
  count: number;
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vNormal = mat3(uModel) * aNormal;
  vUv = aUv;
  gl_Position = uProjection * uModel * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uLabel;
uniform vec3 uMetal;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 normal = normalize(vNormal);
  vec3 toLight = normalize(vec3(-0.45, 0.85, 0.9));
  float diffuse = max(dot(normal, toLight), 0.0);
  float rim = pow(1.0 - abs(normal.z), 2.0);
  vec4 label = texture2D(uLabel, vUv);
  vec3 colour = mix(label.rgb, uMetal, label.a < 0.5 ? 1.0 : 0.0);
  float specular = pow(max(dot(reflect(-toLight, normal), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
  colour *= 0.72 + 0.6 * diffuse;
  colour += vec3(0.55) * specular;
  gl_FragColor = vec4(colour, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) return null;
  return shader;
}

/** Builds the can's mesh in code: a capped cylinder with the label wrapped round it. */
function buildCan(gl: WebGLRenderingContext): Mesh | null {
  const segments = 72;
  const radius = 0.36;
  const halfHeight = 0.95;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let segment = 0; segment <= segments; segment += 1) {
    const turn = (segment / segments) * Math.PI * 2;
    const x = Math.cos(turn);
    const z = Math.sin(turn);
    for (const [row, y] of [
      [0, halfHeight],
      [1, -halfHeight],
    ] as const) {
      positions.push(x * radius, y, z * radius);
      normals.push(x, 0, z);
      // The label wraps clockwise as seen from the camera, so u runs the other way.
      uvs.push(1 - segment / segments, row);
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    const top = segment * 2;
    indices.push(top, top + 1, top + 2, top + 1, top + 3, top + 2);
  }

  for (const [y, normalY] of [
    [halfHeight, 1],
    [-halfHeight, -1],
  ] as const) {
    const centre = positions.length / 3;
    positions.push(0, y * 0.98, 0);
    normals.push(0, normalY, 0);
    uvs.push(0.5, normalY > 0 ? 0.02 : 0.98);
    for (let segment = 0; segment <= segments; segment += 1) {
      const turn = (segment / segments) * Math.PI * 2;
      positions.push(Math.cos(turn) * radius * 0.94, y * 0.98, Math.sin(turn) * radius * 0.94);
      normals.push(0, normalY, 0);
      uvs.push(0.5, normalY > 0 ? 0.02 : 0.98);
      if (segment < segments) {
        if (normalY > 0) indices.push(centre, centre + segment + 1, centre + segment + 2);
        else indices.push(centre, centre + segment + 2, centre + segment + 1);
      }
    }
  }

  const upload = (data: Float32Array, target = gl.ARRAY_BUFFER): WebGLBuffer | null => {
    const buffer = gl.createBuffer();
    if (buffer === null) return null;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  };
  const position = upload(new Float32Array(positions));
  const normal = upload(new Float32Array(normals));
  const uv = upload(new Float32Array(uvs));
  const index = gl.createBuffer();
  if (position === null || normal === null || uv === null || index === null) return null;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  return { position, normal, uv, index, count: indices.length };
}

function perspective(aspect: number): Float32Array {
  const fieldOfView = Math.PI / 7;
  const near = 0.1;
  const far = 40;
  const f = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
}

/** A tilt about X after a turn about Y, in column-major order, then pushed back. */
function modelMatrix(yawDegrees: number, tiltDegrees: number): Float32Array {
  const yaw = (yawDegrees * Math.PI) / 180;
  const tilt = (tiltDegrees * Math.PI) / 180;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  return new Float32Array([
    cosYaw, sinTilt * sinYaw, -cosTilt * sinYaw, 0,
    0, cosTilt, sinTilt, 0,
    sinYaw, -sinTilt * cosYaw, cosTilt * cosYaw, 0,
    0, 0, -5.4, 1,
  ]);
}

export function CanTurntable({ flavour, scrollDegrees, label }: CanTurntableProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const userDegrees = useRef(18);
  const lastInput = useRef(0);
  const dragging = useRef<{ pointerId: number; startX: number; startAngle: number } | null>(null);
  const animation = useRef<{ from: number; to: number; startedAt: number } | null>(null);
  const scrollRef = useRef(scrollDegrees);
  const flavourRef = useRef(flavour);
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);

  scrollRef.current = scrollDegrees;
  flavourRef.current = flavour;
  reducedRef.current = reduced;

  const turnBy = useCallback((degrees: number) => {
    lastInput.current = performance.now();
    const from = userDegrees.current;
    if (reducedRef.current) {
      userDegrees.current = from + degrees;
      animation.current = null;
      return;
    }
    animation.current = { from, to: from + degrees, startedAt: performance.now() };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (canvas === null || frame === null) return;

    const gl =
      (canvas.getContext('webgl', { antialias: true, alpha: true }) as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 1024;
    labelCanvas.height = 512;
    const labelContext = labelCanvas.getContext('2d');

    let stop = false;
    let frameHandle = 0;
    let visible = true;
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.1 },
    );
    observer.observe(frame);

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const box = frame.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width * ratio));
      canvas.height = Math.max(1, Math.round(box.height * ratio));
    };
    resize();
    const onResize = () => resize();
    window.addEventListener('resize', onResize);

    const setName = (degrees: number) => {
      const whole = ((Math.round(degrees) % 360) + 360) % 360;
      canvas.setAttribute(
        'aria-label',
        `${flavourName(flavourRef.current)} can, turned ${whole} degrees`,
      );
    };

    if (gl === null) {
      // Without WebGL the same place shows a layered drawing of the can.
      const context = canvas.getContext('2d');
      const paint = () => {
        if (stop) return;
        const now = performance.now();
        const active = animation.current;
        if (active !== null) {
          const progress = Math.min(1, (now - active.startedAt) / EIGHTH_TURN_MS);
          userDegrees.current = active.from + (active.to - active.from) * progress;
          if (progress === 1) animation.current = null;
        }
        const total = userDegrees.current + (reducedRef.current ? 0 : scrollRef.current);
        setName(total);
        if (context !== null) {
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          context.setTransform(ratio, 0, 0, ratio, 0, 0);
          drawLayeredCan(
            context,
            flavourRef.current,
            total,
            canvas.width / ratio,
            canvas.height / ratio,
          );
        }
        frameHandle = requestAnimationFrame(paint);
      };
      paint();
      return () => {
        stop = true;
        cancelAnimationFrame(frameHandle);
        observer.disconnect();
        window.removeEventListener('resize', onResize);
      };
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    const mesh = buildCan(gl);
    const texture = gl.createTexture();
    if (
      vertex === null ||
      fragment === null ||
      program === null ||
      mesh === null ||
      texture === null
    ) {
      return () => observer.disconnect();
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);

    const aPosition = gl.getAttribLocation(program, 'aPosition');
    const aNormal = gl.getAttribLocation(program, 'aNormal');
    const aUv = gl.getAttribLocation(program, 'aUv');
    const uProjection = gl.getUniformLocation(program, 'uProjection');
    const uModel = gl.getUniformLocation(program, 'uModel');
    const uMetal = gl.getUniformLocation(program, 'uMetal');

    gl.enable(gl.DEPTH_TEST);

    let paintedFlavour = '';
    const refreshTexture = () => {
      if (labelContext === null) return;
      drawCanLabel(labelContext, flavourRef.current, labelCanvas.width, labelCanvas.height);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      paintedFlavour = flavourRef.current;
    };

    const bind = (buffer: WebGLBuffer, location: number, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };

    let lastFrame = performance.now();
    const paint = () => {
      if (stop) return;
      const now = performance.now();
      const elapsed = now - lastFrame;
      lastFrame = now;

      const active = animation.current;
      if (active !== null) {
        const progress = Math.min(1, (now - active.startedAt) / EIGHTH_TURN_MS);
        const eased = 1 - (1 - progress) ** 3;
        userDegrees.current = active.from + (active.to - active.from) * eased;
        if (progress === 1) animation.current = null;
      } else if (
        !reducedRef.current &&
        visible &&
        dragging.current === null &&
        now - lastInput.current > IDLE_PAUSE_MS
      ) {
        userDegrees.current += (elapsed / IDLE_TURN_MS) * 360;
      }

      const total = userDegrees.current + (reducedRef.current ? 0 : scrollRef.current);
      setName(total);
      if (paintedFlavour !== flavourRef.current) refreshTexture();

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(uProjection, false, perspective(canvas.width / canvas.height));
      gl.uniformMatrix4fv(uModel, false, modelMatrix(total, -6));
      gl.uniform3f(uMetal, 0.85, 0.84, 0.8);
      bind(mesh.position, aPosition, 3);
      bind(mesh.normal, aNormal, 3);
      bind(mesh.uv, aUv, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);

      frameHandle = requestAnimationFrame(paint);
    };
    refreshTexture();
    paint();

    return () => {
      stop = true;
      cancelAnimationFrame(frameHandle);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startAngle: userDegrees.current,
    };
    animation.current = null;
    lastInput.current = performance.now();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragging.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const width = event.currentTarget.getBoundingClientRect().width || 1;
    // Dragging the full width of the can turns it about half a turn.
    userDegrees.current = drag.startAngle + ((event.clientX - drag.startX) / width) * 180;
    lastInput.current = performance.now();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current?.pointerId === event.pointerId) dragging.current = null;
    lastInput.current = performance.now();
  };

  return (
    <div className="turntable" ref={frameRef}>
      <canvas
        ref={canvasRef}
        className="turntable__canvas"
        role="img"
        aria-label={`${flavourName(flavour)} can, turned 0 degrees`}
        tabIndex={0}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            turnBy(-EIGHTH_TURN);
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            turnBy(EIGHTH_TURN);
          }
        }}
      />
      <p className="turntable__label" style={{ color: canPalette(flavour).base }}>
        {label}
      </p>
      <div className="turntable__controls">
        <button type="button" className="icon-button" aria-label="Turn can left" onClick={() => turnBy(-EIGHTH_TURN)}>
          <ChevronLeft aria-hidden="true" size={22} />
        </button>
        <button type="button" className="icon-button" aria-label="Turn can right" onClick={() => turnBy(EIGHTH_TURN)}>
          <ChevronRight aria-hidden="true" size={22} />
        </button>
      </div>
    </div>
  );
}
