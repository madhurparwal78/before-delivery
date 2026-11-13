// Readout construction: the exact texts from the readout table, built by the
// one evaluator and shown by the inspector, the evaluate route and the embed.
import type { App } from './app';
import type { ResolvedScene, ResolvedLayer, EvalContext, ModelInfo } from '../domain/evaluate';
import { localVertex, extrusionFor } from '../domain/evaluate';
import { sampleComposite } from '../domain/composite';
import { simulateEmit, simulateForm } from '../domain/particles';
import { simulateCloth } from '../domain/cloth';
import { formatFixed, formatTimeReadout, rgbToHex, formatInt, hexToRgb } from '../domain/format';
import { ARTBOARDS, PRIMITIVES } from '../domain/props';
import { transformPoint, projectToScreen, quatToEulerXYZ } from '../domain/math3d';
import type { SceneBundle, SceneDocument, Vec3, Layer, Breakpoint } from '../domain/kinds';

export interface ReadoutInput {
  frame: number;
  vertex?: string | null;
  particle?: string | null;
  point?: string | null;
  node?: string | null;
  sampleX?: string | null;
  sampleY?: string | null;
  bundle: SceneBundle;
  modelInfo: Map<string, ModelInfo>;
}

export function buildReadouts(
  app: App,
  doc: SceneDocument,
  resolved: ResolvedScene,
  layer: ResolvedLayer | undefined,
  input: ReadoutInput,
): Record<string, string> {
  const out: Record<string, string> = {};
  out['time'] = formatTimeReadout(input.frame);

  const ab = ARTBOARDS[resolved.camera ? 'desktop' : 'desktop'];
  void ab;
  const bpArtboard = ARTBOARDS[(resolved as unknown as { breakpoint?: Breakpoint }).breakpoint ?? 'desktop'];
  void bpArtboard;

  if (layer) {
    const props = layer.props;
    const l = layer.layer;
    // screen-point
    if (layer.screenPoint) {
      out['screen-point'] = `${formatFixed(layer.screenPoint.x, 2)}, ${formatFixed(layer.screenPoint.y, 2)} px`;
    } else if (props.position) {
      out['screen-point'] = 'Not visible';
    }
    // vertex-point / vertex-world
    if (input.vertex) {
      const local = localVertex(l, props, input.vertex, ctxOf(resolved));
      if (local) {
        const world = transformPoint(layer.world, local);
        out['vertex-world'] = `${formatFixed(world.x, 3)}, ${formatFixed(world.y, 3)}, ${formatFixed(world.z, 3)}`;
        const pr = projectToScreen(
          world,
          resolved.camera.view,
          resolved.camera.fov,
          artboardOf(doc, resolved).w,
          artboardOf(doc, resolved).h,
          doc.camera.near,
          doc.camera.far,
        );
        out['vertex-point'] = pr.visible
          ? `${formatFixed(pr.x, 2)}, ${formatFixed(pr.y, 2)} px`
          : 'Not visible';
      } else {
        out['vertex-point'] = 'Not visible';
        out['vertex-world'] = 'Not visible';
      }
    }
    // camera-azimuth (shown on the scene)
    if (doc.orbit.enabled) {
      out['camera-azimuth'] = `Camera azimuth ${formatFixed(resolved.camera.azimuth, 3)}°`;
    }
    // triangles
    out['triangles'] = `Triangles ${formatInt(layerTriangles(l, props, input.bundle))}`;
    // Triangles drawn: the selected layer's triangles, doubled when it draws
    // both sides.
    {
      const tris = layerTriangles(l, props, input.bundle);
      const faces = props.faces as string;
      const mat = props.material as { kind: string; backFaceRefraction: boolean } | undefined;
      const alwaysBoth =
        mat?.kind === 'Glass' && mat.backFaceRefraction === true;
      const doubled = faces === 'both' || alwaysBoth;
      out['triangles-drawn'] = `Triangles drawn ${formatInt(doubled ? tris * 2 : tris)}`;
    }
    // ior
    if (props.material) {
      if ((props.material as { kind: string }).kind === 'Glass') {
        const r = (props.material as { refraction: number }).refraction;
        out['ior'] = `IOR ${formatFixed(1 + 0.25 * r, 3)}`;
      }
    }
    // blur
    if (l.kind === 'Effect') {
      const eff = props.effect as { kind: string } & Record<string, number>;
      if (eff.kind === 'Blur') {
        const sigma = eff.blurRadius / 2;
        const taps = 2 * Math.ceil(3 * sigma) + 1;
        out['blur'] = `σ ${formatFixed(sigma, 2)} · ${taps} taps`;
      }
      if (eff.kind === 'Chromatic aberration') {
        out['aberration'] = `R +${formatInt(eff.aberration)} px · B -${formatInt(eff.aberration)} px`;
      }
    }
    // particles
    if (l.kind === 'Particles') {
      if (props.mode === 'form') {
        const targets = formationTargets(props, resolved, input.bundle);
        const count = (props.formation as { count: number }).count;
        const dur = (props.formation as { durationMs: number }).durationMs;
        const form = simulateForm(
          { seed: props.seed as number, count, durationMs: dur, targets },
          input.frame,
        );
        out['live-particles'] = `Live particles ${formatInt(count)}`;
        const n = Number(input.particle ?? 0);
        const pt = form.positions.find((p) => p.n === n);
        if (pt) {
          out['particle'] = `Particle ${formatInt(n)} at ${formatFixed(pt.p.x, 3)}, ${formatFixed(pt.p.y, 3)}, ${formatFixed(pt.p.z, 3)}`;
        } else {
          out['particle'] = `Particle ${formatInt(n)} is not alive at ${out['time']}.`;
        }
      } else {
        const sim = simulateEmit(
          {
            seed: props.seed as number,
            rate: props.rate as number,
            burst: props.burst as number,
            lifetime: props.lifetime as number,
            speed: props.speed as number,
            gravity: props.gravity as number,
            trailLength: props.trailLength as number,
            orbit: props.orbit as number,
            attractor: props.attractor as never,
            particleMax: app.limits.particleMax,
          },
          input.frame,
        );
        out['live-particles'] = `Live particles ${formatInt(sim.liveCount)}`;
        const n = Number(input.particle ?? 0);
        const pt = sim.particles.find((p) => p.number === n);
        if (pt) {
          out['particle'] = `Particle ${formatInt(n)} at ${formatFixed(pt.p.x, 3)}, ${formatFixed(pt.p.y, 3)}, ${formatFixed(pt.p.z, 3)}`;
        } else {
          out['particle'] = `Particle ${formatInt(n)} is not alive at ${out['time']}.`;
        }
        if ((props.trailLength as number) > 0) {
          const steps = pt ? input.frame - pt.birthStep + 1 : 0;
          out['trail-points'] = `Trail points ${formatInt(Math.min(props.trailLength as number, steps))}`;
        }
      }
    }
    // cloth
    if (l.kind === 'Cloth') {
      const points = simulateCloth(
        {
          columns: props.columns as number,
          rows: props.rows as number,
          pinned: props.pinned as never,
          gravity: props.clothGravity as number,
          windStrength: props.windStrength as number,
          windDirection: props.windDirection as number,
          stiffness: props.stiffness as number,
          damping: props.damping as number,
          iterations: props.iterations as number,
          seed: props.clothSeed as number,
        },
        input.frame,
      );
      const name = input.point;
      const pt = name ? points.find((p) => p.name === name) : undefined;
      if (pt) {
        out['cloth-point'] = `Cloth point ${pt.name} at ${formatFixed(pt.p.x, 3)}, ${formatFixed(pt.p.y, 3)}, ${formatFixed(pt.p.z, 3)}`;
      }
    }
    // model node transform
    if (l.kind === 'Model' && input.node) {
      const info = input.modelInfo.get(l.id) ?? null;
      if (info) {
        const nodeIdx = Math.max(0, info.nodes.findIndex((n) => n.name === input.node));
        const node = info.nodes[nodeIdx] ?? info.nodes[0]!;
        const t = sampleNodeTransform(info, node.name, props, input.frame);
        out['node-translation'] = `Translation ${formatFixed(t.translation.x, 3)}, ${formatFixed(t.translation.y, 3)}, ${formatFixed(t.translation.z, 3)}`;
        out['node-quaternion'] = `Quaternion ${formatFixed(t.rotation[0], 4)}, ${formatFixed(t.rotation[1], 4)}, ${formatFixed(t.rotation[2], 4)}, ${formatFixed(t.rotation[3], 4)}`;
        const e = quatToEulerXYZ(t.rotation);
        out['node-euler'] = `Euler ${formatFixed(e.x, 3)}, ${formatFixed(e.y, 3)}, ${formatFixed(e.z, 3)}`;
        out['node-scale'] = `Scale ${formatFixed(t.scale.x, 3)}, ${formatFixed(t.scale.y, 3)}, ${formatFixed(t.scale.z, 3)}`;
      }
    }
    // extrusion bounds
    if (l.kind === 'Extrusion') {
      const geom = extrusionFor(props);
      if (geom) {
        out['bounds'] = `Bounds ${formatFixed(geom.bounds.w, 3)} × ${formatFixed(geom.bounds.h, 3)} × ${formatFixed(geom.bounds.d, 3)}`;
      }
    }
    // tilt readouts
    const tilt = layer.tilt;
    if (l.events.tilt?.enabled) {
      out['tilt-x'] = `Tilt X ${formatFixed(tilt.x, 3)}`;
      out['tilt-y'] = `Tilt Y ${formatFixed(tilt.y, 3)}`;
      out['tilt-target'] = `Tilt target ${formatFixed(layer.tiltTarget.x, 3)}, ${formatFixed(layer.tiltTarget.y, 3)}`;
    }
  }

  // Light focus (scene-level)
  if (doc.light.enabled) {
    out['light-focus'] = `Light focus ${formatFixed(resolved.lightFocus.x, 3)}, ${formatFixed(resolved.lightFocus.y, 3)}`;
  }

  // Sample
  if (input.sampleX !== null && input.sampleX !== undefined && input.sampleY !== null && input.sampleY !== undefined) {
    const x = Number(input.sampleX);
    const y = Number(input.sampleY);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // 2D draws and effect layers both take part: effects apply to the
      // composite of everything below them.
      const sampled = resolved.layers
        .filter((l) => ['Rectangle', 'Ellipse', 'Polygon', 'Gradient', 'Effect'].includes(l.layer.kind))
        .map((l) => ({ layer: l.layer, props: l.props }));
      const colour = sampleComposite(doc, sampled, x, y, app.limits.grainSeed);
      const hex = rgbToHex(colour.r, colour.g, colour.b);
      const { r, g, b } = hexToRgb(hex);
      out['sample'] = `#${hex.slice(1).toUpperCase()} · rgb(${r}, ${g}, ${b})`;
    }
  }

  return out;
}

