// The reading view of a note body: the laid-out plain text with highlight segments as <mark> runs.
// Every rendered character is a character of the note's `text`; each run carries its offsets.
import { Check } from "lucide-react";
import { forwardRef, useMemo, type PointerEvent, type ReactNode } from "react";
import type { Insight } from "../../shared/api.js";
import { coveredRuns, slicePiece, type HighlightSpan, type PieceSlice } from "../../shared/highlights.js";
import { isNoteTag, layoutNote, type LaidNode, type NoteNode } from "../../shared/noteText.js";

/** The stored body is already reduced to the allowlist; this reads it back into the shared tree shape. */
function readBody(html: string): NoteNode[] {
  const convert = (nodes: NodeListOf<ChildNode>): NoteNode[] =>
    Array.from(nodes).flatMap((node): NoteNode[] => {
      if (node.nodeType === Node.TEXT_NODE) return [{ type: "text", value: node.textContent ?? "" }];
      if (!(node instanceof Element)) return [];
      const tag = node.tagName.toLowerCase();
      const children = convert(node.childNodes);
      return isNoteTag(tag) ? [{ type: "element", tag, href: node.getAttribute("href"), children }] : children;
    });
  return convert(new DOMParser().parseFromString(html, "text/html").body.childNodes);
}

export interface Pending { start: number; end: number }

interface Props {
  body: string;
  insights: Insight[];
  pending: Pending | null;
  hiddenTicks: ReadonlySet<string>;
  onPendingPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onMarkClick: (insightIds: string[], mark: HTMLElement) => void;
  /** A pointer or keyboard (Shift + arrows) selection may have ended inside the body. */
  onSelectionEnd: (fromKeyboard: boolean) => void;
}

export const NoteBody = forwardRef<HTMLDivElement, Props>(function NoteBody(props, ref) {
  const laid = useMemo(() => layoutNote(readBody(props.body)).nodes, [props.body]);
  const spans: HighlightSpan[] = [
    ...props.insights.map((i) => ({ insightId: i.id, start: i.start, end: i.end })),
    ...(props.pending ? [{ insightId: null, ...props.pending }] : []),
  ];
  const runs = coveredRuns(spans);

  // Pieces in document order, sliced at run edges; the last slice of each insight gets its tick.
  const sliced: PieceSlice[][] = [];
  const collect = (nodes: LaidNode[]): void => {
    for (const node of nodes) {
      if (node.type === "text") sliced.push(slicePiece(node, runs));
      else collect(node.children);
    }
  };
  collect(laid);
  const lastSlice = new Map<string, string>();
  sliced.forEach((slices, p) => slices.forEach((slice, s) => slice.mark?.insightIds.forEach((id) => lastSlice.set(id, `${p}:${s}`))));
  const featureOf = new Map(props.insights.map((i) => [i.id, i.featureName]));

  let pieceIndex = -1;
  const render = (nodes: LaidNode[], keyPrefix: string): ReactNode[] =>
    nodes.map((node, i): ReactNode => {
      const key = `${keyPrefix}${i}`;
      if (node.type === "text") {
        pieceIndex += 1;
        const p = pieceIndex;
        return (sliced[p] ?? []).map((slice, s) => {
          const ticks = [...lastSlice.entries()].filter(([id, at]) => at === `${p}:${s}` && !props.hiddenTicks.has(id)).map(([id]) => id).sort();
          const content = slice.mark ? (
            <mark
              key={`${key}-${s}`}
              data-start={slice.start}
              data-end={slice.end}
              data-insights={slice.mark.insightIds.join(" ")}
              data-pending={slice.mark.pending ? "true" : undefined}
              data-depth={slice.mark.insightIds.length}
              onPointerDown={slice.mark.pending ? props.onPendingPointerDown : undefined}
              onClick={slice.mark.insightIds.length > 0 && !slice.mark.pending
                ? (event) => props.onMarkClick(slice.mark?.insightIds ?? [], event.currentTarget)
                : undefined}
            >
              {slice.value}
            </mark>
          ) : (
            <span key={`${key}-${s}`} data-start={slice.start} data-end={slice.end}>{slice.value}</span>
          );
          return ticks.length === 0 ? content : [
            content,
            ...ticks.map((id) => (
              <span key={`${key}-${s}-tick-${id}`} role="img" aria-label={`Linked to ${featureOf.get(id) ?? ""}`} className="tick" data-tick={id}>
                <Check aria-hidden="true" size={12} strokeWidth={3} />
              </span>
            )),
          ];
        });
      }
      const children = render(node.children, `${key}.`);
      switch (node.tag) {
        case "br": return <br key={key} />;
        case "a": return node.href ? <a key={key} href={node.href} rel="noopener noreferrer nofollow" target="_blank">{children}</a> : <a key={key}>{children}</a>;
        case "p": return <p key={key}>{children}</p>;
        case "strong": return <strong key={key}>{children}</strong>;
        case "b": return <b key={key}>{children}</b>;
        case "em": return <em key={key}>{children}</em>;
        case "i": return <i key={key}>{children}</i>;
        case "u": return <u key={key}>{children}</u>;
        case "ul": return <ul key={key}>{children}</ul>;
        case "ol": return <ol key={key}>{children}</ol>;
        case "li": return <li key={key}>{children}</li>;
        case "blockquote": return <blockquote key={key}>{children}</blockquote>;
        case "code": return <code key={key}>{children}</code>;
        case "pre": return <pre key={key}>{children}</pre>;
      }
    });

  return (
    <div ref={ref} className="note-body" tabIndex={0}
      onPointerUp={() => props.onSelectionEnd(false)}
      onKeyUp={(event) => { if (event.shiftKey) props.onSelectionEnd(true); }}>
      {render(laid, "")}
    </div>
  );
});
