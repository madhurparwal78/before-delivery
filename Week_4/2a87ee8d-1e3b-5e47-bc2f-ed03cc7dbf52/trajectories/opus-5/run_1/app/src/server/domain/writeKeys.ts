import { AppError, FIELD_MESSAGES, type FieldErrors } from '../errors.js';

/**
 * The one place the accepted keys of each board write are declared. A board write accepts
 * exactly these keys at the top level and inside each nested object; any other key answers
 * 422 under that key's path with "This field can't be set".
 */
export const BOARD_WRITE_SHAPES = {
  createFrame: { top: ['clientOpId', 'title', 'x', 'y', 'width', 'height'], nested: {} },
  patchFrame: { top: ['clientOpId', 'title', 'x', 'y', 'width', 'height'], nested: {} },
  trashFrame: { top: ['clientOpId'], nested: {} },
  restoreTrash: { top: ['clientOpId'], nested: {} },
  createNote: {
    top: ['clientOpId', 'frameId', 'kind', 'text', 'imageId', 'x', 'y', 'facilitatorOnly'],
    nested: {},
  },
  patchNote: {
    top: ['clientOpId', 'position', 'text', 'placement', 'facilitatorOnly'],
    nested: { position: ['x', 'y'], placement: ['frameId', 'clusterId', 'index'] },
  },
  createCluster: { top: ['clientOpId', 'frameId', 'title', 'x', 'y'], nested: {} },
  patchCluster: { top: ['clientOpId', 'title', 'x', 'y'], nested: {} },
  createConnector: { top: ['clientOpId', 'fromNoteId', 'toNoteId'], nested: {} },
  spendDot: { top: ['clientOpId'], nested: {} },
  returnDot: { top: ['clientOpId'], nested: {} },
  restoreVersion: { top: ['clientOpId'], nested: {} },
} as const satisfies Record<string, { top: readonly string[]; nested: Readonly<Record<string, readonly string[]>> }>;

export type BoardWriteShape = keyof typeof BOARD_WRITE_SHAPES;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collects a field error for every key the shape does not publish, at the top level and
 * inside each published nested object. Returns the unknown-key errors found.
 */
export function unknownKeyErrors(shape: BoardWriteShape, body: Record<string, unknown>): FieldErrors {
  const definition = BOARD_WRITE_SHAPES[shape];
  const allowedTop = new Set<string>(definition.top);
  const nested = definition.nested as Readonly<Record<string, readonly string[]>>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowedTop.has(key)) {
      errors[key] = FIELD_MESSAGES.unknownKey;
      continue;
    }
    const allowedNested = nested[key];
    if (!allowedNested) continue;
    const value = body[key];
    if (!isPlainObject(value)) continue;
    const allowedNestedSet = new Set<string>(allowedNested);
    for (const innerKey of Object.keys(value)) {
      if (!allowedNestedSet.has(innerKey)) errors[`${key}.${innerKey}`] = FIELD_MESSAGES.unknownKey;
    }
  }
  return errors;
}

const CLIENT_OP_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function readClientOpId(body: Record<string, unknown>): string {
  const value = body.clientOpId;
  if (typeof value !== 'string' || !CLIENT_OP_ID_PATTERN.test(value)) {
    throw new AppError('validation', { fields: { clientOpId: FIELD_MESSAGES.clientOpId } });
  }
  return value;
}

/**
 * A note's fields form four groups. Each group keeps the value of the write the server
 * committed last, so writes to different groups never overwrite each other.
 */
export const NOTE_FIELD_GROUPS = ['position', 'text', 'placement', 'facilitatorOnly'] as const;
export type NoteFieldGroup = (typeof NOTE_FIELD_GROUPS)[number];

export function noteFieldGroupsInBody(body: Record<string, unknown>): NoteFieldGroup[] {
  return NOTE_FIELD_GROUPS.filter((group) => Object.hasOwn(body, group));
}
