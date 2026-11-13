// BLOCK, INSERT, EXPLODE, PURGE.
import * as copy from '../../copy.ts';
import type { BlockAttribute, Point } from '../../types.ts';
import { purgeCandidates } from '../../model/index.ts';
import { numberStage, pointStage, textStage } from '../builders.ts';
import { addOps, named } from '../ops.ts';
import { isType, needsSome, pickEntities, pickMany } from '../picking.ts';
import { readNumber, readPositive } from '../points.ts';
import { finish, next, PROMPTS, stay, type Definition, type Stage } from '../stages.ts';

/** `TAG=default`; a tag typed without `=` has an empty default. */
function parseAttribute(text: string): BlockAttribute {
  const at = text.indexOf('=');
  return at < 0 ? { tag: text, default: '' } : { tag: text.slice(0, at).trim(), default: text.slice(at + 1) };
}

/** Attributes are asked for until an empty Enter, which defines the block from the picked entities. */
function attributeStage(name: string, base: Point, handles: readonly string[], attributes: readonly BlockAttribute[]): Stage {
  return textStage(PROMPTS.BLOCK.attribute, (text) => {
    if (text === '') return finish([{ type: 'block_define', name, base, handles: [...handles], attributes: [...attributes] }]);
    const attribute = parseAttribute(text);
    return attribute.tag === '' ? stay() : next(attributeStage(name, base, handles, [...attributes, attribute]));
  });
}

const blockEntities = (name: string, base: Point): Stage =>
  pickEntities(PROMPTS.BLOCK.pick, (handles) => attributeStage(name, base, handles, []));

export const BLOCK: Definition = {
  name: 'BLOCK',
  alias: 'B',
  edits: true,
  begin: () => next(textStage(PROMPTS.BLOCK.name, (name) =>
    name === '' ? stay() : next(pointStage(PROMPTS.BLOCK.base, (base) => next(blockEntities(name, base)))))),
};

function insertRotation(block: string, [x, y]: Point, scale: number): Stage {
  return numberStage(PROMPTS.INSERT.rotation, readNumber, (rotation, env) =>
    finish(addOps([{ type: 'insert', layer: env.layer, block, x, y, scale, rotation, attributes: {} }])), 0);
}

const insertScale = (block: string, at: Point): Stage =>
  numberStage(PROMPTS.INSERT.scale, readPositive, (scale) => next(insertRotation(block, at, scale)), 1);

/** The new insert's attributes are left empty: the engine fills them with the definition's defaults. */
export const INSERT: Definition = {
  name: 'INSERT',
  alias: 'I',
  edits: true,
  begin: () => next(textStage(PROMPTS.INSERT.name, (name, env) => {
    if (name === '') return stay();
    if (!named(env.state.blocks, name)) return stay(copy.noBlock(name));
    return next(pointStage(PROMPTS.INSERT.point, (at) => next(insertScale(name, at))));
  })),
};

export const EXPLODE: Definition = {
  name: 'EXPLODE',
  alias: 'X',
  edits: true,
  begin: () => next(pickMany(PROMPTS.EXPLODE.pick, isType('insert'), needsSome((handles) =>
    finish(handles.map((handle) => ({ type: 'explode', handle })))))),
};

export const PURGE: Definition = {
  name: 'PURGE',
  alias: 'PU',
  edits: true,
  begin(env) {
    const { blocks, layers } = purgeCandidates(env.state);
    return finish([{ type: 'purge' }], { message: copy.purged(blocks.length, layers.length) });
  },
};
