import { useMemo, useState, type FocusEvent } from 'react';
import { bindingPaths } from '../../../shared/bindings';
import { sceneFields } from './env';
import { VIEWER_NOTICE } from './viewer';
import type { Layer, Variable } from '../../../shared/types';
import type { PropertyDef } from '../../../shared/properties';
import { CAMERA_ID, useEditor, type Editor } from '../model';
import { evalContextOf, fieldLayer, FieldContext, groupOf, type FieldEnv } from './env';
import { CameraSections, LayerSections, SampleFields } from './sections';
import '../../styles/inspector.css';

const KIND_TITLES: Record<string, string> = { Primitive: '3D primitive', Extrusion: 'Extruded type', Model: 'Model', Particles: 'Particles', Cloth: 'Cloth', Effect: 'Effect' };

function subjectOf(layer: Layer): string {
  if (layer.kind === 'Primitive' && typeof layer.props['primitive'] === 'string') return layer.props['primitive'];
  return KIND_TITLES[layer.kind] ?? layer.kind;
}

/** The environment of a layer field: values at the playhead and breakpoint, and the writes that go with them. */
function useLayerEnv(editor: Editor, layer: Layer, errors: Record<string, string>, setError: FieldEnv['setError']): FieldEnv {
  const context = evalContextOf(editor);
  const resolved = fieldLayer(layer, context);
  const level = editor.breakpoint === 'desktop' ? null : editor.breakpoint;
  const variables = editor.document.variables;

  const bindingOf: FieldEnv['bindingOf'] = (path) => {
    const own = layer.bindings[path];
    if (own && variables.some((v) => v.name === own)) return { variable: own, property: path };
    const group = groupOf(layer, path);
    const via = group ? layer.bindings[group] : undefined;
    return group && via && variables.some((v) => v.name === via) ? { variable: via, property: group } : null;
  };

  return {
    editor,
    target: { kind: 'layer', layer },
    values: { ...resolved.values, blendMode: layer.blendMode, maskAbove: layer.maskAbove, locked: layer.locked },
    sources: resolved.sources,
    bound: resolved.bound,
    errors,
    setError,
    commit: (def, value, mergeSuffix) => {
      setError(def.path, null);
      const keyframe = layer.keyframes.filter((k) => k.property === def.path);
      if (keyframe.length > 0 && def.keyframeable && typeof value === 'number') {
        const here = keyframe.find((k) => k.frame === editor.frame);
        editor.setKeyframe(layer.id, def.path, editor.frame, value, here?.easing ?? 'linear');
        return;
      }
      const key = `${layer.id}:${editor.breakpoint}:${mergeSuffix ?? def.path}`;
      if (def.overridable) editor.editLayer(layer.id, { [def.path]: value }, key);
      else editor.apply([{ type: 'updateLayer', layerId: layer.id, set: { [def.path]: value }, breakpoint: 'desktop' }], key, 'inspector');
    },
    isOverridden: (path) => level !== null && layer.overrides[level][path] !== undefined,
    reset: (path) => editor.resetOverride(layer.id, path),
    bindingOf,
    bind: (property, variable) => editor.apply([{ type: 'bind', layerId: layer.id, property, variable }], undefined, 'inspector'),
    unbind: (property) => editor.apply([{ type: 'unbind', layerId: layer.id, property }], undefined, 'inspector'),
    compatible: (def: PropertyDef) => {
      const out: { variable: Variable; property: string }[] = [];
      for (const variable of variables) {
        const group = groupOf(layer, def.path);
        const property = variable.type === 'Vector 2' || variable.type === 'Vector 3' ? group : def.path;
        if (property && typeof bindingPaths(layer, property, variable.type) !== 'string') out.push({ variable, property });
      }
      return out;
    },
    viewer: !editor.canEdit,
    describedBy: 'viewer-refusal',
  };
}

