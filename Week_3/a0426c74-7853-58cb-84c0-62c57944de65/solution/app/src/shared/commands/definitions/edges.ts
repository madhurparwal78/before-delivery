// TRIM and EXTEND: pick the edges (or use every entity), then keep picking parts until Enter ends the run as one group.
import * as copy from '../../copy.ts';
import { extend, isRefusal, trim, type ModifyResult, type Refusal } from '../../geometry/index.ts';
import { applyGroup } from '../../model/index.ts';
import type { Entity, Point } from '../../types.ts';
import type { CommandEnv } from '../env.ts';
import { groupOf, opsOfResult, type Edits } from '../ops.ts';
import { pickMany, readPick } from '../picking.ts';
import { finish, isEnter, next, PROMPTS, stay, type Definition, type OpSpec, type Stage } from '../stages.ts';

type Apply = (target: Entity, pick: Point, edges: readonly Entity[]) => ModifyResult | Refusal;
const NOTHING_DONE: Edits = { modified: [], added: [], removed: [] };

/** A pick's edits added to the run so far: an entity picked twice keeps one `set` holding both. */
function merged(done: Edits, result: Edits): Edits {
  const modified = [...done.modified];
  for (const edit of result.modified) {
    const at = modified.findIndex((earlier) => earlier.handle === edit.handle);
    if (at < 0) modified.push(edit);
    else modified[at] = { handle: edit.handle, set: { ...modified[at].set, ...edit.set } };
  }
  return { modified, added: [...done.added, ...result.added], removed: [...done.removed, ...result.removed] };
}

/**
 * The model entities as the run has left them: the engine applies the picks so far, without the constraints, because a constraint
 * is judged on the whole group when it is submitted and not between two picks.
 */
function workingEntities(command: string, env: CommandEnv, done: Edits): Readonly<Record<string, Entity>> {
  if (done.modified.length === 0) return env.state.entities;
  const edits = done.modified.map((edit): OpSpec => ({ type: 'modify', handle: edit.handle, set: edit.set }));
  return applyGroup({ ...env.state, constraints: [] }, groupOf(command, edits, env), { username: env.username }).state.entities;
}

/** The entities that cut or bound: the ones picked, or every visible entity when none was. The target never cuts itself. */
function edgeEntities(env: CommandEnv, entities: Readonly<Record<string, Entity>>, done: Edits, picked: readonly string[] | null, target: string): Entity[] {
  const ids = picked ?? env.scene.entities.filter((entity) => entity.visible).map((entity) => entity.id);
  return ids.flatMap((id) => {
    const scened = env.scene.byId.get(id);
    if (!scened || id === target || done.removed.includes(id)) return [];
    return [scened.xref === null ? entities[id] : scened.entity];
  });
}

function partStage(command: string, prompt: string, apply: Apply, picked: readonly string[] | null, done: Edits): Stage {
  return {
    prompt,
    expects: 'pick',
    accept(entry, env, last) {
      if (isEnter(entry)) return finish(opsOfResult(done));
      const hit = readPick(entry, env, last);
      if (!hit.ok) return stay(hit.message);
      const { entity, at, entered } = hit.value;
      if (done.removed.includes(entity.id)) return stay(copy.NOTHING_TO_PICK);
      const entities = workingEntities(command, env, done);
      const result = apply(entities[entity.id], at, edgeEntities(env, entities, done, picked, entity.id));
      if (isRefusal(result)) return stay(result.refused, entered ?? undefined);
      return next(partStage(command, prompt, apply, picked, merged(done, result)), entered ?? undefined);
    },
  };
}

function edgedCommand(name: string, alias: string, edgesPrompt: string, partPrompt: string, apply: Apply): Definition {
  const parts = (picked: readonly string[]): Stage => partStage(name, partPrompt, apply, picked.length > 0 ? picked : null, NOTHING_DONE);
  return { name, alias, edits: true, begin: () => next(pickMany(edgesPrompt, () => true, (picked) => next(parts(picked)))) };
}

export const TRIM = edgedCommand('TRIM', 'TR', PROMPTS.TRIM.edges, PROMPTS.TRIM.part, trim);
export const EXTEND = edgedCommand('EXTEND', 'EX', PROMPTS.EXTEND.boundaries, PROMPTS.EXTEND.end, extend);