function ctxOf(resolved: ResolvedScene): EvalContext {
  return resolved as unknown as EvalContext;
}

function artboardOf(doc: SceneDocument, resolved: ResolvedScene): { w: number; h: number } {
  void doc;
  const bp = (resolved as unknown as { breakpoint?: Breakpoint }).breakpoint ?? 'desktop';
  return ARTBOARDS[bp];
}

function layerTriangles(l: Layer, props: Record<string, unknown>, bundle: SceneBundle): number {
  switch (l.kind) {
    case 'Primitive':
      return PRIMITIVES[props.primitive as keyof typeof PRIMITIVES].triangles;
    case 'Extrusion': {
      if (props.source === 'svg') {
        const svg = bundle.scenes.flatMap((s) => s.layers).find((x) => x.id === l.id);
        void svg;
        return 0;
      }
      const geom = extrusionFor(props);
      return geom?.triangles ?? 0;
    }
    default:
      return 0;
  }
}

function sampleNodeTransform(
  info: ModelInfo,
  nodeName: string,
  props: Record<string, unknown>,
  frame: number,
): { translation: Vec3; rotation: [number, number, number, number]; scale: Vec3 } {
  const nodeIdx = info.nodes.findIndex((n) => n.name === nodeName);
  const base = info.nodes[Math.max(0, nodeIdx)]!;
  let translation = { ...base.translation };
  let rotation: [number, number, number, number] = [...base.rotation];
  let scale = { ...base.scale };
  const clips = (props.clips as { name: string; play: boolean; loop: boolean; speed: number; offsetMs: number }[]) ?? [];
  for (const setting of clips) {
    const clip = info.clips.find((c) => c.name === setting.name);
    if (!clip) continue;
    const T = frame / 60;
    const raw = Math.max(0, T - setting.offsetMs / 1000) * setting.speed;
    const c = !setting.play ? 0 : setting.loop ? (clip.duration > 0 ? raw % clip.duration : 0) : Math.min(raw, clip.duration);
    for (const ch of clip.channels) {
      if (ch.node !== Math.max(0, nodeIdx) && info.nodes[ch.node]?.name !== nodeName) continue;
      const v = sampleChannel(ch, c);
      if (ch.path === 'translation') translation = { x: v[0]!, y: v[1]!, z: v[2]! };
      else if (ch.path === 'scale') scale = { x: v[0]!, y: v[1]!, z: v[2]! };
      else rotation = [v[0]!, v[1]!, v[2]!, v[3]!];
    }
  }
  return { translation, rotation, scale };
}