function useSceneEnv(editor: Editor, errors: Record<string, string>, setError: FieldEnv['setError']): FieldEnv {
  const resolved = sceneFields(editor.scene, evalContextOf(editor));
  return {
    editor,
    target: { kind: 'scene', scene: editor.scene },
    values: resolved.values,
    sources: resolved.sources,
    bound: {},
    errors,
    setError,
    commit: (def, value) => {
      setError(def.path, null);
      const key = `scene:${editor.breakpoint}:${def.path}`;
      if (def.overridable) editor.editScene({ [def.path]: value }, key);
      else editor.apply([{ type: 'updateScene', set: { [def.path]: value }, breakpoint: 'desktop' }], key, 'inspector');
    },
    isOverridden: () => false,
    reset: () => undefined,
    bindingOf: () => null,
    bind: () => undefined,
    unbind: () => undefined,
    compatible: () => [],
    viewer: !editor.canEdit,
    describedBy: 'viewer-refusal',
  };
}

function Body({ editor, errors, setError }: { editor: Editor; errors: Record<string, string>; setError: FieldEnv['setError'] }) {
  const layer = editor.primary && editor.primary !== CAMERA_ID ? editor.scene.layers.find((l) => l.id === editor.primary) : undefined;
  if (editor.primary === CAMERA_ID) return <SceneBody editor={editor} errors={errors} setError={setError} />;
  if (!layer) return <EmptyState />;
  return <LayerBody editor={editor} layer={layer} errors={errors} setError={setError} />;
}

function SceneBody({ editor, errors, setError }: { editor: Editor; errors: Record<string, string>; setError: FieldEnv['setError'] }) {
  const env = useSceneEnv(editor, errors, setError);
  return (
    <FieldContext.Provider value={env}>
      <p className="inspector-subject">
        <strong>Camera</strong> <span className="muted">Scene camera</span>
      </p>
      <CameraSections />
    </FieldContext.Provider>
  );
}

function LayerBody({ editor, layer, errors, setError }: { editor: Editor; layer: Layer; errors: Record<string, string>; setError: FieldEnv['setError'] }) {
  const env = useLayerEnv(editor, layer, errors, setError);
  const resolved = useMemo(() => fieldLayer(layer, evalContextOf(editor)), [editor, layer]);
  return (
    <FieldContext.Provider value={env}>
      <p className="inspector-subject">
        <strong>{layer.name}</strong> <span className="muted">{subjectOf(layer)}</span>
      </p>
      {layer.kind === 'Group' ? <p className="muted group-note">Groups have no values of their own. Select a layer inside it.</p> : <LayerSections layer={layer} resolved={resolved} />}
    </FieldContext.Provider>
  );
}

function EmptyState() {
  return (
    <div className="empty-inspector">
      <svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true">
        <rect x="1" y="1" width="118" height="78" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.4" />
        <circle cx="86" cy="52" r="18" fill="currentColor" fillOpacity="0.12" />
        <circle cx="86" cy="52" r="7" fill="currentColor" fillOpacity="0.25" />
      </svg>
      <p className="muted">Select a layer or the camera to inspect it.</p>
      <SampleFields />
    </div>
  );
}

export function Inspector() {
  const editor = useEditor();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError: FieldEnv['setError'] = (path, message) =>
    setErrors((current) => {
      if (message === null) {
        if (!(path in current)) return current;
        const { [path]: _gone, ...rest } = current;
        void _gone;
        return rest;
      }
      return { ...current, [path]: message };
    });
  const notice = editor.notices.inspector;

  const leave = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) editor.releaseLock();
  };

  return (
    <section aria-label="Inspector" className="panel inspector" onBlur={leave}>
      <h2 className="panel-title">Inspector</h2>
      <p id="viewer-refusal" className="sr-only">
        {VIEWER_NOTICE}
      </p>
      {!editor.canEdit && (
        <p className="viewer-note muted" title={VIEWER_NOTICE}>
          {VIEWER_NOTICE}
        </p>
      )}
      {notice && (
        <div role="alert" className="notice inspector-notice">
          {notice}
        </div>
      )}
      <div className="inspector-body" title={editor.canEdit ? undefined : VIEWER_NOTICE}>
        <Body editor={editor} errors={errors} setError={setError} />
      </div>
    </section>
  );
}

