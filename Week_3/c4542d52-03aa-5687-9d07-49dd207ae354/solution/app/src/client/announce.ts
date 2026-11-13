type Listener = (message: string) => void;

const listeners = new Set<Listener>();
const announced = new Set<string>();

export function onAnnouncement(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Says something through the polite "Register updates" region, which exists from first paint. */
export function announce(message: string): void {
  const region = document.getElementById("register-updates");
  if (region) {
    const line = document.createElement("p");
    line.textContent = message;
    region.replaceChildren(line);
  }
  listeners.forEach((listener) => listener(message));
}

/** Announces once per key for the life of the page, however many times the event is seen. */
export function announceOnce(key: string, message: string): void {
  if (announced.has(key)) return;
  announced.add(key);
  announce(message);
}
