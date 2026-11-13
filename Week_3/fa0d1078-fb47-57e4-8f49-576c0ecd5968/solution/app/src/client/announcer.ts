let pending: number | null = null;

/**
 * Writes a sentence into the page's one live region. Repeating the sentence that is already there clears
 * the text first and sets it again on the next animation frame so it is announced again.
 */
export function announce(sentence: string): void {
  const region = document.getElementById("announcer");
  if (!region) return;
  if (pending !== null) cancelAnimationFrame(pending);
  pending = null;
  if (region.textContent !== sentence) {
    region.textContent = sentence;
    return;
  }
  region.textContent = "";
  pending = requestAnimationFrame(() => {
    pending = null;
    region.textContent = sentence;
  });
}
