const CHANNEL_NAME = 'seatwise-cart';

/**
 * Tells the other tabs of this browser that the buyer themselves emptied a cart, by paying for it
 * or by releasing its last seat, so those tabs update silently instead of reporting an ended hold.
 */
export function tellOtherTabsCartClosed(performanceId: string): void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(performanceId);
  channel.close();
}

export function onCartClosedElsewhere(performanceId: string, handle: () => void): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<string>) => {
    if (event.data === performanceId) handle();
  };
  return () => channel.close();
}
