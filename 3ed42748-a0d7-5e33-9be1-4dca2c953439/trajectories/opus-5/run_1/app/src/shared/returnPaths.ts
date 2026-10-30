export const MISSION_ID_SHAPE = /^[a-z0-9-]{1,64}$/;

const RETURN_PATH_SHAPE = /^\/(?:|console(?:\?mission=[a-z0-9-]{1,64})?)$/;

export const DEFAULT_RETURN_PATH = '/';

export type ReturnPathFault = 'invalid' | 'too_long';

/** The only paths a postbox key may lead back to. */
export function checkReturnPath(raw: unknown): { path: string } | { fault: ReturnPathFault } {
  if (typeof raw !== 'string') return { fault: 'invalid' };
  if (raw.length > 200) return { fault: 'too_long' };
  if (!RETURN_PATH_SHAPE.test(raw)) return { fault: 'invalid' };
  return { path: raw };
}
