// Strongly connected components (Tarjan): cycles in the formula graph and in an edit's
// changed cells. Components come out with every component they point to before them.
export function stronglyConnected(nodes: string[], edges: (n: string) => string[]): string[][] {
  let index = 0;
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    order.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges(v)) {
      if (!order.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, order.get(w)!));
    }
    if (low.get(v) === order.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      out.push(component);
    }
  };
  for (const n of nodes) if (!order.has(n)) visit(n);
  return out;
}
