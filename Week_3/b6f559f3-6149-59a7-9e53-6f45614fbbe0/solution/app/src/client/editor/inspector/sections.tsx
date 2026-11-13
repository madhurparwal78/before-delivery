import { useId, useState } from 'react';
import { Pause, Play, Plus, X } from 'lucide-react';
import { clipConfigsOf } from '../../../shared/evaluator';
import { MESSAGES } from '../../../shared/messages';
import {
  appliesEvents,
  CLIP_OFFSET,
  CLIP_SPEED,
  EVENT_PROPERTIES,
  findLayerDefinition,
  GRADIENT_PROPERTIES,
  LAYER_FIELDS,
  layerProperties,
  SCENE_PROPERTIES,
  type PropertyDef,
} from '../../../shared/properties';
import { stopsOf } from '../../../shared/evaluator/compositing';
import { vertexList } from '../../../shared/evaluator/solids';
import { str, num, type ResolvedLayer } from '../../../shared/evaluator/resolve';
import type { Json, Layer } from '../../../shared/types';
import { EASING_CHOICES } from './easingLabels';
import { useFieldEnv } from './env';
import { Field, FieldFrame, NumberField, Section, SelectField, SpinInput, SwitchField } from './fields';
import { inspect, useInspection } from './inspection';
import { useEditor } from '../model';

const defs = (layer: Layer): Map<string, PropertyDef> => {
  const map = new Map<string, PropertyDef>();
  for (const def of layerProperties(layer)) map.set(def.path, def);
  return map;
};

function Fields({ layer, paths }: { layer: Layer; paths: string[] }) {
  const all = defs(layer);
  return (
    <>
      {paths.map((path) => {
        const def = all.get(path);
        return def ? <Field key={path} def={def} /> : null;
      })}
    </>
  );
}

const layerField = (path: string): PropertyDef => LAYER_FIELDS.find((def) => def.path === path) as PropertyDef;

/** A plain select for read-only inspection choices (Vertex, Node, Cloth point): never disabled for viewers. */
function InspectSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="field-frame" data-inspect={label}>
      <label htmlFor={id} className="field-name">
        {label}
      </label>
      <div className="field-control">
        <select id={id} className="select-input" value={options.includes(value) ? value : ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">None</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function InspectNumber({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="field-frame" data-inspect={label}>
      <label htmlFor={id} className="field-name">
        {label}
      </label>
      <div className="field-control">
        <SpinInput
          id={id}
          value={value}
          min={min}
          max={max}
          step={step}
          shiftStep={step * 10}
          integer
          readOnly={false}
          disabled={false}
          onCommit={(next) => {
            if (next < min || next > max) return `Must be between ${min} and ${max}.`;
            onChange(next);
            return null;
          }}
        />
      </div>
    </div>
  );
}

export function SampleFields() {
  const sample = useInspection();
  return (
    <Section title="Sample">
      <InspectNumber label="Sample X" value={sample.sampleX} min={0} max={10000} step={1} onChange={(sampleX) => inspect({ sampleX })} />
      <InspectNumber label="Sample Y" value={sample.sampleY} min={0} max={10000} step={1} onChange={(sampleY) => inspect({ sampleY })} />
    </Section>
  );
}

function VertexSelect({ resolved }: { resolved: ResolvedLayer }) {
  const editor = useEditor();
  const { vertex } = useInspection();
  const names = vertexList(resolved, editor.assets).map((v) => v.name);
  if (names.length === 0) return null;
  return <InspectSelect label="Vertex" value={vertex} options={names} onChange={(next) => inspect({ vertex: next })} />;
}

function Transform({ layer, resolved }: { layer: Layer; resolved: ResolvedLayer }) {
  return (
    <Section title="Transform">
      <Fields layer={layer} paths={['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z']} />
      <VertexSelect resolved={resolved} />
    </Section>
  );
}

function Material({ layer }: { layer: Layer }) {
  return (
    <Section title="Material">
      <Fields
        layer={layer}
        paths={['material.kind', 'material.matcap', 'material.color', 'material.opacity', 'material.refraction', 'material.backFaceRefraction', 'depthTest', 'faces']}
      />
    </Section>
  );
}

