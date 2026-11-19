// The Three.js scene: gradient-shaded light planes that resolve into a faceted car body, with a
// bright rim on the panel under discussion and one marker per finding. It draws a frame only when
// the scroll position, the viewport or the server's state changes.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, LinearSRGBColorSpace, Mesh,
  MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer,
} from 'three';
import { bodyFacets, centroid, groundShadow, panelRim, type Facet } from '../../shared/scene.js';
import { PANELS, type Vec3 } from '../../shared/panels.js';
import type { CameraFrame } from '../../shared/camera.js';

export interface MarkerInput {
  point: Vec3;
  seen: boolean;
}

const MARKER_RADIUS = 12;
const MARKER_CORE = 5;

function facetGeometry(facets: Facet[]): BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  for (const facet of facets) {
    const [a, ...rest] = facet.points;
    // Light added over the body is drawn at its own strength, so a rim fades out across its bands.
    const glow = facet.glow ?? 1;
    const opacity = facet.opacity ?? 1;
    const height = centroid(facet.points)[1];
    for (let index = 0; index + 1 < rest.length; index += 1) {
      for (const point of [a, rest[index], rest[index + 1]]) {
        positions.push(point[0], point[1], point[2]);
        // Each plane is gradient-shaded: lighter up its height, darker towards the road.
        const sheen = facet.glow === undefined ? 1 + (point[1] - height) * 0.7 : 1;
        colours.push(
          facet.colour[0] * glow * sheen, facet.colour[1] * glow * sheen, facet.colour[2] * glow * sheen, opacity,
        );
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 4));
  return geometry;
}

const BACKDROP_VERTEX = `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const BACKDROP_FRAGMENT = `
  precision highp float;
  varying vec2 vNdc;
  uniform vec2 uHero;
  uniform float uAspect;
  uniform float uLevel;

  const vec3 PERIWINKLE = vec3(0.561, 0.651, 0.961);
  const vec3 INDIGO = vec3(0.169, 0.133, 0.447);
  const vec3 MAGENTA = vec3(0.541, 0.247, 0.522);
  const vec3 FAR_BLUE = vec3(0.102, 0.184, 0.753);
  const vec3 BASE = vec3(0.055, 0.012, 0.224);

  // The creases where the planes meet at the vertex: left and a little up, up and right, down and right.
  const float LEFT = 2.99;
  const float UP = 0.96;
  const float DOWN = -1.13;

  float across(vec2 p, float angle) {
    return abs(-p.x * sin(angle) + p.y * cos(angle));
  }

  void main() {
    // Measured from the vertex, in stage heights, so the planes keep their shape on any frame.
    vec2 p = vec2((vNdc.x - uHero.x) * uAspect, vNdc.y - uHero.y) * 0.5;
    float angle = atan(p.y, p.x);
    float near = exp(-length(p) / 0.5);
    float wide = clamp(abs(vNdc.x - uHero.x) * 0.72, 0.0, 1.0);
    vec3 colour;
    if (angle > UP && angle < LEFT) {
      // The upper plane: violet at the vertex, the magenta bloom over the nearside.
      colour = mix(INDIGO * 0.62, vec3(0.3, 0.2, 0.78), near * 0.95);
      colour = mix(colour, FAR_BLUE, wide * smoothstep(0.2, -0.02, p.y) * 0.8);
      vec2 bloom = p - vec2(-0.3, 0.22) * vec2(min(1.0, uAspect), 1.0);
      colour = mix(colour, MAGENTA, 0.92 * exp(-dot(bloom, bloom) / 0.04));
    } else if (angle <= UP && angle > DOWN) {
      // The right plane: an azure edge at the vertex, plum in the middle, saturated blue far out.
      colour = mix(vec3(0.14, 0.075, 0.29), FAR_BLUE * 1.15, smoothstep(0.08, 0.72, wide));
      colour += MAGENTA * 0.36 * exp(-dot(p - vec2(0.2, 0.16), p - vec2(0.2, 0.16)) / 0.04);
      colour += vec3(0.1, 0.32, 0.62) * exp(-across(p, DOWN) / 0.1) * exp(-length(p) / 0.34);
    } else {
      // The left plane: periwinkle under the crease at the far side, falling through the indigo.
      float under = across(p, LEFT);
      vec3 lit = mix(vec3(0.2, 0.3, 0.8), PERIWINKLE, wide * wide);
      colour = mix(lit, INDIGO, smoothstep(0.0, 0.2, under));
      colour = mix(colour, FAR_BLUE * 0.8, near * 0.45);
    }
    // The planes dissolve into the indigo base by about two-thirds of the way down.
    colour = mix(colour, BASE, smoothstep(0.2, -0.32, vNdc.y));
    // Inside a beat they step back, so the brightest thing there is the panel under discussion.
    gl_FragColor = vec4(mix(BASE, colour, uLevel), 1.0);
  }
