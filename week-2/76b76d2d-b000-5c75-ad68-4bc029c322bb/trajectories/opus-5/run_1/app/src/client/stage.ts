import { setI18n, setI18nAria } from './i18n.ts';

const FSTOPS = ['22', '16', '11', '8', '5.6', '4', '2.8', '2', '1.4'];
const SEGMENT = 1000;
const TINTS = ['#1a0a0c', '#071413', '#140d07', '#0d0a14'];

export type StageSeason = { slug: string; title_en: string; title_fr: string; count: number };

type StageState = {
  segment: number;
  open: number;
  rotation: number;
  radius: number;
  fstop: string;
  rail: number;
  tint: number;
  active: number;
};

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function stateFor(y: number, count: number, diagonal: number): StageState {
  const segment = Math.min(count - 1, Math.floor(y / SEGMENT));
  const position = Math.min(SEGMENT, y - SEGMENT * segment);
  const open =
    position < 400 ? position / 400 : position < 700 ? 1 : (SEGMENT - position) / 300;
  const rail = position < 400 ? 0 : position < 700 ? (position - 400) / 300 : (SEGMENT - position) / 300;
  const tint = position < 700 || segment === count - 1 ? 0 : (position - 700) / 300;
  return {
    segment,
    open,
    rotation: 40 * open,
    radius: (diagonal / 2) * (0.04 + 0.96 * open),
    fstop: FSTOPS[Math.min(8, Math.floor(8 * open))],
    rail,
    tint,
    active: position >= 300 ? segment : Math.max(0, segment - 1),
  };
}

function bladeGeometry(radius: number, rotationDegrees: number, reach: number): Float32Array {
  const vertices: number[] = [];
  const blades = 9;
  const step = (Math.PI * 2) / blades;
  const base = (rotationDegrees * Math.PI) / 180;
  for (let index = 0; index < blades; index += 1) {
    const a0 = base + index * step;
    const a1 = base + (index + 1) * step;
    const inner0 = [Math.cos(a0) * radius, Math.sin(a0) * radius];
    const inner1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
    const outer0 = [Math.cos(a0) * reach, Math.sin(a0) * reach];
    const outer1 = [Math.cos(a1) * reach, Math.sin(a1) * reach];
    vertices.push(inner0[0], inner0[1], inner1[0], inner1[1], outer1[0], outer1[1]);
    vertices.push(inner0[0], inner0[1], outer1[0], outer1[1], outer0[0], outer0[1]);
  }
  return new Float32Array(vertices);
}

function polygonPath(radius: number, rotationDegrees: number): string {
  const blades = 9;
  const step = 360 / blades;
  const points: string[] = [];
  for (let index = 0; index < blades; index += 1) {
    const angle = ((rotationDegrees + index * step) * Math.PI) / 180;
    points.push(`${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

class SvgIris {
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  draw(radius: number, rotation: number, tintColour: string): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const reach = Math.hypot(width, height);
    const blades: string[] = [];
    const step = 360 / 9;
    for (let index = 0; index < 9; index += 1) {
      const a0 = ((rotation + index * step) * Math.PI) / 180;
      const a1 = ((rotation + (index + 1) * step) * Math.PI) / 180;
      const inner0 = [Math.cos(a0) * radius, Math.sin(a0) * radius];
      const inner1 = [Math.cos(a1) * radius, Math.sin(a1) * radius];
      const outer0 = [Math.cos(a0) * reach, Math.sin(a0) * reach];
      const outer1 = [Math.cos(a1) * reach, Math.sin(a1) * reach];
      blades.push(
        `<path d="M${inner0[0].toFixed(1)},${inner0[1].toFixed(1)}L${inner1[0].toFixed(1)},${inner1[1].toFixed(
          1,
        )}L${outer1[0].toFixed(1)},${outer1[1].toFixed(1)}L${outer0[0].toFixed(1)},${outer0[1].toFixed(
          1,
        )}Z" fill="${tintColour}" stroke="#241f1b" stroke-width="1.5" />`,
      );
    }
    this.host.innerHTML =
      `<svg viewBox="${-width / 2} ${-height / 2} ${width} ${height}" width="${width}" height="${height}" ` +
      `aria-hidden="true" class="iris-blades">${blades.join('')}` +
      `<path d="${polygonPath(radius, rotation)}" fill="none" stroke="#3a3027" stroke-width="2" /></svg>`;
  }

  clear(): void {
    this.host.innerHTML = '';
  }
}

