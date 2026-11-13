/** Scene JSON import: the ordered refusals of the brief, then the complete working document. */
import {
  completeDocument,
  type DocumentDraft,
  type LayerDraft,
  type SceneDraft,
} from '../shared/document';
import { missingField, MESSAGES, outOfRange, schemaTooNew, unknownKind } from '../shared/messages';
import { isObject } from '../shared/paths';
import { findLayerDefinition, findSceneDefinition } from '../shared/properties';
import { findProject, openProject } from './access';
import { now } from './clock';
import { config } from './config';
import { query, transaction } from './db';
import { forbidden, invalid, json, newId, notFound, router, storageDown, type Ctx, type Reply } from './http';
import { createProject } from './routes/projects';
import { importKey, StorageUnavailable } from './s3';
import { storage } from './services';
import { LAYER_KINDS, SCHEMA_VERSION, type Json, type JsonObject, type Seeds, type SceneDocument } from '../shared/types';

type ImportResult = { error: string } | { document: SceneDocument };

const asObjects = (value: Json | undefined): JsonObject[] => (Array.isArray(value) ? value.filter(isObject) : []);

/** A required field is missing when it is absent, or null. */
const absent = (object: JsonObject, key: string): boolean => object[key] === undefined || object[key] === null;

function missingFieldError(root: JsonObject): string | null {
  for (const key of ['name', 'scenes']) if (absent(root, key)) return missingField(key);
  const scenes = root['scenes'];
  if (!Array.isArray(scenes)) return missingField('scenes');
  for (const [i, scene] of scenes.entries()) {
    const at = `scenes[${i}]`;
    if (!isObject(scene)) return missingField(`${at}.id`);
    for (const key of ['id', 'name', 'layers']) if (absent(scene, key)) return missingField(`${at}.${key}`);
    const layers = scene['layers'];
    if (!Array.isArray(layers)) return missingField(`${at}.layers`);
    for (const [j, layer] of layers.entries()) {
      const where = `${at}.layers[${j}]`;
      if (!isObject(layer)) return missingField(`${where}.id`);
      for (const key of ['id', 'name', 'kind']) if (absent(layer, key)) return missingField(`${where}.${key}`);
    }
  }
  return null;
}

function unknownKindError(root: JsonObject): string | null {
  for (const [i, scene] of asObjects(root['scenes']).entries()) {
    for (const [j, layer] of asObjects(scene['layers']).entries()) {
      const kind = layer['kind'];
      if (typeof kind !== 'string' || !(LAYER_KINDS as readonly string[]).includes(kind)) {
        return unknownKind(String(kind), `scenes[${i}].layers[${j}].kind`);
      }
    }
  }
  return null;
}

type Lookup = (dotted: string) => { min?: number; max?: number; control: string } | undefined;

/** The first numeric leaf, in file order, that lies outside the range of its definition. */
function rangeProblem(value: Json | undefined, path: string, dotted: string, lookup: Lookup): string | null {
  if (typeof value === 'number') {
    const def = lookup(dotted);
    if (def?.control === 'spin' && def.min !== undefined && def.max !== undefined && (value < def.min || value > def.max)) {
      return outOfRange(path, value, def.min, def.max);
    }
    return null;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = rangeProblem(child, `${path}.${key}`, dotted ? `${dotted}.${key}` : key, lookup);
      if (problem) return problem;
    }
  }
  return null;
}

function layerRangeProblem(layer: JsonObject, path: string): string | null {
  const props = isObject(layer['props']) ? layer['props'] : {};
  const source = { kind: layer['kind'] as (typeof LAYER_KINDS)[number], props };
  const lookup: Lookup = (dotted) => findLayerDefinition(source, dotted);
  for (const [key, value] of Object.entries(layer)) {
    let problem: string | null = null;
    if (key === 'props') problem = rangeProblem(value, `${path}.props`, '', lookup);
    else if (key === 'events') problem = rangeProblem(value, `${path}.events`, 'events', lookup);
    else if (key === 'overrides' && isObject(value)) {
      for (const [level, entries] of Object.entries(value)) {
        problem = problem ?? rangeProblem(entries, `${path}.overrides.${level}`, '', lookup);
      }
    } else if (key === 'keyframes' && Array.isArray(value)) {
      for (const [k, frame] of value.entries()) {
        if (!isObject(frame) || typeof frame['property'] !== 'string') continue;
        problem = problem ?? rangeProblem(frame['value'], `${path}.keyframes[${k}].value`, frame['property'], lookup);
      }
    }
    if (problem) return problem;
  }
  return null;
}