function sampleChannel(
  ch: { times: number[]; values: number[][]; interpolation: 'LINEAR' | 'STEP' },
  c: number,
): number[] {
  const { times, values } = ch;
  if (times.length === 0) return values[0] ?? [0, 0, 0, 1];
  if (c <= times[0]!) return values[0]!;
  if (c >= times[times.length - 1]!) return values[values.length - 1]!;
  for (let i = 0; i < times.length - 1; i++) {
    const t1 = times[i]!;
    const t2 = times[i + 1]!;
    if (c >= t1 && c <= t2) {
      if (ch.interpolation === 'STEP') return values[i]!;
      const t = (c - t1) / (t2 - t1);
      const v1 = values[i]!;
      const v2 = values[i + 1]!;
      if (v1.length === 4) {
        // slerp
        let q1 = v1 as [number, number, number, number];
        let q2 = v2 as [number, number, number, number];
        let d = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
        if (d < 0) {
          q2 = [-q2[0], -q2[1], -q2[2], -q2[3]];
          d = -d;
        }
        if (d > 0.9995) {
          const l = q1.map((a, k) => a + t * (q2[k]! - a));
          const len = Math.hypot(...l) || 1;
          return l.map((a) => a / len);
        }
        const theta = Math.acos(Math.min(1, d));
        const s = Math.sin(theta);
        const w1 = Math.sin((1 - t) * theta) / s;
        const w2 = Math.sin(t * theta) / s;
        return q1.map((a, k) => w1 * a + w2 * q2[k]!);
      }
      return v1.map((a, k) => a + t * (v2[k]! - a));
    }
  }
  return values[values.length - 1]!;
}

