/** Label formatting by the stack rule: only exact `<b>`, `</b>`, `<i>`, `</i>` and `<br>` can act; everything else is literal text. */

export type LabelNode =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "b" | "i"; children: LabelNode[] };

type Token =
  | { kind: "text"; text: string }
  | { kind: "open" | "close"; tag: "b" | "i"; raw: string }
  | { kind: "br"; raw: string };

const TAG = /<(\/?)(b|i)>|<br>/g;

function tokenize(label: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of label.matchAll(TAG)) {
    if (m.index > last) tokens.push({ kind: "text", text: label.slice(last, m.index) });
    if (m[0] === "<br>") tokens.push({ kind: "br", raw: m[0] });
    else tokens.push({ kind: m[1] ? "close" : "open", tag: m[2] as "b" | "i", raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < label.length) tokens.push({ kind: "text", text: label.slice(last) });
  return tokens;
}

/** Marks which tokens act: an opener acts only when a later closer of its kind meets it on top of the stack. */
function acting(tokens: Token[]): boolean[] {
  const acts = tokens.map((t) => t.kind === "br");
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind === "open") stack.push(i);
    else if (t.kind === "close") {
      const top = stack[stack.length - 1];
      if (top !== undefined && (tokens[top] as { tag: string }).tag === t.tag) {
        acts[i] = true;
        acts[top] = true;
        stack.pop();
      }
    }
  });
  return acts;
}

export function parseLabel(label: string): LabelNode[] {
  const tokens = tokenize(label);
  const acts = acting(tokens);
  const root: LabelNode[] = [];
  const stack: LabelNode[][] = [root];
  const push = (node: LabelNode) => {
    const top = stack[stack.length - 1]!;
    const prev = top[top.length - 1];
    if (node.type === "text" && prev?.type === "text") prev.text += node.text;
    else top.push(node);
  };
  tokens.forEach((t, i) => {
    if (t.kind === "text") push({ type: "text", text: t.text });
    else if (!acts[i]) push({ type: "text", text: t.raw });
    else if (t.kind === "br") push({ type: "br" });
    else if (t.kind === "open") {
      const node: LabelNode = { type: t.tag, children: [] };
      push(node);
      stack.push(node.children);
    } else stack.pop();
  });
  return root;
}

/** The label with acting tags removed and acting `<br>` replaced by a space. */
export function plainLabel(label: string): string {
  const walk = (nodes: LabelNode[]): string =>
    nodes.map((n) => (n.type === "text" ? n.text : n.type === "br" ? " " : walk(n.children))).join("");
  return walk(parseLabel(label));
}
