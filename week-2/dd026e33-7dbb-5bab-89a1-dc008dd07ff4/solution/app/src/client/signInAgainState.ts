// Whether Sign in again is open: re-reads pause until it closes.
let open = false;

export function isSignInAgainOpen(): boolean {
  return open;
}

export function setSignInAgainOpen(next: boolean): void {
  open = next;
}