`;

// The vertex: three bright plane edges meeting on the car's worst fault, drawn over the body.
const GLOW_FRAGMENT = `
  precision highp float;
  uniform vec2 uHero;
  uniform float uBloom;
  uniform vec2 uViewport;
  uniform float uDpr;
  const vec3 RIM = vec3(1.0, 0.949, 0.859);

  float edge(vec2 px, float angle, float width, float reach) {
    vec2 direction = vec2(cos(angle), sin(angle));
    float along = dot(px, direction);
    if (along < 0.0) return 0.0;
    float across = abs(px.x * -direction.y + px.y * direction.x);
    return exp(-(across * across) / (width * width)) * exp(-along / reach);
  }

  void main() {
    vec2 here = gl_FragCoord.xy / uDpr;
    vec2 heroPx = vec2((uHero.x + 1.0) * 0.5 * uViewport.x, (uHero.y + 1.0) * 0.5 * uViewport.y);
    vec2 px = here - heroPx;
    float away = dot(px, px);
    float rays = edge(px, 2.99, 2.6, 300.0) + edge(px, 0.96, 2.4, 130.0) + edge(px, -1.13, 2.6, 130.0);
    float glint = 1.4 * exp(-away / 760.0) + 0.3 * exp(-away / 4600.0);
    gl_FragColor = vec4(RIM * (rays * 0.42 + glint) * uBloom, 1.0);
  }
`;

// The advisory ticks: a dark strip along the bottom of the preview's canvas with one bright
// square tick per open advisory, up to twelve.
const TICK_FRAGMENT = `
  precision highp float;
  uniform float uDpr;
  uniform float uOpen;
  void main() {
    vec2 px = gl_FragCoord.xy / uDpr;
    float fromBottom = px.y;
    if (fromBottom > 24.0) discard;
    vec3 colour = vec3(0.027, 0.008, 0.102);
    for (int k = 1; k <= 12; k += 1) {
      if (float(k) > uOpen) break;
      float cx = 16.0 * float(k);
      if (abs(px.x - cx) <= 5.0 && abs(fromBottom - 12.0) <= 5.0) colour = vec3(1.0, 0.949, 0.859);
    }
    gl_FragColor = vec4(colour, 1.0);
  }
`;

const TICK_VERTEX = `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const MARKER_VERTEX = `
  attribute vec2 corner;
  attribute float filled;
  uniform vec2 uViewport;
  uniform float uRadius;
  varying vec2 vCorner;
  varying float vFilled;
  void main() {
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    clip.xy += corner * (uRadius * 2.0 / uViewport) * clip.w;
    gl_Position = clip;
    vCorner = corner;
    vFilled = filled;
  }
`;

const MARKER_FRAGMENT = `
  precision highp float;
  uniform float uRadius;
  uniform float uCore;
  varying vec2 vCorner;
  varying float vFilled;
  void main() {
    float d = length(vCorner) * uRadius;
    if (d > uRadius) discard;
    vec3 bright = vec3(1.0, 0.949, 0.859);
    vec3 dark = vec3(0.04, 0.01, 0.16);
    vec3 colour = (vFilled > 0.5 || d > uCore) ? bright : dark;
    float alpha = 1.0 - smoothstep(uRadius - 1.25, uRadius, d);
    gl_FragColor = vec4(colour, alpha);
  }
`;

