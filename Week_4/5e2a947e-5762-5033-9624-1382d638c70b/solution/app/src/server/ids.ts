import { randomBytes, randomUUID } from 'node:crypto';

/** A random url-safe id of the length given. */
export const randomId = (length = 12): string => randomBytes(length).toString('base64url').slice(0, length);

/** A random id that fits the client id pattern and is unique per call. */
export const operationId = (): string => randomUUID().replace(/-/g, '').slice(0, 24);