function AssetNote({ label, assetId }: { label: string; assetId: Json | undefined }) {
  const editor = useEditor();
  const asset = typeof assetId === 'string' ? editor.assets.get(assetId) : undefined;
  return (
    <p className="field-note asset-note">
      {label}: <span className="num">{asset ? asset.fileName : 'none'}</span>
    </p>
  );
}

function GradientStops({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const def = findLayerDefinition(layer, 'gradient.stops') as PropertyDef;
  const stops = stopsOf(env.values['gradient.stops']);
  const [problem, setProblem] = useState<string | null>(null);

  const write = (next: { color: string; position: number }[]): void => {
    env.commit(def, next as unknown as Json);
  };
  const set = (index: number, patch: Partial<{ color: string; position: number }>): void =>
    write(stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)));

  return (
    <div className="stops-block">
      <p className="field-name" id="stops-label">
        Stops
      </p>
      <ul role="list" aria-label="Gradient stops" className="stop-list">
        {stops.map((stop, index) => (
          <li key={index} className="stop-row">
            <StopColour index={index} colour={stop.color} onCommit={(color) => set(index, { color })} />
            <StopPosition index={index} position={stop.position} onCommit={(position) => set(index, { position })} />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove stop ${index + 1}`}
              disabled={env.viewer}
              onClick={() => {
                if (stops.length <= 2) return setProblem(MESSAGES.gradientStops);
                setProblem(null);
                write(stops.filter((_, i) => i !== index));
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn add-stop"
        disabled={env.viewer}
        onClick={() => {
          if (stops.length >= 8) return setProblem(MESSAGES.gradientStops);
          setProblem(null);
          write([...stops, { color: '#FFFFFF', position: 50 }]);
        }}
      >
        <Plus size={16} aria-hidden="true" /> Add stop
      </button>
      {problem && (
        <div role="alert" className="notice field-notice">
          {problem}
        </div>
      )}
    </div>
  );
}

function StopColour({ index, colour, onCommit }: { index: number; colour: string; onCommit: (colour: string) => void }) {
  const env = useFieldEnv();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const commit = (text: string): void => {
    setDraft(null);
    const next = text.trim().toUpperCase();
    if (next === colour) return setProblem(null);
    if (!/^#[0-9A-F]{6}$/.test(next)) return setProblem(MESSAGES.colour);
    setProblem(null);
    onCommit(next);
  };
  return (
    <div className="stop-field">
      <label htmlFor={id} className="sr-only">{`Stop ${index + 1} colour`}</label>
      <span className="swatch" style={{ background: colour }} aria-hidden="true" />
      <input
        id={id}
        type="text"
        className="text-input colour-input"
        value={draft ?? colour}
        disabled={env.viewer}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft !== null) {
            event.preventDefault();
            commit(draft);
          }
        }}
        onBlur={() => draft !== null && commit(draft)}
      />
      {problem && (
        <div role="alert" className="notice field-notice">
          {problem}
        </div>
      )}
    </div>
  );
}

function StopPosition({ index, position, onCommit }: { index: number; position: number; onCommit: (position: number) => void }) {
  const env = useFieldEnv();
  const id = useId();
  return (
    <div className="stop-field">
      <label htmlFor={id} className="sr-only">{`Stop ${index + 1} position`}</label>
      <SpinInput
        id={id}
        value={position}
        min={0}
        max={100}
        step={1}
        shiftStep={10}
        integer
        readOnly={false}
        disabled={env.viewer}
        describedBy={env.describedBy}
        onCommit={(next) => {
          onCommit(next);
          return null;
        }}
      />
    </div>
  );
}

function Flat({ layer }: { layer: Layer }) {
  const kind = layer.kind;
  return (
    <>
      <Section title="Layer">
        <Fields layer={layer} paths={['x', 'y', 'width', 'height', 'opacity']} />
        {kind === 'Polygon' && <Fields layer={layer} paths={['sides']} />}
        {kind !== 'Text' && kind !== 'Image' && kind !== 'Gradient' && <Fields layer={layer} paths={['fill']} />}
        {kind === 'Text' && <Fields layer={layer} paths={['fill', 'text', 'textSize']} />}
        {kind === 'Image' && <ImageNote />}
        <Field def={layerField('blendMode')} />
        <SwitchField def={layerField('maskAbove')} />
      </Section>
      {kind === 'Gradient' && (
        <Section title="Gradient">
          <SelectField def={GRADIENT_PROPERTIES[0] as PropertyDef} />
          <GradientFields layer={layer} />
        </Section>
      )}
    </>
  );
}

function ImageNote() {
  const env = useFieldEnv();
  return <AssetNote label="Image" assetId={env.values['assetId']} />;
}

function GradientFields({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const radial = env.values['gradient.type'] === 'Radial';
  return (
    <>
      {!radial && <Fields layer={layer} paths={['gradient.angle']} />}
      {radial && <Fields layer={layer} paths={['gradient.centerX', 'gradient.centerY', 'gradient.radius']} />}
      <GradientStops layer={layer} />
    </>
  );
}

function EffectFields({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const all = layerProperties(layer).filter((def) => def.path !== 'effect.kind');
  return (
    <Section title="Effect">
      <p className="field-note">
        Effect: <span className="num">{str(env.values, 'effect.kind', 'Blur')}</span>
      </p>
      {all.map((def) => (
        <Field key={def.path} def={def} />
      ))}
    </Section>
  );
}

function Extrusion({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const text = str(env.values, 'source', 'text') === 'text';
  return (
    <Section title="Extrusion">
      {text ? <Fields layer={layer} paths={['text', 'letterHeight']} /> : <AssetNote label="SVG" assetId={env.values['svgAssetId']} />}
      <Fields layer={layer} paths={['depth', 'bevelSize', 'bevelSegments']} />
    </Section>
  );
}

function ClipRow({
  clip,
  duration,
  onChange,
}: {
  clip: { name: string; play: boolean; loop: boolean; speed: number; offsetMs: number };
  duration: number;
  onChange: (patch: Partial<{ play: boolean; loop: boolean; speed: number; offsetMs: number }>) => void;
}) {
  const env = useFieldEnv();
  const loopId = useId();
  const speedId = useId();
  const offsetId = useId();
  return (
    <li className="clip-row">
      <div className="clip-head">
        <span className="num clip-title">{`${clip.name} · ${duration.toFixed(3)} s`}</span>
        <button
          type="button"
          className="btn clip-play"
          aria-label={`${clip.play ? 'Pause' : 'Play'} ${clip.name}`}
          disabled={env.viewer}
          onClick={() => onChange({ play: !clip.play })}
        >
          {clip.play ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
      </div>
      <div className="field-frame">
        <label htmlFor={loopId} className="field-name">{`Loop ${clip.name}`}</label>
        <div className="field-control">
          <input id={loopId} type="checkbox" role="switch" className="switch-input" checked={clip.loop} disabled={env.viewer} onChange={(event) => onChange({ loop: event.target.checked })} />
        </div>
      </div>
      <div className="field-frame">
        <label htmlFor={speedId} className="field-name">{`Speed ${clip.name}`}</label>
        <div className="field-control">
          <SpinInput
            id={speedId}
            value={clip.speed}
            min={CLIP_SPEED.min}
            max={CLIP_SPEED.max}
            step={CLIP_SPEED.step}
            shiftStep={CLIP_SPEED.shiftStep}
            readOnly={false}
            disabled={env.viewer}
            describedBy={env.describedBy}
            onCommit={(speed) => {
              if (speed < CLIP_SPEED.min || speed > CLIP_SPEED.max) return `Must be between ${CLIP_SPEED.min} and ${CLIP_SPEED.max}.`;
              onChange({ speed });
              return null;
            }}
          />
        </div>
      </div>
      <div className="field-frame">
        <label htmlFor={offsetId} className="field-name">{`Clip offset ${clip.name}`}</label>
        <div className="field-control">
          <SpinInput
            id={offsetId}
            value={clip.offsetMs}
            min={CLIP_OFFSET.min}
            max={CLIP_OFFSET.max}
            step={CLIP_OFFSET.step}
            shiftStep={CLIP_OFFSET.shiftStep}
            integer
            readOnly={false}
            disabled={env.viewer}
            describedBy={env.describedBy}
            onCommit={(offsetMs) => {
              if (offsetMs < CLIP_OFFSET.min || offsetMs > CLIP_OFFSET.max) return `Must be between ${CLIP_OFFSET.min} and ${CLIP_OFFSET.max}.`;
              onChange({ offsetMs });
              return null;
            }}
          />
        </div>
      </div>
    </li>
  );
}

function ModelFields({ layer, resolved }: { layer: Layer; resolved: ResolvedLayer }) {
  const env = useFieldEnv();
  const editor = useEditor();
  const inspection = useInspection();
  const info = clipConfigsOf(resolved, editor.assets);
  const clipsDef = findLayerDefinition(layer, 'clips') as PropertyDef;
  const preset = str(env.values, 'preset');
  const nodes = info?.model.nodes.map((n) => n.name) ?? [];
  return (
    <Section title="Model">
      {preset ? <p className="field-note">Preset: <span className="num">{preset}</span></p> : <AssetNote label="Model" assetId={env.values['modelAssetId']} />}
      {nodes.length > 0 && <InspectSelect label="Node" value={inspection.node} options={nodes} onChange={(node) => inspect({ node })} />}
      {info && (
        <ul role="list" aria-label="Clips" className="clip-list">
          {info.configs.map((config, index) => (
            <ClipRow
              key={config.name}
              clip={config}
              duration={info.model.clips[index]?.durationS ?? 0}
              onChange={(patch) =>
                env.commit(clipsDef, info.configs.map((c) => ({ ...(c.name === config.name ? { ...c, ...patch } : c) })) as unknown as Json, `clips:${config.name}:${Object.keys(patch)[0]}`)
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function FormInto({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const editor = useEditor();
  const def = findLayerDefinition(layer, 'formation.target') as PropertyDef;
  const raw = env.values['formation.target'];
  const value = typeof raw === 'string' ? raw : '';
  const options = editor.scene.layers.filter((l) => l.id !== layer.id && l.kind !== 'Group' && l.kind !== 'Effect');
  return (
    <FieldFrame def={def} bindable={false}>
      {(id) => (
        <select
          id={id}
          className="select-input"
          value={options.some((l) => l.id === value) ? value : ''}
          disabled={env.viewer}
          aria-describedby={env.viewer ? env.describedBy : undefined}
          onFocus={() => editor.setFocusedProperty(def.path)}
          onChange={(event) => env.commit(def, event.target.value === '' ? null : event.target.value)}
        >
          <option value="">None</option>
          {options.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

function ParticleFields({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const inspection = useInspection();
  const form = str(env.values, 'mode', 'emit') === 'form';
  const numberId = useId();
  return (
    <Section title="Particles">
      <Fields layer={layer} paths={['mode', 'seed']} />
      {form ? (
        <>
          <FormInto layer={layer} />
          <Fields layer={layer} paths={['formation.count', 'formation.durationMs']} />
        </>
      ) : (
        <Fields
          layer={layer}
          paths={['rate', 'burst', 'lifetime', 'speed', 'gravity', 'trailLength', 'orbit', 'attractor.x', 'attractor.y', 'attractor.z', 'attractor.strength']}
        />
      )}
      <div className="field-frame" data-inspect="Particle number">
        <label htmlFor={numberId} className="field-name">
          Particle number
        </label>
        <div className="field-control">
          <SpinInput
            id={numberId}
            value={inspection.particleNumber}
            min={1}
            max={1_000_000}
            step={1}
            shiftStep={10}
            integer
            readOnly={false}
            disabled={false}
            onCommit={(next) => {
              if (next < 1) return 'Must be between 1 and 1000000.';
              inspect({ particleNumber: next });
              return null;
            }}
          />
        </div>
      </div>
    </Section>
  );
}

function ClothFields({ layer }: { layer: Layer }) {
  const env = useFieldEnv();
  const { clothPoint } = useInspection();
  const columns = Math.floor(num(env.values, 'columns', 10));
  const rows = Math.floor(num(env.values, 'rows', 10));
  const points: string[] = [];
  for (let r = 1; r <= rows; r++) for (let c = 1; c <= columns; c++) points.push(`R${r} C${c}`);
  return (
    <Section title="Cloth">
      <Fields layer={layer} paths={['columns', 'rows', 'pinned', 'gravity', 'windStrength', 'windDirection', 'stiffness', 'damping', 'iterations', 'seed']} />
      <InspectSelect label="Cloth point" value={clothPoint} options={points} onChange={(next) => inspect({ clothPoint: next })} />
    </Section>
  );
}

const EVENT_GROUPS: { title: string; paths: string[] }[] = [
  { title: 'Cursor tilt', paths: ['events.tilt.enabled', 'events.tilt.maxTilt', 'events.tilt.sensitivity', 'events.tilt.momentum'] },
  { title: 'Appear', paths: ['events.appear.enabled', 'events.appear.durationMs', 'events.appear.delayMs', 'events.appear.easing'] },
  { title: 'Hover', paths: ['events.hover.enabled', 'events.hover.durationMs', 'events.hover.delayMs', 'events.hover.easing', 'events.hover.forwardsOnly'] },
  { title: 'Scroll', paths: ['events.scroll.enabled', 'events.scroll.delayPct', 'events.scroll.durationPct', 'events.scroll.easing'] },
  { title: 'Loop', paths: ['events.loop.enabled', 'events.loop.loopDelayMs'] },
];

/** An event's own easing shows once the event is on. */
function EventFields({ resolved }: { resolved: ResolvedLayer }) {
  const all = new Map(EVENT_PROPERTIES.map((def) => [def.path, def]));
  return (
    <>
      {EVENT_GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.paths.map((path) => {
            const def = all.get(path) as PropertyDef;
            if (path.endsWith('.easing') && resolved.values[group.paths[0] as string] !== true) return null;
            if (def.control === 'select') return <SelectField key={path} def={def} choices={EASING_CHOICES} />;
            return <Field key={path} def={def} />;
          })}
        </Section>
      ))}
    </>
  );
}

export function LayerSections({ layer, resolved }: { layer: Layer; resolved: ResolvedLayer }) {
  const kind = layer.kind;
  const flat = ['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient'].includes(kind);
  const solid = ['Primitive', 'Extrusion', 'Model', 'Particles', 'Cloth'].includes(kind);
  return (
    <>
      {flat && <Flat layer={layer} />}
      {kind === 'Effect' && <EffectFields layer={layer} />}
      {solid && <Transform layer={layer} resolved={resolved} />}
      {solid && <Material layer={layer} />}
      {kind === 'Extrusion' && <Extrusion layer={layer} />}
      {kind === 'Model' && <ModelFields layer={layer} resolved={resolved} />}
      {kind === 'Particles' && <ParticleFields layer={layer} />}
      {kind === 'Cloth' && <ClothFields layer={layer} />}
      {(flat || kind === 'Effect') && <SampleFields />}
      {appliesEvents(kind) && <EventFields resolved={resolved} />}
    </>
  );
}

export function CameraSections() {
  const all = new Map(SCENE_PROPERTIES.map((def) => [def.path, def]));
  const get = (path: string): PropertyDef => all.get(path) as PropertyDef;
  return (
    <>
      <Section title="Camera">
        {['camera.fov', 'camera.position.x', 'camera.position.y', 'camera.position.z', 'camera.target.x', 'camera.target.y', 'camera.target.z', 'camera.near', 'camera.far'].map((path) => (
          <NumberField key={path} def={get(path)} />
        ))}
      </Section>
      <Section title="Scroll orbit">
        <SwitchField def={get('orbit.enabled')} />
        <NumberField def={get('orbit.startAngle')} />
        <NumberField def={get('orbit.endAngle')} />
      </Section>
      <Section title="Scene">
        <SelectField def={get('environment')} />
        <SwitchField def={get('light.enabled')} />
      </Section>
    </>
  );
}
