let pending = false;

/** After a sign-in the home screen puts focus on its first row, or on New request when the list is empty. */
export const requestSignInFocus = (): void => {
  pending = true;
};

export function consumeSignInFocus(): boolean {
  const wanted = pending;
  pending = false;
  return wanted;
}
