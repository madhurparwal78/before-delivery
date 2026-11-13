// XATTACH, XBIND and the commands that only move focus or the view: LAYER, FIND, ZOOMALL.
import * as copy from '../../copy.ts';
import { xrefCircularChain, type XrefDirectory } from '../../model/index.ts';
import { numberStage, pointStage, textStage } from '../builders.ts';
import type { CommandEnv } from '../env.ts';
import { named } from '../ops.ts';
import { readNumber, readPositive } from '../points.ts';
import type { Point } from '../../types.ts';
import { finish, next, PROMPTS, stay, type Definition, type Stage } from '../stages.ts';

/** The folder's drawings as the circular reference rule walks them. */
function directoryOf(env: CommandEnv): XrefDirectory {
  const find = (id: string) => env.drawings.find((drawing) => drawing.id === id);
  return {
    name: (id) => (id === env.host.id ? env.host.name : find(id)?.name ?? id),
    sources: (id) => find(id)?.xref_sources ?? [],
  };
}

interface Attachment { name: string; source: string; x: number; y: number; scale: number }

const attachRotation = ({ name, source, x, y, scale }: Attachment): Stage =>
  numberStage(PROMPTS.XATTACH.rotation, readNumber, (rotation) =>
    finish([{ type: 'xref_attach', name, source, x, y, scale, rotation }]), 0);

const attachScale = (name: string, source: string, [x, y]: Point): Stage =>
  numberStage(PROMPTS.XATTACH.scale, readPositive, (scale) => next(attachRotation({ name, source, x, y, scale })), 1);

const attachPoint = (name: string, source: string): Stage =>
  pointStage(PROMPTS.XATTACH.point, (at) => next(attachScale(name, source, at)));

const attachName = (source: string): Stage =>
  textStage(PROMPTS.XATTACH.name, (name) => (name === '' ? stay() : next(attachPoint(name, source))));

export const XATTACH: Definition = {
  name: 'XATTACH',
  alias: 'XA',
  edits: true,
  begin: () => next(textStage(PROMPTS.XATTACH.drawing, (drawingName, env) => {
    if (drawingName === '') return stay();
    const source = env.drawings.find((drawing) => drawing.name === drawingName);
    if (!source) return stay(copy.noDrawingInFolder(drawingName));
    const loop = xrefCircularChain(env.host.id, source.id, directoryOf(env));
    return loop ? stay(copy.circularReference(loop)) : next(attachName(source.id));
  })),
};

export const XBIND: Definition = {
  name: 'XBIND',
  alias: 'XB',
  edits: true,
  begin: () => next(textStage(PROMPTS.XBIND.name, (name, env) => {
    if (name === '') return stay();
    return named(env.state.xrefs, name) ? finish([{ type: 'xref_bind', name }]) : stay(copy.noXref(name));
  })),
};

export const LAYER: Definition = { name: 'LAYER', alias: 'LA', edits: true, begin: () => finish([], { focus: 'layer-list' }) };
export const FIND: Definition = { name: 'FIND', alias: 'FD', edits: false, begin: () => finish([], { focus: 'find' }) };
export const ZOOMALL: Definition = { name: 'ZOOMALL', alias: 'ZA', edits: false, begin: () => finish([], { view: 'zoomall' }) };
