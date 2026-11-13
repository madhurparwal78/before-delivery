import { publicSettings } from '../../api';
import {
  clipReadouts,
  drawOrder,
  formatValue,
  propertyReadout,
  readoutsOf,
  resolveScenery,
  type Query,
} from '../../../shared/evaluator';
import { vector } from '../../../shared/format';
import { layerProperties, SCENE_PROPERTIES } from '../../../shared/properties';
import { BREAKPOINT_LEVELS, type Json } from '../../../shared/types';
import { useFollowReadout } from '../../stage/follow';
import { CAMERA_ID, useEditor } from '../model';
import { evalContextOf } from './env';
import { useInspection } from './inspection';

interface Entry {
  key: string;
  text: string;
  path?: string;
  clip?: string;
  warn?: boolean;
}

/** Display order of the readouts that come from the shared evaluator. */
const ORDER = [
  'time',
  'camera-azimuth',
  'screen-point',
  'vertex-point',
  'vertex-world',
  'triangles',
  'triangles-drawn',
  'bounds',
  'ior',
  'live-particles',
  'particle',
  'trail-points',
  'cloth-point',
  'node-translation',
  'node-quaternion',
  'node-euler',
  'node-scale',
  'blur',
  'aberration',
  'sample',
];

const FLAT = ['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient', 'Effect'];

export function Readouts() {
  const editor = useEditor();
  const inspection = useInspection();
  const settings = publicSettings();
  const context = evalContextOf(editor);
  const scenery = resolveScenery(editor.scene, context);
  const resolved = editor.primary === CAMERA_ID ? undefined : scenery.layers.find((l) => l.layer.id === editor.primary);
  const kind = resolved?.layer.kind;
  const samples = editor.primary !== CAMERA_ID && (kind === undefined || FLAT.includes(kind));
  const follow = useFollowReadout(resolved?.layer.id ?? null);

  const query: Query = {
    layerId: resolved?.layer.id,
    frame: editor.frame,
    breakpoint: editor.breakpoint,
    scroll: editor.scroll,
    reducedMotion: editor.reduceMotion,
    vertex: inspection.vertex || undefined,
    particle: kind === 'Particles' ? inspection.particleNumber : undefined,
    point: inspection.clothPoint || undefined,
    node: inspection.node || undefined,
    sampleX: samples ? inspection.sampleX : undefined,
    sampleY: samples ? inspection.sampleY : undefined,
  };
  const computed = readoutsOf(scenery, editor.scene, query, editor.assets, settings);
  const cap = computed['live-particles'] === `Live particles ${settings.particleMax}`;

  const entries: Entry[] = ORDER.filter((key) => computed[key] !== undefined).map((key) => ({
    key,
    text: computed[key] as string,
    warn: computed[key]?.endsWith('Not visible') || (key === 'live-particles' && cap),
  }));
  if (resolved) {
    for (const clip of clipReadouts(resolved, scenery, editor.assets)) entries.push({ key: 'clip-time', text: clip.text, clip: clip.clip });
    if (resolved.values['events.tilt.enabled'] === true) {
      entries.push({ key: 'tilt-x', text: `Tilt X ${vector(3, follow.tiltX)}` });
      entries.push({ key: 'tilt-y', text: `Tilt Y ${vector(3, follow.tiltY)}` });
      entries.push({ key: 'tilt-target', text: `Tilt target ${vector(3, follow.targetX, follow.targetY)}` });
    }
  }
  if (editor.scene.light.enabled) entries.push({ key: 'light-focus', text: `Light focus ${vector(3, follow.focusX, follow.focusY)}` });

  if (resolved) {
    for (const def of layerProperties(resolved.layer)) {
      if (def.control === 'custom') continue;
      entries.push({ key: 'property', path: def.path, text: propertyReadout(resolved, def, editor.breakpoint) });
    }
  } else if (editor.primary === CAMERA_ID) {
    for (const def of SCENE_PROPERTIES) {
      if (def.path === 'durationMs' || def.path.startsWith('light.') || def.path === 'background') continue;
      const level = scenery.scene.sources[def.path] ?? 'Desktop';
      const suffix = level === BREAKPOINT_LEVELS[editor.breakpoint] ? '' : ` (from ${level})`;
      entries.push({ key: 'property', path: def.path, text: `${def.label} ${formatValue(def, scenery.scene.values[def.path] as Json)}${suffix}` });
    }
  }

  const draws = drawOrder(scenery.layers);
  return (
    <section aria-label="Readouts" className="panel readouts">
      <h2 className="panel-title">Readouts</h2>
      <div className="readout-list">
        {entries.map((entry, index) => (
          <p
            key={`${entry.key}:${entry.path ?? entry.clip ?? index}`}
            className={entry.warn ? 'readout num warn' : 'readout num'}
            data-readout={entry.key}
            data-path={entry.path}
            data-clip={entry.clip}
          >
            {entry.text}
          </p>
        ))}
      </div>
      <p className="section-title">Draw order</p>
      {draws.length === 0 && <p className="muted draw-empty">No 3D layers are drawn.</p>}
      <ul role="list" aria-label="Draw order" className="draw-list">
        {draws.map((draw, index) => (
          <li key={`${index}:${draw}`} className="num">
            {draw}
          </li>
        ))}
      </ul>
    </section>
  );
}
