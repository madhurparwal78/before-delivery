/** Copy an action showed that belongs on the screen it lands on. */

let carried: string | null = null;

export function carry(copy: string): void {
  carried = copy;
}

export function takeCarried(): string | null {
  const value = carried;
  carried = null;
  return value;
}