function rangeError(root: JsonObject): string | null {
  for (const [i, scene] of asObjects(root['scenes']).entries()) {
    const at = `scenes[${i}]`;
    for (const [key, value] of Object.entries(scene)) {
      let problem: string | null = null;
      const sceneLookup: Lookup = (dotted) => findSceneDefinition(dotted);
      if (key === 'layers') {
        for (const [j, layer] of asObjects(value).entries()) problem = problem ?? layerRangeProblem(layer, `${at}.layers[${j}]`);
      } else if (key === 'overrides' && isObject(value)) {
        for (const [level, entries] of Object.entries(value)) problem = problem ?? rangeProblem(entries, `${at}.overrides.${level}`, '', sceneLookup);
      } else if (key !== 'id' && key !== 'name') problem = rangeProblem(value, `${at}.${key}`, key, sceneLookup);
      if (problem) return problem;
    }
  }
  return null;
}

/** Validates the bytes of an import in the brief's order and builds the complete working document. */
function readImport(bytes: Buffer, seeds: Seeds): ImportResult {
  let parsed: Json;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as Json;
  } catch {
    return { error: MESSAGES.jsonInvalid };
  }
  if (!isObject(parsed) || absent(parsed, 'schemaVersion')) return { error: MESSAGES.missingSchemaVersion };
  const version = parsed['schemaVersion'];
  if (typeof version !== 'number' || version > SCHEMA_VERSION) return { error: schemaTooNew(Number(version), SCHEMA_VERSION) };
  const problem = missingFieldError(parsed) ?? unknownKindError(parsed) ?? rangeError(parsed);
  if (problem) return { error: problem };
  const draft: DocumentDraft = {
    name: `${String(parsed['name'])} (imported)`,
    variables: Array.isArray(parsed['variables']) ? (parsed['variables'] as unknown as DocumentDraft['variables']) : [],
    presets: Array.isArray(parsed['presets']) ? (parsed['presets'] as unknown as DocumentDraft['presets']) : [],
    scenes: asObjects(parsed['scenes']).map((scene) => {
      const siblings = new Map<string | null, number>();
      const layers = asObjects(scene['layers']).map((layer) => {
        const parentId = typeof layer['parentId'] === 'string' ? layer['parentId'] : null;
        const next = siblings.get(parentId) ?? 0;
        siblings.set(parentId, next + 1);
        return { ...layer, parentId, order: typeof layer['order'] === 'number' ? layer['order'] : next } as unknown as LayerDraft;
      });
      return { ...scene, layers } as unknown as SceneDraft;
    }),
  };
  return { document: completeDocument(draft, seeds) };
}

async function postImport(ctx: Ctx): Promise<Reply> {
  const person = await ctx.requirePerson();
  const form = await ctx.multipart();
  const workspaceId = form.fields['workspaceId'] ?? '';
  const membership = (
    await query<{ role: string }>('SELECT role FROM workspace_members WHERE workspace_id = $1 AND person_id = $2', [workspaceId, person.id])
  )[0];
  if (!membership) return notFound();
  if (membership.role !== 'Owner') return forbidden(MESSAGES.memberRefusal);
  const file = form.files['file'];
  if (!file) return invalid('file', MESSAGES.invalidValue);
  const result = readImport(file.bytes, config.seeds);
  if ('error' in result) return invalid('file', result.error);
  const id = newId('p');
  await transaction(async (client) => {
    await createProject(client, {
      id,
      workspaceId,
      name: result.document.name,
      ownerId: person.id,
      document: result.document,
      imported: true,
      at: await now(client),
    });
    try {
      await storage.put(importKey(id), file.bytes, 'application/json');
      const head = await storage.head(importKey(id));
      if (!head || head.size !== file.bytes.length) throw new StorageUnavailable('import original not confirmed');
    } catch (error) {
      if (error instanceof StorageUnavailable) return storageDown(MESSAGES.storageUploads);
      throw error;
    }
  });
  return json(201, { project: await findProject(person.id, id) });
}

async function getImportOriginal(ctx: Ctx): Promise<Reply> {
  const { project } = await openProject(ctx, ctx.param('id'));
  const rows = await query<{ imported: boolean }>('SELECT imported FROM projects WHERE id = $1', [project.id]);
  if (!rows[0]?.imported) return notFound();
  let bytes: Buffer | null;
  try {
    bytes = await storage.get(importKey(project.id));
  } catch (error) {
    if (error instanceof StorageUnavailable) return storageDown(MESSAGES.storageUploads);
    throw error;
  }
  if (!bytes) return notFound();
  return { status: 200, raw: bytes, contentType: 'application/json' };
}

export function registerImportRoutes(): void {
  router.post('/api/imports', postImport);
  router.get('/api/projects/:id/import/original', getImportOriginal);
}
