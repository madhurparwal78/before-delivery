import { Reply, RequestContext } from '../http';

export type BodyKind = 'json' | 'photo';

export interface Route {
  method: string;
  pattern: string;
  bodyKind: BodyKind;
  needsSession: boolean;
  handle(context: RequestContext): Promise<Reply>;
}

export function route(
  method: string,
  pattern: string,
  needsSession: boolean,
  handle: (context: RequestContext) => Promise<Reply>,
  bodyKind: BodyKind = 'json'
): Route {
  return { method, pattern, bodyKind, needsSession, handle };
}
