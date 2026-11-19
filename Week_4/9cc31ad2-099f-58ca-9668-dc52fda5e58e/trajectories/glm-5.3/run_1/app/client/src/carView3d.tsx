// The 3D car view: turns on its own, orbits when dragged, falls back to a drawing.
import { useEffect, useRef, useState, type JSX } from 'react';
import { prefersReducedMotion } from './ui';

export function CarView3D({ carName }: { carName: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [fallback, setFallback] = useState(false);
  const [angle, setAngle] = useState(0.6);
  const dragRef = useRef<{ active: boolean; lastX: number; resumeAt: number }>({ active: false, lastX: 0, resumeAt: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      setFallback(true);
      return;
    }
    // A tiny WebGL 2 renderer: one buffer, one program, built-in shapes.
    const vs = `#version 300 es
      in vec3 aPos;
      in vec3 aNormal;
      in vec3 aColour;
      uniform mat4 uMVP;
      uniform mat4 uModel;
      out vec3 vNormal;
      out vec3 vColour;
      void main() {
        gl_Position = uMVP * vec4(aPos, 1.0);
        vNormal = mat3(uModel) * aNormal;
        vColour = aColour;
      }`;
    const fs = `#version 300 es
      precision mediump float;
      in vec3 vNormal;
      in vec3 vColour;
      out vec4 o;
      void main() {
        float light = 0.55 + 0.45 * max(dot(normalize(vNormal), normalize(vec3(0.5, 0.8, 0.6))), 0.0);
        o = vec4(vColour * light, 1.0);
      }`;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('no shader');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error('no program');
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    // Build the car from boxes: body, cabin, four wheels, on a ruled floor.
    const boxes: { pos: [number, number, number]; size: [number, number, number]; colour: [number, number, number] }[] = [];
    const cream: [number, number, number] = [0.95, 0.93, 0.87];
    const ink: [number, number, number] = [0.14, 0.11, 0.08];
    const accent: [number, number, number] = [0.85, 0.38, 0.06];
    boxes.push({ pos: [0, 0.5, 0], size: [1.9, 0.5, 0.9], colour: cream });
    boxes.push({ pos: [-0.1, 0.9, 0], size: [0.9, 0.32, 0.8], colour: ink });
    boxes.push({ pos: [0.62, 0.55, 0], size: [0.06, 0.3, 0.7], colour: accent });
    for (const [x, z] of [[-0.6, 0.5], [0.6, 0.5], [-0.6, -0.5], [0.6, -0.5]] as [number, number][]) {
      boxes.push({ pos: [x, 0.22, z], size: [0.42, 0.42, 0.16], colour: ink });
    }

    interface Tri { pos: number[]; normal: number[]; colour: number[] }
    const verts: number[] = [];
    const pushTri = (t: Tri): void => {
      verts.push(...t.pos, ...t.normal, ...t.colour);
    };
    const face = (corner: [number, number, number], du: [number, number, number], dv: [number, number, number],
                  normal: [number, number, number], colour: [number, number, number]): void => {
      const c = corner;
      pushTri({ pos: [...c, ...add(c, du), ...add(c, dv)], normal: [...normal, ...normal, ...normal], colour: [...colour, ...colour, ...colour] });
      const c2 = add(c, du);
      const c3 = add(c, dv);
      pushTri({ pos: [...c2, ...add(c2, dv), ...c3], normal: [...normal, ...normal, ...normal], colour: [...colour, ...colour, ...colour] });
    };
    const add = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    for (const b of boxes) {
      const [cx, cy, cz] = b.pos;
      const [sx, sy, sz] = b.size;
      const h: [number, number, number] = [sx / 2, sy / 2, sz / 2];
      // six faces
      face([cx - h[0], cy - h[1], cz + h[2]], [sx, 0, 0], [0, sy, 0], [0, 0, 1], b.colour);
      face([cx - h[0], cy - h[1], cz - h[2]], [0, sy, 0], [sx, 0, 0], [0, 0, -1], b.colour);
      face([cx - h[0], cy + h[1], cz + h[2]], [0, 0, -sz], [sx, 0, 0], [0, 1, 0], b.colour);
      face([cx - h[0], cy - h[1], cz - h[2]], [sx, 0, 0], [0, 0, sz], [0, -1, 0], b.colour);
      face([cx + h[0], cy - h[1], cz + h[2]], [0, sy, 0], [0, 0, -sz], [1, 0, 0], b.colour);
      face([cx - h[0], cy - h[1], cz - h[2]], [0, 0, sz], [0, sy, 0], [-1, 0, 0], b.colour);
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const stride = 9 * 4;
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, stride, 0);
    const aNormal = gl.getAttribLocation(prog, 'aNormal');
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, stride, 12);
    const aColour = gl.getAttribLocation(prog, 'aColour');
    gl.enableVertexAttribArray(aColour);
    gl.vertexAttribPointer(aColour, 3, gl.FLOAT, false, stride, 24);

    const uMVP = gl.getUniformLocation(prog, 'uMVP');
    const uModel = gl.getUniformLocation(prog, 'uModel');

    const mat4mul = (a: number[], b: number[]): number[] => {
      const out = new Array(16).fill(0);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
          out[i * 4 + j] = s;
        }
      }
      return out;
    };
    const perspective = (fov: number, aspect: number, near: number, far: number): number[] => {
      const f = 1 / Math.tan(fov / 2);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    };
    const rotY = (t: number): number[] => {
      const c = Math.cos(t), s = Math.sin(t);
      return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
    };
    const translate = (x: number, y: number, z: number): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const TURN_PERIOD = 30000; // once every 30 seconds
    const render = (now: number): void => {
      raf = requestAnimationFrame(render);
      const dt = Math.min(now - last, 100);
      last = now;
      if (!prefersReducedMotion() && !dragRef.current.active && now >= dragRef.current.resumeAt) {
        acc += dt;
        setAngle(a => (a + (2 * Math.PI * acc) / TURN_PERIOD) % (2 * Math.PI));
        acc = 0;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.965, 0.937, 0.886, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const model = rotY(angle);
      const view = translate(0, -0.9, -4.2);
      const proj = perspective(0.9, canvas.width / canvas.height, 0.1, 100);
      const mvp = mat4mul(proj, mat4mul(view, model));
      gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
      gl.uniformMatrix4fv(uModel, false, new Float32Array(model));
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / 9);
    };
    raf = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(raf); };
  }, [angle]);

  // Dragging orbits the car; it resumes turning about 2 seconds later.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    dragRef.current.active = true;
    dragRef.current.lastX = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    dragRef.current.lastX = e.clientX;
    setAngle(a => a + dx * 0.01);
  };
  const onPointerUp = (): void => {
    dragRef.current.active = false;
    dragRef.current.resumeAt = performance.now() + 2000;
  };

  if (fallback) {
    return (
      <figure style={{ margin: 0 }}>
        <svg viewBox="0 0 220 90" width="220" height="90" role="img" aria-label={`${carName}, drawing`}>
          <rect x="10" y="40" width="150" height="26" fill="#f0e8d6" stroke="#231c14" strokeWidth="2" />
          <rect x="45" y="22" width="70" height="20" fill="#f0e8d6" stroke="#231c14" strokeWidth="2" />
          <circle cx="45" cy="70" r="13" fill="#231c14" />
          <circle cx="130" cy="70" r="13" fill="#231c14" />
          <rect x="150" y="46" width="14" height="14" fill="#d9600f" />
        </svg>
        <figcaption className="notice" style={{ padding: '6px 10px' }}>
          3D view needs WebGL 2. Showing a drawing instead.
        </figcaption>
      </figure>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${carName}, 3D view`}
      style={{ width: 260, height: 180, border: '1px solid var(--ink)', touchAction: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
