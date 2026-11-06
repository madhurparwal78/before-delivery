let pending: string | null = null;

/** Carries the lost-access copy to the Projects screen the browser is sent to. */
export function setNotice(copy: string): void {
  pending = copy;
}

export function takeNotice(): string | null {
  const copy = pending;
  pending = null;
  return copy;
}
