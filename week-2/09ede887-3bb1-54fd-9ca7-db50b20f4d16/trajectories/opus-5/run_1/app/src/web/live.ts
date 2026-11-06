const INTERVAL_MS = 4000;

/**
 * Re-reads a page's data while the tab is visible, and again whenever the tab
 * regains focus, so a change made anywhere else shows within five seconds.
 */
export function startLiveRefresh(refresh: () => Promise<void>): () => void {
  let running = false;
  const tick = (): void => {
    if (running || document.visibilityState !== 'visible') return;
    running = true;
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = window.setInterval(tick, INTERVAL_MS);
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', tick);
    window.removeEventListener('focus', tick);
  };
}
