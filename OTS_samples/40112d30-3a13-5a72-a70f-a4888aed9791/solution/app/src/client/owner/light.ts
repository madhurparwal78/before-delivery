// One item is lit at a time: the first at first, then whichever is hovered or focused.

export function lightOne(items: HTMLElement[], first: HTMLElement | undefined = items[0]): void {
  const light = (lit: HTMLElement): void => {
    for (const item of items) item.toggleAttribute('data-lit', item === lit);
  };
  for (const item of items) {
    item.addEventListener('pointerenter', () => light(item));
    item.addEventListener('focusin', () => light(item));
  }
  if (first) light(first);
}
