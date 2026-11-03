import { isStyleKey, isValidStyleString, styleKeyHint } from './style.js';
import type {
  Breakpoint,
  Collection,
  Entry,
  Field,
  NodeType,
  Page,
  PlinthNode,
  Props,
  SharedComponent,
  SizeUnit,
  StyleKey,
  StyleValue,
  TokenKind,
} from './types.js';
import { BREAKPOINTS, NODE_TYPE_LABELS } from './types.js';

export type Fields = Record<string, string>;

export class OpFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Fields | undefined;

  constructor(status: number, code: string, message: string, fields?: Fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function invalid(fields: Fields, message = 'Some values are not valid.'): OpFailure {
  return new OpFailure(422, 'invalid', message, fields);
}

export function invalidMove(fields: Fields): OpFailure {
  return new OpFailure(422, 'invalid_move', "That move isn't allowed.", fields);
}

export function notFound(): OpFailure {
  return new OpFailure(404, 'not_found', 'Not found.');
}

export interface InsertNodeOp {
  kind: 'insert_node';
  pageId: string;
  parentId: string;
  index: number;
  type: NodeType;
  props?: Props;
  name?: string;
}
export interface InsertInstanceOp {
  kind: 'insert_instance';
  pageId: string;
  parentId: string;
  index: number;
  componentId: string;
}
export interface MoveNodeOp {
  kind: 'move_node';
  nodeId: string;
  parentId: string;
  index: number;
}
export interface DeleteNodeOp {
  kind: 'delete_node';
  nodeId: string;
}
export interface DuplicateNodeOp {
  kind: 'duplicate_node';
  nodeId: string;
}
export interface RenameNodeOp {
  kind: 'rename_node';
  nodeId: string;
  name: string;
}
export interface SetPropOp {
  kind: 'set_prop';
  nodeId: string;
  prop: string;
  value: string | number;
}
export interface SetStyleOp {
  kind: 'set_style';
  nodeId: string;
  breakpoint: Breakpoint;
  property: StyleKey;
  value: StyleValue;
}
export interface ClearStyleOp {
  kind: 'clear_style';
  nodeId: string;
  breakpoint: Breakpoint;
  property: StyleKey;
}
export interface SetTokenOp {
  kind: 'set_token';
  name: string;
  tokenKind?: TokenKind;
  value: string | number;
  unit?: SizeUnit;
}
export interface RenameTokenOp {
  kind: 'rename_token';
  name: string;
  newName: string;
}
export interface DeleteTokenOp {
  kind: 'delete_token';
  name: string;
}
export interface CreateComponentOp {
  kind: 'create_component';
  nodeId: string;
  name: string;
}
export interface DetachInstanceOp {
  kind: 'detach_instance';
  nodeId: string;
}
export interface DeleteComponentOp {
  kind: 'delete_component';
  componentId: string;
}
export interface SetFieldsOp {
  kind: 'set_fields';
  fields: Field[];
}
export interface PutEntryOp {
  kind: 'put_entry';
  entryId?: string;
  values: Record<string, string>;
}
export interface MoveEntryOp {
  kind: 'move_entry';
  entryId: string;
  index: number;
}
export interface DeleteEntryOp {
  kind: 'delete_entry';
  entryId: string;
}
export interface BindPropOp {
  kind: 'bind_prop';
  nodeId: string;
  prop: string;
  field: string | null;
}
export interface AddPageOp {
  kind: 'add_page';
  name: string;
}
export interface RenamePageOp {
  kind: 'rename_page';
  pageId: string;
  name: string;
}
export interface UndoOp {
  kind: 'undo';
}
export interface RedoOp {
  kind: 'redo';
}
export interface RestoreOp {
  kind: 'restore';
  versionId: string;
  versionName: string;
}

/** Inverses the server writes for undo; never accepted from a client. */
export interface RestoreSubtreeOp {
  kind: 'restore_subtree';
  parentId: string;
  index: number;
  node: PlinthNode;
}
export interface RestoreDocOp {
  kind: 'restore_doc';
  document: unknown;
}
export interface AttachInstanceOp {
  kind: 'attach_instance';
  nodeId: string;
  componentId: string;
}
export interface RemoveComponentOp {
  kind: 'remove_component';
  componentId: string;
}
export interface RestoreComponentOp {
  kind: 'restore_component';
  component: SharedComponent;
}
export interface RestoreCollectionOp {
  kind: 'restore_collection';
  collection: Collection;
}
export interface RestoreEntryOp {
  kind: 'restore_entry';
  entry: Entry;
  index: number;
}
export interface RemovePageOp {
  kind: 'remove_page';
  pageId: string;
}
export interface RestorePageOp {
  kind: 'restore_page';
  page: Page;
  index: number;
}

export type PublicOp =
  | InsertNodeOp
  | InsertInstanceOp
  | MoveNodeOp
  | DeleteNodeOp
  | DuplicateNodeOp
  | RenameNodeOp
  | SetPropOp
  | SetStyleOp
  | ClearStyleOp
  | SetTokenOp
  | RenameTokenOp
  | DeleteTokenOp
  | CreateComponentOp
  | DetachInstanceOp
  | DeleteComponentOp
  | SetFieldsOp
  | PutEntryOp
  | MoveEntryOp
  | DeleteEntryOp
  | BindPropOp
  | AddPageOp
  | RenamePageOp
  | UndoOp
  | RedoOp
  | RestoreOp;

export type InternalOp =
  | RestoreSubtreeOp
  | RestoreDocOp
  | AttachInstanceOp
  | RemoveComponentOp
  | RestoreComponentOp
  | RestoreCollectionOp
  | RestoreEntryOp
  | RemovePageOp
  | RestorePageOp;

export type Op = PublicOp | InternalOp;

const NODE_TYPES: readonly NodeType[] = [
  'page',
  'section',
  'stack',
  'heading',
  'text',
  'image',
  'button',
  'nav',
  'collection_list',
];

const PROPS_BY_TYPE: Record<NodeType, readonly string[]> = {
  page: [],
  section: [],
  stack: [],
  nav: [],
  collection_list: [],
  heading: ['text', 'level'],
  text: ['text'],
  button: ['text', 'href'],
  image: ['imageId', 'alt', 'focalX', 'focalY'],
};

export function propsOfType(type: NodeType): readonly string[] {
  return PROPS_BY_TYPE[type];
}

export function mainPropOf(type: NodeType): string | undefined {
  if (type === 'heading' || type === 'text' || type === 'button') return 'text';
  if (type === 'image') return 'imageId';
  return undefined;
}

export function bindableFieldKinds(type: NodeType, prop: string): readonly Field['kind'][] {
  if (prop !== mainPropOf(type)) return [];
  if (type === 'text') return ['text', 'rich_text'];
  if (type === 'heading' || type === 'button') return ['text'];
  if (type === 'image') return ['image'];
  return [];
}

export const TOKEN_NAME_RE = /^[a-z0-9-]{1,40}$/;
const HREF_RE = /^(https?:\/\/|mailto:|\/)/;

export function isValidHref(value: string): boolean {
  return HREF_RE.test(value);
}

export function defaultPropsFor(type: NodeType, name: string): Props {
  switch (type) {
    case 'heading':
      return { text: name, level: 1 };
    case 'text':
      return { text: 'Text' };
    case 'button':
      return { text: name, href: '/' };
    case 'image':
      return { imageId: '', alt: '', focalX: 50, focalY: 50 };
    default:
      return {};
  }
}

export function defaultNodeName(type: NodeType, countOnPage: number): string {
  return `${NODE_TYPE_LABELS[type]} ${countOnPage + 1}`;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid({ [path]: 'Expected an object.' });
  }
  return value as Record<string, unknown>;
}