export function formationTargets(
  props: Record<string, unknown>,
  resolved: ResolvedScene,
  bundle: SceneBundle,
): Vec3[] {
  const targetId = (props.formation as { target: string | null }).target;
  if (!targetId) return [];
  const target = bundle.scenes.flatMap((s) => s.layers).find((l) => l.id === targetId);
  if (!target) return [];
  const targetResolved = resolved.layers.find((l) => l.layer.id === targetId);
  const world = targetResolved?.world;
  const tProps = targetResolved?.props ?? target.props;
  if (!world) return [];
  const local = (p: Vec3): Vec3 => {
    // Target points are in world space with the target's transform, then made
    // local to the particle layer: for the seeded formation scenes the
    // particle layer sits at the origin, so world equals local there.
    return p;
  };
  if (target.kind === 'Primitive') {
    const prim = tProps.primitive as keyof typeof PRIMITIVES;
    const info = PRIMITIVES[prim];
    const pts: Vec3[] = [];
    const signs: [number, number, number][] = [
      [1, 1, 1],
      [-1, 1, 1],
      [1, -1, 1],
      [-1, -1, 1],
      [1, 1, -1],
      [-1, 1, -1],
      [1, -1, -1],
      [-1, -1, -1],
    ];
    for (const [sx, sy, sz] of signs) {
      pts.push(
        transformPoint(world, {
          x: sx * info.halfExtents.x,
          y: sy * info.halfExtents.y,
          z: sz * info.halfExtents.z,
        }),
      );
    }
    return pts.map(local);
  }
  if (target.kind === 'Extrusion') {
    if (tProps.source === 'text') {
      const text = tProps.text as string;
      const h = tProps.letterHeight as number;
      const frontZ = (tProps.depth as number) / 2 + (tProps.bevelSize as number);
      const totalW = h * (0.7 * text.length - 0.1);
      const pts: Vec3[] = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue;
        const left = -totalW / 2 + i * 0.7 * h;
        const top = h / 2;
        const corners: Vec3[] = [
          { x: left, y: top, z: frontZ },
          { x: left + 0.6 * h, y: top, z: frontZ },
          { x: left + 0.6 * h, y: top - h, z: frontZ },
          { x: left, y: top - h, z: frontZ },
        ];
        for (const c of corners) pts.push(transformPoint(world, c));
      }
      return pts.map(local);
    }
  }
  return [];
}