export class StageRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera();
  private readonly backdrop: ShaderMaterial;
  private readonly glow: ShaderMaterial;
  private readonly bodyMaterials: MeshBasicMaterial[] = [];
  private readonly rims = new Map<string, Mesh>();
  private readonly markerMaterial: ShaderMaterial;
  private readonly tickMaterial: ShaderMaterial;
  private readonly dimMaterial: ShaderMaterial;
  private readonly dimLayer: Mesh;
  private readonly ticks: Mesh;
  private markers: Mesh | null = null;

  constructor(canvas: HTMLCanvasElement, context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true, preserveDrawingBuffer: true });
    // The palette is written as display values, the same ones the drawn still paints.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.setClearColor(new Color(0.055, 0.012, 0.224), 1);
    this.camera.matrixAutoUpdate = false;

    this.backdrop = new ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uHero: { value: [0, 0] },
        uAspect: { value: 1.6 },
        uLevel: { value: 1 },
      },
    });
    const field = new BufferGeometry();
    field.setAttribute('position', new BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    const backdropMesh = new Mesh(field, this.backdrop);
    backdropMesh.frustumCulled = false;
    backdropMesh.renderOrder = -10;
    this.scene.add(backdropMesh);

    this.glow = new ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      transparent: true,
      uniforms: {
        uHero: { value: [0, 0] },
        uBloom: { value: 1 },
        uViewport: { value: [1280, 800] },
        uDpr: { value: 1 },
      },
    });
    const glowMesh = new Mesh(field, this.glow);
    glowMesh.frustumCulled = false;
    glowMesh.renderOrder = 5;
    this.scene.add(glowMesh);

    const shadow = new Mesh(facetGeometry(groundShadow()), new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }));
    shadow.frustumCulled = false;
    shadow.renderOrder = -5;
    this.scene.add(shadow);

    // Facets that share a plane are told apart by offset, so one skin wins at every angle and no
    // comb of stripes appears where a panel lies on the shell.
    const facets = bodyFacets();
    for (const layer of [0, 1, 2]) {
      const material = new MeshBasicMaterial({
        vertexColors: true,
        side: DoubleSide,
        polygonOffset: layer > 0,
        polygonOffsetFactor: -layer,
        polygonOffsetUnits: -4 * layer,
      });
      const mesh = new Mesh(facetGeometry(facets.filter((item) => (item.layer ?? 0) === layer)), material);
      mesh.frustumCulled = false;
      mesh.renderOrder = layer;
      this.bodyMaterials.push(material);
      this.scene.add(mesh);
    }

    for (const panel of PANELS) {
      const material = new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        // The rim traces the whole panel, so it is drawn over the body rather than buried in it
        // where the body's curve stands proud of the flat panel frame.
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(facetGeometry(panelRim(panel)), material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.rims.set(panel.id, mesh);
      this.scene.add(mesh);
    }

    this.tickMaterial = new ShaderMaterial({
      vertexShader: TICK_VERTEX,
      fragmentShader: TICK_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uViewport: { value: [1280, 800] },
        uDpr: { value: 1 },
        uOpen: { value: 0 },
      },
    });
    const strip = new BufferGeometry();
    strip.setAttribute('position', new BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    this.ticks = new Mesh(strip, this.tickMaterial);
    this.ticks.frustumCulled = false;
    this.ticks.renderOrder = 20;
    this.ticks.visible = false;
    this.scene.add(this.ticks);

    this.dimMaterial = new ShaderMaterial({
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: `
        precision highp float;
        uniform float uAmount;
        void main() { gl_FragColor = vec4(0.02, 0.004, 0.06, uAmount); }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uAmount: { value: 0 } },
    });
    const dimMesh = new Mesh(field, this.dimMaterial);
    dimMesh.frustumCulled = false;
    dimMesh.renderOrder = 30;
    dimMesh.visible = false;
    this.dimLayer = dimMesh;
    this.scene.add(dimMesh);

    this.markerMaterial = new ShaderMaterial({
      vertexShader: MARKER_VERTEX,
      fragmentShader: MARKER_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uViewport: { value: [1280, 800] },
        uRadius: { value: MARKER_RADIUS },
        uCore: { value: MARKER_CORE },
      },
    });
  }

  setMarkers(markers: MarkerInput[]): void {
    if (this.markers) {
      this.scene.remove(this.markers);
      this.markers.geometry.dispose();
      this.markers = null;
    }
    if (markers.length === 0) return;
    const positions: number[] = [];
    const corners: number[] = [];
    const filled: number[] = [];
    const indices: number[] = [];
    markers.forEach((marker, index) => {
      const base = index * 4;
      for (const corner of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(marker.point[0], marker.point[1], marker.point[2]);
        corners.push(corner[0], corner[1]);
        filled.push(marker.seen ? 1 : 0);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('corner', new BufferAttribute(new Float32Array(corners), 2));
    geometry.setAttribute('filled', new BufferAttribute(new Float32Array(filled), 1));
    geometry.setIndex(indices);
    const mesh = new Mesh(geometry, this.markerMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.markers = mesh;
    this.scene.add(mesh);
  }

  draw(options: {
    frame: CameraFrame;
    width: number;
    height: number;
    heroNdc: readonly [number, number];
    bloom: number;
    dim: number;
    rimPanelId: string;
    rimGlow: number;
    /** Below zero when this stage shows no advisory ticks. */
    ticks: number;
  }): void {
    const { frame, width, height } = options;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);

    this.camera.position.set(frame.eye[0], frame.eye[1], frame.eye[2]);
    this.camera.rotation.set(frame.pitch, frame.yaw, 0, 'YXZ');
    this.camera.updateMatrix();
    this.camera.updateMatrixWorld(true);
    this.camera.projectionMatrix.fromArray(frame.projection);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    this.backdrop.uniforms.uHero.value = [options.heroNdc[0], options.heroNdc[1]];
    this.backdrop.uniforms.uAspect.value = Math.max(0.2, width / Math.max(1, height));
    this.backdrop.uniforms.uLevel.value = 0.5 + 0.5 * options.bloom;
    for (const material of this.bodyMaterials) material.color.setScalar(0.6 + 0.4 * options.bloom);
    this.glow.uniforms.uHero.value = [options.heroNdc[0], options.heroNdc[1]];
    this.glow.uniforms.uBloom.value = options.bloom;
    this.glow.uniforms.uViewport.value = [width, height];
    this.glow.uniforms.uDpr.value = this.renderer.getPixelRatio();

    for (const [panelId, mesh] of this.rims) {
      const lit = panelId === options.rimPanelId && options.rimGlow > 0;
      mesh.visible = lit;
      (mesh.material as MeshBasicMaterial).opacity = lit ? options.rimGlow : 0;
    }

    this.markerMaterial.uniforms.uViewport.value = [width, height];

    this.dimLayer.visible = options.dim < 1;
    this.dimMaterial.uniforms.uAmount.value = 1 - options.dim;

    this.ticks.visible = options.ticks >= 0;
    this.tickMaterial.uniforms.uDpr.value = this.renderer.getPixelRatio();
    this.tickMaterial.uniforms.uOpen.value = Math.max(0, options.ticks);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