function takeString(raw: Record<string, unknown>, key: string, max: number): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length < 1 || value.length > max) {
    throw invalid({ [key]: `Expected text of 1 to ${max} characters.` });
  }
  return value;
}

function takeIndex(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid({ [key]: 'Expected a whole number of 0 or more.' });
  }
  return value;
}

function takeEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = raw[key];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw invalid({ [key]: `Expected one of ${allowed.join(', ')}.` });
  }
  return value as T;
}

function checkExactKeys(raw: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) throw invalid({ [key]: 'Unknown field for this operation.' });
  }
}

export function parseProps(type: NodeType, raw: unknown): Props {
  const record = asRecord(raw, 'props');
  const allowed = PROPS_BY_TYPE[type];
  const out: Props = {};
  for (const [key, value] of Object.entries(record)) {
    if (!allowed.includes(key)) throw invalid({ [`props.${key}`]: 'Unknown prop for this type.' });
    out[key] = parsePropValue(type, key, value);
  }
  return out;
}

export function parsePropValue(type: NodeType, prop: string, value: unknown): string | number {
  if (!PROPS_BY_TYPE[type].includes(prop)) {
    throw invalid({ prop: 'Unknown prop for this type.' });
  }
  if (prop === 'level') {
    if (value !== 1 && value !== 2 && value !== 3) {
      throw invalid({ value: 'Heading level is 1, 2 or 3.' });
    }
    return value;
  }
  if (prop === 'focalX' || prop === 'focalY') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
      throw invalid({ value: 'Focal values are whole numbers from 0 to 100.' });
    }
    return value;
  }
  if (typeof value !== 'string') throw invalid({ value: 'Expected text.' });
  if (value.length > 2000) throw invalid({ value: 'Use 2,000 characters or fewer.' });
  if (prop === 'href' && value !== '' && !isValidHref(value)) {
    throw invalid({ value: 'Links start with http:, https:, mailto: or /.' });
  }
  if (prop === 'alt' && value.trim() === '') {
    throw invalid({ value: 'Alt text is required.' });
  }
  return value;
}

