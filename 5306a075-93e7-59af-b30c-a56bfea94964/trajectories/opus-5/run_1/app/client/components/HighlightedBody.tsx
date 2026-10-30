import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import { buildNoteDoc, type DocNode, type NoteDoc, type SimpleNode } from '../../shared/doc';
import { computeHighlightSegments, type HighlightSegment, type HighlightSpan } from '../../shared/segments';

/** Parses the allowlisted body with the browser, then builds the shared document model. */
export function parseNoteBody(body: string): NoteDoc {
  const parsed = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html');
  return buildNoteDoc(toSimpleNodes(parsed.body.childNodes));
}

function toSimpleNodes(nodes: NodeListOf<ChildNode>): SimpleNode[] {
  const result: SimpleNode[] = [];
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (value !== '') result.push({ type: 'text', value });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const attrs: Record<string, string> = {};
    for (const attribute of element.getAttributeNames()) {
      attrs[attribute] = element.getAttribute(attribute) ?? '';
    }
    result.push({
      type: 'element',
      tag: element.tagName.toLowerCase(),
      attrs,
      children: toSimpleNodes(element.childNodes),
    });
  });
  return result;
}

interface Piece {
  start: number;
  end: number;
  text: string;
  segment: HighlightSegment | null;
}

function splitTextNode(node: { start: number; text: string }, segments: readonly HighlightSegment[]): Piece[] {
  const nodeEnd = node.start + node.text.length;
  const pieces: Piece[] = [];
  let cursor = node.start;
  for (const segment of segments) {
    if (segment.end <= cursor || segment.start >= nodeEnd) continue;
    const from = Math.max(segment.start, cursor);
    const to = Math.min(segment.end, nodeEnd);
    if (from > cursor) {
      pieces.push({ start: cursor, end: from, text: node.text.slice(cursor - node.start, from - node.start), segment: null });
    }
    pieces.push({ start: from, end: to, text: node.text.slice(from - node.start, to - node.start), segment });
    cursor = to;
  }
  if (cursor < nodeEnd) {
    pieces.push({ start: cursor, end: nodeEnd, text: node.text.slice(cursor - node.start), segment: null });
  }
  return pieces;
}

export interface HighlightedBodyProps {
  doc: NoteDoc;
  spans: readonly HighlightSpan[];
  /** Ticks rendered after the last mark of a saved insight. */
  tickFor?: (insightId: string) => ReactNode;
  onMarkClick?: (segment: HighlightSegment) => void;
}

export function HighlightedBody({ doc, spans, tickFor, onMarkClick }: HighlightedBodyProps): JSX.Element {
  const segments = useMemo(() => computeHighlightSegments(spans), [spans]);
  const lastSegmentFor = useMemo(() => {
    const last = new Map<string, HighlightSegment>();
    for (const segment of segments) for (const id of segment.insightIds) last.set(id, segment);
    return last;
  }, [segments]);

  const renderNodes = (nodes: readonly DocNode[]): ReactNode[] =>
    nodes.map((node, index) => {
      if (node.kind === 'br') return <br key={index} />;
      if (node.kind === 'el') {
        const Tag = node.tag as keyof JSX.IntrinsicElements;
        if (node.tag === 'a') {
          return (
            <a key={index} href={node.href ?? undefined} rel="noopener noreferrer nofollow">
              {renderNodes(node.children)}
            </a>
          );
        }
        return <Tag key={index}>{renderNodes(node.children)}</Tag>;
      }
      return (
        <Fragment key={index}>
          {splitTextNode(node, segments).map((piece, pieceIndex) => {
            if (piece.segment === null) return <Fragment key={pieceIndex}>{piece.text}</Fragment>;
            const segment = piece.segment;
            const ticks = tickFor
              ? segment.insightIds
                  .filter((id) => lastSegmentFor.get(id) === segment && segment.end === piece.end)
                  .map((id) => <Fragment key={id}>{tickFor(id)}</Fragment>)
              : null;
            return (
              <Fragment key={pieceIndex}>
                <mark
                  data-start={piece.start}
                  data-end={piece.end}
                  data-insights={segment.insightIds.join(' ')}
                  {...(segment.pending ? { 'data-pending': 'true' } : {})}
                  className={segment.insightIds.length > 1 ? 'mark mark-overlap' : 'mark'}
                  onClick={onMarkClick && segment.insightIds.length > 0 ? () => onMarkClick(segment) : undefined}
                >
                  {piece.text}
                </mark>
                {ticks}
              </Fragment>
            );
          })}
        </Fragment>
      );
    });

  return <>{renderNodes(doc.nodes)}</>;
}
