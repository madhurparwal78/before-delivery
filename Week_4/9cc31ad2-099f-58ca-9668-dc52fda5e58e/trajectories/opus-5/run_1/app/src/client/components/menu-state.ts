const collapsers = new Set<() => void>();

export function registerMenu(collapse: () => void): () => void {
  collapsers.add(collapse);
  return () => {
    collapsers.delete(collapse);
  };
}

export function collapseMenu(): void {
  for (const collapse of collapsers) collapse();
}