class WebglIris {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  start(): boolean {
    const gl = this.canvas.getContext('webgl', { antialias: true, alpha: true });
    if (gl === null) return false;
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertex,
      'attribute vec2 position; uniform vec2 viewport; void main() { gl_Position = vec4(position / (viewport * 0.5), 0.0, 1.0); }',
    );
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragment, 'precision mediump float; uniform vec4 tint; void main() { gl_FragColor = tint; }');
    gl.compileShader(fragment);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return false;
    this.gl = gl;
    this.program = program;
    this.buffer = gl.createBuffer();
    return true;
  }

  draw(radius: number, rotation: number, colour: [number, number, number]): void {
    const gl = this.gl;
    const program = this.program;
    if (gl === null || program === null) return;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    const vertices = bladeGeometry(radius, rotation, Math.hypot(width, height) * 1.2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(program, 'viewport'), width, height);
    gl.uniform4f(gl.getUniformLocation(program, 'tint'), colour[0], colour[1], colour[2], 1);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

export function initStage(seasons: StageSeason[]): void {
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('iris-canvas') as HTMLCanvasElement | null;
  const svgHost = document.getElementById('iris-svg');
  const announcer = document.getElementById('season-announcer');
  const fstopEl = document.getElementById('fstop');
  const segmentsHost = document.getElementById('stage-segments');
  const scroller = document.getElementById('stage-scroll');
  if (stage === null || canvas === null || svgHost === null || segmentsHost === null) return;
  const count = Math.max(1, seasons.length);
  const svg = new SvgIris(svgHost);
  const webgl = new WebglIris(canvas);
  let renderer: 'webgl' | 'svg' = 'svg';
  let context: 'ok' | 'lost' | 'none' = 'none';
  if (webgl.start()) {
    renderer = 'webgl';
    context = 'ok';
  }
  canvas.hidden = renderer !== 'webgl';
  let active = -1;
  let announced = false;

  const tintFor = (index: number): string => TINTS[index % TINTS.length];

  const render = (state: StageState): void => {
    stage.setAttribute('data-segment', String(state.segment));
    stage.setAttribute('data-iris-open', state.open.toFixed(3));
    stage.setAttribute('data-iris-rotation', state.rotation.toFixed(1));
    stage.setAttribute('data-iris-radius', String(Math.round(state.radius)));
    stage.setAttribute('data-fstop', state.fstop);
    stage.setAttribute('data-rail-visible', state.rail.toFixed(3));
    stage.setAttribute('data-tint-mix', state.tint.toFixed(3));
    stage.setAttribute('data-renderer', renderer);
    stage.setAttribute('data-context', context);
    if (fstopEl !== null) fstopEl.textContent = `f/${state.fstop}`;
    const colour = tintFor(state.segment);
    document.body.style.setProperty('--season-tint', colour);
    document.body.style.setProperty('--season-tint-next', tintFor(state.segment + 1));
    document.body.style.setProperty('--tint-mix', state.tint.toFixed(3));
    if (renderer === 'webgl') webgl.draw(state.radius, state.rotation, hexToRgb(colour));
    else svg.draw(state.radius, state.rotation, colour);

    for (const element of segmentsHost.querySelectorAll('.season-segment')) {
      const index = Number(element.getAttribute('data-index'));
      const visible = index === state.segment;
      (element as HTMLElement).hidden = !visible;
      (element as HTMLElement).style.setProperty('--rail-visible', state.rail.toFixed(3));
    }

    if (state.active !== active) {
      active = state.active;
      const season = seasons[active];
      if (season !== undefined) {
        const url = new URL(window.location.href);
        url.searchParams.set('season', season.slug);
        window.history.replaceState({}, '', url);
        document.documentElement.setAttribute('data-active-season', season.slug);
        for (const tab of document.querySelectorAll('[role="tab"]')) {
          const selected = tab.getAttribute('data-season') === season.slug;
          tab.setAttribute('aria-selected', selected ? 'true' : 'false');
          if (selected) tab.setAttribute('aria-current', 'true');
          else tab.removeAttribute('aria-current');
          (tab as HTMLElement).tabIndex = selected ? 0 : -1;
        }
        if (announcer !== null && announced) {
          setI18n(announcer, season.count === 1 ? 'season_announce_one' : 'season_announce_many', {
            title: { en: season.title_en, fr: season.title_fr },
            count: season.count,
          });
        }
        announced = true;
      }
    }
  };

  const diagonal = (): number => Math.hypot(window.innerWidth, window.innerHeight);

  const paintScroll = (): void => {
    render(stateFor(window.scrollY, count, diagonal()));
  };

  const paintReduced = (index: number): void => {
    const d = diagonal();
    render({
      segment: index,
      open: 1,
      rotation: 40,
      radius: Math.round(d / 2),
      fstop: '1.4',
      rail: 1,
      tint: 0,
      active: index,
    });
  };

  const slugIndex = (slug: string | null): number => {
    if (slug === null) return -1;
    return seasons.findIndex((season) => season.slug === slug);
  };

  const reduced = reducedMotion();
  if (reduced && scroller !== null) scroller.style.height = '0px';

  const goTo = (index: number): void => {
    if (reduced) {
      paintReduced(index);
      return;
    }
    window.scrollTo({ top: SEGMENT * index + 700, behavior: 'instant' as ScrollBehavior });
    paintScroll();
  };

  const initial = slugIndex(new URL(window.location.href).searchParams.get('season'));
  if (reduced) {
    paintReduced(initial >= 0 ? initial : 0);
  } else if (initial >= 0) {
    goTo(initial);
  } else {
    paintScroll();
  }

  if (!reduced) {
    window.addEventListener('scroll', () => {
      window.requestAnimationFrame(paintScroll);
    }, { passive: true });
  }
  window.addEventListener('resize', () => {
    if (reduced) paintReduced(Math.max(0, active));
    else paintScroll();
  });

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer = 'svg';
    context = 'lost';
    canvas.hidden = true;
    if (reduced) paintReduced(Math.max(0, active));
    else paintScroll();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (webgl.start()) {
      renderer = 'webgl';
      context = 'ok';
      canvas.hidden = false;
      svg.clear();
      if (reduced) paintReduced(Math.max(0, active));
      else paintScroll();
    }
  });

  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => goTo(index));
    tab.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        const next = key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
      } else if (key === 'Home') {
        event.preventDefault();
        tabs[0].focus();
      } else if (key === 'End') {
        event.preventDefault();
        tabs[tabs.length - 1].focus();
      } else if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        goTo(index);
      }
    });
  });

  for (const link of document.querySelectorAll<HTMLElement>('.rail-link')) {
    link.addEventListener('focus', () => {
      const row = link.closest('.season-segment');
      const index = Number(row?.getAttribute('data-index') ?? '0');
      if (!reduced && index !== active) goTo(index);
    });
  }

  if (announcer !== null) setI18nAria(announcer, 'season_announcer');

  const refreshSeats = async (): Promise<void> => {
    const slug = document.documentElement.getAttribute('data-active-season');
    if (slug === null) return;
    const response = await fetch(`/api/seasons/${slug}`, { headers: { 'X-Halide-Locale': document.documentElement.lang } });
    if (!response.ok) return;
    const data = (await response.json()) as {
      season: { screenings: Array<{ id: string; seats_remaining: number }> };
    };
    for (const screening of data.season.screenings) {
      const cell = document.querySelector(`[data-seats-left="${screening.id}"]`);
      if (cell === null) continue;
      if (screening.seats_remaining === 0) setI18n(cell, 'sold_out');
      else setI18n(cell, 'seats_left', { count: screening.seats_remaining });
    }
  };
  window.setInterval(() => {
    void refreshSeats().catch(() => undefined);
  }, 15000);
}