export function parseStyleValue(property: StyleKey, raw: unknown): StyleValue {
  if (typeof raw === 'string') {
    if (!isValidStyleString(property, raw)) throw invalid({ value: styleKeyHint(property) });
    return raw;
  }
  const record = asRecord(raw, 'value');
  checkExactKeys(record, ['token']);
  const token = record['token'];
  if (typeof token !== 'string' || !TOKEN_NAME_RE.test(token)) {
    throw invalid({ 'value.token': 'Expected a token name.' });
  }
  return { token };
}

function parseStyleKey(raw: Record<string, unknown>): StyleKey {
  const property = raw['property'];
  if (typeof property !== 'string' || !isStyleKey(property)) {
    throw invalid({ property: 'Unknown style property.' });
  }
  return property;
}

function parseFields(raw: unknown): Field[] {
  if (!Array.isArray(raw)) throw invalid({ fields: 'Expected a list of fields.' });
  if (raw.length > 20) throw invalid({ fields: 'A collection holds at most 20 fields.' });
  const out: Field[] = [];
  raw.forEach((item, i) => {
    const record = asRecord(item, `fields.${i}`);
    checkExactKeys(record, ['name', 'kind']);
    const name = record['name'];
    if (typeof name !== 'string' || name.length < 1 || name.length > 80) {
      throw invalid({ [`fields.${i}.name`]: 'Expected a name of 1 to 80 characters.' });
    }
    const kind = record['kind'];
    if (kind !== 'text' && kind !== 'rich_text' && kind !== 'image') {
      throw invalid({ [`fields.${i}.kind`]: 'Expected text, rich_text or image.' });
    }
    if (out.some((f) => f.name === name)) {
      throw invalid({ [`fields.${i}.name`]: 'Field names are unique.' });
    }
    out.push({ name, kind });
  });
  return out;
}

function parseValues(raw: unknown): Record<string, string> {
  const record = asRecord(raw, 'values');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string') throw invalid({ [`values.${key}`]: 'Expected text.' });
    out[key] = value;
  }
  return out;
}

