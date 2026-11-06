/** A sticky bar never covers the tapped or focused control. */
export function keepClearOfBar(scope: HTMLElement, bar: HTMLElement): () => void {
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || bar.contains(target)) return;
    const barTop = bar.getBoundingClientRect().top;
    const bottom = target.getBoundingClientRect().bottom;
    if (bottom <= barTop) return;
    window.scrollBy({ top: bottom - barTop + 16 });
  };
  scope.addEventListener('focusin', onFocusIn);
  return () => scope.removeEventListener('focusin', onFocusIn);
}
