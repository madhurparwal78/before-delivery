/** Game limits the page is served with, so the copy matches the server's settings. */
export function chatLimit(): number {
  const meta = document.querySelector('meta[name="deedfall-chat-limit"]');
  const value = Number(meta?.getAttribute('content'));
  return Number.isFinite(value) ? value : 0;
}
