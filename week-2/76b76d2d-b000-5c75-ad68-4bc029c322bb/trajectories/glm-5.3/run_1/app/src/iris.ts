/**
 * The Iris Pull: the scroll-mapped season stage.
 * Every value is a pure function of scroll position and viewport size.
 */

export interface StageState {
  segment: number;
  openness: number;
  rotationDegrees: number;
  radiusPx: number;
  fstop: string;
  railVisible: number;
  tintMix: number;
  activeIndex: number;
}

const fstops = ['22', '16', '11', '8', '5.6', '4', '2.8', '2', '1.4'];

export const segmentHeight = 1000;

export function stageState(scrollY: number, seasonCount: number, viewportW: number, viewportH: number): StageState {
  const n = Math.max(1, seasonCount);
  const k = Math.min(n - 1, Math.floor(Math.max(0, scrollY) / segmentHeight));
  const p = Math.min(segmentHeight, Math.max(0, scrollY) - segmentHeight * k);

  const openness = p < 400 ? p / 400 : p < 700 ? 1 : (1000 - p) / 300;
  const rotationDegrees = 40 * openness;
  const diagonal = Math.sqrt(viewportW * viewportW + viewportH * viewportH);
  const radiusPx = (diagonal / 2) * (0.04 + 0.96 * openness);
  const fstopIndex = Math.min(8, Math.floor(8 * openness));
  const railVisible = p < 400 ? 0 : p < 700 ? (p - 400) / 300 : (1000 - p) / 300;
  const tintMix = k >= n - 1 ? 0 : (p < 700 ? 0 : (p - 700) / 300);
  const activeIndex = p >= 300 ? k : Math.max(0, k - 1);

  return {
    segment: k,
    openness,
    rotationDegrees,
    radiusPx,
    fstop: fstops[fstopIndex],
    railVisible,
    tintMix,
    activeIndex,
  };
}

export function deepLinkY(index: number): number {
  return segmentHeight * index + 700;
}

export interface IrisRenderer {
  draw(state: { openness: number; rotationDegrees: number; radiusPx: number }): void;
  destroy(): void;
  rendererName(): 'webgl' | 'svg';
  contextName(): 'ok' | 'lost' | 'none';
}

/**
 * The nine procedural blades, shared by both renderers: each blade is a
 * chord quadrilateral from the aperture edge to the outer ring.
 */
export function bladePath(index: number, rotationDegrees: number, radiusPx: number, cx: number, cy: number): number[] {
  const blades = 9;
  const angle = (360 / blades) * index + rotationDegrees;
  const rad = (angle * Math.PI) / 180;
  const outer = radiusPx * 4.5 + 60;
  const chord = radiusPx * 0.72;
  const inner = radiusPx;
  const pts: number[] = [];
  const corners: [number, number][] = [
    [Math.cos(rad) * (inner + 2) - Math.sin(rad) * -chord, Math.sin(rad) * (inner + 2) + Math.cos(rad) * -chord],
    [Math.cos(rad) * outer - Math.sin(rad) * -chord, Math.sin(rad) * outer + Math.cos(rad) * -chord],
    [Math.cos(rad) * outer - Math.sin(rad) * chord, Math.sin(rad) * outer + Math.cos(rad) * chord],
    [Math.cos(rad) * (inner + 2) - Math.sin(rad) * chord, Math.sin(rad) * (inner + 2) + Math.cos(rad) * chord],
  ];
  for (const [x, y] of corners) {
    pts.push(cx + x, cy + y);
  }
  return pts;
}

export function createWebglIris(canvas: HTMLCanvasElement, onLost: () => void): IrisRenderer | null {
  const glMaybe = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!glMaybe) return null;
  const gl = glMaybe;

  canvas.addEventListener('webglcontextlost', (e: Event) => {
    e.preventDefault();
    onLost();
  });

  const vertexSrc = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;
  const fragmentSrc = `
    precision mediump float;
    uniform vec2 uCenter;
    uniform float uRadius;
    uniform float uRotation;
    void main() {
      vec2 d = gl_FragCoord.xy - uCenter;
      float dist = length(d);
      float angle = atan(d.y, d.x) + uRotation;
      float sector = mod(angle, 6.28318530718 / 9.0);
      float seam = smoothstep(0.10, 0.0, abs(sector - 0.349));
      vec3 blade = vec3(0.09, 0.07, 0.055) + seam * vec3(0.05, 0.035, 0.02);
      if (dist < uRadius - 1.0) {
        // The pupil: open to the stage behind the canvas.
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      } else if (dist < uRadius + 1.5) {
        // A thin tungsten ring at the aperture edge.
        gl_FragColor = vec4(0.78, 0.52, 0.18, 1.0);
      } else {
        gl_FragColor = vec4(blade, 1.0);
      }
    }
  `;

  function compile(type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compile(gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uCenter = gl.getUniformLocation(program, 'uCenter');
  const uRadius = gl.getUniformLocation(program, 'uRadius');
  const uRotation = gl.getUniformLocation(program, 'uRotation');
  const uInk = gl.getUniformLocation(program, 'uInk');

  return {
    draw(state) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uCenter, canvas.width / 2, canvas.height / 2);
      gl.uniform1f(uRadius, state.radiusPx * dpr);
      gl.uniform1f(uRotation, (state.rotationDegrees * Math.PI) / 180);
      gl.uniform3f(uInk, 0.13, 0.10, 0.08);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    rendererName: () => 'webgl',
    contextName: () => 'ok',
  };
}

export function createSvgIris(svg: SVGSVGElement): IrisRenderer {
  let group: SVGGElement | null = null;
  return {
    draw(state) {
      const w = svg.clientWidth || window.innerWidth;
      const h = svg.clientHeight || window.innerHeight;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      if (!group) {
        group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svg.appendChild(group);
      }
      while (group.firstChild) group.removeChild(group.firstChild);
      const cx = w / 2;
      const cy = h / 2;
      for (let i = 0; i < 9; i++) {
        const pts = bladePath(i, state.rotationDegrees, state.radiusPx, cx, cy);
        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', pts.join(','));
        poly.setAttribute('fill', '#231b14');
        group.appendChild(poly);
      }
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', String(cx));
      ring.setAttribute('cy', String(cy));
      ring.setAttribute('r', String(state.radiusPx));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#6b5636');
      ring.setAttribute('stroke-width', '1.5');
      group.appendChild(ring);
    },
    destroy() {
      if (group && group.parentNode) group.parentNode.removeChild(group);
    },
    rendererName: () => 'svg',
    contextName: () => 'none',
  };
}
