const pending = new Map<string, string>();

/** Carries one action's result copy across a screen change, so the newest result is what shows. */
export function setPendingNotice(key: string, text: string): void {
  pending.set(key, text);
}

export function takePendingNotice(key: string): string | null {
  const text = pending.get(key) ?? null;
  pending.delete(key);
  return text;
}
