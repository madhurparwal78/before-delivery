import { createLayer, createScene, writeLayerPath } from '../shared/scene-doc';
import type { JsonValue, Layer, LayerKind, Scene, SceneDocument } from '../shared/types';

function add(
  scene: Scene,
  kind: LayerKind,
  name: string,
  props: Record<string, JsonValue>,
): Layer {
  const layer = createLayer({
    id: `${scene.id}-${name}`,
    kind,
    name,
    parentId: null,
    order: scene.layers.length,
  });
  for (const [path, value] of Object.entries(props)) writeLayerPath(layer, path, value);
  scene.layers.push(layer);
  return layer;
}

/** The built-in demo scene for the landing stage, generated in code. */
export function demoDocument(narrow = false): SceneDocument {
  const scene = createScene('demo-scene', 'Main');
  scene.background = '#07070B';
  scene.environment = 'Dusk room';
  scene.camera.fov = 46;
  add(scene, 'Primitive', 'Halo torus', {
    primitive: 'Torus',
    'position.x': narrow ? -1.1 : -4.6,
    'position.y': narrow ? 2.7 : 0.4,
    'position.z': -1,
    'rotation.x': 24,
    'rotation.y': 18,
    'scale.x': narrow ? 1.3 : 1.8,
    'scale.y': narrow ? 1.3 : 1.8,
    'scale.z': narrow ? 1.3 : 1.8,
    'material.matcap': 'Chrome',
  });
  add(scene, 'Primitive', 'Light sphere', {
    primitive: 'Sphere',
    'position.x': narrow ? 1.5 : 4.6,
    'position.y': narrow ? 3.6 : 1.9,
    'position.z': -1.5,
    'scale.x': narrow ? 0.9 : 1.3,
    'scale.y': narrow ? 0.9 : 1.3,
    'scale.z': narrow ? 0.9 : 1.3,
    'material.matcap': 'Jade',
  });
  add(scene, 'Extrusion', 'Mark', {
    source: 'text',
    text: 'HALO',
    letterHeight: narrow ? 0.42 : 0.46,
    depth: 0.18,
    'position.x': narrow ? 0 : -4.3,
    'position.y': narrow ? -3.4 : -2.6,
    'material.matcap': 'Ember',
  });
  const torus = scene.layers[0];
  torus.events.tilt = { enabled: true, maxTilt: 10, sensitivity: 1, momentum: 1 };
  const sphere = scene.layers[1];
  sphere.events.tilt = { enabled: true, maxTilt: 14, sensitivity: 1, momentum: 1 };
  return { schemaVersion: 3, name: 'Follow Light demo', variables: [], presets: [], scenes: [scene] };
}

/** A single-primitive scene for the layer kind tiles. */
export function tileDocument(kind: string): SceneDocument {
  const scene = createScene(`tile-${kind}`, 'Main');
  scene.background = '#07070B';
  scene.environment = 'Flat';
  scene.light.enabled = true;
  if (kind === 'Primitives') {
    add(scene, 'Primitive', 'Torus', {
      primitive: 'Torus',
      'scale.x': 2.4,
      'scale.y': 2.4,
      'scale.z': 2.4,
      'rotation.x': 30,
      'material.matcap': 'Chrome',
    });
  } else if (kind === 'Extruded type') {
    add(scene, 'Extrusion', 'Type', {
      source: 'text',
      text: 'HALO',
      letterHeight: 0.8,
      depth: 0.3,
      'rotation.y': -18,
      'material.matcap': 'Ember',
    });
  } else if (kind === 'Models') {
    add(scene, 'Model', 'Arch', {
      preset: 'Arch',
      'scale.x': 2.6,
      'scale.y': 2.6,
      'scale.z': 2.6,
      'material.matcap': 'Clay',
    });
  } else if (kind === 'Particles') {
    add(scene, 'Particles', 'Sparks', {
      seed: 7,
      rate: 120,
      burst: 40,
      lifetime: 2,
      speed: 2.4,
      gravity: 3.2,
      'material.matcap': 'Jade',
    });
  } else if (kind === 'Cloth') {
    add(scene, 'Cloth', 'Banner', {
      columns: 10,
      rows: 10,
      seed: 3,
      windStrength: 3,
      'scale.x': 4,
      'scale.y': 4,
      'scale.z': 4,
      'position.y': 1.6,
      'material.matcap': 'Clay',
    });
  } else {
    add(scene, 'Rectangle', 'Plate', {
      x: 120,
      y: 120,
      width: 1200,
      height: 570,
      fill: '#7C5CFF',
      opacity: 70,
    });
    add(scene, 'Ellipse', 'Bloom', {
      x: 520,
      y: 180,
      width: 520,
      height: 440,
      fill: '#B7A4FF',
      opacity: 60,
    });
    scene.layers[1].blendMode = 'Screen';
  }
  return { schemaVersion: 3, name: `${kind} tile`, variables: [], presets: [], scenes: [scene] };
}

/** The extruded numeral shown on the version export card. */
export function numeralDocument(numeral: string): SceneDocument {
  const scene = createScene(`numeral-${numeral}`, 'Main');
  scene.background = '#07070B';
  add(scene, 'Extrusion', 'Numeral', {
    source: 'text',
    text: numeral,
    letterHeight: 2.4,
    depth: 0.6,
    'rotation.y': -24,
    'rotation.x': 12,
    'material.matcap': 'Chrome',
  });
  return { schemaVersion: 3, name: 'Version numeral', variables: [], presets: [], scenes: [scene] };
}
