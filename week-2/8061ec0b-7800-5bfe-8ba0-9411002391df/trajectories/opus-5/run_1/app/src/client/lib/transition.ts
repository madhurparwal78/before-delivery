interface RowOrigin {
  contractId: string;
  box: { top: number; left: number; width: number; height: number };
}

let pending: RowOrigin | null = null;

/** Remembers the register entry a contract sheet was opened from, so its header can grow out of it. */
export function setRowOrigin(contractId: string, element: Element): void {
  const box = element.getBoundingClientRect();
  pending = { contractId, box: { top: box.top, left: box.left, width: box.width, height: box.height } };
}

export function takeRowOrigin(contractId: string): RowOrigin['box'] | null {
  if (pending === null || pending.contractId !== contractId) return null;
  const box = pending.box;
  pending = null;
  return box;
}
