import { join } from 'node:path';

const ROOT = __dirname;

/** Built assets sit beside the server bundle, so nothing outside dist is ever served. */
export const assetPath = (...parts: string[]): string => join(ROOT, ...parts);
