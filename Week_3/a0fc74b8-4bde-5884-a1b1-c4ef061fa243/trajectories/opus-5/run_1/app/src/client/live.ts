import type {
  DocumentJson,
  DocumentRowJson,
  Role,
  ServiceNotice,
  SignViewJson,
  TemplateJson,
} from '../shared/types.ts';

export interface LivePayload {
  role?: Role;
  notice?: ServiceNotice;
  documents?: DocumentRowJson[];
  document?: DocumentJson | null;
  templates?: TemplateJson[];
  view?: SignViewJson | null;
}

export interface LiveSubscription {
  close: () => void;
}

/** One same-origin live channel per open screen. */
export const subscribe = (
  query: Record<string, string>,
  onPayload: (payload: LivePayload) => void,
): LiveSubscription => {
  const search = new URLSearchParams(query).toString();
  let source: EventSource | null = new EventSource(`/api/events?${search}`);
  source.addEventListener('message', (event: MessageEvent<string>) => {
    try {
      const parsed: unknown = JSON.parse(event.data);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onPayload(parsed);
      }
    } catch {
      /* a malformed frame is simply skipped; the next tick repeats the state */
    }
  });
  return {
    close: () => {
      source?.close();
      source = null;
    },
  };
};