/** Reads one operation body from a request, refusing unknown or wrong fields. */
export function parseOp(raw: unknown): PublicOp {
  const record = asRecord(raw, 'op');
  const kind = record['kind'];
  if (typeof kind !== 'string') throw invalid({ kind: 'Expected an operation kind.' });
  const rest = { ...record };
  delete rest['kind'];
  delete rest['opId'];
  delete rest['baseSeq'];
  switch (kind) {
    case 'insert_node': {
      checkExactKeys(rest, ['pageId', 'parentId', 'index', 'type', 'props', 'name']);
      const op: InsertNodeOp = {
        kind,
        pageId: takeString(rest, 'pageId', 64),
        parentId: takeString(rest, 'parentId', 64),
        index: takeIndex(rest, 'index'),
        type: takeEnum(rest, 'type', NODE_TYPES),
      };
      if (rest['props'] !== undefined) op.props = parseProps(op.type, rest['props']);
      if (rest['name'] !== undefined) op.name = takeString(rest, 'name', 80);
      return op;
    }
    case 'insert_instance':
      checkExactKeys(rest, ['pageId', 'parentId', 'index', 'componentId']);
      return {
        kind,
        pageId: takeString(rest, 'pageId', 64),
        parentId: takeString(rest, 'parentId', 64),
        index: takeIndex(rest, 'index'),
        componentId: takeString(rest, 'componentId', 64),
      };
    case 'move_node':
      checkExactKeys(rest, ['nodeId', 'parentId', 'index']);
      return {
        kind,
        nodeId: takeString(rest, 'nodeId', 64),
        parentId: takeString(rest, 'parentId', 64),
        index: takeIndex(rest, 'index'),
      };
    case 'delete_node':
    case 'duplicate_node':
    case 'detach_instance':
      checkExactKeys(rest, ['nodeId']);
      return { kind, nodeId: takeString(rest, 'nodeId', 64) };
    case 'rename_node':
      checkExactKeys(rest, ['nodeId', 'name']);
      return {
        kind,
        nodeId: takeString(rest, 'nodeId', 64),
        name: takeString(rest, 'name', 80),
      };
    case 'set_prop': {
      checkExactKeys(rest, ['nodeId', 'prop', 'value']);
      const prop = rest['prop'];
      if (typeof prop !== 'string') throw invalid({ prop: 'Expected a prop name.' });
      const value = rest['value'];
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw invalid({ value: 'Expected text or a number.' });
      }
      return { kind, nodeId: takeString(rest, 'nodeId', 64), prop, value };
    }
    case 'set_style': {
      checkExactKeys(rest, ['nodeId', 'breakpoint', 'property', 'value']);
      const property = parseStyleKey(rest);
      return {
        kind,
        nodeId: takeString(rest, 'nodeId', 64),
        breakpoint: takeEnum(rest, 'breakpoint', BREAKPOINTS),
        property,
        value: parseStyleValue(property, rest['value']),
      };
    }
    case 'clear_style':
      checkExactKeys(rest, ['nodeId', 'breakpoint', 'property']);
      return {
        kind,
        nodeId: takeString(rest, 'nodeId', 64),
        breakpoint: takeEnum(rest, 'breakpoint', BREAKPOINTS),
        property: parseStyleKey(rest),
      };
    case 'set_token': {
      checkExactKeys(rest, ['name', 'tokenKind', 'value', 'unit']);
      const name = takeString(rest, 'name', 40);
      if (!TOKEN_NAME_RE.test(name)) {
        throw invalid({ name: 'Token names use lowercase letters, digits and hyphens.' });
      }
      const value = rest['value'];
      const stated =
        rest['tokenKind'] === undefined
          ? undefined
          : takeEnum<TokenKind>(rest, 'tokenKind', ['color', 'size']);
      const tokenKind = stated ?? (typeof value === 'number' ? 'size' : 'color');
      if (tokenKind === 'color') {
        if (typeof value !== 'string' || !isValidStyleString('color', value)) {
          throw invalid({ value: 'A colour token takes a CSS named colour.' });
        }
        if (rest['unit'] !== undefined) throw invalid({ unit: 'A colour token has no unit.' });
        return { kind, name, tokenKind, value };
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999) {
        throw invalid({ value: 'A size token takes a number from 0 to 999.' });
      }
      const unit =
        rest['unit'] === undefined ? 'px' : takeEnum<SizeUnit>(rest, 'unit', ['px', 'rem']);
      return { kind, name, tokenKind, value, unit };
    }
    case 'rename_token': {
      checkExactKeys(rest, ['name', 'newName']);
      const newName = takeString(rest, 'newName', 40);
      if (!TOKEN_NAME_RE.test(newName)) {
        throw invalid({ newName: 'Token names use lowercase letters, digits and hyphens.' });
      }
      return { kind, name: takeString(rest, 'name', 40), newName };
    }
    case 'delete_token':
      checkExactKeys(rest, ['name']);
      return { kind, name: takeString(rest, 'name', 40) };
    case 'create_component':
      checkExactKeys(rest, ['nodeId', 'name']);
      return {
        kind,
        nodeId: takeString(rest, 'nodeId', 64),
        name: takeString(rest, 'name', 80),
      };
    case 'delete_component':
      checkExactKeys(rest, ['componentId']);
      return { kind, componentId: takeString(rest, 'componentId', 64) };
    case 'set_fields':
      checkExactKeys(rest, ['fields']);
      return { kind, fields: parseFields(rest['fields']) };
    case 'put_entry': {
      checkExactKeys(rest, ['entryId', 'values']);
      const op: PutEntryOp = { kind, values: parseValues(rest['values']) };
      if (rest['entryId'] !== undefined) op.entryId = takeString(rest, 'entryId', 64);
      return op;
    }
    case 'move_entry':
      checkExactKeys(rest, ['entryId', 'index']);
      return {
        kind,
        entryId: takeString(rest, 'entryId', 64),
        index: takeIndex(rest, 'index'),
      };
    case 'delete_entry':
      checkExactKeys(rest, ['entryId']);
      return { kind, entryId: takeString(rest, 'entryId', 64) };
    case 'bind_prop': {
      checkExactKeys(rest, ['nodeId', 'prop', 'field']);
      const prop = rest['prop'];
      if (typeof prop !== 'string') throw invalid({ prop: 'Expected a prop name.' });
      const field = rest['field'];
      if (field !== null && typeof field !== 'string') {
        throw invalid({ field: 'Expected a field name or null.' });
      }
      return { kind, nodeId: takeString(rest, 'nodeId', 64), prop, field };
    }
    case 'add_page':
      checkExactKeys(rest, ['name']);
      return { kind, name: takeString(rest, 'name', 80) };
    case 'rename_page':
      checkExactKeys(rest, ['pageId', 'name']);
      return {
        kind,
        pageId: takeString(rest, 'pageId', 64),
        name: takeString(rest, 'name', 80),
      };
    case 'undo':
    case 'redo':
      checkExactKeys(rest, []);
      return { kind };
    case 'restore':
      throw invalid({ kind: 'A restore is written by the restore route.' });
    default:
      throw invalid({ kind: 'Unknown operation kind.' });
  }
}
