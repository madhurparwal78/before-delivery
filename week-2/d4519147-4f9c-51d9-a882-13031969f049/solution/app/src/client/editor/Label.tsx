import { Fragment, type ReactNode } from "react";
import { parseLabel, type LabelNode } from "../../shared/label.ts";

function render(nodes: LabelNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.type === "text") return <Fragment key={i}>{n.text}</Fragment>;
    if (n.type === "br") return <br key={i} />;
    if (n.type === "b") return <b key={i}>{render(n.children)}</b>;
    return <i key={i}>{render(n.children)}</i>;
  });
}

/** A label with only the stack rule's acting tags as formatting; everything else is literal text. */
export function Label({ text }: { text: string }) {
  return <>{render(parseLabel(text))}</>;
}
