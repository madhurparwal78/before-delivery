import type { ClosedText } from '../../shared/types.ts';
import { connect, type Live } from '../lib/socket.ts';

interface LiveHandlers {
  closed(text: ClosedText): void;
  moved(): void;
}

/** The response's own socket: the form closing and the response moving to another device arrive here. */
export function joinLive(responseId: string, handlers: LiveHandlers): Live {
  return connect({ type: 'join', response: responseId }, (frame) => {
    if (frame.type === 'form_state' && frame.closed) handlers.closed(frame.closed);
    else if (frame.type === 'moved') handlers.moved();
  });
}
