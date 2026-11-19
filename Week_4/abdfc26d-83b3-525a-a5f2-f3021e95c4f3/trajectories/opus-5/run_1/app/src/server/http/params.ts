import type { Request } from 'express';
import { ApiError } from '../errors.js';

/** Reads a declared path parameter; a missing one could only mean a routing slip. */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | undefined>)[name];
  if (value === undefined) throw ApiError.notFound();
  return value;
}
