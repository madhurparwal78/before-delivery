import { useEffect, useRef } from 'react';

export interface LiveTopics {
  readonly performanceId?: string;
  readonly offerToken?: string;
  readonly owner?: boolean;
}

/** Follows server changes for the given topics and runs `onChange` when one arrives. */
export function useLiveUpdates(topics: LiveTopics, onChange: () => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;
  const { performanceId, offerToken, owner } = topics;

  useEffect(() => {
    const params = new URLSearchParams();
    if (performanceId !== undefined) params.set('performance', performanceId);
    if (offerToken !== undefined) params.set('offer', offerToken);
    if (owner === true) params.set('owner', '1');
    const source = new EventSource(`/api/events?${params.toString()}`);
    source.addEventListener('changed', () => {
      handler.current();
    });
    return () => source.close();
  }, [performanceId, offerToken, owner]);
}
