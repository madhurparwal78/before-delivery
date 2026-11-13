export interface NumeralOrigin {
  numeral: string;
  rect: { top: number; left: number; width: number; height: number };
}

let pending: NumeralOrigin | null = null;

/**
 * Records where a chapter numeral was when its link was followed, so the chapter page can
 * morph that numeral into its header.
 */
export function watchNumeralLinks(): () => void {
  const onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const source = target?.closest<HTMLElement>('[data-numeral]');
    if (!source) return;
    const box = (source.querySelector<HTMLElement>('.numeral') ?? source).getBoundingClientRect();
    pending = {
      numeral: source.dataset.numeral as string,
      rect: { top: box.top, left: box.left, width: box.width, height: box.height },
    };
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

export function takeNumeralOrigin(numeral: string): NumeralOrigin | null {
  if (!pending || pending.numeral !== numeral) return null;
  const origin = pending;
  pending = null;
  return origin;
}
