import { sharedRefresh } from './api';

export interface StreamHandlers {
  onEvent(event: string, data: unknown): void;
}

/**
 * Reads a server-sent event stream over fetch, so a 401 can wait on the one
 * shared refresh before the stream reconnects.
 */
export function openStream(path: string, handlers: StreamHandlers, signal: AbortSignal): void {
  let stopped = false;
  signal.addEventListener('abort', () => {
    stopped = true;
  });

  const run = async (): Promise<void> => {
    let attempt = 0;
    while (!stopped) {
      try {
        const response = await fetch(path, { headers: { Accept: 'text/event-stream' }, signal });
        if (response.status === 401) {
          const renewed = await sharedRefresh();
          if (!renewed) return;
          continue;
        }
        if (!response.ok || response.body === null) {
          attempt += 1;
          await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 200 * attempt)));
          continue;
        }
        attempt = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let name = 'message';
            const dataLines: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event: ')) name = line.slice(7);
              else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
            }
            if (dataLines.length > 0) {
              try {
                handlers.onEvent(name, JSON.parse(dataLines.join('\n')));
              } catch {
                /* a frame that is not JSON is ignored */
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (stopped) return;
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 200 * attempt)));
      }
    }
  };
  void run();
}
