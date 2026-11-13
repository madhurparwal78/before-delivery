import { createContext, useContext } from 'react';
import { roundTo } from '../../../shared/format';
import { clone, isObject } from '../../../shared/paths';
import { contextOf } from '../../../shared/evaluator';
import { resolveLayer, resolveScene, type BoundInfo, type EvalContext, type ResolvedLayer } from '../../../shared/evaluator/resolve';
import type { PropertyDef } from '../../../shared/properties';
import { SOLID_KINDS, type BreakpointLevel, type Json, type Layer, type Scene, type Variable } from '../../../shared/types';
import type { Editor } from '../model';

export type Target = { kind: 'layer'; layer: Layer } | { kind: 'scene'; scene: Scene };

/** Everything a field needs to show a value and to write one. */
export interface FieldEnv {
  editor: Editor;
  target: Target;
  values: Record<string, Json>;
  sources: Record<string, BreakpointLevel>;
  bound: Record<string, BoundInfo>;
  errors: Record<string, string>;
  setError: (path: string, message: string | null) => void;
  /** Writes a value for a definition: a keyframe when the property is animated, an override or the base value otherwise. */
  commit: (def: PropertyDef, value: Json, mergeSuffix?: string) => void;
  isOverridden: (path: string) => boolean;
  reset: (path: string) => void;
  /** The binding that covers a path, with the `bindings` key it is stored under. */
  bindingOf: (path: string) => { variable: string; property: string } | null;
  bind: (property: string, variable: string) => void;
  unbind: (property: string) => void;
  compatible: (def: PropertyDef) => { variable: Variable; property: string }[];
  /** Fields are read-only for viewers. */
  viewer: boolean;
  describedBy: string;
}

export const FieldContext = createContext<FieldEnv | null>(null);

export function useFieldEnv(): FieldEnv {
  const value = useContext(FieldContext);
  if (!value) throw new Error('Field outside an Inspector');
  return value;
}

export const evalContextOf = (editor: Editor): EvalContext =>
  contextOf({ frame: editor.frame, breakpoint: editor.breakpoint, scroll: editor.scroll, reducedMotion: editor.reduceMotion }, editor.document.variables);

/**
 * The values the fields show: the breakpoint level plus the keyframe and binding values at the playhead, but not the appear and
 * scroll animations, so that typing a value or stepping a field never writes an animated number.
 */
export function fieldLayer(layer: Layer, context: EvalContext): ResolvedLayer {
  const full = resolveLayer(layer, context);
  const calm = clone(layer);
  for (const name of ['appear', 'scroll']) {
    const event = calm.events[name];
    if (isObject(event)) event['enabled'] = false;
  }
  const base = resolveLayer(calm, context);
  const values = { ...base.values };
  for (const [path, value] of Object.entries(full.values)) if (path.startsWith('events.')) values[path] = value;
  return { ...base, values, sources: full.sources };
}

export const sceneFields = (scene: Scene, context: EvalContext) => resolveScene(scene, context);

const GROUPS = ['position', 'rotation', 'scale'] as const;

/** The `bindings` key a variable of a vector type uses for a path, or null when the path has no vector group. */
export function groupOf(layer: Pick<Layer, 'kind'>, path: string): string | null {
  const [head] = path.split('.');
  if (SOLID_KINDS.includes(layer.kind) && head && (GROUPS as readonly string[]).includes(head) && path.includes('.')) return head;
  if (!SOLID_KINDS.includes(layer.kind) && (path === 'x' || path === 'y')) return 'position';
  return null;
}

export const format = (value: number): string => String(roundTo(value, 3));

;
