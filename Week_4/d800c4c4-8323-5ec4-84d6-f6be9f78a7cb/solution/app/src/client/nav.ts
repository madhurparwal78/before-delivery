// In-app navigation from Join to Account, so the first Account landing knows it came straight from a join.
let joinedJustNow = false;
let listener: () => void = () => undefined;

export function goToAccountAfterJoin(): void {
  joinedJustNow = true;
  window.history.pushState(null, "", "/account");
  listener();
}

export function takeJoinedFlag(): boolean {
  const value = joinedJustNow;
  joinedJustNow = false;
  return value;
}

export function onNavigate(callback: () => void): void {
  listener = callback;
}
